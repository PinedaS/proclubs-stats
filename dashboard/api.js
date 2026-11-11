// Acceso de solo lectura a Supabase vía su API REST (PostgREST), con fetch.
// Sin supabase-js: no hay dependencias de terceros que cargar desde un CDN.
import { MATCH_LIST_LIMIT, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js?v=__V__';

const REST = `${SUPABASE_URL}/rest/v1`;

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${REST}/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Supabase respondió ${res.status}: ${detail}`);
  }
  return res.json();
}

/** Parámetros comunes de las funciones de análisis (RPC). */
function rpcFilters(f) {
  return { p_match_types: f.types, p_from: f.from, p_to: f.to, p_exclude_incomplete: f.excludeIncomplete, p_club_id: f.clubId ?? null };
}

/** Filtro por club para consultas directas (null = todos). */
const clubParam = (clubId) => (clubId ? `&club_id=eq.${Number(clubId)}` : '');

/** Filtros comunes como parámetros de PostgREST (consultas directas a tablas/vistas). */
function filterParams(f) {
  const p = new URLSearchParams();
  p.append('match_type', `in.(${f.types.join(',')})`);
  if (f.clubId) p.append('club_id', `eq.${Number(f.clubId)}`);
  if (f.from) p.append('played_at', `gte.${f.from}`);
  if (f.to) p.append('played_at', `lt.${f.to}`);
  return p;
}

const rpc = (name, body) => request(`rpc/${name}`, { method: 'POST', body });

export const getPersonStats = (f) => rpc('person_stats', rpcFilters(f));
export const getSplitStats = (split, f) => rpc('person_split_stats', { p_split: split, ...rpcFilters(f) });
export const getPairStats = (f) => rpc('pair_stats', rpcFilters(f));
export const getPositionStats = (f) => rpc('position_stats', rpcFilters(f));
export const getPersonRecords = (f) => rpc('person_records', rpcFilters(f));
export const getRelativeStats = (group, f) => rpc('relative_stats', { p_group: group, ...rpcFilters(f) });
export const getRelativeDetail = (group, f) => rpc('relative_stats_detail', { p_group: group, ...rpcFilters(f) });
export const getPositionFit = (f) => rpc('position_fit', rpcFilters(f));
export const getWithWithout = (f) => rpc('with_without_stats', rpcFilters(f));

/** Todos los clubes seguidos, el más reciente primero. */
export function getClubs() {
  return request('clubs?select=club_id,name,season&order=first_seen_at.desc');
}

export function getClubSnapshots(clubId) {
  return request(`club_snapshots?select=snapshot_date,skill_rating,current_division,best_division,season_points,season_games,season_wins,season_draws,season_losses,season_goals,season_goals_against,games_played,wins,draws,losses,promotions,relegations,win_streak,unbeaten_streak&order=snapshot_date.asc${clubParam(clubId)}`);
}

export function getCollectorStatus() {
  return request('v_collector_status?select=*').then((r) => r[0] ?? null);
}

export function getMatches(f) {
  const p = filterParams(f);
  p.set('select', 'match_id,match_type,played_at,goals_for,goals_against,outcome,winner_by_dnf,opponent_name,opponent_skill_rating');
  p.set('order', 'played_at.desc');
  p.set('limit', String(MATCH_LIST_LIMIT));
  return request(`matches?${p}`);
}

/** Tamaño del equipo e "incompleto" por partido (salen de la vista por jugador). */
export async function getMatchFlags(f) {
  const p = filterParams(f);
  p.set('select', 'match_id,team_size,incomplete,club_division');
  const rows = await request(`v_player_match_stats?${p}`);
  return new Map(rows.map((r) => [r.match_id, r]));
}

export function getPersonMatches(personId, f) {
  const p = filterParams(f);
  p.set('select', 'match_id,played_at,match_type,opponent_name,opponent_skill_rating,goals_for,goals_against,outcome,playername,position,platform,rating,goals,assists,is_mom,shots,passes_made,pass_attempts,tackles_made,saves,team_size,incomplete,dribbles_exp,interceptions_exp,possession_won_exp,possession_lost_exp');
  p.set('person_id', `eq.${Number(personId)}`);
  p.set('order', 'played_at.asc');
  if (f.excludeIncomplete) p.set('incomplete', 'is.false');
  return request(`v_player_match_stats?${p}`);
}

export function getMatchPlayers(matchId) {
  const p = new URLSearchParams({
    select: 'person_id,person_name,playername,position,platform,rating,goals,assists,is_mom,shots,passes_made,pass_attempts,tackles_made,saves,dribbles_exp,interceptions_exp',
    match_id: `eq.${matchId}`,
    order: 'rating.desc.nullslast',
  });
  return request(`v_player_match_stats?${p}`);
}

/** Conciliación EA vs. capturado desde la primera foto (vista v_reconciliation). */
export function getReconciliation(clubId) {
  return request(`v_reconciliation?select=*&order=status.asc,member_name.asc${clubParam(clubId)}`);
}

/** Último estado de cada miembro según members/stats (página "Members" de EA). */
export function getMembers(clubId) {
  return request(`v_member_latest?select=*&order=pro_overall.desc.nullslast,member_name.asc${clubParam(clubId)}`);
}

/** Evolución de la media del Pro de uno o varios gamertags. */
export function getMemberHistory(names, clubId) {
  if (!names.length) return Promise.resolve([]);
  const list = names.map((n) => `"${String(n).replaceAll('"', '')}"`).join(',');
  const p = new URLSearchParams({
    select: 'member_name,snapshot_date,pro_overall,games_played',
    member_name: `in.(${list})`,
    order: 'snapshot_date.asc',
  });
  if (clubId) p.set('club_id', `eq.${Number(clubId)}`);
  return request(`member_snapshots?${p}`);
}
