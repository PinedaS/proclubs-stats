// Tipos del dominio: filas tal como se guardan en Postgres (snake_case).

export const MATCH_TYPES = ['leagueMatch', 'playoffMatch', 'friendlyMatch'] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export type Outcome = 'win' | 'draw' | 'loss';

export interface ClubRow {
  club_id: number;
  name: string;
  platform: string;
  season: string;
}

export interface RawMatchRow {
  match_id: string;
  club_id: number;
  match_type: MatchType;
  payload: unknown;
  fetched_at: string;
}

export interface MatchRow {
  match_id: string;
  club_id: number;
  match_type: MatchType;
  played_at: string;
  goals_for: number;
  goals_against: number;
  outcome: Outcome | null;
  winner_by_dnf: boolean;
  opponent_club_id: number | null;
  opponent_name: string | null;
  last_collected_at: string;
}

// Sin person_id: lo asigna el trigger de la base de datos.
export interface AccountRow {
  player_id: string;
  last_known_name: string;
  last_seen_at: string;
}

export interface PlayerMatchStatsRow {
  match_id: string;
  player_id: string;
  playername: string;
  position: string;
  archetype_id: number | null;
  rating: number | null;
  goals: number;
  assists: number;
  shots: number;
  pass_attempts: number;
  passes_made: number;
  tackle_attempts: number;
  tackles_made: number;
  is_mom: boolean;
  red_cards: number;
  saves: number;
  goals_conceded: number;
  clean_sheets_def: number;
  clean_sheets_gk: number;
  seconds_played: number | null;
  game_time: number | null;
  parry_saves: number | null;
  punch_saves: number | null;
  reflex_saves: number | null;
  cross_saves: number | null;
  ball_dive_saves: number | null;
  good_direction_saves: number | null;
}

export interface NormalizedMatch {
  match: MatchRow;
  accounts: AccountRow[];
  stats: PlayerMatchStatsRow[];
}

export type RunStatus = 'success' | 'error';

export interface RunResult {
  status: RunStatus;
  clubId: number | null;
  matchesSeen: number;
  matchesNew: number;
  errorCode: string | null;
  errorMessage: string | null;
}
