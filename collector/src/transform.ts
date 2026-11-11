// Transformación PURA: partido crudo de EA -> filas de la base de datos.
// Sin red, sin base de datos, sin reloj (la hora entra como parámetro).
// Es estricta: si un campo obligatorio falta o no es un número, lanza
// TransformError en vez de inventar un 0. El JSON crudo ya se habrá guardado.
import type { ClubMatch } from 'proclubs-sdk';
import type {
  AccountRow,
  MatchRow,
  MatchType,
  NormalizedMatch,
  Outcome,
  PlayerMatchStatsRow,
  RawMatchRow,
} from './domain.ts';

export class TransformError extends Error {
  override name = 'TransformError';
  readonly matchId: string | undefined;

  constructor(message: string, matchId?: string) {
    super(matchId ? `Partido ${matchId}: ${message}` : message);
    this.matchId = matchId;
  }
}

export interface TransformContext {
  clubId: string;
  matchType: MatchType;
  collectedAt: Date;
}

type Dict = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Conversión de valores (EA manda casi todo como string)
// ---------------------------------------------------------------------------

const INT_RE = /^-?\d+$/;
const DECIMAL_RE = /^\d+(\.\d+)?$/;

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function int(v: unknown, field: string): number {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v;
  if (typeof v === 'string' && INT_RE.test(v.trim())) {
    const n = Number(v.trim());
    if (Number.isSafeInteger(n)) return n;
  }
  throw new TransformError(`"${field}" no es un entero válido: ${JSON.stringify(v)}`);
}

function optInt(v: unknown, field: string): number | null {
  return isBlank(v) ? null : int(v, field);
}

function flag(v: unknown, field: string): boolean {
  const n = int(v, field);
  if (n !== 0 && n !== 1) throw new TransformError(`"${field}" debería ser 0 o 1: ${JSON.stringify(v)}`);
  return n === 1;
}

function rating(v: unknown): number | null {
  if (isBlank(v)) return null;
  const s = String(v).trim();
  if (!DECIMAL_RE.test(s)) throw new TransformError(`"rating" no es un decimal válido: ${JSON.stringify(v)}`);
  return Number(s);
}

function text(v: unknown, field: string): string {
  if (typeof v === 'string' && v.trim() !== '') return v;
  throw new TransformError(`"${field}" falta o está vacío`);
}

function asDict(v: unknown): Dict | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : undefined;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/** ID del partido como texto. Es lo único imprescindible para guardar el JSON crudo. */
export function matchIdOf(raw: ClubMatch): string {
  const id = raw.matchId;
  if (typeof id === 'number' && Number.isSafeInteger(id)) return String(id);
  if (typeof id === 'string' && INT_RE.test(id.trim())) return id.trim();
  throw new TransformError(`matchId inválido: ${JSON.stringify(id)}`);
}

export function toRawRow(raw: ClubMatch, ctx: TransformContext): RawMatchRow {
  return {
    match_id: matchIdOf(raw),
    club_id: int(ctx.clubId, 'clubId'),
    match_type: ctx.matchType,
    payload: raw,
    fetched_at: ctx.collectedAt.toISOString(),
  };
}

export function normalizeMatch(raw: ClubMatch, ctx: TransformContext): NormalizedMatch {
  const matchId = matchIdOf(raw);
  try {
    return normalizeUnsafe(raw, matchId, ctx);
  } catch (err) {
    if (err instanceof TransformError && err.matchId === undefined) {
      throw new TransformError(err.message, matchId);
    }
    throw err;
  }
}

function normalizeUnsafe(raw: ClubMatch, matchId: string, ctx: TransformContext): NormalizedMatch {
  const nowIso = ctx.collectedAt.toISOString();
  const clubs = asDict(raw.clubs) ?? {};
  const ours = asDict(clubs[ctx.clubId]);
  if (!ours) throw new TransformError(`el club ${ctx.clubId} no aparece en "clubs"`);

  const opponentId = Object.keys(clubs).find((id) => id !== ctx.clubId);
  const opponent = opponentId ? asDict(clubs[opponentId]) : undefined;
  const opponentName = asDict(opponent?.details)?.name;

  const timestamp = int(raw.timestamp, 'timestamp');

  const match: MatchRow = {
    match_id: matchId,
    club_id: int(ctx.clubId, 'clubId'),
    match_type: ctx.matchType,
    played_at: new Date(timestamp * 1000).toISOString(),
    goals_for: int(ours.goals, 'clubs.goals'),
    goals_against: int(ours.goalsAgainst, 'clubs.goalsAgainst'),
    outcome: outcomeOf(ours),
    winner_by_dnf: isBlank(ours.winnerByDnf) ? false : flag(ours.winnerByDnf, 'clubs.winnerByDnf'),
    opponent_club_id: opponentId ? int(opponentId, 'opponentClubId') : null,
    opponent_name: typeof opponentName === 'string' ? opponentName : null,
    last_collected_at: nowIso,
  };

  // Solo los jugadores de nuestro club; los rivales quedan en el JSON crudo.
  const players = asDict(asDict(raw.players)?.[ctx.clubId]) ?? {};
  const accounts: AccountRow[] = [];
  const stats: PlayerMatchStatsRow[] = [];

  for (const [playerId, value] of Object.entries(players)) {
    if (!INT_RE.test(playerId)) throw new TransformError(`playerId inválido: ${JSON.stringify(playerId)}`);
    const p = asDict(value);
    if (!p) throw new TransformError(`jugador ${playerId} sin datos`);
    const name = text(p.playername, `players.${playerId}.playername`);

    accounts.push({ player_id: playerId, last_known_name: name, last_seen_at: nowIso });
    stats.push(toStatsRow(matchId, playerId, name, p));
  }

  return { match, accounts, stats };
}

/**
 * Resultado desde wins/losses/ties del club. No se usa "result" (es un código:
 * 1, 2, 4, 10...) ni los goles (no reflejan victorias por abandono).
 * Si no hay exactamente un 1, se deja en null en vez de adivinar.
 */
function outcomeOf(club: Dict): Outcome | null {
  const flags: [Outcome, unknown][] = [
    ['win', club.wins],
    ['draw', club.ties],
    ['loss', club.losses],
  ];
  const set = flags.filter(([, v]) => !isBlank(v) && int(v, 'clubs.wins/ties/losses') === 1);
  return set.length === 1 ? set[0]![0] : null;
}

function toStatsRow(matchId: string, playerId: string, name: string, p: Dict): PlayerMatchStatsRow {
  const f = (key: string) => `players.${playerId}.${key}`;
  return {
    match_id: matchId,
    player_id: playerId,
    playername: name,
    position: text(p.pos, f('pos')),
    archetype_id: optInt(p.archetypeid, f('archetypeid')),
    rating: rating(p.rating),
    goals: int(p.goals, f('goals')),
    assists: int(p.assists, f('assists')),
    shots: int(p.shots, f('shots')),
    pass_attempts: int(p.passattempts, f('passattempts')),
    passes_made: int(p.passesmade, f('passesmade')),
    tackle_attempts: int(p.tackleattempts, f('tackleattempts')),
    tackles_made: int(p.tacklesmade, f('tacklesmade')),
    is_mom: flag(p.mom, f('mom')),
    red_cards: int(p.redcards, f('redcards')),
    saves: int(p.saves, f('saves')),
    goals_conceded: int(p.goalsconceded, f('goalsconceded')),
    clean_sheets_def: int(p.cleansheetsdef, f('cleansheetsdef')),
    clean_sheets_gk: int(p.cleansheetsgk, f('cleansheetsgk')),
    seconds_played: optInt(p.secondsPlayed, f('secondsPlayed')),
    game_time: optInt(p.gameTime, f('gameTime')),
    parry_saves: optInt(p.parrySaves, f('parrySaves')),
    punch_saves: optInt(p.punchSaves, f('punchSaves')),
    reflex_saves: optInt(p.reflexSaves, f('reflexSaves')),
    cross_saves: optInt(p.crossSaves, f('crossSaves')),
    ball_dive_saves: optInt(p.ballDiveSaves, f('ballDiveSaves')),
    good_direction_saves: optInt(p.goodDirectionSaves, f('goodDirectionSaves')),
  };
}
