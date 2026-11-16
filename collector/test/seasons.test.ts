import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isSeasonOverdue, isSeasonReset } from '../src/seasons.ts';

const at = '2026-12-03T06:50:00Z';
const c = (games: number | null, points: number | null) => ({ captured_at: at, season_games: games, season_points: points });

describe('temporadas: reinicio de EA', () => {
  test('bajan partidos y puntos: temporada nueva', () => {
    assert.equal(isSeasonReset(c(30, 50), c(0, 0)), true);
    assert.equal(isSeasonReset(c(30, 50), c(2, 3)), true, 'ya jugaron 2 partidos de la nueva antes de la captura');
  });
  test('sube o se mantiene: misma temporada', () => {
    assert.equal(isSeasonReset(c(12, 12), c(13, 15)), false);
    assert.equal(isSeasonReset(c(12, 12), c(12, 12)), false);
  });
  test('bajan los partidos pero suben los puntos: dato raro, no se toma como reinicio', () => {
    assert.equal(isSeasonReset(c(12, 12), c(5, 20)), false);
  });
  test('sin foto anterior o sin dato: no hay reinicio', () => {
    assert.equal(isSeasonReset(null, c(0, 0)), false);
    assert.equal(isSeasonReset(c(null, null), c(0, 0)), false);
    assert.equal(isSeasonReset(c(12, 12), c(null, null)), false);
  });
  test('si no hay puntos, basta con que bajen los partidos', () => {
    assert.equal(isSeasonReset(c(12, null), c(1, null)), true);
  });
});

describe('temporadas: aviso de fin esperado', () => {
  test('avisa solo después de un día de gracia', () => {
    assert.equal(isSeasonOverdue('2026-12-03T07:00:00Z', new Date('2026-12-04T06:00:00Z')), false);
    assert.equal(isSeasonOverdue('2026-12-03T07:00:00Z', new Date('2026-12-04T08:00:00Z')), true);
    assert.equal(isSeasonOverdue(null, new Date('2030-01-01T00:00:00Z')), false);
  });
});
