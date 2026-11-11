import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import type { ClubMatch } from 'proclubs-sdk';
import { TransformError, normalizeMatch, parseEventAggregates, toRawRow } from '../src/transform.ts';

// Fixture con estructura y stats REALES: 10 partidos de liga de "Aston Huila"
// (club ajeno de prueba), descargados con `npm run fetch-fixture` el 2026-11-10.
// Anonimizado (scripts/anonymize.ts): jugadores Jugador_NN / Rival_NN con IDs
// 10000000NN, y rivales "Rival FC NN" con IDs 90000NN.
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/matches-leagueMatch.json', import.meta.url), 'utf8'),
) as ClubMatch[];

const CLUB = '1330384';
const ctx = { clubId: CLUB, matchType: 'leagueMatch' as const, collectedAt: new Date('2026-11-10T12:00:00Z') };

function match(id: string): ClubMatch {
  const m = fixture.find((x) => x.matchId === id);
  assert.ok(m, `falta el partido ${id} en el fixture`);
  return structuredClone(m);
}

function players(m: ClubMatch, clubId: string): Record<string, Record<string, unknown>> {
  return (m.players as Record<string, Record<string, Record<string, unknown>>>)[clubId]!;
}

describe('normalizeMatch con datos reales', () => {
  test('normaliza los 10 partidos del fixture sin errores', () => {
    assert.equal(fixture.length, 10);
    for (const m of fixture) {
      const n = normalizeMatch(m, ctx);
      assert.equal(n.stats.length, Object.keys(players(m, CLUB)).length);
      assert.equal(n.accounts.length, n.stats.length);
    }
  });

  test('empate 2-2 contra Rival FC 01', () => {
    const { match: row } = normalizeMatch(match('165590075320436'), ctx);
    assert.deepEqual(row, {
      match_id: '165590075320436',
      club_id: 1330384,
      match_type: 'leagueMatch',
      played_at: '2026-11-04T04:14:51.000Z',
      goals_for: 2,
      goals_against: 2,
      outcome: 'draw',
      winner_by_dnf: false,
      opponent_club_id: 9000001,
      opponent_name: 'Rival FC 01',
      last_collected_at: '2026-11-10T12:00:00.000Z',
    });
  });

  test('convierte los stats del jugador (strings -> números y booleanos)', () => {
    const { stats } = normalizeMatch(match('165590075320436'), ctx);
    const dark = stats.find((s) => s.player_id === '1000000001');
    assert.ok(dark);
    assert.equal(dark.playername, 'Jugador_01');
    assert.equal(dark.position, 'defender');
    assert.equal(dark.rating, 8.7);
    assert.equal(dark.is_mom, true);
    assert.equal(dark.passes_made, 7);
    assert.equal(dark.pass_attempts, 14);
    assert.equal(dark.tackles_made, 3);
    assert.equal(dark.goals_conceded, 2);
    assert.equal(dark.seconds_played, 5545);
    assert.equal(dark.archetype_id, 4);
    assert.equal(dark.parry_saves, 0);
  });

  test('result=10 con losses=1 se toma como derrota', () => {
    const { match: row } = normalizeMatch(match('165126453510292'), ctx);
    assert.equal(row.outcome, 'loss');
    assert.equal(row.goals_for, 1);
    assert.equal(row.goals_against, 4);
  });

  test('victoria 3-0', () => {
    assert.equal(normalizeMatch(match('165204575600392'), ctx).match.outcome, 'win');
  });

  test('no incluye jugadores del rival', () => {
    const m = match('165590075320436');
    const rivals = new Set(Object.keys(players(m, '9000001')));
    const { stats } = normalizeMatch(m, ctx);
    assert.ok(stats.every((s) => !rivals.has(s.player_id)));
  });

  test('es pura: no modifica la entrada', () => {
    const m = match('165590075320436');
    const before = structuredClone(m);
    normalizeMatch(m, ctx);
    assert.deepEqual(m, before);
  });
});

describe('parseEventAggregates (datos experimentales)', () => {
  test('suma por código las 4 cadenas', () => {
    assert.deepEqual(
      parseEventAggregates({ match_event_aggregate_0: '1:2,174:3', match_event_aggregate_1: '174:1', match_event_aggregate_2: '' }),
      { 1: 2, 174: 4 },
    );
  });

  test('con el fixture real: incluye regates (174) e intercepciones (6)', () => {
    const { stats } = normalizeMatch(match('165590075320436'), ctx);
    const j = stats.find((s) => s.player_id === '1000000001');
    assert.equal(j?.event_counts?.['174'], 11);
    assert.equal(j?.event_counts?.['6'], 3);
  });

  test('sin cadenas -> objeto vacío', () => {
    assert.deepEqual(parseEventAggregates({}), {});
  });

  test('mal formado -> null, sin lanzar error (no se pierde el partido)', () => {
    assert.equal(parseEventAggregates({ match_event_aggregate_0: '1:2,abc' }), null);
    assert.equal(parseEventAggregates({ match_event_aggregate_0: 42 }), null);
  });
});

describe('toRawRow', () => {
  test('guarda el JSON completo, sin tocar', () => {
    const m = match('165590075320436');
    const raw = toRawRow(m, ctx);
    assert.equal(raw.match_id, '165590075320436');
    assert.equal(raw.club_id, 1330384);
    assert.deepEqual(raw.payload, m);
  });

  test('falla si no hay matchId', () => {
    const m = match('165590075320436');
    delete (m as { matchId?: unknown }).matchId;
    assert.throws(() => toRawRow(m, ctx), TransformError);
  });
});

describe('normalizeMatch con datos inválidos', () => {
  test('sin timestamp -> TransformError con el ID del partido', () => {
    const m = match('165590075320436');
    delete (m as { timestamp?: unknown }).timestamp;
    assert.throws(
      () => normalizeMatch(m, ctx),
      (e: unknown) => e instanceof TransformError && e.matchId === '165590075320436' && /timestamp/.test(e.message),
    );
  });

  test('un gol no numérico no se convierte en 0', () => {
    const m = match('165590075320436');
    players(m, CLUB)['1000000001']!.goals = 'abc';
    assert.throws(() => normalizeMatch(m, ctx), /players\.1000000001\.goals/);
  });

  test('mom distinto de 0/1 es inválido', () => {
    const m = match('165590075320436');
    players(m, CLUB)['1000000001']!.mom = '2';
    assert.throws(() => normalizeMatch(m, ctx), /mom/);
  });

  test('resultado ambiguo -> outcome null en vez de adivinar', () => {
    const m = match('165590075320436');
    const club = (m.clubs as Record<string, Record<string, unknown>>)[CLUB]!;
    club.wins = '1';
    club.ties = '1';
    assert.equal(normalizeMatch(m, ctx).match.outcome, null);
  });

  test('el club no aparece en el partido', () => {
    assert.throws(() => normalizeMatch(match('165590075320436'), { ...ctx, clubId: '42' }), /no aparece/);
  });

  test('atajadas detalladas ausentes -> null', () => {
    const m = match('165590075320436');
    delete players(m, CLUB)['1000000001']!.parrySaves;
    const dark = normalizeMatch(m, ctx).stats.find((s) => s.player_id === '1000000001');
    assert.equal(dark?.parry_saves, null);
  });
});
