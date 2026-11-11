// Acceso de solo lectura a Supabase vía su API REST (PostgREST), con fetch.
// Sin supabase-js: no hay dependencias de terceros que cargar desde un CDN.
import { MATCH_LIST_LIMIT, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js';

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

/** Filtros comunes (tipo de partido y fechas) como parámetros de PostgREST. */
function filterParams(filters) {
  const p = new URLSearchParams();
  p.append('match_type', `in.(${filters.types.join(',')})`);
  if (filters.from) p.append('played_at', `gte.${filters.from}`);
  if (filters.to) p.append('played_at', `lt.${filters.to}`);
  return p;
}

export function getClub() {
  return request('clubs?select=name,season&order=first_seen_at.desc&limit=1').then((r) => r[0] ?? null);
}

export function getCollectorStatus() {
  return request('v_collector_status?select=*').then((r) => r[0] ?? null);
}

export function getPersonStats(filters) {
  return request('rpc/person_stats', {
    method: 'POST',
    body: { p_match_types: filters.types, p_from: filters.from, p_to: filters.to },
  });
}

export function getMatches(filters) {
  const p = filterParams(filters);
  p.set('select', 'match_id,match_type,played_at,goals_for,goals_against,outcome,winner_by_dnf,opponent_name,opponent_skill_rating');
  p.set('order', 'played_at.desc');
  p.set('limit', String(MATCH_LIST_LIMIT));
  return request(`matches?${p}`);
}

export function getPersonMatches(personId, filters) {
  const p = filterParams(filters);
  p.set('select', 'match_id,played_at,match_type,opponent_name,opponent_skill_rating,goals_for,goals_against,outcome,playername,position,rating,goals,assists,is_mom,shots,passes_made,pass_attempts,tackles_made,saves,dribbles_exp,interceptions_exp,possession_won_exp,possession_lost_exp');
  p.set('person_id', `eq.${Number(personId)}`);
  p.set('order', 'played_at.asc');
  return request(`v_player_match_stats?${p}`);
}

/** Último estado de cada miembro según members/stats (página "Members" de EA). */
export function getMembers() {
  return request('v_member_latest?select=*&order=pro_overall.desc.nullslast,member_name.asc');
}

/** Evolución de la media del Pro de uno o varios gamertags. */
export function getMemberHistory(names) {
  if (!names.length) return Promise.resolve([]);
  const list = names.map((n) => `"${String(n).replaceAll('"', '')}"`).join(',');
  const p = new URLSearchParams({
    select: 'member_name,snapshot_date,pro_overall,games_played',
    member_name: `in.(${list})`,
    order: 'snapshot_date.asc',
  });
  return request(`member_snapshots?${p}`);
}

export function getMatchPlayers(matchId) {
  const p = new URLSearchParams({
    select: 'person_id,person_name,playername,position,rating,goals,assists,is_mom,shots,passes_made,pass_attempts,tackles_made,saves,dribbles_exp,interceptions_exp',
    match_id: `eq.${matchId}`,
    order: 'rating.desc.nullslast',
  });
  return request(`v_player_match_stats?${p}`);
}
