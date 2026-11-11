import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { toMemberSnapshotRows } from '../src/members.ts';

// Forma real de members/stats (verificada el 2026-11-11), con nombres ficticios.
const response = {
  members: [
    {
      name: 'Jugador_01', gamesPlayed: '102', winRate: '47', goals: '130', assists: '141',
      cleanSheetsDef: '4', cleanSheetsGK: '0', shotSuccessRate: '33', passesMade: '5795',
      passSuccessRate: '75', ratingAve: '6.9', tacklesMade: '432', tackleSuccessRate: '54',
      proName: 'H. Palacios', proPos: '5', proStyle: '0', proHeight: '196', proNationality: '56',
      proOverall: '78', proOverallStr: '78', manOfTheMatch: '12', redCards: '1',
      prevGoals: '0', prevGoals1: '1', favoritePosition: 'defender',
    },
    { name: 'Jugador_02', gamesPlayed: '1', proOverall: 'N/A', ratingAve: '99' },
    { gamesPlayed: '3' },
  ],
  positionCount: { defender: 1 },
};

describe('toMemberSnapshotRows', () => {
  const rows = toMemberSnapshotRows(response, '1330384', new Date('2026-11-11T23:59:00Z'));

  test('convierte los campos y usa la fecha UTC como día de la foto', () => {
    const r = rows[0]!;
    assert.equal(r.club_id, 1330384);
    assert.equal(r.member_name, 'Jugador_01');
    assert.equal(r.snapshot_date, '2026-11-11');
    assert.equal(r.pro_overall, 78);
    assert.equal(r.games_played, 102);
    assert.equal(r.win_rate, 47);
    assert.equal(r.rating_avg, 6.9);
    assert.equal(r.clean_sheets_def, 4);
    assert.equal(r.favorite_position, 'defender');
    assert.equal(r.pro_name, 'H. Palacios');
    assert.equal(r.pro_height, 196);
  });

  test('guarda el JSON crudo completo (campos sin columna incluidos)', () => {
    assert.equal((rows[0]!.raw as Record<string, unknown>).proNationality, '56');
    assert.equal((rows[0]!.raw as Record<string, unknown>).prevGoals1, '1');
  });

  test('es tolerante: valores raros quedan en null, no se pierde la foto', () => {
    const r = rows[1]!;
    assert.equal(r.pro_overall, null);
    assert.equal(r.rating_avg, null, 'una calificación fuera de 0..10 se descarta');
    assert.equal(r.games_played, 1);
  });

  test('ignora miembros sin nombre y respuestas sin lista', () => {
    assert.equal(rows.length, 2);
    assert.deepEqual(toMemberSnapshotRows({}, '1', new Date()), []);
    assert.deepEqual(toMemberSnapshotRows(null, '1', new Date()), []);
  });
});
