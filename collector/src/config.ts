// Configuración validada desde variables de entorno. Nada fijo en el código:
// el mismo colector corre en GitHub Actions o en un equipo de casa.
import { z } from 'zod';
import { MATCH_TYPES, type MatchType } from './domain.ts';

const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  EA_CLUB_NAME: z.string().trim().min(1),
  // common-gen4 no funciona desde FC 27 (HTTP 400), por eso no se admite.
  EA_PLATFORM: z.enum(['common-gen5', 'nx']).default('common-gen5'),
  SEASON: z.string().trim().min(1),
  COLLECTOR_RUNNER: z.string().trim().min(1).default('local'),
  EA_MATCH_TYPES: z
    .string()
    .default(MATCH_TYPES.join(','))
    .transform((s) => s.split(',').map((t) => t.trim()).filter(Boolean))
    .pipe(z.array(z.enum(MATCH_TYPES)).min(1)),
});

export interface Config {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  clubName: string;
  platform: 'common-gen5' | 'nx';
  season: string;
  runner: string;
  matchTypes: MatchType[];
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // prettifyError muestra campos y reglas, no los valores (no filtra secretos).
    throw new ConfigError(`Configuración inválida:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    supabaseUrl: e.SUPABASE_URL,
    supabaseServiceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
    clubName: e.EA_CLUB_NAME,
    platform: e.EA_PLATFORM,
    season: e.SEASON,
    runner: e.COLLECTOR_RUNNER,
    matchTypes: [...new Set(e.EA_MATCH_TYPES)],
  };
}
