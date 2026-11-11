import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ConfigError, loadConfig } from '../src/config.ts';

const base = {
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
  EA_CLUB_NAME: 'Aston Huila',
  SEASON: 'FC27',
};

describe('loadConfig', () => {
  test('aplica valores por defecto', () => {
    const c = loadConfig(base);
    assert.equal(c.platform, 'common-gen5');
    assert.equal(c.runner, 'local');
    assert.deepEqual(c.matchTypes, ['leagueMatch', 'playoffMatch', 'friendlyMatch']);
  });

  test('lee la lista de tipos de partido', () => {
    const c = loadConfig({ ...base, EA_MATCH_TYPES: ' leagueMatch, friendlyMatch,leagueMatch ' });
    assert.deepEqual(c.matchTypes, ['leagueMatch', 'friendlyMatch']);
  });

  test('rechaza un tipo de partido desconocido', () => {
    assert.throws(() => loadConfig({ ...base, EA_MATCH_TYPES: 'cupMatch' }), ConfigError);
  });

  test('rechaza common-gen4', () => {
    assert.throws(() => loadConfig({ ...base, EA_PLATFORM: 'common-gen4' }), ConfigError);
  });

  test('exige las variables obligatorias y no muestra el secreto', () => {
    const secret = 'super-secreto-que-no-debe-aparecer';
    try {
      loadConfig({ SUPABASE_SERVICE_ROLE_KEY: secret, SUPABASE_URL: 'no-es-url' });
      assert.fail('debió lanzar');
    } catch (e) {
      assert.ok(e instanceof ConfigError);
      assert.match(e.message, /SUPABASE_URL/);
      assert.match(e.message, /EA_CLUB_NAME/);
      assert.match(e.message, /SEASON/);
      assert.doesNotMatch(e.message, new RegExp(secret));
    }
  });
});
