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
  /** Contadores sin documentar de match_event_aggregate_0..3 ({"174": 11}). */
  event_counts: Record<string, number> | null;
}

export interface NormalizedMatch {
  match: MatchRow;
  accounts: AccountRow[];
  stats: PlayerMatchStatsRow[];
}

/** Foto diaria de members/stats (una fila por miembro y día). */
export interface MemberSnapshotRow {
  club_id: number;
  member_name: string;
  snapshot_date: string; // YYYY-MM-DD (UTC)
  captured_at: string;
  pro_overall: number | null;
  games_played: number | null;
  goals: number | null;
  assists: number | null;
  win_rate: number | null;
  pass_success_rate: number | null;
  shot_success_rate: number | null;
  tackle_success_rate: number | null;
  passes_made: number | null;
  tackles_made: number | null;
  clean_sheets_def: number | null;
  clean_sheets_gk: number | null;
  rating_avg: number | null;
  man_of_the_match: number | null;
  red_cards: number | null;
  favorite_position: string | null;
  pro_name: string | null;
  pro_height: number | null;
  raw: unknown;
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
