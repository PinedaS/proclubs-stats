import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { alertMessage, decideAlert, type RunStatus } from '../src/alerts.ts';

const runs = (s: string): RunStatus[] => [...s].map((c) => (c === 'E' ? 'error' : c === 'R' ? 'running' : 'success'));

describe('decideAlert (más reciente primero)', () => {
  test('sin fallas no avisa', () => {
    assert.equal(decideAlert(runs('SSSS')), null);
    assert.equal(decideAlert([]), null);
  });
  test('1 o 2 fallas no avisan (pueden ser un tropiezo de EA)', () => {
    assert.equal(decideAlert(runs('ES')), null);
    assert.equal(decideAlert(runs('EES')), null);
  });
  test('avisa justo en la 3.ª falla seguida, no en la 4.ª', () => {
    assert.deepEqual(decideAlert(runs('EEES')), { kind: 'failing', failures: 3 });
    assert.equal(decideAlert(runs('EEEES')), null);
  });
  test('repite cada 24 fallas (27, 51…)', () => {
    assert.deepEqual(decideAlert(runs('E'.repeat(27))), { kind: 'failing', failures: 27 });
    assert.equal(decideAlert(runs('E'.repeat(28))), null);
  });
  test('avisa que se recuperó solo si antes hubo 3+ fallas', () => {
    assert.deepEqual(decideAlert(runs('SEEES')), { kind: 'recovered', failures: 3 });
    assert.equal(decideAlert(runs('SEES')), null);
    assert.equal(decideAlert(runs('SSEEE')), null, 'el aviso de recuperación sale una sola vez');
  });
  test('ignora ejecuciones en curso', () => {
    assert.deepEqual(decideAlert(runs('REEES')), { kind: 'failing', failures: 3 });
  });
});

describe('alertMessage', () => {
  test('incluye club, conteo y enlace; recorta el error', () => {
    const m = alertMessage({ kind: 'failing', failures: 3 }, 'FC Aston Huila', 'https://github.com/x/actions/runs/1', 'x'.repeat(500));
    assert.match(m, /FC Aston Huila/);
    assert.match(m, /3 ejecuciones fallidas/);
    assert.match(m, /actions\/runs\/1/);
    assert.ok(m.length < 600);
  });
});
