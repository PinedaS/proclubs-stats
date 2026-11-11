// Configuración validada desde variables de entorno. Nada fijo en el código:
// el mismo colector corre en GitHub Actions o en un equipo de casa.
import { z } from 'zod';
import { MATCH_TYPES, type MatchType } from './domain.ts';

const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  // Uno o varios clubes. EA_CLUB_NAMES separa con ";" (un nombre puede tener comas).
  // EA_CLUB_NAME (uno solo) se sigue aceptando por compatibilidad.
  EA_CLUB_NAMES: z.string().optional(),
  EA_CLUB_NAME: z.string().optional(),
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
  /** Clubes a seguir, sin repetidos (sin distinguir mayúsculas). Al menos uno. */
  clubNames: string[];
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
  const seen = new Set<string>();
  const clubNames = [...(e.EA_CLUB_NAMES ?? '').split(';'), e.EA_CLUB_NAME ?? '']
    .map((n) => n.trim())
    .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
  if (clubNames.length === 0) {
    throw new ConfigError('Configuración inválida:\nFalta EA_CLUB_NAMES (nombres separados por ";") o EA_CLUB_NAME.');
  }
  return {
    supabaseUrl: e.SUPABASE_URL,
    supabaseServiceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY,
    clubNames,
    platform: e.EA_PLATFORM,
    season: e.SEASON,
    runner: e.COLLECTOR_RUNNER,
    matchTypes: [...new Set(e.EA_MATCH_TYPES)],
  };
}
