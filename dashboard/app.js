// Dashboard de solo lectura. Todo el texto que viene de EA (nombres, rivales)
// se inserta como TEXTO, nunca como HTML: evita inyección de código (XSS).
import * as api from './api.js?v=__V__';
import { STALE_CRITICAL_MINUTES, STALE_WARNING_MINUTES } from './config.js?v=__V__';
import { CHANGELOG } from './changelog.js?v=__V__';

const TYPE_LABEL = { leagueMatch: 'Liga', playoffMatch: 'Play-off', friendlyMatch: 'Amistoso' };
const POS_LABEL = { forward: 'Delantero', midfielder: 'Mediocampista', defender: 'Defensa', goalkeeper: 'Portero' };
const PLATFORM_LABEL = { ps5: 'PS5', pc: 'PC', 'xbox-series': 'Xbox Series', ps4: 'PS4', 'xbox-one': 'Xbox One', switch: 'Switch' };
const OUTCOME = {
  win: { letter: 'V', label: 'Victoria' },
  draw: { letter: 'E', label: 'Empate' },
  loss: { letter: 'D', label: 'Derrota' },
};

const state = {
  view: 'ranking',
  sort: { key: 'avg_rating', dir: -1 },
  minMatches: 1,
  // Experimentales activas y avanzadas apagadas por defecto (decisión del usuario);
  // cada navegador recuerda lo que elija (prefs).
  showExp: true,
  showAdv: false,
  ranking: [],
  records: new Map(),
  members: null,
  clubSnaps: null,
  personId: null,
  split: 'rival',
  splitMetric: 'avg_rating',
  position: 'forward',
  roleGroup: 'position',
  roleMode: 'relative', // 'relative' (índices vs. el rol) | 'real' (valores por posición)
  h2h: { a: null, b: null }, // Cara a cara: person_id de cada lado
  trend: new Map(), // person_id -> calificaciones por partido (de más vieja a más nueva)
  personTab: 'resumen', // pestaña abierta en el detalle del jugador
  photos: new Map(), // person_id -> URL de su foto
  photoByName: new Map(), // nombre mostrado -> URL (los avatares se dibujan por nombre)
  timeline: [], // filas {match_id, played_at, person_id, rating} con los filtros actuales
  roleSort: { key: 'rating_idx', dir: -1 },
  relative: new Map(),
  clubs: [],
  clubId: null, // club seleccionado (todas las consultas se filtran por él)
  requestId: 0,
};

const $ = (sel) => document.querySelector(sel);

/**
 * Preferencias de vista guardadas en este navegador (localStorage). Solo son
 * comodidades: si el navegador no deja guardar (modo privado), se usa lo de por defecto.
 */
const PREFS_KEY = 'proclubs-stats:prefs';
const prefs = {
  load() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') ?? {}; } catch { return {}; }
  },
  save(patch) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs.load(), ...patch })); } catch { /* sin almacenamiento */ }
  },
};

// ---------------------------------------------------------------------------
// Utilidades de DOM y formato
// ---------------------------------------------------------------------------

/** Crea un elemento. Los hijos de tipo string se agregan como nodos de texto. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const fmtCache = new Map();
function fmtNum(value, digits = 0) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—';
  if (!fmtCache.has(digits)) {
    fmtCache.set(digits, new Intl.NumberFormat('es-CO', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return fmtCache.get(digits).format(Number(value));
}
const fmtPct = (v, d = 1) => (v == null ? '—' : `${fmtNum(v, d)} %`);
const fmtSigned = (v) => (v == null ? '—' : v > 0 ? `+${fmtNum(v)}` : fmtNum(v));

function fmtDate(iso, withTime = true) {
  const opts = withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' };
  return new Date(iso).toLocaleString('es-CO', opts);
}

function fmtAgo(minutes) {
  if (minutes < 1) return 'hace menos de 1 min';
  if (minutes < 60) return `hace ${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `hace ${Math.round(hours)} h`;
  return `hace ${Math.round(hours / 24)} días`;
}

function initials(name) {
  const clean = String(name ?? '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const text = parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2);
  return (text || '?').toUpperCase();
}

/** Avatar: la foto del jugador si tiene (state.photoByName), si no sus iniciales. */
const avatar = (name, big = false) => {
  const url = state.photoByName.get(name);
  return el('span', { class: `${big ? 'avatar lg' : 'avatar'}${url ? ' has-photo' : ''}`, 'aria-hidden': 'true' },
    url ? el('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' }) : initials(name));
};
const POS_SHORT = { forward: 'DEL', midfielder: 'MED', defender: 'DEF', goalkeeper: 'POR' };
/** Insignia de posición: texto completo en escritorio, abreviado en el celular (CSS). */
const posBadge = (pos) => (pos ? el('span', { class: `badge pos-${pos}`, title: POS_LABEL[pos] ?? pos },
  el('span', { class: 'pos-long' }, POS_LABEL[pos] ?? pos), el('span', { class: 'pos-short' }, POS_SHORT[pos] ?? pos)) : null);
const platformLabel = (p) => PLATFORM_LABEL[p] ?? p;

/**
 * División como la muestra el JUEGO. Verificado con el usuario (2026-11-16): el juego
 * muestra siempre una menos que la API de EA (API 6 = 5ª del juego, API 5 = 4ª). La API
 * tiene 6 niveles: el 1 es la División Élite, por encima de la 1ª (identificada por su
 * ícono; EA describe la pirámide "de la División 5 a la División Élite"). En la base se
 * guarda el número de EA, tal cual; solo se traduce al mostrar, y el tooltip dice cómo
 * lo envía EA.
 */
const TOP_DIVISION_NAME = 'División Élite';
function gameDivision(apiDiv) {
  if (apiDiv == null) return null;
  const n = Number(apiDiv) - 1;
  return n >= 1 ? `${n}ª` : TOP_DIVISION_NAME;
}
const divisionTitle = (apiDiv) => (apiDiv == null ? null : `División del juego. EA la envía como ${apiDiv} (el juego muestra una menos).`);

function playerCell(name, sub) {
  return el('span', { class: 'player-cell' }, avatar(name), el('span', {}, el('span', { class: 'person' }, name),
    sub ? el('span', { class: 'muted small' }, ` ${sub}`) : null));
}

function resultBadge(outcome, dnf) {
  const o = OUTCOME[outcome];
  if (!o) return el('span', { class: 'muted' }, '—');
  return el('span', { class: `result ${outcome}`, title: o.label + (dnf ? ' (por abandono)' : '') }, o.letter);
}

function showError(err) {
  const box = $('#error');
  if (!err) { box.hidden = true; return; }
  box.textContent = `No se pudieron cargar los datos. ${err.message ?? err}`;
  box.hidden = false;
}

const emptyRow = (cols, text = 'Sin datos para estos filtros.') =>
  el('tr', {}, el('td', { class: 'empty', colspan: cols }, text));

function onActivate(fn) {
  return {
    tabindex: '0',
    onclick: fn,
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } },
  };
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

function readFilters() {
  const types = [...document.querySelectorAll('input[name="type"]:checked')].map((i) => i.value);
  const day = (value, addDays = 0) => {
    if (!value) return null;
    const d = new Date(`${value}T00:00:00`); // medianoche local
    d.setDate(d.getDate() + addDays);
    return d.toISOString();
  };
  // "Hasta" es inclusivo para el usuario; en la API p_to es exclusivo (+1 día).
  return { types, from: day($('#from').value), to: day($('#to').value, 1), excludeIncomplete: $('#exclude-incomplete').checked, clubId: state.clubId };
}

// ---------------------------------------------------------------------------
// Cabecera: estado del colector y tarjetas del club
// ---------------------------------------------------------------------------

/**
 * Aviso del disparo desde Supabase (cada 15 min). Solo aparece si hay un problema:
 * sin token, GitHub lo rechazó (p. ej. token vencido) o lleva rato sin responder.
 */
async function renderDispatchAlert() {
  const box = $('#dispatch-alert');
  let s;
  try { s = await api.getDispatchStatus(); } catch { box.hidden = true; return; }
  let level = null, text = null;
  if (!s || !s.available) { box.hidden = true; return; }
  const minutes = s.last_response_at ? (Date.now() - new Date(s.last_response_at).getTime()) / 60000 : Infinity;
  if (!s.token_configured) { level = 'warning'; text = 'Disparo desde Supabase sin token'; }
  else if (s.last_problem) { level = 'critical'; text = `Disparo falló${s.last_status_code ? ` (HTTP ${s.last_status_code})` : ''}: ${s.last_problem}`; }
  else if (minutes > 45) { level = 'warning'; text = 'Disparo desde Supabase sin respuestas recientes'; }
  if (!level) { box.hidden = true; return; }
  box.className = `status ${level}`;
  box.title = 'Supabase le pide a GitHub ejecutar el colector cada 15 min. Ver CLAUDE.md, pendiente 8.';
  box.replaceChildren(el('span', { class: 'icon', 'aria-hidden': 'true' }, level === 'critical' ? '✕' : '⚠'), el('span', {}, text));
  box.hidden = false;
}

async function renderStatus() {
  renderDispatchAlert().catch(() => {});
  const box = $('#collector-status');
  try {
    const s = await api.getCollectorStatus();
    const last = s?.last_success_at ? new Date(s.last_success_at) : null;
    const minutes = last ? (Date.now() - last.getTime()) / 60000 : Infinity;
    let level = 'good', icon = '●', text;
    if (!last) { level = 'critical'; icon = '✕'; text = 'Sin capturas exitosas todavía'; }
    else {
      if (minutes > STALE_CRITICAL_MINUTES) { level = 'critical'; icon = '✕'; }
      else if (minutes > STALE_WARNING_MINUTES) { level = 'warning'; icon = '⚠'; }
      text = `Captura automática · ${fmtAgo(minutes)}`;
    }
    const failures = Number(s?.consecutive_failures ?? 0);
    if (failures > 0 && level === 'good') { level = 'warning'; icon = '⚠'; }
    box.className = `status ${level}`;
    box.replaceChildren(
      el('span', { class: 'icon', 'aria-hidden': 'true' }, icon),
      el('span', {}, text + (failures > 0 ? ` · ${failures} falla${failures === 1 ? '' : 's'} seguida${failures === 1 ? '' : 's'}` : '')),
    );
    box.title = last ? `Última captura exitosa: ${fmtDate(last.toISOString())}` : '';
  } catch {
    box.className = 'status critical';
    box.replaceChildren(el('span', { class: 'icon', 'aria-hidden': 'true' }, '✕'), el('span', {}, 'Estado no disponible'));
  }
}

function kpi(label, value, hint, deltaClass) {
  return el('div', { class: 'kpi' }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value),
    hint ? el('div', { class: `hint ${deltaClass ? `delta ${deltaClass}` : ''}` }, hint) : null);
}

async function renderHeader() {
  const club = state.clubs.find((c) => c.club_id === state.clubId) ?? null;
  const snaps = await api.getClubSnapshots(state.clubId).catch(() => []);
  state.clubSnaps = snaps;
  if (club) {
    $('#club-name').textContent = club.name;
    $('#crest-initials').textContent = initials(club.name);
    // "FC27" -> "FC 27": el título sigue a la temporada del club (FC 28 sin tocar código).
    const game = String(club.season ?? '').replace(/^FC\s*(\d+)$/i, 'FC $1') || 'FC';
    $('#club-season').textContent = `Temporada ${club.season}`;
    $('#game-label').textContent = `EA SPORTS ${game} · Clubes`;
    document.title = `${club.name} · Stats EA ${game}`;
  }
  const last = snaps.at(-1);
  const first = snaps[0];
  const delta = last && first && last.skill_rating != null && first.skill_rating != null ? last.skill_rating - first.skill_rating : null;
  const recent = await api.getRecentMatches(state.clubId).catch(() => []);
  const capturedMatches = state.ranking[0]?.club_matches;
  if (club) {
    $('#club-season').textContent = `Temporada ${club.season} · ${fmtNum(capturedMatches ?? 0)} partido${capturedMatches === 1 ? '' : 's'}`;
    $('#club-season').title = 'Partidos capturados con los filtros actuales';
  }
  const form = el('div', { class: 'form-chips', role: 'img', 'aria-label': `Últimos resultados: ${recent.slice(0, 5).map((m) => OUTCOME[m.outcome]?.label ?? '—').join(', ')}` },
    recent.length ? [...recent.slice(0, 5)].reverse().map((m) => el('span', {
      class: `result ${m.outcome}`, title: `${OUTCOME[m.outcome]?.label ?? ''} ${m.goals_for}–${m.goals_against}${m.opponent_name ? ` vs. ${m.opponent_name}` : ''} · ${fmtDate(m.played_at, false)}`,
    }, OUTCOME[m.outcome]?.letter ?? '?')) : el('span', { class: 'muted' }, '—'));
  $('#club-kpis').replaceChildren(
    kpi('Nivel del club', fmtNum(last?.skill_rating),
      delta == null || snaps.length < 2 ? 'skillRating de EA' : `${fmtSigned(delta)} desde ${fmtDate(`${first.snapshot_date}T12:00:00Z`, false)}`,
      delta > 0 ? 'up' : delta < 0 ? 'down' : null),
    Object.assign(kpi('División', gameDivision(last?.current_division) ?? '—', last?.best_division != null ? `Mejor: ${gameDivision(last.best_division)}` : null), { title: divisionTitle(last?.current_division) ?? '' }),
    kpi('Temporada', last?.season_wins != null ? `${last.season_wins}-${last.season_draws}-${last.season_losses}` : '—',
      last?.season_points != null ? `${fmtNum(last.season_points)} pts · goles ${last.season_goals ?? '—'} : ${last.season_goals_against ?? '—'}` : 'V-E-D'),
    kpi('Forma (últ. 5)', form, streakText(recent)),
  );
}

/**
 * Racha actual según los partidos capturados (del más reciente hacia atrás):
 * "3 victorias seguidas", "2 derrotas seguidas" o "4 sin perder".
 */
function streakText(recent) {
  if (!recent.length) return null;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (recent[0].outcome === 'loss') {
    const n = recent.findIndex((m) => m.outcome !== 'loss');
    return plural(n < 0 ? recent.length : n, 'derrota', 'derrotas seguidas').replace(/^1 derrota$/, 'Viene de 1 derrota');
  }
  const unbeaten = recent.findIndex((m) => m.outcome === 'loss');
  const runUnbeaten = unbeaten < 0 ? recent.length : unbeaten;
  const wins = recent.findIndex((m) => m.outcome !== 'win');
  const runWins = wins < 0 ? recent.length : wins;
  if (runWins === runUnbeaten && runWins > 1) return `${runWins} victorias seguidas`;
  return plural(runUnbeaten, 'partido sin perder', 'sin perder');
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

const RANKING_COLUMNS = [
  { key: 'person_name', label: 'Jugador', text: true, render: (r) => playerCell(r.person_name, r.platforms ? r.platforms.split(', ').map(platformLabel).join(' · ') : null) },
  { key: 'main_position', label: 'Pos.', text: true, title: 'Posición más jugada', render: (r) => posBadge(r.main_position) ?? '—' },
  { key: 'pro_overall', label: 'Media (EA)', title: 'Media (overall) actual del Pro según EA (members/stats)' },
  { key: 'matches', label: 'PJ', title: 'Partidos jugados (capturados)' },
  { key: 'wins', label: 'V-E-D', title: 'Victorias, empates y derrotas (ordena por victorias)', render: (r) => `${r.wins}-${r.draws}-${r.losses}` },
  { key: 'avg_rating', label: 'Calif.', title: 'Calificación media de EA', digits: 2 },
  { key: 'mom_pct', label: 'MVP %', title: 'Porcentaje de partidos como mejor jugador', digits: 1 },
  // Columnas agrupadas por tema. Las avanzadas (adv) y las experimentales (exp, con *
  // y fondo teñido) van junto a los datos oficiales de su mismo tema (pedido del usuario).
  // --- Ataque
  { key: 'goals', label: 'G', title: 'Goles' },
  { key: 'assists', label: 'A', title: 'Asistencias' },
  { key: 'goal_contributions', label: 'G+A', title: 'Goles + asistencias' },
  { key: 'ga_per_match', label: 'G+A/PJ', title: 'Goles + asistencias por partido', digits: 2 },
  { key: 'goals_per90', label: 'G/90', title: 'Goles por cada 90 minutos', digits: 2, adv: true },
  { key: 'assists_per90', label: 'A/90', title: 'Asistencias por cada 90 minutos', digits: 2, adv: true },
  { key: 'ga_per90', label: 'G+A/90', title: 'Goles + asistencias por cada 90 minutos', digits: 2, adv: true },
  { key: 'shot_conversion_pct', label: 'Conv. %', title: 'Goles / tiros', digits: 1, adv: true },
  { key: 'shot_accuracy_exp_pct', label: 'A puerta %*', title: 'Experimental: tiros a puerta / tiros (códigos EA 217 y 218)', digits: 1, exp: true },
  { key: 'second_assists_exp', label: '2ª asist.*', title: 'Experimental: segundas asistencias (código EA 115)', exp: true },
  { key: 'dribbles_exp', label: 'Regates*', title: 'Experimental: regates completados (código EA 174)', exp: true },
  { key: 'goal_participation_pct', label: 'Part. goles %', title: '(Goles + asistencias) / goles del equipo en sus partidos', digits: 1, adv: true },
  // --- Pase
  { key: 'pass_accuracy_pct', label: 'Pases %', title: 'Pases completados / intentados', digits: 1 },
  { key: 'forward_pass_pct_exp', label: 'Pase adel. %*', title: 'Experimental: pases hacia adelante completados (códigos EA 30 y 31)', digits: 1, exp: true },
  { key: 'through_passes_exp', label: 'Filtrados*', title: 'Experimental: pases filtrados (código EA 152)', exp: true },
  { key: 'cross_pct_exp', label: 'Centros %*', title: 'Experimental: centros completados (códigos EA 36 y 37)', digits: 1, exp: true },
  { key: 'best_option_pct_exp', label: 'Decisiones %*', title: 'Experimental: "tomó la mejor opción" / (mejor + "debió pasar a otro") (códigos EA 177 y 182)', digits: 1, exp: true },
  { key: 'possession_lost_exp', label: 'Pérdidas*', title: 'Experimental: posesiones perdidas (códigos EA 105–107)', exp: true, better: 'low' },
  // --- Defensa
  { key: 'tackle_success_pct', label: 'Entradas %', title: 'Entradas ganadas / intentadas', digits: 1 },
  { key: 'interceptions_exp', label: 'Intercep.*', title: 'Experimental: intercepciones (código EA 6)', exp: true },
  { key: 'possession_won_exp', label: 'Recup.*', title: 'Experimental: posesiones ganadas (códigos EA 108–110)', exp: true },
  { key: 'aerial_duels_won_exp', label: 'Aéreos*', title: 'Experimental: duelos aéreos ganados (códigos EA 265–266)', exp: true },
  { key: 'in_position_pct_exp', label: 'En posición %*', title: 'Experimental: veces en posición / (en + fuera de posición) (códigos EA 111 y 219)', digits: 1, exp: true },
  { key: 'clean_sheets', label: 'Vallas', title: 'Vallas invictas (defensa + portero)', adv: true },
  { key: 'saves', label: 'Atajadas' },
  { key: 'save_pct', label: '% Atajadas', title: 'Porteros: atajadas / (atajadas + goles recibidos)', digits: 1, adv: true },
  // --- Disciplina
  { key: 'red_cards', label: 'Rojas', title: 'Tarjetas rojas', better: 'low' },
  { key: 'yellow_cards_exp', label: 'Amarillas*', title: 'Experimental: tarjetas amarillas (códigos EA 95 y 213)', exp: true, better: 'low' },
  { key: 'fouls_exp', label: 'Faltas*', title: 'Experimental: faltas cometidas (códigos EA 2 y 3)', exp: true, better: 'low' },
  { key: 'penalties_conceded_exp', label: 'Penales*', title: 'Experimental: penales cometidos (código EA 94)', exp: true, better: 'low' },
  { key: 'fouls_won_exp', label: 'F. recibidas*', title: 'Experimental: faltas recibidas (código EA 4)', exp: true },
  { key: 'offsides_exp', label: 'Fuera lugar*', title: 'Experimental: fueras de juego (código EA 104; tiende a contar de menos)', exp: true, better: 'low' },
  // --- Equipo y contexto
  { key: 'minutes_played', label: 'Min.', title: 'Minutos jugados (tiempo de juego)', adv: true },
  { key: 'goal_diff', label: 'Dif. goles', title: 'Goles a favor menos en contra en los partidos que jugó', adv: true, render: (r) => fmtSigned(r.goal_diff) },
  { key: 'attendance_pct', label: 'Presencia %', title: 'Partidos jugados / partidos del club en el rango filtrado', digits: 1, adv: true },
  { key: 'form_rating', label: 'Forma', title: 'Calificación media de sus últimos 5 partidos', digits: 2, adv: true },
  { key: 'rating_stddev', label: 'Variación', title: 'Desviación de su calificación: más bajo = más regular', digits: 2, adv: true, better: 'low' },
  { key: 'avg_opponent_skill', label: 'Nivel rival', title: 'Nivel medio (skillRating) de los rivales que enfrentó', adv: true, better: null },
  { key: 'avg_team_size', label: 'Jug. prom.', title: 'Jugadores del club en cancha, en promedio', digits: 1, adv: true, better: null },
  { key: 'incomplete_matches', label: 'Incompl.', title: 'Partidos incompletos (abandono o < 90 % del tiempo)', adv: true, better: null },
];

const visibleColumns = () => RANKING_COLUMNS.filter((c) => (state.showExp || !c.exp) && (state.showAdv || !c.adv));
const cellClass = (c, extra = '') => [c.text ? 'left' : '', c.exp ? 'exp' : '', c.adv ? 'adv' : '', extra].join(' ').trim() || null;

function sortRows(rows) {
  const { key, dir } = state.sort;
  const col = RANKING_COLUMNS.find((c) => c.key === key);
  return [...rows].sort((a, b) => {
    const va = a[key], vb = b[key];
    if (va == null && vb == null) return 0;
    if (va == null) return 1; // nulos siempre al final
    if (vb == null) return -1;
    const cmp = col?.text ? String(va).localeCompare(String(vb), 'es') : Number(va) - Number(vb);
    return cmp * dir;
  });
}

/** 'high' (más es mejor, por defecto), 'low' (menos es mejor) o null (no es mérito: sin podio). */
const betterOf = (col) => (col.text ? null : col.better === undefined ? 'high' : col.better);
/** Mínimo de partidos para subir al podio: con 1 o 2 PJ cualquiera queda arriba por casualidad. */
const PODIUM_MIN_MATCHES = 3;

/** Filas de mejor a peor según la columna, sin importar cómo esté ordenada la tabla. */
function bestFirst(rows, col) {
  const better = betterOf(col);
  if (!better) return null;
  const sign = better === 'high' ? -1 : 1;
  return rows.filter((r) => r[col.key] != null).sort((a, b) => (Number(a[col.key]) - Number(b[col.key])) * sign);
}

/** Puestos con empates: quienes tienen el mismo valor comparten puesto (1, 1, 3…). */
function placesOf(ordered, col) {
  const places = new Map();
  ordered.forEach((r, i) => {
    const prev = ordered[i - 1];
    const same = prev && Number(prev[col.key]) === Number(r[col.key]);
    places.set(r.person_id, same ? places.get(prev.person_id) : i + 1);
  });
  return places;
}

function renderPodium(rows) {
  const col = RANKING_COLUMNS.find((c) => c.key === state.sort.key);
  const box = $('#podium');
  const ordered = col ? bestFirst(rows.filter((r) => r.matches >= Math.max(state.minMatches, PODIUM_MIN_MATCHES)), col) : null;
  if (!ordered) { box.replaceChildren(); return; }
  if (ordered.length < 3) {
    // Mensaje claro en vez de un hueco: dice cuándo aparece el podio.
    box.replaceChildren(el('div', { class: 'podium-empty' },
      el('strong', {}, 'El podio aparece cuando haya 3 jugadores con al menos 3 partidos.'),
      el('span', { class: 'muted' }, ` Ahora ${ordered.length === 1 ? 'hay 1' : `hay ${ordered.length}`}.`)));
    return;
  }
  const places = placesOf(ordered, col);
  // Si más de 3 comparten el primer puesto, el podio no distingue a nadie: no se muestra.
  if (ordered.filter((r) => places.get(r.person_id) === 1).length > 3) { box.replaceChildren(); return; }
  const top = ordered.slice(0, 3);
  // p1/p2/p3 = lugar en el podio (diseño); m1/m2/m3 = medalla según el puesto (con empates).
  box.replaceChildren(...top.map((r, i) => el('div', { class: `podium-card p${i + 1} m${places.get(r.person_id)}`, ...onActivate(() => openPerson(r.person_id)), 'aria-label': `${places.get(r.person_id)}º ${r.person_name}` },
    el('div', { class: 'medal' }, String(places.get(r.person_id))),
    el('div', { class: 'name' }, r.person_name),
    el('div', { class: 'metric' }, col.render ? col.render(r) : fmtNum(r[col.key], col.digits ?? 0)),
    el('div', { class: 'metric-label' }, col.title ?? col.label),
    el('div', { class: 'muted small' }, `${r.matches} PJ`))));
}

function renderRanking() {
  const table = $('#ranking-table');
  const columns = visibleColumns();
  const head = el('tr', {}, el('th', { scope: 'col', class: 'rank' }, '#'), columns.map((c) => {
    const active = state.sort.key === c.key;
    return el('th', {
      class: cellClass(c), scope: 'col', title: c.title,
      'aria-sort': active ? (state.sort.dir === 1 ? 'ascending' : 'descending') : null,
    }, el('button', {
      type: 'button',
      onclick: () => {
        state.sort = active ? { key: c.key, dir: -state.sort.dir } : { key: c.key, dir: c.text ? 1 : -1 };
        renderRanking();
      },
    }, c.label + (active ? (state.sort.dir === 1 ? ' ▲' : ' ▼') : '')));
  }));

  const rows = sortRows(state.ranking.filter((r) => r.matches >= state.minMatches));
  renderPodium(rows);
  // El puesto (#) es siempre de mejor a peor en ese dato, aunque la tabla esté
  // ordenada al revés: así el peor nunca aparece como "1". Sin mérito, sin puesto.
  const sortCol = RANKING_COLUMNS.find((c) => c.key === state.sort.key);
  const best = sortCol ? bestFirst(rows, sortCol) : null;
  const place = best ? placesOf(best, sortCol) : new Map();
  const low = (r) => (r.matches < PODIUM_MIN_MATCHES ? 'low-sample' : '');
  const lowTitle = (r) => (r.matches < PODIUM_MIN_MATCHES ? `Solo ${r.matches} PJ: sus números todavía pueden ser casualidad` : null);
  const body = rows.length
    ? rows.map((r) => el('tr', { class: `clickable ${low(r)}`.trim(), title: lowTitle(r), ...onActivate(() => openPerson(r.person_id)) },
        el('td', { class: 'rank' }, place.has(r.person_id) ? String(place.get(r.person_id)) : '—'),
        columns.map((c) => el('td', { class: cellClass(c, c.key === state.sort.key && !c.text ? 'sorted' : '') },
          c.render ? c.render(r) : fmtNum(r[c.key], c.digits ?? 0),
          c.key === 'avg_rating' ? sparkline(state.trend.get(r.person_id)) : null))))
    : [emptyRow(columns.length + 1)];
  // La columna "#" va primero y es la fija; el nombre queda justo después.
  table.replaceChildren(el('thead', {}, head), el('tbody', {}, body));

  // Selector "Ordenar por" (solo celular): mismas columnas que la tabla, sin las de texto.
  const sel = $('#sort-select');
  sel.replaceChildren(...columns.filter((c) => !c.text).map((c) => el('option', { value: c.key }, c.title ?? c.label)));
  sel.value = state.sort.key;
  sel.onchange = () => { const c = RANKING_COLUMNS.find((x) => x.key === sel.value); state.sort = { key: c.key, dir: betterOf(c) === 'low' ? 1 : -1 }; renderRanking(); };

  // En el celular, tarjetas en vez de la tabla ancha (el CSS muestra una u otra).
  const cardKeys = [['avg_rating', 'Calif.', 2], ['goal_contributions', 'G+A', 0], ['mom_pct', 'MVP %', 0], ['matches', 'PJ', 0]];
  const extra = sortCol && !sortCol.text && !cardKeys.some(([k]) => k === sortCol.key) ? sortCol : null;
  $('#ranking-cards').replaceChildren(...(rows.length ? rows.map((r) => el('button', { type: 'button', class: `rank-card ${low(r)}`.trim(), title: lowTitle(r), onclick: () => openPerson(r.person_id) },
    el('div', { class: 'rank-card-head' },
      el('span', { class: 'place' }, place.has(r.person_id) ? String(place.get(r.person_id)) : '—'),
      avatar(r.person_name),
      el('span', { class: 'person' }, r.person_name),
      posBadge(r.main_position),
      sparkline(state.trend.get(r.person_id))),
    el('div', { class: 'rank-card-stats' },
      cardKeys.map(([k, label, d]) => el('div', { class: k === state.sort.key ? 'sorted' : null }, el('div', { class: 'v' }, fmtNum(r[k], d)), el('div', { class: 'l' }, label))),
      extra ? el('div', { class: 'sorted' }, el('div', { class: 'v' }, extra.render ? extra.render(r) : fmtNum(r[extra.key], extra.digits ?? 0)), el('div', { class: 'l' }, extra.label)) : null))) : [el('p', { class: 'muted', style: 'padding: 12px' }, 'Sin datos para estos filtros.')]));
}

/**
 * Entradas desde la banca y salidas antes de tiempo, DEDUCIDAS de los tiempos que da
 * EA (no lo dice directamente; verificado en 2 casos reales el 2026-11-16):
 *   - gameTime: reloj del partido cuando terminó su participación;
 *   - secondsPlayed: cuánto jugó.
 * Entró tarde si gameTime − secondsPlayed > 1 min (entró en ese minuto); salió antes si
 * su gameTime es más de 1 min menor que el final del partido (el mayor gameTime).
 * Si todos terminan a la vez antes del 90 %, es el partido el que se cortó: no se marca a nadie.
 * Devuelve Map "match_id|player_id" -> { in: minuto|null, out: minuto|null }.
 */
function playerTimeFlags(times) {
  const byMatch = new Map();
  for (const t of times) {
    if (!byMatch.has(t.match_id)) byMatch.set(t.match_id, []);
    byMatch.get(t.match_id).push(t);
  }
  const flags = new Map();
  for (const [matchId, list] of byMatch) {
    const end = Math.max(...list.map((t) => t.game_time ?? 0));
    for (const t of list) {
      if (t.game_time == null || t.seconds_played == null) continue;
      const late = t.game_time - t.seconds_played > 60 ? Math.round((t.game_time - t.seconds_played) / 60) : null;
      const early = end - t.game_time > 60 ? Math.round(t.game_time / 60) : null;
      if (late != null || early != null) flags.set(`${matchId}|${t.player_id}`, { in: late, out: early });
    }
  }
  return flags;
}

/** Etiquetas visuales "Entró 45'" / "Salió 19'" (vacío si jugó todo el partido). */
function timeBadges(f) {
  if (!f) return null;
  const note = ' (deducido de los tiempos de EA)';
  return [
    f.in != null ? el('span', { class: 'badge sub-in', title: `Entró desde la banca en el minuto ${f.in}${note}` }, `↑ Entró ${f.in}'`) : null,
    f.out != null ? el('span', { class: 'badge sub-out', title: `Salió del partido en el minuto ${f.out}${note}` }, `↓ Salió ${f.out}'`) : null,
  ];
}

/**
 * Goles de jugadores humanos vs. goles de la IA en los partidos capturados (con los
 * filtros actuales). Los abandonos no cuentan: su marcador lo asigna EA.
 */
function goalSplitTile() {
  const by = new Map();
  for (const r of state.timeline) {
    if (r.incomplete) continue;
    if (!by.has(r.match_id)) by.set(r.match_id, { team: r.goals_for ?? 0, human: 0 });
    by.get(r.match_id).human += r.goals ?? 0;
  }
  let human = 0, ai = 0;
  for (const m of by.values()) { human += m.human; ai += Math.max(0, m.team - m.human); }
  const t = tile('Goles: jugadores / IA', by.size ? `${human} / ${ai}` : '—');
  t.title = 'Goles de los jugadores humanos y goles de la IA de nuestro equipo, en los partidos capturados (sin abandonos)';
  return t;
}

/** person_id -> calificación de cada partido (si jugó con 2 cuentas, el promedio). */
function trendByPerson(rows) {
  const per = new Map();
  for (const r of rows) {
    if (r.rating == null) continue;
    const key = `${r.person_id}|${r.match_id}`;
    if (!per.has(key)) per.set(key, { person: r.person_id, at: r.played_at, sum: 0, n: 0 });
    const e = per.get(key); e.sum += Number(r.rating); e.n++;
  }
  const out = new Map();
  for (const e of [...per.values()].sort((a, b) => a.at.localeCompare(b.at))) {
    if (!out.has(e.person)) out.set(e.person, []);
    out.get(e.person).push(e.sum / e.n);
  }
  return out;
}

/**
 * Calificación media por semana (lunes a domingo, hora local), del equipo o de
 * una persona. Devuelve [{ week: 'YYYY-MM-DD' (lunes), avg, n }] en orden.
 */
function weeklyAverages(rows, personId = null) {
  const weeks = new Map();
  for (const r of rows) {
    if (r.rating == null || (personId != null && r.person_id !== personId)) continue;
    const d = new Date(r.played_at);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // lunes
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!weeks.has(key)) weeks.set(key, { week: key, sum: 0, n: 0, matches: new Set() });
    const w = weeks.get(key); w.sum += Number(r.rating); w.n++; w.matches.add(r.match_id);
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week))
    .map((w) => ({ week: w.week, avg: w.sum / w.n, n: w.matches.size }));
}

/** Mini línea con las últimas 5 calificaciones (más vieja a la izquierda). */
function sparkline(values) {
  const v = (values ?? []).slice(-5);
  if (v.length < 2) return null;
  const W = 52, H = 16, min = Math.min(...v, 5), max = Math.max(...v, 8);
  const x = (i) => (i * (W - 4)) / (v.length - 1) + 2;
  const y = (n) => H - 2 - ((n - min) / (max - min || 1)) * (H - 4);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'spark', role: 'img', 'aria-label': `Últimas calificaciones: ${v.map((n) => fmtNum(n, 1)).join(', ')}` });
  s.append(svg('polyline', { points: v.map((n, i) => `${x(i)},${y(n)}`).join(' '), fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  s.append(svg('circle', { cx: x(v.length - 1), cy: y(v.at(-1)), r: 2.5, fill: 'currentColor' }));
  const t = document.createElementNS(SVG_NS, 'title');
  t.textContent = `Últimas calificaciones: ${v.map((n) => fmtNum(n, 1)).join(' → ')}`;
  s.prepend(t);
  return s;
}

// ---------------------------------------------------------------------------
// Por rol: rendimiento relativo al promedio del club en cada posición/arquetipo
// ---------------------------------------------------------------------------

/**
 * archetypeid -> nombre (FC 27). EA solo manda el número; este mapeo es de la
 * comunidad (Interactive-63/eafc-pro-clubs-api-research, issue #5, nov. 2026),
 * no oficial. sure=false: deducido por estadísticas o por un solo testimonio.
 * Contrastado con nuestros datos el 2026-11-11: 4, 5 y 8 cuadran con las
 * posiciones jugadas; 13 aparece sobre todo en el medio (la comunidad: 95 % DEL).
 */
const ARCHETYPES = {
  1: { name: 'Shot Stopper', sure: false },
  2: { name: 'Sweeper Keeper', sure: false },
  3: { name: 'Progressor', sure: true },
  4: { name: 'Boss', sure: false },
  5: { name: 'Disruptor', sure: true },
  6: { name: 'Marauder', sure: true },
  7: { name: 'Recycler', sure: false },
  8: { name: 'Maestro', sure: true },
  9: { name: 'Creator', sure: false },
  10: { name: 'Spark', sure: true },
  11: { name: 'Magician', sure: true },
  12: { name: 'Finisher', sure: true },
  13: { name: 'Target Man', sure: true },
};
const ARCHETYPE_SOURCE = 'Nombre según la comunidad (EA solo da el número)';

/** Nombre del arquetipo; con "?" si la comunidad lo dedujo sin confirmarlo. */
function archetypeName(id) {
  const a = ARCHETYPES[id];
  if (!a) return id === '?' || id == null ? 'Arquetipo ?' : `Arquetipo #${id}`;
  return a.sure ? a.name : `${a.name}?`;
}
const archetypeTitle = (id) => {
  const a = ARCHETYPES[id];
  return a ? `${ARCHETYPE_SOURCE}: n.º ${id}${a.sure ? ', confirmado por jugadores' : ', sin confirmar'}` : `Número ${id}: sin nombre conocido`;
};

const roleLabel = (group, key) => (group === 'archetype' ? archetypeName(key) : POS_LABEL[key] ?? key);

/** Índice relativo: valor + flecha y color. 100 = promedio del rol. */
function idxCell(v, extraClass = '') {
  if (v == null) return el('td', { class: `muted ${extraClass}`.trim() }, '—');
  const n = Number(v);
  const dir = n >= 105 ? 'up' : n <= 95 ? 'down' : '';
  return el('td', { class: extraClass || null, title: `${fmtNum(n, 1)} (100 = promedio del rol)` },
    el('span', { class: `idx ${dir}` }, fmtNum(n, 0), dir ? el('span', { class: 'arrow', 'aria-hidden': 'true' }, dir === 'up' ? '▲' : '▼') : null));
}

const ROLE_COLUMNS = [
  { key: 'rating_idx', label: 'Calificación', title: 'Calificación media vs. la media del rol' },
  { key: 'ga90_idx', label: 'G+A / 90', title: 'Goles + asistencias por 90 min vs. el rol' },
  { key: 'pass_idx', label: 'Pases %', title: 'Precisión de pase vs. el rol' },
  { key: 'tackles90_idx', label: 'Entradas / 90', title: 'Entradas ganadas por 90 min vs. el rol (clave para roles defensivos)' },
  { key: 'save_idx', label: '% Atajadas', title: 'Solo porteros: % de atajadas vs. otros porteros' },
  { key: 'interceptions90_idx_exp', label: 'Intercep. / 90*', title: 'Experimental: intercepciones por 90 min vs. el rol', exp: true },
];

async function renderRoles(filters, requestId) {
  const group = state.roleGroup;
  const [rows, detail] = filters.types.length
    ? await Promise.all([api.getRelativeStats(group, filters), api.getRelativeDetail(group, filters)])
    : [[], []];
  if (requestId !== state.requestId) return;
  const cols = ROLE_COLUMNS.filter((c) => state.showExp || !c.exp);
  const { key, dir } = state.roleSort;
  const list = rows.filter((r) => r.matches >= state.minMatches)
    .sort((a, b) => (a[key] == null) - (b[key] == null) || (Number(a[key]) - Number(b[key])) * dir);
  const byPerson = new Map();
  for (const d of detail) {
    if (!byPerson.has(d.person_id)) byPerson.set(d.person_id, []);
    byPerson.get(d.person_id).push(d);
  }

  const head = el('tr', {}, el('th', { scope: 'col', class: 'rank' }, '#'), el('th', { scope: 'col', class: 'left' }, 'Jugador'),
    el('th', { scope: 'col', class: 'left' }, group === 'archetype' ? 'Arquetipos jugados' : 'Roles jugados'),
    el('th', { scope: 'col' }, 'PJ'), el('th', { scope: 'col' }, 'Min.'),
    cols.map((c) => {
      const active = key === c.key;
      return el('th', { scope: 'col', title: c.title, class: c.exp ? 'exp' : null, 'aria-sort': active ? (dir === 1 ? 'ascending' : 'descending') : null },
        el('button', { type: 'button', onclick: () => { state.roleSort = active ? { key: c.key, dir: -dir } : { key: c.key, dir: -1 }; renderRoles(readFilters(), state.requestId); } },
          c.label + (active ? (dir === 1 ? ' ▲' : ' ▼') : '')));
    }));
  const colspan = cols.length + 5;
  const body = el('tbody');
  if (!list.length) body.append(emptyRow(colspan));
  list.forEach((r, i) => {
    const roles = (r.roles ?? '').split(', ').filter(Boolean);
    const row = el('tr', { class: 'clickable', 'aria-expanded': 'false' },
      el('td', { class: 'rank' }, String(i + 1)),
      el('td', { class: 'left' }, playerCell(r.person_name)),
      el('td', { class: 'left' }, group === 'position'
        ? roles.map((p) => [posBadge(p), ' '])
        : roles.map((a) => [el('span', { class: 'badge', title: archetypeTitle(a) }, roleLabel(group, a)), ' '])),
      el('td', {}, fmtNum(r.matches)), el('td', {}, fmtNum(r.minutes)),
      cols.map((c) => idxCell(r[c.key], [c.exp ? 'exp' : '', c.key === key ? 'sorted' : ''].join(' ').trim())));
    const toggle = () => {
      const next = row.nextElementSibling;
      if (next?.classList.contains('role-detail')) { next.remove(); row.setAttribute('aria-expanded', 'false'); return; }
      row.setAttribute('aria-expanded', 'true');
      const parts = (byPerson.get(r.person_id) ?? []).sort((a, b) => b.seconds - a.seconds);
      row.after(el('tr', { class: 'role-detail' }, el('td', { colspan },
        el('table', { class: 'data' },
          el('thead', {}, el('tr', {}, ['Rol', 'PJ', 'Calif. (él / rol)', 'G+A/90 (él / rol)', 'Pases % (él / rol)', 'Entradas/90 (él / rol)', 'Partidos del rol']
            .map((h, k) => el('th', { scope: 'col', class: k === 0 ? 'left' : null }, h)))),
          el('tbody', {}, parts.map((d) => el('tr', {},
            el('td', { class: 'left' }, group === 'position' ? posBadge(d.group_key) : roleLabel(group, d.group_key)),
            el('td', {}, fmtNum(d.matches)),
            el('td', {}, `${fmtNum(d.rating, 2)} / ${fmtNum(d.group_rating, 2)}`),
            el('td', {}, `${fmtNum(d.ga90, 2)} / ${fmtNum(d.group_ga90, 2)}`),
            el('td', {}, `${fmtNum(d.pass_pct, 1)} / ${fmtNum(d.group_pass_pct, 1)}`),
            el('td', {}, `${fmtNum(d.tackles90, 2)} / ${fmtNum(d.group_tackles90, 2)}`),
            el('td', { title: 'Registros del club en ese rol: con pocos, el promedio es menos confiable' }, fmtNum(d.group_rows)))))))));
    };
    Object.entries(onActivate(toggle)).forEach(([k, v]) => (k.startsWith('on') ? row.addEventListener(k.slice(2), v) : row.setAttribute(k, v)));
    body.append(row);
  });
  $('#roles-table').replaceChildren(el('thead', {}, head), body);
}

// ---------------------------------------------------------------------------
// Cara a cara: dos jugadores, dato por dato, con quién es mejor en cada uno.
// Solo se juzgan tasas (por partido, por 90 min, %), nunca totales: así no gana
// quien jugó más. Los índices relativos al rol van primero (justos si rotan).
// ---------------------------------------------------------------------------

const per90 = (r, key) => (r[key] == null || !Number(r.minutes_played) ? null : (Number(r[key]) * 90) / Number(r.minutes_played));
const perMatch = (r, key) => (r[key] == null || !r.matches ? null : Number(r[key]) / r.matches);

/**
 * better: 'high' (más es mejor), 'low' (menos es mejor) o null (solo contexto).
 * Orden por importancia (decisión del usuario, 2026-11-15): rendimiento primero,
 * luego relativo a su rol, experimentales y contexto.
 */
const H2H_RELATIVE = {
  title: 'Relativo a su rol (100 = promedio de su posición)',
  source: 'relative',
  rows: [
    { label: 'Calificación vs. su rol', key: 'rating_idx', better: 'high' },
    { label: 'G+A/90 vs. su rol', key: 'ga90_idx', better: 'high' },
    { label: 'Pases % vs. su rol', key: 'pass_idx', better: 'high' },
    { label: 'Entradas/90 vs. su rol', key: 'tackles90_idx', better: 'high' },
    { label: '% Atajadas vs. porteros', key: 'save_idx', better: 'high' },
    { label: 'Intercepciones/90 vs. su rol*', key: 'interceptions90_idx_exp', better: 'high', exp: true },
  ],
};
const H2H_GROUPS = [
  {
    title: 'Rendimiento',
    rows: [
      { label: 'Calificación media', key: 'avg_rating', better: 'high', digits: 2 },
      { label: '% MVP', key: 'mom_pct', better: 'high', digits: 1, pct: true },
      { label: '% Victorias', value: (r) => (r.matches ? (100 * r.wins) / r.matches : null), better: 'high', digits: 0, pct: true },
      // Experimentales (*) junto a los datos seguros de su mismo tema (pedido del usuario).
      // Ataque
      { label: 'Goles por 90 min', key: 'goals_per90', better: 'high', digits: 2 },
      { label: 'Asistencias por 90 min', key: 'assists_per90', better: 'high', digits: 2 },
      { label: 'G+A por 90 min', key: 'ga_per90', better: 'high', digits: 2 },
      { label: 'Conversión de tiros', key: 'shot_conversion_pct', better: 'high', digits: 1, pct: true },
      { label: 'Tiros a puerta %*', key: 'shot_accuracy_exp_pct', better: 'high', digits: 1, pct: true, exp: true },
      { label: 'Regates por 90*', value: (r) => per90(r, 'dribbles_exp'), better: 'high', digits: 2, exp: true },
      { label: 'Participación en goles', key: 'goal_participation_pct', better: 'high', digits: 1, pct: true },
      // Pase
      { label: 'Precisión de pase', key: 'pass_accuracy_pct', better: 'high', digits: 1, pct: true },
      { label: 'Pases hacia adelante %*', key: 'forward_pass_pct_exp', better: 'high', digits: 1, pct: true, exp: true },
      { label: 'Pases filtrados por 90*', value: (r) => per90(r, 'through_passes_exp'), better: 'high', digits: 2, exp: true },
      { label: 'Centros completados %*', key: 'cross_pct_exp', better: 'high', digits: 1, pct: true, exp: true },
      { label: 'Mejores decisiones %*', key: 'best_option_pct_exp', better: 'high', digits: 1, pct: true, exp: true },
      { label: 'Posesiones perdidas por 90*', value: (r) => per90(r, 'possession_lost_exp'), better: 'low', digits: 2, exp: true },
      // Defensa
      { label: 'Entradas ganadas %', key: 'tackle_success_pct', better: 'high', digits: 1, pct: true },
      { label: 'Entradas ganadas por 90', value: (r) => per90(r, 'tackles_made'), better: 'high', digits: 2 },
      { label: 'Intercepciones por 90*', value: (r) => per90(r, 'interceptions_exp'), better: 'high', digits: 2, exp: true },
      { label: 'Posesiones ganadas por 90*', value: (r) => per90(r, 'possession_won_exp'), better: 'high', digits: 2, exp: true },
      { label: 'Duelos aéreos ganados por 90*', value: (r) => per90(r, 'aerial_duels_won_exp'), better: 'high', digits: 2, exp: true },
      { label: 'En posición %*', key: 'in_position_pct_exp', better: 'high', digits: 1, pct: true, exp: true },
      { label: 'Atajadas %', key: 'save_pct', better: 'high', digits: 1, pct: true },
      // Equipo y disciplina
      { label: 'Dif. de goles por partido', value: (r) => perMatch(r, 'goal_diff'), better: 'high', digits: 2, signed: true },
      { label: 'Forma (últimos 5)', key: 'form_rating', better: 'high', digits: 2 },
      { label: 'Regularidad (variación)', key: 'rating_stddev', better: 'low', digits: 2, hint: 'Más bajo = más regular', winLabel: 'Más regular' },
      { label: 'Rojas por partido', value: (r) => perMatch(r, 'red_cards'), better: 'low', digits: 2, winLabel: 'Menos rojas' },
      { label: 'Faltas cometidas por 90*', value: (r) => per90(r, 'fouls_exp'), better: 'low', digits: 2, exp: true },
    ],
  },
  H2H_RELATIVE,
  {
    title: 'Contexto (no se juzga)',
    rows: [
      { label: 'Partidos', key: 'matches', better: null },
      { label: 'Minutos', key: 'minutes_played', better: null },
      { label: 'Presencia', key: 'attendance_pct', better: null, digits: 1, pct: true },
      { label: 'Nivel medio del rival', key: 'avg_opponent_skill', better: null },
      { label: 'Media del Pro (EA)', key: 'pro_overall', better: null },
    ],
  },
];

/**
 * 'a', 'b', 'tie' o null (sin dato o no se juzga). Empate solo si los dos valores
 * son iguales tal como se muestran (redondeados a `digits` decimales): 6,90 vs 6,70
 * tiene ganador (decisión del usuario, 2026-11-15; antes había un margen del 3 %).
 */
function h2hWinner(va, vb, better, digits = 0) {
  if (!better || va == null || vb == null || Number.isNaN(va) || Number.isNaN(vb)) return null;
  const f = 10 ** digits;
  const ra = Math.round(va * f), rb = Math.round(vb * f);
  if (ra === rb) return 'tie';
  return (ra > rb) === (better === 'high') ? 'a' : 'b';
}

function fillH2hPickers() {
  const people = state.ranking.filter((r) => r.matches >= state.minMatches)
    .sort((x, y) => x.person_name.localeCompare(y.person_name, 'es'));
  const ids = people.map((p) => p.person_id);
  const byMatches = [...people].sort((x, y) => y.matches - x.matches);
  if (!ids.includes(state.h2h.a)) state.h2h.a = byMatches[0]?.person_id ?? null;
  if (!ids.includes(state.h2h.b) || state.h2h.b === state.h2h.a) state.h2h.b = byMatches.find((p) => p.person_id !== state.h2h.a)?.person_id ?? null;
  for (const [sel, key] of [['#h2h-a', 'a'], ['#h2h-b', 'b']]) {
    $(sel).replaceChildren(...people.map((p) => el('option', { value: p.person_id }, `${p.person_name} (${p.matches} PJ)`)));
    $(sel).value = String(state.h2h[key] ?? '');
  }
}

function renderH2h() {
  fillH2hPickers();
  const box = $('#h2h-body');
  const A = state.ranking.find((r) => r.person_id === state.h2h.a);
  const B = state.ranking.find((r) => r.person_id === state.h2h.b);
  if (!A || !B || A === B) {
    box.replaceChildren(el('p', { class: 'muted', style: 'padding: 0 18px 18px' }, 'Hacen falta al menos dos jugadores con el mínimo de partidos de los filtros.'));
    return;
  }
  const relA = state.relative.get(A.person_id) ?? {}, relB = state.relative.get(B.person_id) ?? {};
  const score = { a: 0, b: 0, tie: 0 };
  const groups = H2H_GROUPS.filter((g) => state.showExp || !g.exp).map((g) => {
    const rows = g.rows.filter((m) => state.showExp || !m.exp).map((m) => {
      const get = (r, rel) => {
        const v = m.value ? m.value(r) : (g.source === 'relative' ? rel : r)[m.key];
        return v == null ? null : Number(v);
      };
      const va = get(A, relA), vb = get(B, relB);
      if (va == null && vb == null) return null;
      const w = h2hWinner(va, vb, m.better, g.source === 'relative' ? 0 : m.digits ?? 0);
      if (w) score[w]++;
      const fmt = (v) => (v == null ? '—' : m.signed ? (v > 0 ? '+' : '') + fmtNum(v, m.digits ?? 0) : m.pct ? fmtPct(v, m.digits ?? 0) : fmtNum(v, g.source === 'relative' ? 0 : m.digits ?? 0));
      // Largo de cada barra: |valor| / el mayor de los dos (la fila tiene su propia escala).
      const max = Math.max(Math.abs(va ?? 0), Math.abs(vb ?? 0));
      const len = (v) => (v == null || max === 0 ? 0 : (100 * Math.abs(v)) / max);
      const who = w === 'a' ? A.person_name : w === 'b' ? B.person_name : null;
      const tip = `${m.label}: ${A.person_name} ${fmt(va)} · ${B.person_name} ${fmt(vb)}`
        + (m.better === 'low' ? ' (menos es mejor)' : '')
        + (!m.better ? '' : w === 'tie' ? ' · empate' : who ? ` · mejor: ${who}` : '');
      return el('div', { class: `h2h-row ${w ? `w-${w}` : 'neutral'}${m.exp ? ' exp' : ''}`, title: m.exp ? `${tip} · Experimental: dato que EA no documenta` : tip },
        el('div', { class: 'h2h-label' }, m.label, m.better === 'low' ? ' ↓' : ''),
        el('div', { class: 'h2h-bars' },
          el('span', { class: 'h2h-val a' }, fmt(va)),
          el('div', { class: 'h2h-track a', 'aria-hidden': 'true' }, el('i', { style: `width:${len(va)}%` })),
          el('div', { class: 'h2h-track b', 'aria-hidden': 'true' }, el('i', { style: `width:${len(vb)}%` })),
          el('span', { class: 'h2h-val b' }, fmt(vb))));
    }).filter(Boolean);
    return rows.length ? [el('p', { class: 'section-title' }, g.title), el('div', { class: 'h2h-group' }, rows)] : null;
  }).flat().filter(Boolean);

  const roles = (rel) => (rel.roles ?? '').split(', ').filter(Boolean);
  const differentRoles = A.main_position !== B.main_position;
  const lowSample = A.matches < MIN_FIT_MATCHES || B.matches < MIN_FIT_MATCHES;
  const card = (r, rel, cls) => el('div', { class: `h2h-player ${cls}` }, avatar(r.person_name, true),
    el('div', {}, el('div', { class: 'name' }, el('span', { class: 'swatch', 'aria-hidden': 'true' }), ' ', r.person_name),
      el('div', { class: 'badges' }, roles(rel).length ? roles(rel).map(posBadge) : posBadge(r.main_position)),
      el('div', { class: 'muted small' }, `${r.matches} PJ · ${fmtNum(r.minutes_played)} min`)));
  // Marcador visual: proporción de datos que gana cada uno (empates en gris al centro).
  const judged = score.a + score.b + score.tie;
  const seg = (n, cls, label) => (n ? el('span', { class: cls, style: `flex:${n}`, title: label }) : null);
  const scoreboard = judged ? el('div', { class: 'h2h-score', role: 'img',
    'aria-label': `${A.person_name} es mejor en ${score.a} datos, ${B.person_name} en ${score.b}, ${score.tie} empates` },
    el('div', { class: 'num a' }, String(score.a), el('small', {}, 'datos')),
    el('div', { class: 'h2h-score-bar' },
      seg(score.a, 'sa', `${A.person_name}: mejor en ${score.a}`),
      seg(score.tie, 'st', `Empates: ${score.tie}`),
      seg(score.b, 'sb', `${B.person_name}: mejor en ${score.b}`)),
    el('div', { class: 'num b' }, String(score.b), el('small', {}, 'datos'))) : null;

  box.replaceChildren(...[
    el('div', { class: 'h2h-heads' }, card(A, relA, 'a'), el('div', { class: 'vs' }, 'vs'), card(B, relB, 'b')),
    scoreboard,
    differentRoles ? el('p', { class: 'h2h-note' }, `Juegan en posiciones distintas (${POS_LABEL[A.main_position] ?? '—'} y ${POS_LABEL[B.main_position] ?? '—'}): para compararlos de forma justa, fíjate también en "Relativo a su rol".`) : null,
    lowSample ? el('p', { class: 'h2h-note' }, `Alguno tiene menos de ${MIN_FIT_MATCHES} partidos: las diferencias pueden ser casualidad.`) : null,
    ...groups,
  ].filter(Boolean));
  // Enlace para compartir la comparación (?a=…&b=…).
  const url = new URL(location.href);
  url.searchParams.set('a', String(A.person_id));
  url.searchParams.set('b', String(B.person_id));
  history.replaceState(null, '', url);
}

/** Abre Cara a cara con este jugador como A (botón del detalle). */
function compareWith(personId) {
  state.h2h.a = personId;
  if (state.h2h.b === personId) state.h2h.b = null;
  setView('h2h');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// Comparar (rival fuerte/débil, tipo de partido, jugadores en cancha)
// ---------------------------------------------------------------------------

const SPLIT_HELP = {
  rival: 'Rival fuerte = nivel (skillRating) igual o mayor que la mediana de los rivales del rango filtrado.',
  type: 'Útil para ver si los amistosos inflan los números frente a la liga.',
  team_size: 'Cuántos jugadores del club estaban en cancha en ese partido.',
  division: 'División del club el día del partido, según la foto diaria del club (aproximada; los partidos anteriores a la primera foto salen como "Sin dato"). Mira los PJ de cada celda: pocos partidos en una división no son comparables con muchos en otra.',
};
const METRIC = {
  avg_rating: { label: 'Calificación', digits: 2 },
  ga_per90: { label: 'G+A / 90', digits: 2 },
  win_pct: { label: '% Victorias', digits: 1 },
  mom_pct: { label: '% MVP', digits: 1 },
};

async function renderCompare(filters, requestId) {
  const rows = filters.types.length ? await api.getSplitStats(state.split, filters) : [];
  if (requestId !== state.requestId) return;
  $('#split-help').textContent = SPLIT_HELP[state.split];
  const metric = state.splitMetric;
  const buckets = [...new Map(rows.map((r) => [r.bucket, r.bucket_order])).entries()].sort((a, b) => a[1] - b[1]).map(([b]) => b);
  const people = new Map();
  for (const r of rows) {
    if (!people.has(r.person_id)) people.set(r.person_id, { name: r.person_name, total: 0, cells: {} });
    const p = people.get(r.person_id);
    p.total += Number(r.matches);
    p.cells[r.bucket] = r;
  }
  const list = [...people.entries()].filter(([, p]) => p.total >= state.minMatches)
    .sort((a, b) => a[1].name.localeCompare(b[1].name, 'es'));
  const max = Math.max(1, ...rows.map((r) => Number(r[metric] ?? 0)));
  const table = $('#compare-table');
  // Los grupos de división llegan como "División N" con el número de EA: se muestran como en el juego.
  const bucketLabel = (b) => {
    const m = /^División (\d+)$/.exec(b);
    return m ? { text: Number(m[1]) > 1 ? `División ${gameDivision(m[1])}` : TOP_DIVISION_NAME, title: divisionTitle(m[1]) } : { text: b, title: null };
  };
  const head = el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Jugador'),
    buckets.map((b) => el('th', { scope: 'col', title: bucketLabel(b).title }, bucketLabel(b).text))));
  const body = el('tbody', {}, list.length ? list.map(([id, p]) => {
    const values = buckets.map((b) => p.cells[b]?.[metric]).filter((v) => v != null).map(Number);
    const best = values.length > 1 ? Math.max(...values) : null;
    return el('tr', { class: 'clickable', ...onActivate(() => openPerson(id)) },
      el('td', {}, playerCell(p.name)),
      buckets.map((b) => {
        const c = p.cells[b];
        if (!c) return el('td', { class: 'muted' }, '—');
        const v = c[metric];
        return el('td', {}, el('span', { class: `bar-cell ${best != null && Number(v) === best ? 'best' : ''}` },
          el('span', { class: 'muted small' }, `${c.matches} PJ`),
          el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(0, Math.min(100, (Number(v ?? 0) / max) * 100))}%` })),
          el('span', { class: 'val' }, metric.endsWith('pct') ? fmtPct(v) : fmtNum(v, METRIC[metric].digits))));
      }));
  }) : [emptyRow(buckets.length + 1)]);
  table.replaceChildren(head, body);
}

// ---------------------------------------------------------------------------
// Duplas
// ---------------------------------------------------------------------------

async function renderPairs(filters, requestId) {
  const rows = filters.types.length ? await api.getPairStats(filters) : [];
  if (requestId !== state.requestId) return;
  const list = rows.filter((r) => r.matches >= state.minMatches)
    .sort((a, b) => Number(b.win_pct) - Number(a.win_pct) || b.matches - a.matches);
  const cols = ['Dupla', 'PJ juntos', 'V-E-D', '% Victorias', 'Goles a favor / PJ', 'Goles en contra / PJ', 'Dif. goles', 'G+A de la dupla'];
  $('#pairs-table').replaceChildren(
    el('thead', {}, el('tr', {}, cols.map((h, i) => el('th', { scope: 'col', class: i === 0 ? 'left' : null }, h)))),
    el('tbody', {}, list.length ? list.map((r) => el('tr', {},
      el('td', {}, el('span', { class: 'player-cell' }, avatar(r.person_a), el('span', { class: 'person' }, r.person_a), el('span', { class: 'muted' }, '+'), avatar(r.person_b), el('span', { class: 'person' }, r.person_b))),
      el('td', {}, fmtNum(r.matches)),
      el('td', {}, `${r.wins}-${r.draws}-${r.losses}`),
      el('td', { class: 'sorted' }, fmtPct(r.win_pct)),
      el('td', {}, fmtNum(r.goals_for_avg, 2)),
      el('td', {}, fmtNum(r.goals_against_avg, 2)),
      el('td', {}, fmtSigned(r.goal_diff)),
      el('td', {}, fmtNum(r.combined_ga)))) : [emptyRow(cols.length, 'Sin duplas con ese mínimo de partidos.')]));
  await renderWithWithout(filters, requestId);
}

/** Diferencia con signo y color: positivo = rinde mejor con el compañero. */
function deltaCell(v, digits, suffix = '') {
  if (v == null) return el('td', { class: 'muted' }, '—');
  const n = Number(v);
  const text = `${n > 0 ? '+' : ''}${fmtNum(n, digits)}${suffix}`;
  return el('td', { class: n > 0 ? 'delta-up' : n < 0 ? 'delta-down' : null }, el('strong', {}, text));
}

async function renderWithWithout(filters, requestId) {
  const rows = filters.types.length ? await api.getWithWithout(filters) : [];
  if (requestId !== state.requestId) return;
  const list = rows.filter((r) => r.matches_with >= state.minMatches && r.matches_without >= state.minMatches)
    .sort((a, b) => a.person_name.localeCompare(b.person_name, 'es') || Number(b.rating_delta) - Number(a.rating_delta));
  const cols = ['Jugador', 'Con…', 'PJ con / sin', 'Calif. con', 'Calif. sin', 'Δ Calif.', '% Vic. con', '% Vic. sin', 'Δ % Vic.', 'G+A/90 con / sin'];
  $('#withwithout-table').replaceChildren(
    el('thead', {}, el('tr', {}, cols.map((h, i) => el('th', { scope: 'col', class: i < 2 ? 'left' : null }, h)))),
    el('tbody', {}, list.length ? list.map((r) => el('tr', { class: 'clickable', ...onActivate(() => openPerson(r.person_id)) },
      el('td', {}, playerCell(r.person_name)),
      el('td', { class: 'left' }, r.mate_name),
      el('td', {}, `${r.matches_with} / ${r.matches_without}`),
      el('td', {}, fmtNum(r.rating_with, 2)), el('td', {}, fmtNum(r.rating_without, 2)),
      deltaCell(r.rating_delta, 2),
      el('td', {}, fmtPct(r.win_pct_with, 0)), el('td', {}, fmtPct(r.win_pct_without, 0)),
      deltaCell(r.win_pct_delta, 0, ' pts'),
      el('td', {}, `${fmtNum(r.ga90_with, 2)} / ${fmtNum(r.ga90_without, 2)}`)))
      : [emptyRow(cols.length, `Nadie tiene al menos ${state.minMatches} PJ con y sin cada compañero todavía. Baja el mínimo de partidos o espera más partidos.`)]));
}

// ---------------------------------------------------------------------------
// Por posición
// ---------------------------------------------------------------------------

async function renderPositions(filters, requestId) {
  const rows = filters.types.length ? await api.getPositionStats(filters) : [];
  if (requestId !== state.requestId) return;
  const list = rows.filter((r) => r.player_position === state.position && r.matches >= state.minMatches)
    .sort((a, b) => Number(b.avg_rating) - Number(a.avg_rating));
  const isGk = state.position === 'goalkeeper';
  const cols = ['#', 'Jugador', 'PJ', 'Calif.', 'G', 'A', 'G+A/90', 'Pases %', 'Entradas %', 'Vallas', 'MVP %', '% Vic.'];
  $('#positions-table').replaceChildren(
    el('thead', {}, el('tr', {}, cols.map((h, i) => el('th', { scope: 'col', class: i === 1 ? 'left' : i === 0 ? 'rank' : null }, h)))),
    el('tbody', {}, list.length ? list.map((r, i) => el('tr', { class: 'clickable', ...onActivate(() => openPerson(r.person_id)) },
      el('td', { class: 'rank' }, String(i + 1)),
      el('td', { class: 'left' }, playerCell(r.person_name)),
      el('td', {}, fmtNum(r.matches)),
      el('td', { class: 'sorted' }, fmtNum(r.avg_rating, 2)),
      el('td', {}, fmtNum(r.goals)), el('td', {}, fmtNum(r.assists)),
      el('td', {}, fmtNum(r.ga_per90, 2)),
      el('td', {}, fmtPct(r.pass_accuracy_pct)),
      el('td', {}, fmtPct(r.tackle_success_pct)),
      el('td', {}, isGk || r.clean_sheets ? fmtNum(r.clean_sheets) : '—'),
      el('td', {}, fmtPct(r.mom_pct)),
      el('td', {}, fmtPct(r.win_pct)))) : [emptyRow(cols.length, `Nadie jugó de ${POS_LABEL[state.position].toLowerCase()} con estos filtros.`)]));
}

// ---------------------------------------------------------------------------
// Partidos
// ---------------------------------------------------------------------------

async function renderMatches(filters, requestId) {
  const [matches, flags] = filters.types.length
    ? await Promise.all([api.getMatches(filters), api.getMatchFlags(filters)])
    : [[], new Map()];
  if (requestId !== state.requestId) return;
  const shown = filters.excludeIncomplete ? matches.filter((m) => !flags.get(m.match_id)?.incomplete) : matches;
  // Goleadores y MVP de cada partido, para verlos sin abrirlo.
  const ids = shown.map((m) => m.match_id);
  const [hl, times] = await Promise.all([api.getMatchHighlights(ids).catch(() => []), api.getPlayerTimes(ids).catch(() => [])]);
  if (requestId !== state.requestId) return;
  const tflags = playerTimeFlags(times);
  const byMatch = new Map();
  for (const h of hl) {
    if (!byMatch.has(h.match_id)) byMatch.set(h.match_id, { scorers: new Map(), mvp: [], humanGoals: 0, players: [] });
    const e = byMatch.get(h.match_id);
    if (h.goals > 0) e.scorers.set(h.person_name, (e.scorers.get(h.person_name) ?? 0) + h.goals);
    if (h.is_mom) e.mvp.push(h.person_name);
    e.humanGoals += h.goals ?? 0;
    e.players.push(h);
  }
  const highlights = (m, incomplete) => {
    const e = byMatch.get(m.match_id);
    if (!e) return null;
    const goals = [...e.scorers].map(([n, g]) => (g > 1 ? `${n} (${g})` : n)).join(', ');
    // Goles de la IA = marcador del equipo menos los goles de los jugadores humanos.
    // En un abandono el marcador lo asigna EA (p. ej. 0-3), así que no se calcula.
    const ai = incomplete ? 0 : m.goals_for - e.humanGoals;
    // Quién entró desde la banca o salió antes (etiquetas; no cambia ningún número).
    const moves = e.players.map((p) => [p.person_name, tflags.get(`${m.match_id}|${p.player_id}`)]).filter(([, f]) => f);
    return el('div', { class: 'match-hl muted small' },
      goals ? el('span', {}, el('span', { class: 'hl-tag' }, 'Goles'), ` ${goals}`) : null,
      ai > 0 ? el('span', { title: 'Goles de los jugadores controlados por la IA de nuestro equipo (marcador menos goles de los jugadores humanos)' }, el('span', { class: 'hl-tag' }, 'IA'), ` ${ai} gol${ai === 1 ? '' : 'es'}`) : null,
      e.mvp.length ? el('span', {}, el('span', { class: 'hl-tag mvp' }, '★ MVP'), ` ${e.mvp.join(', ')}`) : null,
      moves.map(([name, f]) => el('span', { class: 'hl-move' }, `${name} `, timeBadges(f))));
  };
  const cols = ['Fecha', 'Tipo', 'Rival', 'Nivel rival', 'Div.', 'Jug.', 'Marcador', 'Res.'];
  const body = el('tbody');
  if (!shown.length) body.append(emptyRow(cols.length, 'Sin partidos para estos filtros.'));
  for (const m of shown) {
    const f = flags.get(m.match_id);
    const row = el('tr', { class: 'clickable', 'aria-expanded': 'false' },
      el('td', { class: 'left' }, fmtDate(m.played_at)),
      el('td', { class: 'left' }, el('span', { class: 'badge' }, TYPE_LABEL[m.match_type] ?? m.match_type)),
      el('td', { class: 'left' }, m.opponent_name ?? '—', f?.incomplete ? [' ', el('span', { class: 'badge warn', title: 'El partido se cortó antes del 90 % del tiempo o un equipo abandonó. El marcador es el que da EA.' }, 'Abandonado')] : null, highlights(m, f?.incomplete)),
      el('td', {}, fmtNum(m.opponent_skill_rating)),
      el('td', { title: f?.club_division != null ? `División del club ese día. ${divisionTitle(f.club_division)}` : 'Sin dato de división' }, gameDivision(f?.club_division) ?? '—'),
      el('td', { title: 'Jugadores del club en cancha' }, fmtNum(f?.team_size)),
      // Marcador tal cual EA (en un abandono es el que asigna EA; la etiqueta "Abandonado" lo avisa).
      el('td', {}, el('strong', {}, `${m.goals_for} – ${m.goals_against}`)),
      el('td', {}, resultBadge(m.outcome, m.winner_by_dnf)));
    const toggle = () => toggleMatchPlayers(row, m.match_id, cols.length);
    Object.entries(onActivate(toggle)).forEach(([k, v]) => (k.startsWith('on') ? row.addEventListener(k.slice(2), v) : row.setAttribute(k, v)));
    body.append(row);
  }
  $('#matches-table').replaceChildren(el('thead', {}, el('tr', {}, cols.map((h, i) => el('th', { scope: 'col', class: i < 3 ? 'left' : null }, h)))), body);
}

async function toggleMatchPlayers(row, matchId, colspan) {
  const next = row.nextElementSibling;
  if (next?.classList.contains('match-players')) {
    next.remove();
    row.setAttribute('aria-expanded', 'false');
    return;
  }
  row.setAttribute('aria-expanded', 'true');
  const cell = el('td', { colspan }, el('span', { class: 'muted' }, 'Cargando jugadores…'));
  row.after(el('tr', { class: 'match-players' }, cell));
  try {
    const [players, times] = await Promise.all([api.getMatchPlayers(matchId), api.getPlayerTimes([matchId]).catch(() => [])]);
    const tf = playerTimeFlags(times);
    cell.replaceChildren(el('table', { class: 'data' },
      el('thead', {}, el('tr', {},
        ['Jugador', 'Pos.', 'Calif.', 'G', 'A', 'Tiros', 'Pases', 'Entradas', 'Atajadas', 'MVP'].map((h, i) => el('th', { scope: 'col', class: i < 2 ? 'left' : null }, h)),
        state.showExp ? ['Regates*', 'Intercep.*'].map((h) => el('th', { scope: 'col', class: 'exp' }, h)) : null)),
      el('tbody', {}, players.map((p) => el('tr', { class: 'clickable', ...onActivate(() => openPerson(p.person_id)) },
        el('td', {}, playerCell(p.person_name, p.platform ? platformLabel(p.platform) : null)),
        el('td', { class: 'left' }, posBadge(p.position), ' ', timeBadges(tf.get(`${matchId}|${p.player_id}`))),
        el('td', {}, el('strong', {}, fmtNum(p.rating, 1))),
        el('td', {}, fmtNum(p.goals)), el('td', {}, fmtNum(p.assists)), el('td', {}, fmtNum(p.shots)),
        el('td', {}, `${p.passes_made}/${p.pass_attempts}`),
        el('td', {}, fmtNum(p.tackles_made)), el('td', {}, fmtNum(p.saves)),
        el('td', {}, p.is_mom ? '★' : ''),
        state.showExp ? [el('td', { class: 'exp' }, fmtNum(p.dribbles_exp)), el('td', { class: 'exp' }, fmtNum(p.interceptions_exp))] : null)))));
  } catch (err) {
    cell.replaceChildren(el('span', { class: 'muted' }, `Error: ${err.message}`));
  }
}

// ---------------------------------------------------------------------------
// Miembros (members/stats de EA)
// ---------------------------------------------------------------------------

const RECON_STATUS = {
  ok: { icon: '✓', label: 'Cuadra' },
  faltan: { icon: '⚠', label: 'Faltan' },
  extra: { icon: '•', label: 'Extra' },
  sin_datos: { icon: '–', label: 'Sin datos' },
};

/** Aviso discreto en la cabecera: solo aparece si algún miembro tiene partidos sin capturar. */
async function renderReconAlert() {
  const rows = await api.getReconciliation(state.clubId);
  state.recon = rows;
  const missing = rows.filter((r) => r.status === 'faltan');
  const link = $('#recon-alert');
  if (!missing.length) { link.hidden = true; return; }
  link.hidden = false;
  link.replaceChildren(el('span', { class: 'icon', 'aria-hidden': 'true' }, '⚠'),
    el('span', {}, `Posible partido perdido · ${missing.length} miembro${missing.length === 1 ? '' : 's'}`));
  link.title = 'EA sumó más partidos, goles o asistencias de los que capturamos. Ver verificación.';
}

function renderRecon() {
  const rows = state.recon ?? [];
  const diff = (v) => (v == null ? '—' : v === 0 ? '0' : fmtSigned(v));
  const cols = ['Estado', 'Miembro', 'Desde', 'PJ (cap. / EA)', 'Dif.', 'Goles (cap. / EA)', 'Dif.', 'Asist. (cap. / EA)', 'Dif.', 'MVP (cap. / EA)', 'Dif.'];
  $('#recon-table').replaceChildren(
    el('thead', {}, el('tr', {}, cols.map((h, i) => el('th', { scope: 'col', class: i < 2 ? 'left' : null }, h)))),
    el('tbody', {}, rows.length ? rows.map((r) => {
      const s = RECON_STATUS[r.status] ?? RECON_STATUS.sin_datos;
      return el('tr', r.person_id ? { class: 'clickable', ...onActivate(() => { location.hash = ''; setView('ranking'); openPerson(r.person_id); }) } : {},
        el('td', { class: 'left' }, el('span', { class: r.status === 'faltan' ? 'badge warn' : 'badge' }, `${s.icon} ${s.label}`)),
        el('td', { class: 'left' }, playerCell(r.member_name)),
        el('td', {}, fmtDate(`${r.first_date}T12:00:00Z`, false)),
        el('td', {}, `${fmtNum(r.cap_games)} / ${fmtNum(r.ea_games)}`), el('td', { class: r.diff_games < 0 ? 'sorted' : null }, diff(r.diff_games)),
        el('td', {}, `${fmtNum(r.cap_goals)} / ${fmtNum(r.ea_goals)}`), el('td', {}, diff(r.diff_goals)),
        el('td', {}, `${fmtNum(r.cap_assists)} / ${fmtNum(r.ea_assists)}`), el('td', {}, diff(r.diff_assists)),
        el('td', {}, `${fmtNum(r.cap_mom)} / ${fmtNum(r.ea_mom)}`), el('td', {}, diff(r.diff_mom)));
    }) : [emptyRow(cols.length, 'Todavía no hay fotos de members/stats.')]));
}

async function renderMembers() {
  if (!state.recon) state.recon = await api.getReconciliation(state.clubId);
  renderRecon();
  if (!state.members) state.members = await api.getMembers(state.clubId);
  const cols = [
    ['Miembro', 'left'], ['Personaje', 'left'], ['Pos. favorita', 'left'], ['Media', null, 'Media (overall) del Pro'],
    ['Δ media', null, 'Cambio de la media desde la primera foto'], ['PJ (EA, histórico)', null, 'Partidos según EA, desde que está en el club'],
    ['Goles (EA)', null], ['Asist. (EA)', null], ['% Vic.', null], ['% Pases', null], ['% Tiros', null, 'Tiros acertados según EA'],
    ['MVP', null], ['Calif. (EA)', null],
    ['Capturados / EA', null, 'Desde la primera foto: partidos capturados por el colector / partidos que EA le sumó'],
  ];
  const rows = state.members;
  $('#members-table').replaceChildren(
    el('thead', {}, el('tr', {}, cols.map(([h, cls, title]) => el('th', { scope: 'col', class: cls, title }, h)))),
    el('tbody', {}, rows.length ? rows.map((m) => {
      const delta = m.pro_overall != null && m.first_overall != null ? m.pro_overall - m.first_overall : null;
      const ea = m.ea_games_since_first, got = m.captured_since_first;
      const missing = ea != null && got < ea;
      return el('tr', m.person_id ? { class: 'clickable', ...onActivate(() => openPerson(m.person_id)) } : {},
        el('td', {}, playerCell(m.member_name)),
        el('td', { class: 'left' }, m.pro_name ?? '—'),
        el('td', { class: 'left' }, posBadge(m.favorite_position) ?? '—'),
        el('td', { class: 'sorted' }, fmtNum(m.pro_overall)),
        el('td', {}, delta == null ? '—' : fmtSigned(delta)),
        el('td', {}, fmtNum(m.games_played)),
        el('td', {}, fmtNum(m.goals)), el('td', {}, fmtNum(m.assists)),
        el('td', {}, fmtPct(m.win_rate, 0)), el('td', {}, fmtPct(m.pass_success_rate, 0)), el('td', {}, fmtPct(m.shot_success_rate, 0)),
        el('td', {}, fmtNum(m.man_of_the_match)), el('td', {}, fmtNum(m.rating_avg, 1)),
        el('td', { title: missing ? 'EA sumó más partidos de los que capturamos: posible partido perdido' : null },
          missing ? [el('span', { class: 'warn-icon', 'aria-hidden': 'true' }, '⚠ '), `${got} / ${ea}`] : ea == null ? '—' : `${got} / ${ea}`));
    }) : [emptyRow(cols.length, 'Todavía no hay fotos de members/stats.')]));
}

// ---------------------------------------------------------------------------
// Club
// ---------------------------------------------------------------------------

function renderClub() {
  const snaps = state.clubSnaps ?? [];
  const chartBox = $('#club-chart');
  chartBox.replaceChildren();
  drawLineChart(chartBox, snaps.filter((s) => s.skill_rating != null), {
    label: 'Nivel del club', value: (s) => s.skill_rating, date: (s) => `${s.snapshot_date}T12:00:00Z`,
    min: 0, max: 5000, pad: 25, step: 50, emptyText: 'Sin fotos del club todavía.',
    tooltip: (s) => [el('div', {}, el('strong', {}, `Nivel ${fmtNum(s.skill_rating)}`), s.current_division != null ? ` · ${gameDivision(s.current_division)}${Number(s.current_division) > 1 ? ' división' : ''}` : ''),
      el('div', { class: 'muted' }, fmtDate(`${s.snapshot_date}T12:00:00Z`, false))],
  });
  const weeklyBox = $('#club-weekly');
  weeklyBox.replaceChildren();
  drawLineChart(weeklyBox, weeklyAverages(state.timeline), {
    label: 'Calificación media del equipo por semana', value: (w) => w.avg, date: (w) => `${w.week}T12:00:00`,
    min: 0, max: 10, pad: 0.5, emptyText: 'Sin partidos en este rango.',
    tooltip: (w) => [el('div', {}, el('strong', {}, fmtNum(w.avg, 2)), ` · ${w.n} PJ`), el('div', { class: 'muted' }, `Semana del ${fmtDate(`${w.week}T12:00:00`, false)}`)],
  });
  const last = snaps.at(-1);
  $('#club-season-card').replaceChildren(last
    // Sin lo que ya está en la cabecera (división, V-E-D y puntos de la temporada).
    ? el('div', { class: 'season-grid' },
        tile('Partidos de temporada', fmtNum(last.season_games)),
        tile('Goles', last.season_goals != null ? `${last.season_goals} : ${last.season_goals_against}` : '—'),
        Object.assign(tile('Mejor división', gameDivision(last.best_division) ?? '—'), { title: divisionTitle(last.best_division) ?? '' }),
        goalSplitTile(),
        tile('Ascensos', fmtNum(last.promotions)), tile('Descensos', fmtNum(last.relegations)),
        tile('Histórico V-E-D', last.wins != null ? `${last.wins}-${last.draws}-${last.losses}` : '—'))
    : el('p', { class: 'muted', style: 'padding: 0 18px 18px' }, 'Sin fotos del club todavía.'));
}

// ---------------------------------------------------------------------------
// Detalle de jugador
// ---------------------------------------------------------------------------

function openPerson(personId) {
  if (state.personId !== personId) state.personTab = 'resumen';
  state.personId = personId;
  renderPerson(readFilters(), state.requestId).catch(showError);
}

const MIN_FIT_MATCHES = 3;
const POS_ORDER = ['forward', 'midfielder', 'defender', 'goalkeeper'];

/**
 * Posición recomendada (sugerencia del equipo). Dos lecturas distintas:
 *  - rendimiento: su calificación en cada posición que jugó vs. el promedio del club ahí;
 *  - perfil: a qué posición se parece su forma de jugar (aunque no la haya jugado).
 * Solo orientativo: no es la fórmula de "mejor jugador".
 */
function positionFitSection(fit) {
  if (!fit.length) return null;
  const played = fit.filter((f) => f.matches >= MIN_FIT_MATCHES && f.rating_idx != null)
    .sort((a, b) => Number(b.rating_idx) - Number(a.rating_idx));
  const profiled = fit.filter((f) => f.profile_match_pct != null && f.others_matches >= MIN_FIT_MATCHES)
    .sort((a, b) => Number(b.profile_match_pct) - Number(a.profile_match_pct));
  const best = played[0], like = profiled[0];
  const name = (p) => POS_LABEL[p]?.toLowerCase() ?? p;
  const notes = [];
  if (played.length >= 2) {
    notes.push(el('li', {}, 'Rinde mejor como ', el('strong', {}, name(best.player_position)),
      `: índice ${fmtNum(best.rating_idx, 0)} en ${best.matches} PJ (100 = promedio del club en esa posición).`));
  } else if (played.length === 1) {
    notes.push(el('li', {}, `Solo tiene ${MIN_FIT_MATCHES}+ PJ como ${name(best.player_position)}: hacen falta al menos dos posiciones para comparar su rendimiento.`));
  } else {
    notes.push(el('li', {}, `Todavía no tiene ${MIN_FIT_MATCHES} PJ en ninguna posición para comparar su rendimiento.`));
  }
  if (like && profiled.length >= 2) {
    notes.push(el('li', {}, 'Su forma de jugar se parece más a la de un ', el('strong', {}, name(like.player_position)),
      ` (${fmtNum(like.profile_match_pct, 0)} % de su perfil).`,
      Number(like.matches) === 0 ? ' Nunca jugó ahí: podría probarse, pero es solo una pista.' : ''));
  }
  const rows = [...fit].sort((a, b) => POS_ORDER.indexOf(a.player_position) - POS_ORDER.indexOf(b.player_position));
  return el('div', {},
    el('ul', { class: 'fit-summary' }, notes),
    el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', class: 'left' }, 'Posición'),
        el('th', { scope: 'col' }, 'PJ'),
        el('th', { scope: 'col' }, 'Calif.'),
        el('th', { scope: 'col', title: 'Calificación vs. el promedio del club en esa posición (100 = promedio)' }, 'Índice'),
        el('th', { scope: 'col', title: 'Cómo se reparte su perfil (goles, asistencias, tiros, pases, entradas, atajadas, intercepciones* y regates* por 90 min) entre las posiciones, según qué tan cerca está del perfil de los demás jugadores en cada una. Suma 100 %.' }, 'Perfil'))),
      el('tbody', {}, rows.map((f) => el('tr', { class: f === best && played.length >= 2 ? 'fit-best' : null },
        el('td', { class: 'left' }, posBadge(f.player_position)),
        el('td', {}, fmtNum(f.matches)),
        el('td', {}, fmtNum(f.rating, 2)),
        idxCell(f.rating_idx),
        el('td', { title: f.others_matches < MIN_FIT_MATCHES ? 'Pocos datos de otros jugadores en esa posición' : null },
          f.profile_match_pct == null || f.others_matches < MIN_FIT_MATCHES ? '—' : fmtPct(f.profile_match_pct, 0))))))),
    el('p', { class: 'muted small' }, `Orientativo. Índice: su calificación frente al promedio del club en esa posición (100 = promedio), solo con ${MIN_FIT_MATCHES}+ PJ. Perfil: cuánto de su forma de jugar corresponde a cada posición (suma 100 %); compara con los demás jugadores del club en cada posición (no consigo mismo) y solo usa posiciones donde los demás suman ${MIN_FIT_MATCHES}+ registros.`));
}

function tile(label, value, cls = '') {
  return el('div', { class: `tile ${cls}`.trim() }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value));
}

/**
 * "Nivel y división" del detalle: dónde entró, el nivel de sus rivales y su
 * rendimiento en cada división. Las fichas de la media del Pro se llenan después
 * (fillLevelTiles), cuando llegan las fotos diarias de members/stats.
 */
function divisionContext(matches, summary, levelTiles) {
  const first = matches.find((m) => m.club_division != null); // vienen de más viejo a más nuevo
  levelTiles.replaceChildren(
    tile('Media al entrar', '…'),
    tile('Media actual', summary?.pro_overall != null ? fmtNum(summary.pro_overall) : '…'),
    tile('Entró en', first ? `${gameDivision(first.club_division)}${Number(first.club_division) > 1 ? ' división' : ''}` : '—'),
    tile('Nivel medio de sus rivales', fmtNum(summary?.avg_opponent_skill)));
  levelTiles.lastElementChild.title = 'skillRating medio de los rivales que enfrentó: más alto = rivales más difíciles';
  levelTiles.children[2].title = first ? `Su primer partido con división registrada: ${fmtDate(first.played_at, false)}` : 'Sus partidos son anteriores al registro de la división';

  // Rendimiento por división (1ª arriba; los partidos sin dato, al final).
  const groups = new Map();
  for (const m of matches) {
    const key = m.club_division ?? 'sin';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const keys = [...groups.keys()].sort((a, b) => (a === 'sin') - (b === 'sin') || a - b);
  const avg = (list, f) => { const v = list.map(f).filter((x) => x != null).map(Number); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const table = el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, [['Div.', 'División del club'], ['PJ', 'Partidos jugados'], ['Calif.', 'Calificación media'], ['V-E-D', 'Victorias, empates y derrotas'], ['Rival', 'Nivel medio (skillRating) de los rivales']]
      .map(([h, t], i) => el('th', { scope: 'col', title: t, class: i === 0 ? 'left' : null }, h)))),
    el('tbody', {}, keys.length ? keys.map((k) => {
      const list = groups.get(k);
      const count = (o) => list.filter((m) => m.outcome === o).length;
      return el('tr', {},
        el('td', { class: 'left', title: k === 'sin' ? null : divisionTitle(k) }, k === 'sin' ? el('span', { class: 'muted', title: 'Partidos anteriores al registro de la división' }, 'Sin dato') : gameDivision(k)),
        el('td', {}, String(list.length)),
        el('td', {}, el('strong', {}, fmtNum(avg(list, (m) => m.rating), 2))),
        el('td', {}, `${count('win')}-${count('draw')}-${count('loss')}`),
        el('td', {}, fmtNum(avg(list, (m) => m.opponent_skill_rating))));
    }) : [emptyRow(5, 'Sin partidos para estos filtros.')])));
  return [levelTiles, table,
    el('p', { class: 'muted small' }, 'Contexto para valorar su rendimiento: no es lo mismo jugar en 5ª que en 1ª, ni contra rivales débiles que fuertes. Las divisiones son las del juego: de la 5ª a la 1ª, y por encima la División Élite. Con pocos partidos en una división, su promedio ahí no es confiable.')];
}

/** Media del Pro al entrar (primera foto diaria) y actual (última). */
function fillLevelTiles(box, history, matches) {
  if (!history.length) {
    for (const t of [...box.children].slice(0, 2)) {
      const v = t.querySelector('.value');
      if (v.textContent === '…') v.textContent = '—';
    }
    return;
  }
  const byDate = [...history].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const firstDate = byDate[0].snapshot_date, lastDate = byDate.at(-1).snapshot_date;
  // Con varias cuentas se toma la media más alta de cada día.
  const best = (d) => byDate.filter((h) => h.snapshot_date === d).sort((a, b) => b.pro_overall - a.pro_overall)[0];
  const start = best(firstDate), now = best(lastDate);
  const delta = now.pro_overall - start.pro_overall;
  box.children[0].querySelector('.value').textContent = fmtNum(start.pro_overall);
  box.children[1].querySelector('.value').textContent = `${fmtNum(now.pro_overall)}${delta ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}`;
  // Si en la primera foto ya llevaba partidos que no capturamos, "al entrar" es en
  // realidad "al empezar a registrar". La foto del día se pisa en cada captura, así
  // que incluye los partidos de ese mismo día (<=).
  const before = Number(start.games_played ?? 0) - matches.filter((m) => m.played_at.slice(0, 10) <= firstDate).length;
  box.children[0].title = before > 1
    ? `Primera foto: ${fmtDate(`${firstDate}T12:00:00Z`, false)}. Ya llevaba ${start.games_played} partidos en el club según EA, así que es su media al empezar el registro, no al entrar.`
    : `Primera foto: ${fmtDate(`${firstDate}T12:00:00Z`, false)}`;
  if (before > 1) box.children[0].querySelector('.label').textContent = 'Media al iniciar registro';
}

// ---------------------------------------------------------------------------
// Gráficas del jugador (SVG con viewBox: se escalan al ancho disponible).
// Un solo color de marca (acento); el texto usa los colores de texto, no el de la serie.
// ---------------------------------------------------------------------------

/** Una partida por persona y partido (si jugó con 2 cuentas en el mismo partido, se promedia). */
function perMatchRows(matches) {
  const by = new Map();
  for (const m of matches) {
    if (!by.has(m.match_id)) by.set(m.match_id, { ...m, ratings: [], seconds: 0 });
    const e = by.get(m.match_id);
    if (m.rating != null) e.ratings.push(Number(m.rating));
    e.seconds += Number(m.seconds_played ?? 0);
  }
  return [...by.values()].map((e) => ({ ...e, rating: e.ratings.length ? e.ratings.reduce((a, b) => a + b, 0) / e.ratings.length : null }));
}

const chartCard = (title, sub, body) => el('div', { class: 'pchart' }, el('h3', {}, title), sub ? el('p', { class: 'muted small' }, sub) : null, body);
const svgText = (x, y, text, attrs = {}) => { const t = svg('text', { x, y, ...attrs }); t.textContent = text; return t; };
const svgTitle = (node, text) => { const t = document.createElementNS(SVG_NS, 'title'); t.textContent = text; node.prepend(t); return node; };

/** 2. Calificación contra el nivel del rival: un punto por partido y la tendencia. */
function chartRatingVsRival(rows, W = 560) {
  const pts = rows.filter((r) => r.rating != null && r.opponent_skill_rating != null);
  if (pts.length < 2) return chartCard('Calificación vs. nivel del rival', null, el('p', { class: 'muted' }, 'Hacen falta al menos 2 partidos con el nivel del rival.'));
  const H = Math.round(Math.min(240, Math.max(180, W * 0.45))), L = 30, R = 10, T = 12, B = 34;
  const xs = pts.map((p) => Number(p.opponent_skill_rating)), ys = pts.map((p) => p.rating);
  const x0 = Math.floor((Math.min(...xs) - 30) / 50) * 50, x1 = Math.ceil((Math.max(...xs) + 30) / 50) * 50;
  const y0 = Math.max(0, Math.floor(Math.min(...ys, 6) - 0.5)), y1 = Math.min(10, Math.ceil(Math.max(...ys, 8) + 0.5));
  const sx = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R), sy = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'pchart-svg', role: 'img', 'aria-label': 'Calificación de cada partido según el nivel del rival' });
  for (let y = y0; y <= y1; y++) {
    s.append(svg('line', { x1: L, x2: W - R, y1: sy(y), y2: sy(y), class: 'grid-line' }));
    s.append(svgText(L - 8, sy(y) + 4, String(y), { class: 'axis', 'text-anchor': 'end' }));
  }
  s.append(svgText(L, H - 8, fmtNum(x0), { class: 'axis' }));
  s.append(svgText(W - R, H - 8, fmtNum(x1), { class: 'axis', 'text-anchor': 'end' }));
  s.append(svgText((L + W - R) / 2, H - 8, W < 380 ? 'Nivel del rival →' : 'Nivel del rival (skillRating) →', { class: 'axis', 'text-anchor': 'middle' }));
  // Tendencia (mínimos cuadrados) con 3 o más partidos: ¿baja contra rivales más fuertes?
  let slopeText = null;
  if (pts.length >= 3) {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    if (den > 0) {
      const b = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den, a = my - b * mx;
      s.append(svg('line', { x1: sx(x0), y1: sy(a + b * x0), x2: sx(x1), y2: sy(a + b * x1), class: 'trend-line' }));
      const per100 = b * 100;
      slopeText = Math.abs(per100) < 0.05 ? 'Rinde parecido contra rivales fuertes y débiles.'
        : per100 < 0 ? `Por cada 100 puntos más de nivel del rival, su calificación baja ${fmtNum(-per100, 2)} en promedio.`
          : `Por cada 100 puntos más de nivel del rival, su calificación sube ${fmtNum(per100, 2)} en promedio.`;
    }
  }
  for (const p of pts) {
    s.append(svgTitle(svg('circle', { cx: sx(Number(p.opponent_skill_rating)), cy: sy(p.rating), r: 6, class: 'dot' }),
      `${fmtDate(p.played_at, false)} · ${p.opponent_name ?? 'Rival'} (nivel ${fmtNum(p.opponent_skill_rating)}) · calificación ${fmtNum(p.rating, 1)}`));
  }
  return chartCard('Calificación vs. nivel del rival', slopeText ?? 'Cada punto es un partido. Con 3 o más aparece la tendencia.', s);
}

/** 4. Regularidad: cuántos partidos en cada tramo de calificación. */
function chartRatingDistribution(rows, W = 560) {
  const vals = rows.map((r) => r.rating).filter((v) => v != null);
  if (!vals.length) return chartCard('Regularidad', null, el('p', { class: 'muted' }, 'Sin calificaciones en este rango.'));
  const bins = [['<5,5', -Infinity, 5.5], ['5,5', 5.5, 6], ['6', 6, 6.5], ['6,5', 6.5, 7], ['7', 7, 7.5], ['7,5', 7.5, 8], ['8', 8, 8.5], ['8,5+', 8.5, Infinity]];
  const counts = bins.map(([, lo, hi]) => vals.filter((v) => v >= lo && v < hi).length);
  const max = Math.max(...counts);
  const H = Math.round(Math.min(220, Math.max(170, W * 0.38))), B = 30, T = 18, gap = W < 380 ? 4 : 10, bw = (W - gap * (bins.length - 1)) / bins.length;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'pchart-svg', role: 'img', 'aria-label': `Distribución de ${vals.length} calificaciones` });
  s.append(svg('line', { x1: 0, x2: W, y1: H - B, y2: H - B, class: 'grid-line' }));
  bins.forEach(([label, lo, hi], i) => {
    const x = i * (bw + gap), h = max ? ((H - B - T) * counts[i]) / max : 0;
    if (counts[i]) {
      s.append(svgTitle(svg('rect', { x, y: H - B - h, width: bw, height: h, rx: 4, class: 'bar-mark' }),
        `${counts[i]} partido${counts[i] === 1 ? '' : 's'} con calificación ${Number.isFinite(lo) ? fmtNum(lo, 1) : 'menor a'}${Number.isFinite(hi) ? `–${fmtNum(hi, 1)}` : ' o más'}`));
      s.append(svgText(x + bw / 2, H - B - h - 5, String(counts[i]), { class: 'axis strong', 'text-anchor': 'middle' }));
    }
    s.append(svgText(x + bw / 2, H - 9, label, { class: 'axis', 'text-anchor': 'middle' }));
  });
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
  return chartCard('Regularidad', `${vals.length} partidos · media ${fmtNum(mean, 2)} · variación ${fmtNum(sd, 2)} (más baja = más regular)`, s);
}

/** 5. Dónde juega: reparto de minutos por posición, con calificación y PJ en cada una. */
function chartPositions(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!r.position) continue;
    if (!by.has(r.position)) by.set(r.position, { sec: 0, ratings: [], n: 0 });
    const e = by.get(r.position); e.sec += r.seconds; e.n++; if (r.rating != null) e.ratings.push(r.rating);
  }
  const total = [...by.values()].reduce((a, e) => a + e.sec, 0);
  if (!total) return chartCard('Dónde juega', null, el('p', { class: 'muted' }, 'Sin minutos registrados en este rango.'));
  const list = [...by.entries()].sort((a, b) => b[1].sec - a[1].sec);
  const bar = el('div', { class: 'pos-bar', role: 'img', 'aria-label': list.map(([p, e]) => `${POS_LABEL[p] ?? p} ${Math.round((100 * e.sec) / total)} %`).join(', ') },
    list.map(([p, e]) => el('span', { class: `seg pos-${p}`, style: `flex:${e.sec}`, title: `${POS_LABEL[p] ?? p}: ${Math.round((100 * e.sec) / total)} % de sus minutos` },
      (100 * e.sec) / total >= 18 ? `${Math.round((100 * e.sec) / total)} %` : '')));
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const table = el('div', { class: 'pos-rows' }, list.map(([p, e]) => el('div', { class: 'pos-row' },
    posBadge(p),
    el('span', { class: 'muted small' }, `${Math.round((100 * e.sec) / total)} % · ${fmtNum(e.sec / 60)} min`),
    el('span', {}, el('strong', {}, fmtNum(avg(e.ratings), 2)), el('span', { class: 'muted small' }, ` · ${e.n} PJ`)))));
  return chartCard('Dónde juega', 'Reparto de sus minutos por posición, y su calificación media en cada una.', el('div', {}, bar, table));
}

/** 6. Calendario: cada día jugado, coloreado por su calificación media (más intenso = mejor). */
function chartCalendar(rows) {
  const days = new Map();
  for (const r of rows) {
    if (r.rating == null) continue;
    const d = new Date(r.played_at); d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    if (!days.has(key)) days.set(key, { d, ratings: [] });
    days.get(key).ratings.push(r.rating);
  }
  if (!days.size) return chartCard('Calendario', null, el('p', { class: 'muted' }, 'Sin partidos en este rango.'));
  const monday = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const keys = [...days.keys()].sort((a, b) => a - b);
  const MAX_WEEKS = 26;
  let start = monday(new Date(keys[0]));
  const end = monday(new Date(keys.at(-1)));
  const weeksAll = Math.round((end - start) / (7 * 864e5)) + 1;
  if (weeksAll > MAX_WEEKS) { start = new Date(end); start.setDate(start.getDate() - 7 * (MAX_WEEKS - 1)); }
  const weeks = Math.min(weeksAll, MAX_WEEKS);
  const C = 18, G = 4, L = 22, T = 18, W = L + weeks * (C + G), H = T + 7 * (C + G);
  const s = svg('svg', { viewBox: `0 0 ${Math.max(W, 200)} ${H}`, width: Math.max(W, 200), height: H, class: 'pchart-svg cal', role: 'img', 'aria-label': `Calendario de ${days.size} días con partidos` });
  ['L', '', 'X', '', 'V', '', 'D'].forEach((l, i) => l && s.append(svgText(0, T + i * (C + G) + 13, l, { class: 'axis' })));
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const wd = new Date(start); wd.setDate(wd.getDate() + w * 7);
    if (wd.getMonth() !== lastMonth) {
      lastMonth = wd.getMonth();
      s.append(svgText(L + w * (C + G), 11, wd.toLocaleDateString('es-CO', { month: 'short' }), { class: 'axis' }));
    }
    for (let i = 0; i < 7; i++) {
      const d = new Date(wd); d.setDate(d.getDate() + i);
      const e = days.get(d.getTime());
      const x = L + w * (C + G), y = T + i * (C + G);
      if (!e) { s.append(svg('rect', { x, y, width: C, height: C, rx: 4, class: 'cal-empty' })); continue; }
      const avg = e.ratings.reduce((a, b) => a + b, 0) / e.ratings.length;
      // Escala de un solo tono: 5,5 o menos = tenue; 8,5 o más = acento pleno.
      const pct = Math.round(25 + 75 * Math.min(1, Math.max(0, (avg - 5.5) / 3)));
      s.append(svgTitle(svg('rect', { x, y, width: C, height: C, rx: 4, style: `fill: color-mix(in srgb, var(--accent) ${pct}%, var(--surface-2))` }),
        `${d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })} · ${e.ratings.length} partido${e.ratings.length === 1 ? '' : 's'} · calificación ${fmtNum(avg, 2)}`));
    }
  }
  const legend = el('div', { class: 'cal-legend muted small' }, 'Peor ',
    [25, 50, 75, 100].map((p) => el('span', { class: 'cal-swatch', style: `background: color-mix(in srgb, var(--accent) ${p}%, var(--surface-2))` })), ' Mejor',
    weeksAll > MAX_WEEKS ? ` · últimas ${MAX_WEEKS} semanas` : '');
  return chartCard('Calendario', 'Cada cuadro es un día; los días con partido se colorean según su calificación media.', el('div', {}, el('div', { class: 'cal-scroll' }, s), legend));
}

/** Los avatares se dibujan por nombre: traduce person_id -> foto a nombre -> foto. */
function syncPhotoNames() {
  state.photoByName = new Map(state.ranking.filter((r) => state.photos.has(r.person_id)).map((r) => [r.person_name, state.photos.get(r.person_id)]));
}

/**
 * Achica la imagen elegida a 256×256 (recorte cuadrado al centro) en webp, para que
 * pese poco (el bucket acepta hasta 200 KB). Baja la calidad si hace falta.
 */
async function toAvatarWebp(file) {
  if (!file.type.startsWith('image/')) throw new Error('Elige un archivo de imagen.');
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
  for (const q of [0.85, 0.7, 0.5]) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', q));
    if (blob && blob.type === 'image/webp' && blob.size <= 190 * 1024) return blob;
  }
  throw new Error('No se pudo achicar la imagen lo suficiente. Prueba con otra.');
}

/** Botones de foto en el detalle: cambiar (elige archivo) y quitar. */
function photoControls(personId, name) {
  const input = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const status = el('span', { class: 'muted small photo-status', role: 'status' });
  const busy = (text) => { status.textContent = text; };
  const reload = async () => {
    state.photos = await api.getPlayerPhotos().catch(() => state.photos);
    syncPhotoNames();
    renderRanking();
    renderPerson(readFilters(), state.requestId).catch(showError);
  };
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      busy('Subiendo…');
      await api.uploadPlayerPhoto(personId, await toAvatarWebp(file));
      await reload();
    } catch (err) { busy(err.message); }
  });
  const has = state.photos.has(personId);
  return el('div', { class: 'photo-actions' },
    el('button', { type: 'button', class: 'link-btn', onclick: () => input.click(), title: 'Cualquiera puede cambiar la foto de cualquier jugador' }, has ? 'Cambiar foto' : 'Poner foto'),
    has ? el('button', { type: 'button', class: 'link-btn danger', onclick: async () => {
      if (!confirm(`¿Quitar la foto de ${name}? Vuelven sus iniciales.`)) return;
      try { busy('Quitando…'); await api.deletePlayerPhoto(personId); await reload(); } catch (err) { busy(err.message); }
    } }, 'Quitar') : null,
    input, status);
}

async function renderPerson(filters, requestId) {
  const box = $('#person-detail');
  if (state.personId == null) { box.hidden = true; return; }
  const summary = state.ranking.find((r) => r.person_id === state.personId);
  const rec = state.records.get(state.personId);
  const [matches, fitAll] = filters.types.length
    ? await Promise.all([api.getPersonMatches(state.personId, filters), api.getPositionFit(filters).catch(() => [])])
    : [[], []];
  if (requestId !== state.requestId) return;
  // Tiempos de todos los jugadores de esos partidos (para saber cuándo terminó cada uno).
  const personTimes = playerTimeFlags(await api.getPlayerTimes([...new Set(matches.map((m) => m.match_id))]).catch(() => []));
  if (requestId !== state.requestId) return;
  const fit = positionFitSection(fitAll.filter((f) => f.person_id === state.personId));

  const name = summary?.person_name ?? matches.at(-1)?.playername ?? 'Jugador';
  const platforms = [...new Set(matches.map((m) => m.platform).filter(Boolean))];
  const close = el('button', { type: 'button', class: 'close', onclick: () => { state.personId = null; box.hidden = true; } }, 'Cerrar');

  const basics = el('div', { class: 'tiles' },
    tile('Partidos', fmtNum(summary?.matches ?? matches.length)),
    tile('V-E-D', summary ? `${summary.wins}-${summary.draws}-${summary.losses}` : '—'),
    tile('Goles + asist.', fmtNum(summary?.goal_contributions)),
    tile('Calif. media', fmtNum(summary?.avg_rating, 2)),
    tile('MVP', fmtPct(summary?.mom_pct)),
    tile('Pases', fmtPct(summary?.pass_accuracy_pct)));
  const rel = state.relative.get(state.personId);
  const relTiles = rel ? el('div', { class: 'tiles' },
    tile('Calificación vs. su rol', fmtNum(rel.rating_idx, 0)),
    tile('G+A/90 vs. su rol', fmtNum(rel.ga90_idx, 0)),
    tile('Pases vs. su rol', fmtNum(rel.pass_idx, 0)),
    tile('Entradas/90 vs. su rol', fmtNum(rel.tackles90_idx, 0)),
    tile('Roles jugados', el('span', { class: 'badges' }, (rel.roles ?? '').split(', ').filter(Boolean).map(posBadge)))) : null;
  const advanced = state.showAdv ? el('div', { class: 'tiles' },
    tile('G+A por 90 min', fmtNum(summary?.ga_per90, 2)),
    tile('Forma (últ. 5)', fmtNum(summary?.form_rating, 2)),
    tile('Presencia', fmtPct(summary?.attendance_pct)),
    tile('Part. en goles', fmtPct(summary?.goal_participation_pct)),
    tile('Dif. de goles', fmtSigned(summary?.goal_diff))) : null;
  const records = rec ? el('div', { class: 'tiles' },
    tile('Más goles en un partido', fmtNum(rec.max_goals_match), 'record'),
    tile('Hat-tricks', fmtNum(rec.hat_tricks), 'record'),
    tile('Mejor calificación', fmtNum(rec.best_rating, 1), 'record'),
    tile('Racha goleadora', `${fmtNum(rec.longest_scoring_streak)} PJ`, 'record'),
    tile('Racha de MVP', `${fmtNum(rec.longest_mom_streak)} PJ`, 'record'),
    tile('Mayor invicto', `${fmtNum(rec.longest_unbeaten_streak)} PJ`, 'record'),
    tile('Invicto actual', `${fmtNum(rec.current_unbeaten_streak)} PJ`, 'record')) : null;

  // Nivel y división: contexto para valorar su rendimiento (no es la fórmula de "mejor jugador").
  const levelTiles = el('div', { class: 'tiles' });
  const divisionSection = divisionContext(matches, summary, levelTiles);

  const chartBox = el('div', { class: 'chart' }, el('h3', {}, 'Calificación por partido'));
  const overallBox = el('div', { class: 'chart' }, el('h3', {}, 'Media del Pro (EA), día a día'));
  const table = el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, ['Fecha', 'Tipo', 'Rival', 'Res.', 'Pos.', 'Min.', 'Calif.', 'G', 'A', 'MVP'].map((h, i) =>
      el('th', { scope: 'col', class: i < 3 || i === 4 ? 'left' : null, title: h === 'Min.' ? 'Minutos de juego; "parcial" si jugó menos del 75 % (entró desde la banca o salió antes)' : null }, h)),
      state.showExp ? ['Regates*', 'Intercep.*', 'Recup.*', 'Pérdidas*'].map((h) => el('th', { scope: 'col', class: 'exp' }, h)) : null)),
    el('tbody', {}, matches.length
      ? [...matches].reverse().map((m) => el('tr', {},
          el('td', { class: 'left' }, fmtDate(m.played_at, false)),
          el('td', { class: 'left' }, el('span', { class: 'badge' }, TYPE_LABEL[m.match_type] ?? m.match_type)),
          el('td', { class: 'left' }, m.opponent_name ?? '—', m.incomplete ? [' ', el('span', { class: 'badge warn', title: 'El partido se cortó antes del 90 % del tiempo o un equipo abandonó. El marcador es el que da EA.' }, 'Abandonado')] : null),
          el('td', {}, resultBadge(m.outcome), ` ${m.goals_for}–${m.goals_against}`),
          el('td', { class: 'left' }, posBadge(m.position)),
          // Minutos tal cual EA, con etiqueta si entró desde la banca o salió antes.
          el('td', {}, fmtNum((m.seconds_played ?? 0) / 60), ' ', timeBadges(personTimes.get(`${m.match_id}|${m.player_id}`))),
          el('td', {}, el('strong', {}, fmtNum(m.rating, 1))),
          el('td', {}, fmtNum(m.goals)), el('td', {}, fmtNum(m.assists)),
          el('td', {}, m.is_mom ? '★' : ''),
          state.showExp ? [m.dribbles_exp, m.interceptions_exp, m.possession_won_exp, m.possession_lost_exp].map((v) => el('td', { class: 'exp' }, fmtNum(v))) : null))
      : [emptyRow(state.showExp ? 14 : 10, 'Sin partidos para estos filtros.')])));

  // Evolución semanal: su calificación media por semana (el tooltip muestra la del equipo).
  const weeklyBox = el('div', { class: 'chart' }, el('h3', {}, 'Calificación media por semana'));
  const drawWeekly = () => {
    const team = new Map(weeklyAverages(state.timeline).map((w) => [w.week, w]));
    drawLineChart(weeklyBox, weeklyAverages(state.timeline, state.personId), {
      label: 'Calificación media por semana', value: (w) => w.avg, date: (w) => `${w.week}T12:00:00`,
      min: 0, max: 10, pad: 0.5, emptyText: 'Sin partidos en este rango.',
      tooltip: (w) => [
        el('div', {}, el('strong', {}, fmtNum(w.avg, 2)), ` · ${w.n} PJ`),
        el('div', { class: 'muted' }, `Semana del ${fmtDate(`${w.week}T12:00:00`, false)}`),
        team.get(w.week) ? el('div', {}, `Equipo: ${fmtNum(team.get(w.week).avg, 2)}`) : null,
      ],
    });
  };

  const byMatch = perMatchRows(matches);
  // Las gráficas con ejes se dibujan al mostrarse su pestaña, con el ancho real
  // disponible: así los textos de los ejes no se encogen en el celular.
  const rivalSlot = el('div', { class: 'pchart-slot' }), distSlot = el('div', { class: 'pchart-slot' });
  const drawMeasured = () => {
    for (const [slot, make] of [[rivalSlot, chartRatingVsRival], [distSlot, chartRatingDistribution]]) {
      const w = Math.max(240, Math.floor(slot.clientWidth) - 30);
      slot.replaceChildren(make(byMatch, w));
    }
  };
  // Pestañas internas: menos desplazamiento, sobre todo en el celular.
  const sec = (title, content) => (content ? [el('p', { class: 'section-title' }, title), content] : null);
  const panels = {
    resumen: [basics, el('div', { class: 'grid-2' }, chartBox, overallBox)],
    // Orden por importancia (decisión del usuario): rendimiento, relativo al rol,
    // evolución y, al final, la posición recomendada (orientativa).
    rendimiento: [
      sec('Avanzadas', advanced),
      sec('Relativo a su rol (100 = promedio de su posición)', relTiles),
      el('div', { class: 'grid-2' }, rivalSlot, distSlot),
      weeklyBox,
      sec('Posición recomendada', fit),
    ],
    contexto: [
      sec('Nivel y división', divisionSection),
      el('div', { class: 'grid-2' }, chartPositions(byMatch), chartCalendar(byMatch)), // sin escala: no hace falta medir
      sec('Récords y rachas', records),
    ],
    partidos: [table],
  };
  const labels = { resumen: 'Resumen', rendimiento: 'Rendimiento', contexto: 'Contexto', partidos: `Partidos (${matches.length})` };
  if (!panels[state.personTab]) state.personTab = 'resumen';
  const drawn = new Set();
  const panelEls = Object.fromEntries(Object.entries(panels).map(([k, v]) =>
    [k, el('div', { class: 'detail-panel', role: 'tabpanel', id: `panel-${k}`, hidden: k !== state.personTab }, v.flat(Infinity).filter(Boolean))]));
  const tabButtons = Object.keys(panels).map((k) => el('button', {
    type: 'button', role: 'tab', 'aria-selected': String(k === state.personTab), 'aria-controls': `panel-${k}`,
    onclick: () => {
      state.personTab = k;
      for (const b of tabButtons) b.setAttribute('aria-selected', String(b === tabButtons[Object.keys(panels).indexOf(k)]));
      for (const [pk, p] of Object.entries(panelEls)) p.hidden = pk !== k;
      // Los gráficos se dibujan al mostrarse: oculto no tienen ancho.
      if (k === 'rendimiento' && !drawn.has(k)) { drawn.add(k); drawWeekly(); drawMeasured(); }
    },
  }, labels[k]));

  box.replaceChildren(...[
    el('div', { class: 'detail-head' },
      el('div', { class: 'detail-id' }, el('div', { class: 'detail-avatar' }, avatar(name, true), photoControls(state.personId, name)), el('div', {}, el('h2', {}, name),
        el('div', { class: 'badges' }, posBadge(summary?.main_position), platforms.map((p) => el('span', { class: 'badge' }, platformLabel(p))),
          summary?.pro_overall != null ? el('span', { class: 'badge', title: 'Media (overall) del Pro según EA' }, `Media ${summary.pro_overall}`) : null,
          summary?.pro_name ? el('span', { class: 'badge', title: 'Nombre del personaje' }, summary.pro_name) : null))),
      el('div', { class: 'detail-actions' },
        el('button', { type: 'button', class: 'close', onclick: () => compareWith(state.personId) }, 'Comparar con…'),
        close)),
    el('div', { class: 'detail-tabs', role: 'tablist', 'aria-label': 'Secciones del jugador' }, tabButtons),
    ...Object.values(panelEls),
  ]);
  box.hidden = false;
  if (state.personTab === 'rendimiento') { drawn.add('rendimiento'); drawWeekly(); drawMeasured(); }
  drawLineChart(chartBox, matches.filter((m) => m.rating != null), {
    label: 'Calificación por partido', value: (p) => p.rating, date: (p) => p.played_at,
    min: 0, max: 10, pad: 0.5, emptyText: 'Sin calificaciones en este rango.',
    tooltip: (p) => [
      el('div', {}, el('strong', {}, fmtNum(p.rating, 1)), ` · ${OUTCOME[p.outcome]?.label ?? ''} ${p.goals_for}–${p.goals_against}`),
      el('div', { class: 'muted' }, `${fmtDate(p.played_at, false)} · ${p.opponent_name ?? ''}${p.opponent_skill_rating ? ` (nivel ${p.opponent_skill_rating})` : ''}`),
      el('div', {}, `G ${p.goals} · A ${p.assists}${p.is_mom ? ' · ★ MVP' : ''}`),
    ],
  });
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Media del Pro: fotos diarias de members/stats enlazadas a esta persona por gamertag.
  try {
    if (!state.members) state.members = await api.getMembers(state.clubId);
    const names = state.members.filter((m) => m.person_id === state.personId).map((m) => m.member_name);
    const history = (await api.getMemberHistory(names, state.clubId)).filter((h) => h.pro_overall != null);
    if (requestId !== state.requestId) return;
    fillLevelTiles(levelTiles, history, matches);
    drawLineChart(overallBox, history, {
      label: 'Media del Pro', value: (h) => h.pro_overall, date: (h) => `${h.snapshot_date}T12:00:00Z`,
      min: 40, max: 99, pad: 1, emptyText: 'Sin fotos de members/stats para este jugador.',
      tooltip: (h) => [
        el('div', {}, el('strong', {}, `Media ${h.pro_overall}`), names.length > 1 ? ` · ${h.member_name}` : ''),
        el('div', { class: 'muted' }, `${fmtDate(`${h.snapshot_date}T12:00:00Z`, false)} · ${h.games_played} partidos según EA`),
      ],
    });
  } catch (err) {
    overallBox.append(el('p', { class: 'muted' }, `No se pudo cargar la media: ${err.message}`));
    fillLevelTiles(levelTiles, [], matches);
  }
}

// ---------------------------------------------------------------------------
// Gráfico de línea (una sola serie: sin leyenda, el título la nombra)
// ---------------------------------------------------------------------------

let chartSeq = 0;

/**
 * opts: value(p), date(p) ISO, tooltip(p) -> nodos, min/max (límites del eje),
 *       pad (margen), step (cada cuánto una línea guía), label (accesible).
 */
function drawLineChart(container, points, opts) {
  if (points.length === 0) {
    container.append(el('p', { class: 'muted' }, opts.emptyText ?? 'Sin datos en este rango.'));
    return;
  }
  const W = Math.max(280, container.clientWidth || 600), H = 200;
  const pad = { l: 38, r: 12, t: 10, b: 24 };
  const vals = points.map((p) => Number(opts.value(p)));
  const step = opts.step ?? 1;
  let yMin = Math.max(opts.min, Math.floor((Math.min(...vals) - opts.pad) / step) * step);
  let yMax = Math.min(opts.max, Math.ceil((Math.max(...vals) + opts.pad) / step) * step);
  if (yMax === yMin) { yMin -= step; yMax += step; }
  const gridEvery = Math.max(step, Math.ceil((yMax - yMin) / 5 / step) * step);
  const x = (i) => points.length === 1 ? (pad.l + W - pad.r) / 2 : pad.l + (i * (W - pad.l - pad.r)) / (points.length - 1);
  const y = (v) => pad.t + ((yMax - v) * (H - pad.t - pad.b)) / (yMax - yMin || 1);
  const valueAt = (i) => Number(opts.value(points[i]));
  const gid = `area-${++chartSeq}`;

  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${opts.label}: ${points.length} puntos, entre ${yMin} y ${yMax}` });
  const defs = svg('defs');
  const grad = svg('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(svg('stop', { offset: '0%', 'stop-color': 'var(--series)', 'stop-opacity': 0.28 }),
    svg('stop', { offset: '100%', 'stop-color': 'var(--series)', 'stop-opacity': 0 }));
  defs.append(grad);
  chart.append(defs);
  for (let v = yMin; v <= yMax; v += gridEvery) {
    chart.append(svg('line', { class: 'gridline', x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }));
    const label = svg('text', { class: 'axis-label', x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end' });
    label.textContent = fmtNum(v);
    chart.append(label);
  }
  const first = svg('text', { class: 'axis-label', x: x(0), y: H - 6, 'text-anchor': points.length === 1 ? 'middle' : 'start' });
  first.textContent = fmtDate(opts.date(points[0]), false);
  chart.append(first);
  if (points.length > 1) {
    const last = svg('text', { class: 'axis-label', x: x(points.length - 1), y: H - 6, 'text-anchor': 'end' });
    last.textContent = fmtDate(opts.date(points.at(-1)), false);
    chart.append(last);
    const line = points.map((_, i) => `${i ? 'L' : 'M'}${x(i)},${y(valueAt(i))}`).join('');
    chart.append(svg('path', { d: `${line}L${x(points.length - 1)},${H - pad.b}L${x(0)},${H - pad.b}Z`, fill: `url(#${gid})` }));
    chart.append(svg('path', { class: 'line', d: line }));
  }
  if (points.length <= 40) {
    points.forEach((_, i) => chart.append(svg('circle', { class: 'dot', cx: x(i), cy: y(valueAt(i)), r: 4 })));
  }

  // Capa de hover: línea guía + punto resaltado + tooltip.
  const cross = svg('line', { class: 'crosshair', y1: pad.t, y2: H - pad.b, visibility: 'hidden' });
  const focus = svg('circle', { class: 'dot', r: 6, visibility: 'hidden' });
  const hit = svg('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' });
  chart.append(cross, focus, hit);
  const tip = el('div', { class: 'tooltip', hidden: true });

  hit.addEventListener('pointermove', (ev) => {
    const rect = chart.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    let i = 0;
    for (let k = 1; k < points.length; k++) if (Math.abs(x(k) - px) < Math.abs(x(i) - px)) i = k;
    for (const [node, attrs] of [[cross, { x1: x(i), x2: x(i) }], [focus, { cx: x(i), cy: y(valueAt(i)) }]]) {
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      node.setAttribute('visibility', 'visible');
    }
    tip.replaceChildren(...opts.tooltip(points[i]));
    tip.hidden = false;
    // Coordenadas relativas al contenedor (que también incluye el título).
    const box = container.getBoundingClientRect();
    const left = rect.left - box.left + (x(i) / W) * rect.width;
    const top = rect.top - box.top + (y(valueAt(i)) / H) * rect.height;
    tip.style.left = `${Math.min(Math.max(left - 70, 0), box.width - 180)}px`;
    tip.style.top = `${top + 14}px`;
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); focus.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  container.append(chart, tip);
}

// ---------------------------------------------------------------------------
// Carga y eventos
// ---------------------------------------------------------------------------

async function refresh() {
  const requestId = ++state.requestId;
  const filters = readFilters();
  showError(null);
  try {
    const [ranking, records, relative, timeline, photos] = filters.types.length
      ? await Promise.all([api.getPersonStats(filters), api.getPersonRecords(filters), api.getRelativeStats('position', filters), api.getRatingsTimeline(filters).catch(() => []), api.getPlayerPhotos().catch(() => new Map())])
      : [[], [], [], [], state.photos];
    state.photos = photos;
    state.timeline = timeline;
    state.trend = trendByPerson(timeline);
    if (!state.members) state.members = await api.getMembers(state.clubId).catch(() => []);
    if (requestId !== state.requestId) return;
    // Media del Pro (EA) por persona: la más alta entre sus cuentas.
    const ea = new Map();
    for (const m of state.members) {
      if (m.person_id == null || m.pro_overall == null) continue;
      const prev = ea.get(m.person_id);
      if (!prev || m.pro_overall > prev.pro_overall) ea.set(m.person_id, m);
    }
    state.ranking = ranking.map((r) => ({ ...r, pro_overall: ea.get(r.person_id)?.pro_overall ?? null, pro_name: ea.get(r.person_id)?.pro_name ?? null }));
    syncPhotoNames();
    state.records = new Map(records.map((r) => [r.person_id, r]));
    renderReconAlert().catch(() => {});
    state.relative = new Map(relative.map((r) => [r.person_id, r]));
    renderRanking();
    renderFewData();
    renderHeader().catch(() => {});
    const tasks = [];
    if (state.view === 'roles') {
      const real = state.roleMode === 'real';
      $('#roles-card').hidden = real;
      $('#positions-card').hidden = !real;
      tasks.push(real ? renderPositions(filters, requestId) : renderRoles(filters, requestId));
    }
    if (state.view === 'h2h') renderH2h();
    if (state.view === 'compare') tasks.push(renderCompare(filters, requestId));
    if (state.view === 'pairs') tasks.push(renderPairs(filters, requestId));
    if (state.view === 'matches') tasks.push(renderMatches(filters, requestId));
    if (state.view === 'members') tasks.push(renderMembers());
    if (state.view === 'club') renderClub();
    if (state.personId != null) tasks.push(renderPerson(filters, requestId));
    await Promise.all(tasks);
  } catch (err) {
    if (requestId === state.requestId) showError(err);
  }
}

function setView(view) {
  state.view = view;
  for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  if (view !== 'h2h') {
    // Los parámetros a/b solo tienen sentido en Cara a cara.
    const url = new URL(location.href);
    if (url.searchParams.has('a') || url.searchParams.has('b')) {
      url.searchParams.delete('a'); url.searchParams.delete('b');
      history.replaceState(null, '', url);
    }
  }
  for (const v of ['ranking', 'roles', 'h2h', 'compare', 'pairs', 'matches', 'members', 'club']) $(`#view-${v}`).hidden = v !== view;
  refresh();
}

function bindSegmented(containerSel, attr, onPick) {
  const buttons = document.querySelectorAll(`${containerSel} button`);
  for (const b of buttons) {
    b.addEventListener('click', () => {
      for (const x of buttons) x.setAttribute('aria-pressed', String(x === b));
      onPick(b.dataset[attr]);
    });
  }
}

/**
 * Marca la columna del jugador en cada tabla (class "player-col") para que el CSS
 * la deje fija al desplazar horizontalmente en el celular. Se hace en un solo
 * lugar, observando los cambios del DOM, en vez de tocar cada tabla.
 */
function watchPlayerColumns() {
  const mark = (table) => {
    const row = table.querySelector(':scope > tbody > tr:not(.match-players):not(.role-detail)');
    const cells = row ? [...row.children] : [];
    const idx = cells.findIndex((td) => td.querySelector(':scope > .player-cell'));
    if (idx < 0) return;
    for (const r of table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr:not(.match-players):not(.role-detail)')) {
      r.children[idx]?.classList.add('player-col');
    }
  };
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; document.querySelectorAll('table.data').forEach(mark); });
  }).observe(document.querySelector('main'), { childList: true, subtree: true });
}

/**
 * Etiqueta de versión y ventana de novedades: cada versión es un desplegable con
 * sus cambios; la actual viene abierta. El commit publicado va al pie, para soporte.
 */
function renderChangelog() {
  const current = CHANGELOG[0];
  $('#version-label').textContent = `v${current.version}`;
  // pages.yml cambia el marcador de versión por el commit en todo este archivo, así que
  // aquí se reconoce el commit por su forma (hexadecimal), no comparando con el marcador.
  const commit = new URL(import.meta.url).searchParams.get('v');
  $('#changelog-body').replaceChildren(...[
    ...CHANGELOG.map((v, i) => el('details', { class: 'release', open: i === 0 },
      el('summary', {},
        el('span', { class: 'release-version' }, `v${v.version}`),
        el('span', { class: 'release-title' }, v.title),
        el('span', { class: 'muted small' }, fmtDate(`${v.date}T12:00:00`, false))),
      el('ul', {}, v.changes.map((c) => el('li', {}, c))))),
    commit && /^[0-9a-f]{7,40}$/.test(commit) ? el('p', { class: 'muted small' }, `Publicación ${commit}`) : null,
  ].filter(Boolean));
}

/** Lo elegido en los menús "Fechas" y "Vista", a la vista sin abrirlos. */
function updateFiltersSummary() {
  const from = $('#from').value, to = $('#to').value;
  const short = (v) => new Date(`${v}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  $('#dates-value').textContent = from || to ? `${from ? short(from) : '…'} – ${to ? short(to) : 'hoy'}` : 'Todas';
  const opts = [];
  if (state.minMatches > 1) opts.push(`mín. ${state.minMatches} PJ`);
  // Por defecto se muestra todo tal cual EA; solo se avisa si se excluyen abandonos.
  if ($('#exclude-incomplete').checked) opts.push('sin abandonos');
  if ($('#show-adv').checked) opts.push('avanzadas');
  $('#view-value').textContent = opts.join(' · ');
}

/** Aviso de pocos datos: con menos de 10 partidos, las diferencias suelen ser casualidad. */
const FEW_MATCHES = 10;
function renderFewData() {
  const n = state.ranking[0]?.club_matches ?? 0;
  const box = $('#few-data');
  box.hidden = !(n > 0 && n < FEW_MATCHES);
  if (!box.hidden) box.textContent = `Con ${n} partido${n === 1 ? '' : 's'}, las diferencias entre jugadores todavía no son confiables: pueden ser casualidad. Los jugadores con menos de ${PODIUM_MIN_MATCHES} partidos se ven atenuados.`;
}

/**
 * Clubes seguidos: el elegido sale de la URL (?club=ID, para compartir enlaces)
 * o, si no, del más reciente. El selector solo aparece si hay más de uno.
 */
async function initClubs() {
  state.clubs = await api.getClubs().catch(() => []);
  const fromUrl = Number(new URLSearchParams(location.search).get('club'));
  state.clubId = state.clubs.some((c) => c.club_id === fromUrl) ? fromUrl : state.clubs[0]?.club_id ?? null;
  const select = $('#club-select');
  select.replaceChildren(...state.clubs.map((c) => el('option', { value: c.club_id }, `${c.name} · ${c.season}`)));
  select.value = String(state.clubId ?? '');
  $('#club-select-wrap').hidden = state.clubs.length < 2;
  select.addEventListener('change', () => {
    state.clubId = Number(select.value);
    // Lo que depende del club se vuelve a pedir.
    state.members = null;
    state.recon = null;
    state.personId = null;
    $('#person-detail').hidden = true;
    const url = new URL(location.href);
    url.searchParams.set('club', String(state.clubId));
    history.replaceState(null, '', url);
    refresh();
  });
}

async function init() {
  watchPlayerColumns();
  await initClubs();
  document.querySelector('.filters').addEventListener('change', updateFiltersSummary);
  document.querySelector('.filters').addEventListener('input', updateFiltersSummary);
  $('#clear-dates').addEventListener('click', () => {
    $('#from').value = ''; $('#to').value = '';
    $('#dates-pop').open = false;
    updateFiltersSummary(); refresh();
  });
  // Un menú abierto se cierra al abrir el otro o al tocar fuera.
  const pops = document.querySelectorAll('details.pop');
  for (const p of pops) p.addEventListener('toggle', () => { if (p.open) for (const o of pops) if (o !== p) o.open = false; });
  document.addEventListener('click', (e) => { for (const p of pops) if (p.open && !p.contains(e.target)) p.open = false; });
  for (const input of document.querySelectorAll('input[name="type"], #from, #to, #exclude-incomplete')) {
    input.addEventListener('change', refresh);
  }
  $('#min-matches').addEventListener('input', (e) => {
    state.minMatches = Math.max(1, Number(e.target.value) || 1);
    refresh();
  });
  for (const b of document.querySelectorAll('.tab')) {
    b.addEventListener('click', () => {
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      setView(b.dataset.view);
    });
  }
  // Vista oculta de verificación: solo por enlace (…/#verificacion).
  const route = () => { if (location.hash === '#verificacion') setView('members'); };
  window.addEventListener('hashchange', route);
  $('#close-verification').addEventListener('click', (e) => {
    e.preventDefault();
    history.replaceState(null, '', location.pathname + location.search);
    setView('ranking');
  });
  const resetSortIf = (flag) => {
    if (RANKING_COLUMNS.find((c) => c.key === state.sort.key)?.[flag]) state.sort = { key: 'avg_rating', dir: -1 };
  };
  // Guía y novedades: <dialog> nativo (Esc cierra; clic fuera del contenido también).
  for (const [dlg, open, close] of [['#guide', '#open-guide', '#close-guide'], ['#changelog', '#open-changelog', '#close-changelog']]) {
    const d = $(dlg);
    $(open).addEventListener('click', () => d.showModal());
    $(close).addEventListener('click', () => d.close());
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  }
  renderChangelog();

  const saved = prefs.load();
  if (typeof saved.showExp === 'boolean') state.showExp = saved.showExp;
  if (typeof saved.showAdv === 'boolean') state.showAdv = saved.showAdv;
  $('#show-exp').checked = state.showExp;
  $('#show-adv').checked = state.showAdv;
  updateFiltersSummary();
  $('#show-exp').addEventListener('change', (e) => { state.showExp = e.target.checked; prefs.save({ showExp: state.showExp }); if (!state.showExp) resetSortIf('exp'); refresh(); });
  $('#show-adv').addEventListener('change', (e) => { state.showAdv = e.target.checked; prefs.save({ showAdv: state.showAdv }); if (!state.showAdv) resetSortIf('adv'); refresh(); });
  bindSegmented('#role-group-buttons', 'group', (v) => { state.roleGroup = v; refresh(); });
  bindSegmented('#role-mode-buttons', 'mode', (v) => { state.roleMode = v; refresh(); });
  $('#h2h-a').addEventListener('change', (e) => { state.h2h.a = Number(e.target.value); renderH2h(); });
  $('#h2h-b').addEventListener('change', (e) => { state.h2h.b = Number(e.target.value); renderH2h(); });
  $('#h2h-swap').addEventListener('click', () => { state.h2h = { a: state.h2h.b, b: state.h2h.a }; renderH2h(); });
  // Enlace compartido de Cara a cara: …/?a=ID&b=ID
  const qs = new URLSearchParams(location.search);
  const startH2h = qs.has('a') && qs.has('b');
  if (startH2h) state.h2h = { a: Number(qs.get('a')), b: Number(qs.get('b')) };
  bindSegmented('#split-buttons', 'split', (v) => { state.split = v; refresh(); });
  bindSegmented('#split-metric', 'metric', (v) => { state.splitMetric = v; refresh(); });
  bindSegmented('#position-buttons', 'pos', (v) => { state.position = v; refresh(); });

  renderStatus();
  setInterval(renderStatus, 60_000);
  if (location.hash === '#verificacion') route();
  else if (startH2h) setView('h2h');
  else await refresh();
}

init();
