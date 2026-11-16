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
  // Experimentales activas por defecto (decisión del usuario); cada navegador
  // recuerda lo que elija (prefs).
  showExp: true,
  // Qué datos importantes muestra el ranking: totales, proporciones y oficiales
  // (los experimentales siguen a showExp). addedCols: datos que el usuario agregó a mano.
  colKinds: { abs: true, rate: true, official: true },
  addedCols: [],
  positions: new Map(), // person_id -> [{ pos, pct, sec }] de más a menos minutos
  pairsPerson: null, // Duplas: jugador elegido
  seasons: [], // temporadas del club (club_seasons), de la más reciente a la más vieja
  seasonNo: null, // temporada elegida en el filtro (null = todas)
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
/**
 * Ícono oficial de la división (imágenes públicas de EA, documentadas por la
 * comunidad). Verificado el 2026-11-16: el número de la imagen es el de la API
 * (divisioncrest1 = escudo morado con león = División Élite; divisioncrest5
 * muestra un "4"). Si no carga, se quita y queda el texto.
 */
const DIVISION_ICON = (n) => `https://media.contentapi.ea.com/content/dam/eacom/fc/pro-clubs/divisioncrest${n}.png`;
function divisionIcon(apiDiv, size = 'sm') {
  const n = Number(apiDiv);
  if (!Number.isInteger(n) || n < 1 || n > 6) return null;
  return el('img', { class: `div-icon ${size}`, src: DIVISION_ICON(n), alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() });
}

/**
 * Escudo del club: el propio (crestAssetId) o el real (teamId), desde la dirección
 * pública de EA que documenta la comunidad. Si ninguno carga, queda el escudo
 * dibujado con las iniciales.
 */
const CREST_URL = (id) => `https://eafc24.content.easports.com/fifa/fltOnlineAssets/24B23FDE-7835-41C2-87A2-F453DFDB2E82/2024/fcweb/crests/256x256/l${id}.png`;
function renderCrest(club) {
  const box = document.querySelector('.crest');
  box.querySelector('img')?.remove();
  box.classList.remove('has-img');
  const ids = [club.crest_asset_id, club.team_id].filter((v) => v != null);
  if (!ids.length) return;
  const img = el('img', { src: CREST_URL(ids[0]), alt: '', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.addEventListener('load', () => box.classList.add('has-img'));
  img.addEventListener('error', () => {
    ids.shift();
    if (ids.length) img.src = CREST_URL(ids[0]);
    else { img.remove(); box.classList.remove('has-img'); }
  });
  box.append(img);
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
  const season = state.seasons.find((s) => s.season_no === state.seasonNo);
  // Una temporada es un rango de fechas: se filtra con los mismos p_from/p_to (fin exclusivo).
  if (season) return { types, from: season.started_at, to: season.ended_at ?? null, excludeIncomplete: $('#exclude-incomplete').checked, clubId: state.clubId };
  // "Hasta" es inclusivo para el usuario; en la API p_to es exclusivo (+1 día).
  return { types, from: day($('#from').value), to: day($('#to').value, 1), excludeIncomplete: $('#exclude-incomplete').checked, clubId: state.clubId };
}

/** "Temporada 2 · 3 dic – hoy". */
function seasonLabel(s) {
  const d = (iso) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  return `Temporada ${s.season_no} · ${d(s.started_at)} – ${s.ended_at ? d(s.ended_at) : 'hoy'}`;
}

/** Temporadas del club (dentro del juego): llena el selector del menú "Fechas". */
async function loadSeasons() {
  state.seasons = await api.getSeasons(state.clubId).catch(() => []);
  if (!state.seasons.some((s) => s.season_no === state.seasonNo)) state.seasonNo = null;
  const sel = $('#season-select');
  sel.replaceChildren(el('option', { value: '' }, 'Todas las del juego'), ...state.seasons.map((s) => el('option', { value: s.season_no }, seasonLabel(s))));
  sel.value = state.seasonNo == null ? '' : String(state.seasonNo);
  for (const id of ['#from', '#to']) $(id).disabled = state.seasonNo != null;
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
  // clubs.season es el JUEGO ("FC27" -> "FC 27"); la temporada va aparte (club_seasons).
  const game = String(club?.season ?? '').replace(/^FC\s*(\d+)$/i, 'FC $1') || 'FC';
  const current = state.seasons.find((s) => s.ended_at == null) ?? state.seasons[0] ?? null;
  const seasonText = state.seasonNo != null ? `Temporada ${state.seasonNo}` : current ? `Temporada ${current.season_no}` : null;
  if (club) {
    $('#club-name').textContent = club.name;
    $('#crest-initials').textContent = initials(club.name);
    renderCrest(club);
    $('#game-label').textContent = `EA SPORTS ${game} · Clubes`;
    document.title = `${club.name} · Stats EA ${game}`;
  }
  const last = snaps.at(-1);
  const first = snaps[0];
  const delta = last && first && last.skill_rating != null && first.skill_rating != null ? last.skill_rating - first.skill_rating : null;
  const recent = await api.getRecentMatches(state.clubId).catch(() => []);
  const capturedMatches = state.ranking[0]?.club_matches;
  if (club) {
    $('#club-season').textContent = [game, seasonText, `${fmtNum(capturedMatches ?? 0)} partido${capturedMatches === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    $('#club-season').title = 'Juego, temporada y partidos capturados con los filtros actuales. Las temporadas se cuentan desde que empezamos a registrar al club.';
  }
  const form = el('div', { class: 'form-chips', role: 'img', 'aria-label': `Últimos resultados: ${recent.slice(0, 5).map((m) => OUTCOME[m.outcome]?.label ?? '—').join(', ')}` },
    recent.length ? [...recent.slice(0, 5)].reverse().map((m) => el('span', {
      class: `result ${m.outcome}`, title: `${OUTCOME[m.outcome]?.label ?? ''} ${m.goals_for}–${m.goals_against}${m.opponent_name ? ` vs. ${m.opponent_name}` : ''} · ${fmtDate(m.played_at, false)}`,
    }, OUTCOME[m.outcome]?.letter ?? '?')) : el('span', { class: 'muted' }, '—'));
  $('#club-kpis').replaceChildren(
    kpi('Nivel del club', fmtNum(last?.skill_rating),
      delta == null || snaps.length < 2 ? 'skillRating de EA' : `${fmtSigned(delta)} desde ${fmtDate(`${first.snapshot_date}T12:00:00Z`, false)}`,
      delta > 0 ? 'up' : delta < 0 ? 'down' : null),
    Object.assign(kpi('División', el('span', { class: 'div-value' }, divisionIcon(last?.current_division), gameDivision(last?.current_division) ?? '—'),
      last?.best_division != null ? `Mejor: ${gameDivision(last.best_division)}` : null), { title: divisionTitle(last?.current_division) ?? '' }),
    // EA da los números de la temporada EN CURSO (no de la elegida en el filtro).
    Object.assign(kpi(current ? `Temporada ${current.season_no} (en curso)` : 'Temporada', last?.season_wins != null ? `${last.season_wins}-${last.season_draws}-${last.season_losses}` : '—',
      [last?.season_points != null ? `${fmtNum(last.season_points)} pts · goles ${last.season_goals ?? '—'} : ${last.season_goals_against ?? '—'}` : 'V-E-D',
        current?.expected_end_at ? `termina ~${new Date(current.expected_end_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}` : null].filter(Boolean).join(' · ')),
    { title: current?.expected_end_at ? 'Fin estimado según el calendario del juego (EA no lo da en la API). La temporada nueva se detecta sola cuando EA reinicia sus contadores.' : '' }),
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

/**
 * Columnas del ranking. Cada dato dice qué es, para los filtros de "Datos":
 *   kind: 'base' (siempre), 'abs' (total) o 'rate' (proporción: por partido, por 90 min, %);
 *   exp: experimental (EA no lo documenta; lleva * y fondo teñido);
 *   important: se muestra por defecto. Los demás se agregan a mano con "+ Añadir dato".
 *   better: 'high' (por defecto), 'low' (menos es mejor) o null (no es mérito: sin podio).
 * Van agrupadas por tema; los experimentales, junto a los oficiales de su tema.
 * Los títulos están en lenguaje simple: sin códigos de EA (pedido del usuario).
 */
const EXP_NOTE = 'Experimental: dato que EA no documenta; es una aproximación';
const RANKING_COLUMNS = [
  { key: 'person_name', label: 'Jugador', text: true, kind: 'base', render: (r) => playerCell(r.person_name, r.platforms ? r.platforms.split(', ').map(platformLabel).join(' · ') : null) },
  { key: 'main_position', label: 'Posiciones', text: true, kind: 'base', title: 'Posiciones que jugó, con el % de sus minutos en cada una', render: (r) => positionShares(r.person_id, r.main_position) },
  { key: 'pro_overall', label: 'Media (EA)', kind: 'base', title: 'Media (overall) actual del Pro según EA' },
  { key: 'matches', label: 'PJ', kind: 'base', title: 'Partidos jugados (capturados)' },
  { key: 'wins', label: 'V-E-D', kind: 'base', title: 'Victorias, empates y derrotas (ordena por victorias)', render: (r) => `${r.wins}-${r.draws}-${r.losses}` },
  // --- Rendimiento
  { theme: 'Rendimiento', key: 'avg_rating', label: 'Calif.', kind: 'rate', important: true, title: 'Calificación media de EA', digits: 2 },
  { theme: 'Rendimiento', key: 'mom_pct', label: 'MVP %', kind: 'rate', important: true, title: 'Porcentaje de partidos como mejor jugador', digits: 1 },
  { theme: 'Rendimiento', key: 'mom_count', label: 'MVP', kind: 'abs', title: 'Partidos como mejor jugador' },
  { theme: 'Rendimiento', key: 'win_pct', label: '% Vic.', kind: 'rate', important: true, title: 'Porcentaje de partidos ganados', digits: 1 },
  // --- Ataque
  { theme: 'Ataque', key: 'goals', label: 'G', kind: 'abs', important: true, title: 'Goles' },
  { theme: 'Ataque', key: 'goals_per90', label: 'G/90', kind: 'rate', important: true, title: 'Goles por cada 90 minutos', digits: 2 },
  { theme: 'Ataque', key: 'assists', label: 'A', kind: 'abs', important: true, title: 'Asistencias' },
  { theme: 'Ataque', key: 'assists_per90', label: 'A/90', kind: 'rate', important: true, title: 'Asistencias por cada 90 minutos', digits: 2 },
  { theme: 'Ataque', key: 'goal_contributions', label: 'G+A', kind: 'abs', important: true, title: 'Goles + asistencias' },
  { theme: 'Ataque', key: 'ga_per90', label: 'G+A/90', kind: 'rate', important: true, title: 'Goles + asistencias por cada 90 minutos', digits: 2 },
  { theme: 'Ataque', key: 'ga_per_match', label: 'G+A/PJ', kind: 'rate', title: 'Goles + asistencias por partido', digits: 2 },
  { theme: 'Ataque', key: 'shots', label: 'Tiros', kind: 'abs', title: 'Tiros' },
  { theme: 'Ataque', key: 'shots_p90', label: 'Tiros/90', kind: 'rate', title: 'Tiros por cada 90 minutos', digits: 2 },
  { theme: 'Ataque', key: 'shot_conversion_pct', label: 'Conv. %', kind: 'rate', important: true, title: 'Goles / tiros', digits: 1 },
  { theme: 'Ataque', key: 'shot_accuracy_exp_pct', label: 'A puerta %*', kind: 'rate', important: true, title: 'Tiros a puerta / tiros', digits: 1, exp: true },
  { theme: 'Ataque', key: 'second_assists_exp', label: '2ª asist.*', kind: 'abs', important: true, title: 'Segundas asistencias (el pase previo a la asistencia)', exp: true },
  { theme: 'Ataque', key: 'second_assists_exp_p90', label: '2ª asist./90*', kind: 'rate', title: 'Segundas asistencias por cada 90 minutos', digits: 2, exp: true },
  { theme: 'Ataque', key: 'dribbles_exp', label: 'Regates*', kind: 'abs', important: true, title: 'Regates completados', exp: true },
  { theme: 'Ataque', key: 'dribbles_exp_p90', label: 'Regates/90*', kind: 'rate', important: true, title: 'Regates completados por cada 90 minutos', digits: 2, exp: true },
  { theme: 'Ataque', key: 'goal_participation_pct', label: 'Part. goles %', kind: 'rate', title: '(Goles + asistencias) / goles del equipo en sus partidos', digits: 1 },
  // --- Pase
  { theme: 'Pase', key: 'pass_accuracy_pct', label: 'Pases %', kind: 'rate', important: true, title: 'Pases completados / intentados', digits: 1 },
  { theme: 'Pase', key: 'passes_made', label: 'Pases', kind: 'abs', title: 'Pases completados' },
  { theme: 'Pase', key: 'passes_made_p90', label: 'Pases/90', kind: 'rate', title: 'Pases completados por cada 90 minutos', digits: 1 },
  { theme: 'Pase', key: 'forward_pass_pct_exp', label: 'Pase adel. %*', kind: 'rate', title: 'Pases hacia adelante completados', digits: 1, exp: true },
  { theme: 'Pase', key: 'through_passes_exp', label: 'Filtrados*', kind: 'abs', important: true, title: 'Pases filtrados completados', exp: true },
  { theme: 'Pase', key: 'through_passes_exp_p90', label: 'Filtrados/90*', kind: 'rate', title: 'Pases filtrados por cada 90 minutos', digits: 2, exp: true },
  { theme: 'Pase', key: 'cross_pct_exp', label: 'Centros %*', kind: 'rate', title: 'Centros completados', digits: 1, exp: true },
  { theme: 'Pase', key: 'best_option_pct_exp', label: 'Decisiones %*', kind: 'rate', title: 'Veces que el juego dijo "mejor opción" frente a "debió pasar a otro"', digits: 1, exp: true },
  { theme: 'Pase', key: 'possession_lost_exp', label: 'Pérdidas*', kind: 'abs', title: 'Posesiones perdidas', exp: true, better: 'low' },
  { theme: 'Pase', key: 'possession_lost_exp_p90', label: 'Pérdidas/90*', kind: 'rate', important: true, title: 'Posesiones perdidas por cada 90 minutos', digits: 2, exp: true, better: 'low' },
  // --- Defensa
  { theme: 'Defensa', key: 'tackle_success_pct', label: 'Entradas %', kind: 'rate', important: true, title: 'Entradas ganadas / intentadas', digits: 1 },
  { theme: 'Defensa', key: 'tackles_made', label: 'Entradas', kind: 'abs', important: true, title: 'Entradas ganadas' },
  { theme: 'Defensa', key: 'tackles_made_p90', label: 'Entradas/90', kind: 'rate', important: true, title: 'Entradas ganadas por cada 90 minutos', digits: 2 },
  { theme: 'Defensa', key: 'interceptions_exp', label: 'Intercep.*', kind: 'abs', important: true, title: 'Intercepciones', exp: true },
  { theme: 'Defensa', key: 'interceptions_exp_p90', label: 'Intercep./90*', kind: 'rate', important: true, title: 'Intercepciones por cada 90 minutos', digits: 2, exp: true },
  { theme: 'Defensa', key: 'possession_won_exp', label: 'Recup.*', kind: 'abs', title: 'Posesiones recuperadas', exp: true },
  { theme: 'Defensa', key: 'possession_won_exp_p90', label: 'Recup./90*', kind: 'rate', important: true, title: 'Posesiones recuperadas por cada 90 minutos', digits: 2, exp: true },
  { theme: 'Defensa', key: 'aerial_duels_won_exp', label: 'Aéreos*', kind: 'abs', title: 'Duelos aéreos ganados', exp: true },
  { theme: 'Defensa', key: 'aerial_duels_won_exp_p90', label: 'Aéreos/90*', kind: 'rate', title: 'Duelos aéreos ganados por cada 90 minutos', digits: 2, exp: true },
  { theme: 'Defensa', key: 'in_position_pct_exp', label: 'En posición %*', kind: 'rate', title: 'Veces bien ubicado frente a fuera de posición, según los avisos del juego', digits: 1, exp: true },
  { theme: 'Defensa', key: 'clean_sheets', label: 'Vallas', kind: 'abs', title: 'Vallas invictas (defensa + portero)' },
  { theme: 'Defensa', key: 'saves', label: 'Atajadas', kind: 'abs', important: true, title: 'Atajadas' },
  { theme: 'Defensa', key: 'save_pct', label: '% Atajadas', kind: 'rate', important: true, title: 'Porteros: atajadas / (atajadas + goles recibidos)', digits: 1 },
  // --- Disciplina
  { theme: 'Disciplina', key: 'red_cards', label: 'Rojas', kind: 'abs', important: true, title: 'Tarjetas rojas', better: 'low' },
  { theme: 'Disciplina', key: 'yellow_cards_exp', label: 'Amarillas*', kind: 'abs', important: true, title: 'Tarjetas amarillas', exp: true, better: 'low' },
  { theme: 'Disciplina', key: 'fouls_exp', label: 'Faltas*', kind: 'abs', title: 'Faltas cometidas', exp: true, better: 'low' },
  { theme: 'Disciplina', key: 'fouls_exp_p90', label: 'Faltas/90*', kind: 'rate', important: true, title: 'Faltas cometidas por cada 90 minutos', digits: 2, exp: true, better: 'low' },
  { theme: 'Disciplina', key: 'penalties_conceded_exp', label: 'Penales cometidos*', kind: 'abs', title: 'Penales cometidos (faltas en el área propia). EA no dice cuántos goles fueron de penal.', exp: true, better: 'low' },
  { theme: 'Disciplina', key: 'fouls_won_exp', label: 'Faltas recibidas*', kind: 'abs', title: 'Faltas que le hicieron', exp: true },
  { theme: 'Disciplina', key: 'offsides_exp', label: 'Fuera de juego*', kind: 'abs', title: 'Veces en fuera de juego (tiende a contar de menos)', exp: true, better: 'low' },
  // --- Más contadores (020): solo con "+ Añadir dato". Se suman en el navegador (addExtraCounters).
  { theme: 'Ataque', key: 'box_shots_exp', label: 'Tiros en área*', kind: 'abs', title: 'Tiros desde dentro del área', exp: true },
  { theme: 'Ataque', key: 'outside_shots_exp', label: 'Tiros de afuera*', kind: 'abs', title: 'Tiros desde fuera del área', exp: true },
  { theme: 'Ataque', key: 'weak_foot_goals_exp', label: 'Goles pierna mala*', kind: 'abs', title: 'Goles con la pierna mala', exp: true },
  { theme: 'Ataque', key: 'post_goals_exp', label: 'Goles tras palo*', kind: 'abs', title: 'Goles que entraron después de pegar en el palo', exp: true },
  { theme: 'Ataque', key: 'carries_exp', label: 'Conducciones*', kind: 'abs', title: 'Conducciones con el balón', exp: true },
  { theme: 'Ataque', key: 'beats_exp', label: 'Rival superado*', kind: 'abs', title: 'Regates superando al rival (con o sin filigrana)', exp: true },
  { theme: 'Ataque', key: 'beats_exp_p90', label: 'Rival superado/90*', kind: 'rate', title: 'Regates superando al rival por cada 90 minutos', digits: 2, exp: true },
  { theme: 'Ataque', key: 'skill_beats_exp', label: 'Filigranas*', kind: 'abs', title: 'Regates superando al rival con filigrana (skill move)', exp: true },
  { theme: 'Ataque', key: 'corners_taken_exp', label: 'Córners*', kind: 'abs', title: 'Córners lanzados', exp: true },
  { theme: 'Pase', key: 'short_pass_pct_exp', label: 'Pase corto %*', kind: 'rate', title: 'Pases cortos completados', digits: 1, exp: true },
  { theme: 'Pase', key: 'medium_pass_pct_exp', label: 'Pase medio %*', kind: 'rate', title: 'Pases de media distancia completados', digits: 1, exp: true },
  { theme: 'Pase', key: 'long_pass_pct_exp', label: 'Pase largo %*', kind: 'rate', title: 'Pases largos completados', digits: 1, exp: true },
  { theme: 'Pase', key: 'first_time_passes_exp', label: 'Primer toque*', kind: 'abs', title: 'Pases al primer toque', exp: true },
  { theme: 'Pase', key: 'switches_exp', label: 'Cambios de frente*', kind: 'abs', title: 'Cambios de frente', exp: true },
  { theme: 'Pase', key: 'flair_passes_exp', label: 'Pases de lujo*', kind: 'abs', title: 'Pases de lujo (taco, rabona…)', exp: true },
  { theme: 'Pase', key: 'through_ball_assists_exp', label: 'Asist. filtradas*', kind: 'abs', title: 'Asistencias con pase filtrado', exp: true },
  { theme: 'Pase', key: 'offside_passes_exp', label: 'Pases a fuera de juego*', kind: 'abs', title: 'Pases a un compañero en fuera de juego', exp: true, better: 'low' },
  { theme: 'Defensa', key: 'standing_tackles_exp', label: 'Entradas de pie*', kind: 'abs', title: 'Entradas de pie ganadas', exp: true },
  { theme: 'Defensa', key: 'sliding_tackles_exp', label: 'Barridas*', kind: 'abs', title: 'Entradas con barrida ganadas', exp: true },
  { theme: 'Defensa', key: 'clean_tackles_exp', label: 'Entradas limpias*', kind: 'abs', title: 'Entradas limpias al balón', exp: true },
  { theme: 'Defensa', key: 'dangerous_tackles_exp', label: 'Entradas peligrosas*', kind: 'abs', title: 'Entradas peligrosas', exp: true, better: 'low' },
  { theme: 'Defensa', key: 'dispossessed_exp', label: 'Balones quitados*', kind: 'abs', title: 'Veces que le quitó el balón al rival', exp: true },
  { theme: 'Defensa', key: 'dispossessed_exp_p90', label: 'Balones quitados/90*', kind: 'rate', title: 'Balones quitados al rival por cada 90 minutos', digits: 2, exp: true },
  { theme: 'Defensa', key: 'crosses_blocked_exp', label: 'Centros bloqueados*', kind: 'abs', title: 'Centros bloqueados', exp: true },
  { theme: 'Defensa', key: 'corners_conceded_exp', label: 'Córners concedidos*', kind: 'abs', title: 'Córners concedidos', exp: true, better: 'low' },
  { theme: 'Defensa', key: 'out_of_position_severe_exp', label: 'Muy fuera de posición*', kind: 'abs', title: 'Avisos del juego de "fuera de posición" en los dos niveles más graves', exp: true, better: 'low' },
  // --- Portero: tipos de atajada (oficiales de EA)
  { theme: 'Portero', key: 'reflex_saves', label: 'At. reflejo', kind: 'abs', title: 'Atajadas de reflejo' },
  { theme: 'Portero', key: 'ball_dive_saves', label: 'At. estirada', kind: 'abs', title: 'Atajadas en estirada' },
  { theme: 'Portero', key: 'parry_saves', label: 'At. desviadas', kind: 'abs', title: 'Atajadas desviando el balón' },
  { theme: 'Portero', key: 'punch_saves', label: 'At. puños', kind: 'abs', title: 'Atajadas con los puños' },
  { theme: 'Portero', key: 'cross_saves', label: 'At. centros', kind: 'abs', title: 'Centros atajados' },
  { theme: 'Portero', key: 'good_direction_saves', label: 'At. buena dirección', kind: 'abs', title: 'Atajadas que dejan el balón en buena dirección' },
  // --- Equipo y contexto
  { theme: 'Equipo y contexto', key: 'minutes_played', label: 'Min.', kind: 'abs', title: 'Minutos jugados (tiempo de juego)' },
  { theme: 'Equipo y contexto', key: 'goal_diff', label: 'Dif. goles', kind: 'abs', title: 'Goles a favor menos en contra en los partidos que jugó', render: (r) => fmtSigned(r.goal_diff) },
  { theme: 'Equipo y contexto', key: 'attendance_pct', label: 'Presencia %', kind: 'rate', title: 'Partidos jugados / partidos del club en el rango filtrado', digits: 1 },
  { theme: 'Equipo y contexto', key: 'form_rating', label: 'Forma', kind: 'rate', title: 'Calificación media de sus últimos 5 partidos', digits: 2 },
  { theme: 'Equipo y contexto', key: 'rating_stddev', label: 'Variación', kind: 'rate', title: 'Desviación de su calificación: más bajo = más regular', digits: 2, better: 'low' },
  { theme: 'Equipo y contexto', key: 'avg_opponent_skill', label: 'Nivel rival', kind: 'rate', title: 'Nivel medio (skillRating) de los rivales que enfrentó', better: null },
  { theme: 'Equipo y contexto', key: 'avg_team_size', label: 'Jug. prom.', kind: 'rate', title: 'Jugadores del club en cancha, en promedio', digits: 1, better: null },
  { theme: 'Equipo y contexto', key: 'incomplete_matches', label: 'Abandonos', kind: 'abs', title: 'Partidos abandonados o cortados antes de tiempo', better: null },
];

/** Totales que se pasan a "por 90 min" en el navegador (clave + "_p90"). */
const PER90_KEYS = ['shots', 'passes_made', 'second_assists_exp', 'dribbles_exp', 'through_passes_exp', 'possession_lost_exp', 'tackles_made',
  'interceptions_exp', 'possession_won_exp', 'aerial_duels_won_exp', 'fouls_exp', 'beats_exp', 'dispossessed_exp'];

/**
 * Suma por persona los contadores de la línea de tiempo (mismos filtros que el
 * ranking) y arma los datos derivados: tiros por zona y % de pases por distancia.
 * Si una persona no tiene ningún valor de un contador, queda en null (no en 0).
 */
function addExtraCounters(rows, timeline) {
  const sums = new Map();
  for (const t of timeline) {
    if (!sums.has(t.person_id)) sums.set(t.person_id, {});
    const s = sums.get(t.person_id);
    for (const k of api.EXTRA_COUNTERS) if (t[k] != null) s[k] = (s[k] ?? 0) + Number(t[k]);
  }
  const add = (a, b) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));
  const pct = (ok, ko) => (ok == null || ok + (ko ?? 0) === 0 ? null : Math.round((1000 * ok) / (ok + (ko ?? 0))) / 10);
  return rows.map((r) => {
    const s = sums.get(r.person_id) ?? {};
    return {
      ...r, ...s,
      box_shots_exp: add(s.box_shots_on_exp, s.box_shots_off_exp),
      outside_shots_exp: add(s.outside_shots_on_exp, s.outside_shots_off_exp),
      short_pass_pct_exp: pct(s.short_passes_ok_exp, s.short_passes_failed_exp),
      medium_pass_pct_exp: pct(s.medium_passes_ok_exp, s.medium_passes_failed_exp),
      long_pass_pct_exp: pct(s.long_passes_ok_exp, s.long_passes_failed_exp),
    };
  });
}

/** Agrega a cada fila de person_stats los datos derivados (por 90 min, % de victorias). */
function deriveRow(r) {
  const out = { ...r, win_pct: r.matches ? Math.round((1000 * r.wins) / r.matches) / 10 : null };
  for (const k of PER90_KEYS) out[`${k}_p90`] = r[k] == null || !Number(r.minutes_played) ? null : (Number(r[k]) * 90) / Number(r.minutes_played);
  return out;
}

const isAdded = (c) => state.addedCols.includes(c.key);
/** Lo que se muestra: lo básico, los datos importantes según los filtros de "Datos" y lo agregado a mano. */
function visibleColumns() {
  const k = state.colKinds;
  return RANKING_COLUMNS.filter((c) => c.kind === 'base' || isAdded(c) || (c.important
    && (c.kind === 'abs' ? k.abs : k.rate) && (c.exp ? state.showExp : k.official)));
}
const cellClass = (c, extra = '') => [c.text ? 'left' : '', c.exp ? 'exp' : '', isAdded(c) ? 'added' : '', extra].join(' ').trim() || null;

function setAddedCols(keys) {
  state.addedCols = [...new Set(keys)].filter((k) => RANKING_COLUMNS.some((c) => c.key === k));
  prefs.save({ addedCols: state.addedCols });
  if (!visibleColumns().some((c) => c.key === state.sort.key)) state.sort = { key: 'avg_rating', dir: -1 };
  renderRanking();
}

/**
 * "+ Añadir dato": todos los datos que no están en la tabla, por tema, con su tipo
 * (total o proporción; oficial o experimental). Lo agregado se recuerda en este navegador.
 */
function renderColumnPicker() {
  const shown = new Set(visibleColumns().map((c) => c.key));
  const rest = RANKING_COLUMNS.filter((c) => c.kind !== 'base' && !shown.has(c.key));
  const themes = [...new Set(rest.map((c) => c.theme))];
  $('#col-picker-count').textContent = state.addedCols.length ? `${state.addedCols.length} agregado${state.addedCols.length === 1 ? '' : 's'}` : '';
  $('#col-picker-body').replaceChildren(...[
    rest.length ? null : el('p', { class: 'muted small' }, 'Ya están todos los datos en la tabla.'),
    ...themes.map((t) => el('div', { class: 'picker-group' }, el('p', { class: 'picker-title' }, t),
      rest.filter((c) => c.theme === t).map((c) => el('button', {
        type: 'button', class: `picker-item${c.exp ? ' exp' : ''}`, title: c.exp ? `${c.title.replace(/\.$/, '')}. ${EXP_NOTE}.` : c.title,
        onclick: () => setAddedCols([...state.addedCols, c.key]),
      }, el('span', {}, `+ ${c.title}`), el('span', { class: 'picker-tags' }, c.kind === 'abs' ? 'Total' : 'Proporción', c.exp ? ' · Experimental' : ' · Oficial'))))),
    state.addedCols.length ? el('button', { type: 'button', class: 'link-btn', onclick: () => setAddedCols([]) }, 'Quitar todo lo agregado') : null].filter(Boolean));
}

/**
 * Posiciones de cada persona según sus minutos en los partidos filtrados.
 * Nadie queda definido por una sola posición: se muestran todas las que suman al
 * menos el 10 % de sus minutos (las demás, en el texto de ayuda).
 */
function positionsByPerson(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!r.position) continue;
    if (!by.has(r.person_id)) by.set(r.person_id, new Map());
    const m = by.get(r.person_id);
    m.set(r.position, (m.get(r.position) ?? 0) + Number(r.seconds_played ?? 0));
  }
  const out = new Map();
  for (const [id, m] of by) {
    const total = [...m.values()].reduce((a, b) => a + b, 0) || 1;
    out.set(id, [...m].map(([pos, sec]) => ({ pos, sec, pct: (100 * sec) / total })).sort((a, b) => b.sec - a.sec));
  }
  return out;
}

function positionShares(personId, fallback, compact = false) {
  const list = state.positions.get(personId);
  if (!list?.length) return posBadge(fallback) ?? '—';
  const main = list.filter((p) => p.pct >= 10);
  const title = list.map((p) => `${POS_LABEL[p.pos] ?? p.pos} ${Math.round(p.pct)} %`).join(' · ');
  return el('span', { class: 'pos-shares', title: `Minutos por posición: ${title}` },
    (compact ? main.slice(0, 2) : main).map((p) => el('span', { class: `badge pos-${p.pos}` },
      el('span', { class: list.length > 1 || compact ? 'pos-short-always' : 'pos-long' }, list.length > 1 || compact ? POS_SHORT[p.pos] : POS_LABEL[p.pos]),
      list.length > 1 ? el('span', { class: 'pos-pct' }, ` ${Math.round(p.pct)}%`) : null,
      list.length > 1 || compact ? null : el('span', { class: 'pos-short' }, POS_SHORT[p.pos]))));
}

/** Botones "Datos": totales, proporciones, oficiales y experimentales. */
function bindDataKinds() {
  const sync = () => {
    for (const b of document.querySelectorAll('#data-kinds [data-kind]')) {
      const k = b.dataset.kind;
      b.setAttribute('aria-pressed', String(k === 'exp' ? state.showExp : state.colKinds[k]));
    }
  };
  for (const b of document.querySelectorAll('#data-kinds [data-kind]')) {
    b.addEventListener('click', () => {
      const k = b.dataset.kind;
      if (k === 'exp') { $('#show-exp').checked = !state.showExp; $('#show-exp').dispatchEvent(new Event('change')); }
      else {
        state.colKinds = { ...state.colKinds, [k]: !state.colKinds[k] };
        prefs.save({ colKinds: state.colKinds });
        if (!visibleColumns().some((c) => c.key === state.sort.key)) state.sort = { key: 'avg_rating', dir: -1 };
        renderRanking();
      }
      sync();
    });
  }
  sync();
  return sync;
}

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
    }, c.label + (active ? (state.sort.dir === 1 ? ' ▲' : ' ▼') : '')),
    // Los datos agregados a mano se pueden quitar desde su encabezado.
    isAdded(c) ? el('button', { type: 'button', class: 'col-remove', title: `Quitar "${c.label}" de la tabla`, 'aria-label': `Quitar ${c.label}`, onclick: () => setAddedCols(state.addedCols.filter((k) => k !== c.key)) }, '×') : null);
  }));
  renderColumnPicker();

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

  renderRankingChart(rows, sortCol);

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
      positionShares(r.person_id, r.main_position, true),
      sparkline(state.trend.get(r.person_id))),
    el('div', { class: 'rank-card-stats' },
      cardKeys.map(([k, label, d]) => el('div', { class: k === state.sort.key ? 'sorted' : null }, el('div', { class: 'v' }, fmtNum(r[k], d)), el('div', { class: 'l' }, label))),
      extra ? el('div', { class: 'sorted' }, el('div', { class: 'v' }, extra.render ? extra.render(r) : fmtNum(r[extra.key], extra.digits ?? 0)), el('div', { class: 'l' }, extra.label)) : null))) : [el('p', { class: 'muted', style: 'padding: 12px' }, 'Sin datos para estos filtros.')]));
}

/**
 * Gráfica del dato por el que se ordena la tabla: una barra por jugador, del mejor
 * al peor en ese dato (si "menos es mejor", la barra más corta va arriba). Una sola
 * serie: el título la nombra; el valor va al final de cada barra en color de texto.
 */
function renderRankingChart(rows, col) {
  const box = $('#ranking-chart');
  const title = $('#ranking-chart-title');
  if (!col || col.text) { box.replaceChildren(el('p', { class: 'muted small' }, 'Ordena por un dato numérico para verlo en gráfica.')); title.textContent = 'En gráfica'; return; }
  title.textContent = `En gráfica: ${col.title ?? col.label}${col.exp ? ' *' : ''}`;
  const ordered = bestFirst(rows, col) ?? rows.filter((r) => r[col.key] != null).sort((a, b) => Number(b[col.key]) - Number(a[col.key]));
  if (!ordered.length) { box.replaceChildren(el('p', { class: 'muted small' }, 'Sin datos de este dato con los filtros actuales.')); return; }
  const max = Math.max(...ordered.map((r) => Math.abs(Number(r[col.key])))) || 1;
  // replaceChildren escribe "null" si recibe null: se filtran los vacíos.
  box.replaceChildren(...[el('div', { class: 'hbars', role: 'list' }, ordered.map((r) => {
    const v = Number(r[col.key]);
    const text = col.render ? col.render(r) : fmtNum(v, col.digits ?? 0);
    return el('div', { class: `hbar${r.matches < PODIUM_MIN_MATCHES ? ' low-sample' : ''}`, role: 'listitem', title: `${r.person_name}: ${typeof text === 'string' ? text : fmtNum(v, col.digits ?? 0)} · ${r.matches} PJ`, ...onActivate(() => openPerson(r.person_id)) },
      el('span', { class: 'hbar-name' }, r.person_name),
      el('span', { class: 'hbar-track' }, el('i', { style: `width:${Math.max(1, (100 * Math.abs(v)) / max)}%` })),
      el('span', { class: 'hbar-val' }, text));
  })), betterOf(col) === 'low' ? el('p', { class: 'muted small' }, 'En este dato, menos es mejor: arriba va quien tiene menos.') : null].filter(Boolean));
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
      // Para el promedio del equipo no tienen sentido (serían sumas de todos): sin dato.
      { label: 'Partidos', value: (r) => (r._team ? null : r.matches), better: null },
      { label: 'Minutos', value: (r) => (r._team ? null : r.minutes_played), better: null },
      { label: 'Presencia', value: (r) => (r._team ? null : r.attendance_pct), better: null, digits: 1, pct: true },
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

/** Valor del selector para comparar contra el promedio del equipo. */
const TEAM = 'team';

/**
 * "Promedio del equipo": un jugador ficticio que junta a todos los que cumplen el
 * mínimo de partidos. Los totales se suman y las tasas se recalculan con esas sumas
 * (pases %, por 90 min, % MVP…), así pesa cada partido y no cada jugador por igual.
 * Lo que no se puede recalcular (calificación media, forma, experimentales en %) es
 * el promedio de los jugadores ponderado por sus partidos.
 */
function teamAverageRow(people) {
  const sum = (k) => people.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const wmean = (k) => {
    const list = people.filter((r) => r[k] != null);
    const w = list.reduce((a, r) => a + r.matches, 0);
    return w ? list.reduce((a, r) => a + Number(r[k]) * r.matches, 0) / w : null;
  };
  const pct = (n, d) => (d ? (100 * n) / d : null);
  const row = {};
  for (const k of Object.keys(people[0] ?? {})) {
    if (people.some((r) => r[k] != null && typeof r[k] !== 'boolean' && !Number.isNaN(Number(r[k])))) row[k] = wmean(k);
  }
  Object.assign(row, { person_id: TEAM, person_name: 'Promedio del equipo', _team: true, _count: people.length, platforms: null });
  for (const k of ['matches', 'wins', 'draws', 'losses', 'goals', 'assists', 'shots', 'passes_made', 'pass_attempts', 'tackles_made', 'tackle_attempts',
    'mom_count', 'red_cards', 'seconds_played', 'minutes_played', 'goal_diff', 'team_goals', ...PER90_KEYS]) row[k] = sum(k);
  const min = row.minutes_played || null;
  Object.assign(row, {
    pass_accuracy_pct: pct(row.passes_made, row.pass_attempts),
    tackle_success_pct: pct(row.tackles_made, row.tackle_attempts),
    mom_pct: pct(row.mom_count, row.matches),
    shot_conversion_pct: pct(row.goals, row.shots),
    goal_participation_pct: pct(row.goals + row.assists, row.team_goals),
    goals_per90: min && (row.goals * 90) / min,
    assists_per90: min && (row.assists * 90) / min,
    ga_per90: min && ((row.goals + row.assists) * 90) / min,
    main_position: null,
  });
  return deriveRow(row);
}

/** Índices relativos al rol del "equipo": promedio ponderado por partidos (≈100). */
function teamRelative(people) {
  const out = {};
  for (const k of ['rating_idx', 'ga90_idx', 'pass_idx', 'tackles90_idx', 'save_idx', 'interceptions90_idx_exp']) {
    const list = people.map((p) => [state.relative.get(p.person_id)?.[k], p.matches]).filter(([v]) => v != null);
    const w = list.reduce((a, [, m]) => a + m, 0);
    out[k] = w ? list.reduce((a, [v, m]) => a + Number(v) * m, 0) / w : null;
  }
  return out;
}

function fillH2hPickers() {
  const people = state.ranking.filter((r) => r.matches >= state.minMatches)
    .sort((x, y) => x.person_name.localeCompare(y.person_name, 'es'));
  const ids = people.map((p) => p.person_id);
  const byMatches = [...people].sort((x, y) => y.matches - x.matches);
  if (!ids.includes(state.h2h.a)) state.h2h.a = byMatches[0]?.person_id ?? null;
  if (state.h2h.b !== TEAM && (!ids.includes(state.h2h.b) || state.h2h.b === state.h2h.a)) state.h2h.b = byMatches.find((p) => p.person_id !== state.h2h.a)?.person_id ?? null;
  for (const [sel, key] of [['#h2h-a', 'a'], ['#h2h-b', 'b']]) {
    $(sel).replaceChildren(
      ...(key === 'b' && people.length ? [el('option', { value: TEAM }, `Promedio del equipo (${people.length} jugadores)`)] : []),
      ...people.map((p) => el('option', { value: p.person_id }, `${p.person_name} (${p.matches} PJ)`)));
    $(sel).value = String(state.h2h[key] ?? '');
  }
}
const pickerValue = (v) => (v === TEAM ? TEAM : Number(v));

function renderH2h() {
  fillH2hPickers();
  const box = $('#h2h-body');
  const people = state.ranking.filter((r) => r.matches >= state.minMatches);
  const A = state.ranking.find((r) => r.person_id === state.h2h.a);
  const B = state.h2h.b === TEAM ? (people.length ? teamAverageRow(people) : null) : state.ranking.find((r) => r.person_id === state.h2h.b);
  if (!A || !B || A === B) {
    box.replaceChildren(el('p', { class: 'muted', style: 'padding: 0 18px 18px' }, 'Hacen falta al menos dos jugadores con el mínimo de partidos de los filtros.'));
    return;
  }
  const relA = state.relative.get(A.person_id) ?? {};
  const relB = B._team ? teamRelative(people) : state.relative.get(B.person_id) ?? {};
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
  const differentRoles = !B._team && A.main_position !== B.main_position;
  const lowSample = A.matches < MIN_FIT_MATCHES || (!B._team && B.matches < MIN_FIT_MATCHES);
  const card = (r, rel, cls) => el('div', { class: `h2h-player ${cls}` },
    r._team ? el('span', { class: 'avatar lg team-avatar', 'aria-hidden': 'true' }, 'EQ') : avatar(r.person_name, true),
    el('div', {}, el('div', { class: 'name' }, el('span', { class: 'swatch', 'aria-hidden': 'true' }), ' ', r.person_name),
      r._team ? null : el('div', { class: 'badges' }, roles(rel).length ? roles(rel).map(posBadge) : posBadge(r.main_position)),
      el('div', { class: 'muted small' }, r._team
        ? `${r._count} jugadores · ${fmtNum(state.ranking[0]?.club_matches)} partidos del club`
        : `${r.matches} PJ · ${fmtNum(r.minutes_played)} min`)));
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

/**
 * Partidos del club con quién jugó cada uno (de state.timeline, con los filtros).
 * Map match_id -> { outcome, gf, ga, people: Map(person_id -> { name, rating }) }.
 * Si alguien jugó con dos cuentas en el mismo partido, su calificación se promedia.
 */
function matchRoster(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.match_id)) out.set(r.match_id, { id: r.match_id, at: r.played_at, outcome: r.outcome, gf: r.goals_for, ga: r.goals_against, incomplete: r.incomplete, opp: r.opponent_skill_rating, people: new Map() });
    const ppl = out.get(r.match_id).people;
    if (!ppl.has(r.person_id)) ppl.set(r.person_id, { name: r.person_name, ratings: [] });
    if (r.rating != null) ppl.get(r.person_id).ratings.push(Number(r.rating));
  }
  for (const m of out.values()) for (const p of m.people.values()) p.rating = p.ratings.length ? p.ratings.reduce((a, b) => a + b, 0) / p.ratings.length : null;
  return out;
}

/** Resultados del equipo en una lista de partidos. rateOf(m): calificación a promediar (opcional). */
function teamResults(list, rateOf = null) {
  const n = list.length;
  const c = (o) => list.filter((m) => m.outcome === o).length;
  const ratings = rateOf ? list.map(rateOf).filter((v) => v != null) : [];
  return {
    n, w: c('win'), d: c('draw'), l: c('loss'),
    winPct: n ? (100 * c('win')) / n : null,
    gf: n ? list.reduce((a, m) => a + m.gf, 0) / n : null,
    ga: n ? list.reduce((a, m) => a + m.ga, 0) / n : null,
    rating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
  };
}

/** Diferencia con signo y color: positivo = al equipo le va mejor. */
function deltaCell(v, digits, suffix = '') {
  if (v == null || Number.isNaN(v)) return el('td', { class: 'muted' }, '—');
  const text = `${v > 0 ? '+' : ''}${fmtNum(v, digits)}${suffix}`;
  return el('td', { class: v > 0 ? 'delta-up' : v < 0 ? 'delta-down' : null }, el('strong', {}, text));
}

const vedText = (s) => `${s.w}-${s.d}-${s.l}`;
/** Con menos de 3 partidos (o del mínimo elegido) la diferencia puede ser casualidad: fila atenuada. */
const fewMatches = (n) => n < Math.max(state.minMatches, PODIUM_MIN_MATCHES);
const lowNote = (n) => (fewMatches(n) ? ' low-sample' : '');

/**
 * Duplas (une las antiguas tablas "Duplas" y "Con y sin", pedido del usuario):
 *  1. El equipo con y sin cada jugador (con gráfica de la diferencia en % de victorias).
 *  2. Un jugador elegido: cómo le va al equipo CON él junto a cada compañero, y SIN él.
 * Todo es correlación: también influyen el rival, la posición y la suerte.
 */
function renderPairs() {
  const roster = matchRoster(state.timeline);
  const all = [...roster.values()];
  const people = state.ranking.filter((r) => r.matches >= 1).sort((a, b) => b.matches - a.matches);

  // 1. Con y sin cada jugador
  const impact = people.map((p) => {
    const withP = all.filter((m) => m.people.has(p.person_id));
    const withoutP = all.filter((m) => !m.people.has(p.person_id));
    const a = teamResults(withP), b = teamResults(withoutP);
    return { p, a, b, delta: a.winPct != null && b.winPct != null ? a.winPct - b.winPct : null };
  }).filter((x) => x.a.n >= state.minMatches);
  const cols = ['Jugador', 'PJ con / sin', '% Vic. con', '% Vic. sin', 'Δ % Vic.', 'Goles a favor / PJ (con / sin)', 'Goles en contra / PJ (con / sin)'];
  $('#impact-table').replaceChildren(
    el('thead', {}, el('tr', {}, cols.map((h, i) => el('th', { scope: 'col', class: i === 0 ? 'left' : null }, h)))),
    el('tbody', {}, impact.length ? impact.map(({ p, a, b, delta }) => el('tr', { class: `clickable${lowNote(Math.min(a.n, b.n))}`, title: fewMatches(b.n) ? `Pocos partidos sin ${p.person_name}: la diferencia no es confiable` : null, ...onActivate(() => openPerson(p.person_id)) },
      el('td', {}, playerCell(p.person_name)),
      el('td', {}, `${a.n} / ${b.n}`),
      el('td', {}, fmtPct(a.winPct, 0)), el('td', {}, fmtPct(b.winPct, 0)),
      deltaCell(delta, 0, ' pts'),
      el('td', {}, `${fmtNum(a.gf, 2)} / ${fmtNum(b.gf, 2)}`),
      el('td', {}, `${fmtNum(a.ga, 2)} / ${fmtNum(b.ga, 2)}`)))
      : [emptyRow(cols.length, 'Sin datos para estos filtros.')]));
  renderImpactChart(impact.filter((x) => x.delta != null && x.b.n > 0));

  // 2. Un jugador: con él (junto a cada compañero) y sin él
  const sel = $('#pairs-person');
  if (!people.some((p) => p.person_id === state.pairsPerson)) state.pairsPerson = people[0]?.person_id ?? null;
  sel.replaceChildren(...people.map((p) => el('option', { value: p.person_id }, `${p.person_name} (${p.matches} PJ)`)));
  sel.value = String(state.pairsPerson ?? '');
  const X = people.find((p) => p.person_id === state.pairsPerson);
  if (!X) { $('#pairs-with').replaceChildren(); $('#pairs-without').replaceChildren(); return; }
  const withX = all.filter((m) => m.people.has(X.person_id));
  const withoutX = all.filter((m) => !m.people.has(X.person_id));
  const ratingOf = (id) => (m) => m.people.get(id)?.rating ?? null;
  const mates = people.filter((p) => p.person_id !== X.person_id);
  $('#pairs-with-title').textContent = `Con ${X.person_name}`;
  $('#pairs-without-title').textContent = `Sin ${X.person_name}`;

  const totalWith = teamResults(withX, ratingOf(X.person_id));
  const withRows = mates.map((y) => {
    const both = withX.filter((m) => m.people.has(y.person_id));
    return { y, s: teamResults(both, ratingOf(X.person_id)), ry: teamResults(both, ratingOf(y.person_id)).rating };
  }).filter((r) => r.s.n > 0).sort((a, b) => b.s.n - a.s.n);
  const withCols = ['Junto a', 'PJ', 'V-E-D', '% Vic.', 'Dif. goles / PJ', `Calif. de ${X.person_name}`, 'Calif. del compañero'];
  $('#pairs-with').replaceChildren(
    el('thead', {}, el('tr', {}, withCols.map((h, i) => el('th', { scope: 'col', class: i === 0 ? 'left' : null }, h)))),
    el('tbody', {},
      el('tr', { class: 'total-row' }, el('td', { class: 'left' }, el('strong', {}, 'Total con él')), el('td', {}, String(totalWith.n)), el('td', {}, vedText(totalWith)),
        el('td', {}, fmtPct(totalWith.winPct, 0)), deltaCell(totalWith.n ? totalWith.gf - totalWith.ga : null, 2), el('td', {}, fmtNum(totalWith.rating, 2)), el('td', { class: 'muted' }, '—')),
      withRows.length ? withRows.map(({ y, s, ry }) => el('tr', { class: `clickable${lowNote(s.n)}`, ...onActivate(() => openPerson(y.person_id)) },
        el('td', {}, playerCell(y.person_name)), el('td', {}, String(s.n)), el('td', {}, vedText(s)),
        el('td', {}, fmtPct(s.winPct, 0)), deltaCell(s.gf - s.ga, 2), el('td', {}, fmtNum(s.rating, 2)), el('td', {}, fmtNum(ry, 2))))
        : emptyRow(withCols.length, 'Nunca jugó con otro jugador del club en estos partidos.')));

  const totalWithout = teamResults(withoutX);
  const withoutRows = mates.map((y) => {
    const onlyY = withoutX.filter((m) => m.people.has(y.person_id));
    const s = teamResults(onlyY, ratingOf(y.person_id));
    const together = teamResults(withX.filter((m) => m.people.has(y.person_id)), ratingOf(y.person_id));
    return { y, s, delta: s.rating != null && together.rating != null ? together.rating - s.rating : null };
  }).filter((r) => r.s.n > 0).sort((a, b) => b.s.n - a.s.n);
  const withoutCols = ['Compañero', 'PJ', 'V-E-D', '% Vic.', 'Dif. goles / PJ', 'Calif. del compañero', `Δ calif. con ${X.person_name}`];
  $('#pairs-without').replaceChildren(
    el('thead', {}, el('tr', {}, withoutCols.map((h, i) => el('th', { scope: 'col', class: i === 0 ? 'left' : null, title: i === 6 ? `Calificación del compañero cuando juega con ${X.person_name} menos cuando juega sin él` : null }, h)))),
    el('tbody', {},
      el('tr', { class: 'total-row' }, el('td', { class: 'left' }, el('strong', {}, 'Total sin él')), el('td', {}, String(totalWithout.n)), el('td', {}, totalWithout.n ? vedText(totalWithout) : '—'),
        el('td', {}, fmtPct(totalWithout.winPct, 0)), deltaCell(totalWithout.n ? totalWithout.gf - totalWithout.ga : null, 2), el('td', { class: 'muted' }, '—'), el('td', { class: 'muted' }, '—')),
      withoutRows.length ? withoutRows.map(({ y, s, delta }) => el('tr', { class: `clickable${lowNote(s.n)}`, ...onActivate(() => openPerson(y.person_id)) },
        el('td', {}, playerCell(y.person_name)), el('td', {}, String(s.n)), el('td', {}, vedText(s)),
        el('td', {}, fmtPct(s.winPct, 0)), deltaCell(s.gf - s.ga, 2), el('td', {}, fmtNum(s.rating, 2)), deltaCell(delta, 2)))
        : emptyRow(withoutCols.length, `${X.person_name} jugó todos los partidos de estos filtros.`)));
}

/**
 * Gráfica divergente: % de victorias con el jugador menos sin él. Dos colores
 * (azul = al equipo le va mejor con él; naranja = peor) y el número con signo al
 * lado, para no depender solo del color. El cero es la línea gris del centro.
 */
function renderImpactChart(list) {
  const box = $('#impact-chart');
  if (!list.length) { box.replaceChildren(el('p', { class: 'muted small' }, 'Hace falta que cada jugador tenga partidos con y sin él.')); return; }
  const sorted = [...list].sort((a, b) => b.delta - a.delta);
  const max = Math.max(...sorted.map((x) => Math.abs(x.delta))) || 1;
  box.replaceChildren(el('div', { class: 'dbars', role: 'list' }, sorted.map(({ p, a, b, delta }) => el('div', {
    class: `dbar${fewMatches(Math.min(a.n, b.n)) ? ' low-sample' : ''}`, role: 'listitem',
    title: `${p.person_name}: el equipo gana el ${fmtNum(a.winPct, 0)} % con él (${a.n} PJ) y el ${fmtNum(b.winPct, 0)} % sin él (${b.n} PJ)`,
  },
    el('span', { class: 'dbar-name' }, p.person_name),
    el('span', { class: 'dbar-track' },
      el('span', { class: 'dbar-neg' }, delta < 0 ? el('i', { style: `width:${(100 * -delta) / max}%` }) : null),
      el('span', { class: 'dbar-pos' }, delta > 0 ? el('i', { style: `width:${(100 * delta) / max}%` }) : null)),
    el('span', { class: 'dbar-val' }, `${delta > 0 ? '+' : ''}${fmtNum(delta, 0)} pts`)))),
  el('p', { class: 'dbar-legend muted small' }, el('span', { class: 'sw pos' }), ' Al equipo le va mejor con él  ', el('span', { class: 'sw neg' }), ' Le va mejor sin él'));
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

/**
 * Cobertura de un dato que no se capturó desde el principio: en cuántas filas existe.
 * show = false si falta en más de la mitad (se guarda, pero no se muestra: la
 * comparación sería engañosa). partial = existe, pero no en todas.
 */
const COVERAGE_MIN = 0.5;
function coverage(rows, get) {
  const total = rows.length;
  const have = rows.filter((r) => get(r) != null).length;
  return { total, have, partial: have > 0 && have < total, show: total === 0 || have / total >= COVERAGE_MIN };
}
/** Etiqueta "Parcial": el dato falta en algunos partidos porque empezamos a guardarlo después. */
const partialBadge = (cov) => (cov?.partial
  ? el('span', { class: 'badge partial', title: `Dato parcial: existe en ${cov.have} de ${cov.total} partidos, porque se empezó a guardar después. Los promedios usan solo los partidos con dato.` }, 'Parcial')
  : null);

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
  // Datos que empezamos a guardar más tarde: etiqueta "Parcial" o, si faltan en más
  // de la mitad de los partidos, la columna no se muestra (sigue en la base).
  const covSkill = coverage(shown, (m) => m.opponent_skill_rating);
  const covDiv = coverage(shown, (m) => flags.get(m.match_id)?.club_division);
  // División del rival: se guarda desde el 2026-11-16 (migración 019), solo en partidos nuevos.
  const covOppDiv = coverage(shown, (m) => m.opponent_division);
  const cols = ['Fecha', 'Tipo', 'Rival', covSkill.show && ['Nivel rival', covSkill], covOppDiv.show && ['Div. rival', covOppDiv], covDiv.show && ['Div.', covDiv], 'Jug.', 'Marcador', 'Res.'].filter(Boolean);
  const body = el('tbody');
  if (!shown.length) body.append(emptyRow(cols.length, 'Sin partidos para estos filtros.'));
  for (const m of shown) {
    const f = flags.get(m.match_id);
    const row = el('tr', { class: 'clickable', 'aria-expanded': 'false' },
      el('td', { class: 'left' }, fmtDate(m.played_at)),
      el('td', { class: 'left' }, el('span', { class: 'badge' }, TYPE_LABEL[m.match_type] ?? m.match_type)),
      el('td', { class: 'left' }, m.opponent_name ?? '—', f?.incomplete ? [' ', el('span', { class: 'badge warn', title: 'El partido se cortó antes del 90 % del tiempo o un equipo abandonó. El marcador es el que da EA.' }, 'Abandonado')] : null, highlights(m, f?.incomplete)),
      covSkill.show ? el('td', {}, fmtNum(m.opponent_skill_rating)) : null,
      covOppDiv.show ? el('td', { title: m.opponent_division != null ? `División del rival al jugar. ${divisionTitle(m.opponent_division)}` : 'Sin dato: se empezó a guardar después' }, m.opponent_division != null ? el('span', { class: 'div-value' }, divisionIcon(m.opponent_division), gameDivision(m.opponent_division)) : '—') : null,
      covDiv.show ? el('td', { title: f?.club_division != null ? `División del club ese día. ${divisionTitle(f.club_division)}` : 'Sin dato de división' }, f?.club_division != null ? el('span', { class: 'div-value' }, divisionIcon(f.club_division), gameDivision(f.club_division)) : '—') : null,
      el('td', { title: 'Jugadores del club en cancha' }, fmtNum(f?.team_size)),
      // Marcador tal cual EA (en un abandono es el que asigna EA; la etiqueta "Abandonado" lo avisa).
      el('td', {}, el('strong', {}, `${m.goals_for} – ${m.goals_against}`)),
      el('td', {}, resultBadge(m.outcome, m.winner_by_dnf)));
    const toggle = () => toggleMatchPlayers(row, m.match_id, cols.length);
    Object.entries(onActivate(toggle)).forEach(([k, v]) => (k.startsWith('on') ? row.addEventListener(k.slice(2), v) : row.setAttribute(k, v)));
    body.append(row);
  }
  $('#matches-table').replaceChildren(el('thead', {}, el('tr', {}, cols.map((h, i) => (Array.isArray(h)
    ? el('th', { scope: 'col' }, h[0], partialBadge(h[1]))
    : el('th', { scope: 'col', class: i < 3 ? 'left' : null }, h))))), body);
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
  const games = [...matchRoster(state.timeline).values()].sort((a, b) => a.at.localeCompare(b.at));
  renderResultsByWeek($('#club-results'), games);
  renderGoalsPerMatch($('#club-goals'), games);
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

/** Lunes (hora local) de la semana de una fecha, como 'YYYY-MM-DD'. */
function weekKey(iso) {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Resultados por semana: columnas apiladas de victorias, empates y derrotas. Los
 * colores de resultado son los mismos de las fichas V/E/D y la leyenda lleva la letra,
 * para no depender solo del color.
 */
function renderResultsByWeek(box, games) {
  if (!games.length) { box.replaceChildren(el('p', { class: 'muted' }, 'Sin partidos en este rango.')); return; }
  const weeks = new Map();
  for (const g of games) {
    const k = weekKey(g.at);
    if (!weeks.has(k)) weeks.set(k, { win: 0, draw: 0, loss: 0 });
    if (weeks.get(k)[g.outcome] != null) weeks.get(k)[g.outcome]++;
  }
  const list = [...weeks].sort((a, b) => a[0].localeCompare(b[0])).slice(-16);
  const max = Math.max(...list.map(([, w]) => w.win + w.draw + w.loss));
  box.replaceChildren(
    el('div', { class: 'vcols', role: 'img', 'aria-label': list.map(([k, w]) => `Semana del ${fmtDate(`${k}T12:00:00`, false)}: ${w.win} V, ${w.draw} E, ${w.loss} D`).join('; ') },
      list.map(([k, w]) => el('div', { class: 'vcol', title: `Semana del ${fmtDate(`${k}T12:00:00`, false)}: ${w.win} victorias, ${w.draw} empates, ${w.loss} derrotas` },
        el('span', { class: 'vcol-total' }, String(w.win + w.draw + w.loss)),
        el('div', { class: 'vcol-stack', style: `height:${(100 * (w.win + w.draw + w.loss)) / max}%` },
          ['loss', 'draw', 'win'].map((o) => (w[o] ? el('i', { class: `seg-${o}`, style: `flex:${w[o]}` }) : null))),
        el('span', { class: 'vcol-label' }, new Date(`${k}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }))))),
    el('p', { class: 'chart-legend muted small' }, ['win', 'draw', 'loss'].map((o) => el('span', {}, el('span', { class: `sw seg-${o}` }), ` ${OUTCOME[o].letter} ${OUTCOME[o].label}  `))));
}

/**
 * Goles a favor y en contra de cada partido (los últimos 20), en columnas pareadas.
 * Mismo eje para las dos series (no hay doble eje). Los abandonados van atenuados
 * y con su etiqueta en la ayuda: su marcador lo asigna EA.
 */
function renderGoalsPerMatch(box, games) {
  if (!games.length) { box.replaceChildren(el('p', { class: 'muted' }, 'Sin partidos en este rango.')); return; }
  const list = games.slice(-20);
  const max = Math.max(1, ...list.map((g) => Math.max(g.gf, g.ga)));
  box.replaceChildren(
    el('div', { class: 'vpairs', role: 'img', 'aria-label': `Goles a favor y en contra de los últimos ${list.length} partidos` },
      list.map((g) => el('div', { class: `vpair${g.incomplete ? ' abandoned' : ''}`, title: `${fmtDate(g.at)} · ${OUTCOME[g.outcome]?.label ?? ''} ${g.gf}–${g.ga}${g.incomplete ? ' · Abandonado: marcador asignado por EA' : ''}` },
        el('div', { class: 'vpair-bars' },
          el('i', { class: 'gf', style: `height:${(100 * g.gf) / max}%` }),
          el('i', { class: 'ga', style: `height:${(100 * g.ga) / max}%` })),
        el('span', { class: `result ${g.outcome} mini` }, OUTCOME[g.outcome]?.letter ?? '?')))),
    el('p', { class: 'chart-legend muted small' }, el('span', { class: 'sw gf' }), ' A favor  ', el('span', { class: 'sw ga' }), ' En contra · más viejo a la izquierda'));
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
        el('td', { class: 'left', title: k === 'sin' ? null : divisionTitle(k) }, k === 'sin' ? el('span', { class: 'muted', title: 'Partidos anteriores al registro de la división' }, 'Sin dato') : el('span', { class: 'div-value' }, divisionIcon(k), gameDivision(k))),
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
  const advanced = summary ? el('div', { class: 'tiles' },
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
    state.ranking = addExtraCounters(ranking, timeline).map((r) => deriveRow({ ...r, pro_overall: ea.get(r.person_id)?.pro_overall ?? null, pro_name: ea.get(r.person_id)?.pro_name ?? null }));
    state.positions = positionsByPerson(timeline);
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
    if (state.view === 'pairs') renderPairs();
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
  $('#dates-value').textContent = state.seasonNo != null ? `Temporada ${state.seasonNo}`
    : from || to ? `${from ? short(from) : '…'} – ${to ? short(to) : 'hoy'}` : 'Todas';
  const opts = [];
  if (state.minMatches > 1) opts.push(`mín. ${state.minMatches} PJ`);
  // Por defecto se muestra todo tal cual EA; solo se avisa si se excluyen abandonos.
  if ($('#exclude-incomplete').checked) opts.push('sin abandonos');
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
    state.seasonNo = null;
    loadSeasons().finally(() => { updateFiltersSummary(); refresh(); });
  });
}

async function init() {
  watchPlayerColumns();
  await initClubs();
  document.querySelector('.filters').addEventListener('change', updateFiltersSummary);
  document.querySelector('.filters').addEventListener('input', updateFiltersSummary);
  await loadSeasons();
  $('#season-select').addEventListener('change', (e) => {
    state.seasonNo = e.target.value === '' ? null : Number(e.target.value);
    for (const id of ['#from', '#to']) $(id).disabled = state.seasonNo != null;
    updateFiltersSummary(); refresh();
  });
  $('#clear-dates').addEventListener('click', () => {
    $('#from').value = ''; $('#to').value = '';
    state.seasonNo = null; $('#season-select').value = '';
    for (const id of ['#from', '#to']) $(id).disabled = false;
    $('#dates-pop').open = false;
    updateFiltersSummary(); refresh();
  });
  // Un menú abierto se cierra al abrir el otro o al tocar fuera.
  const pops = document.querySelectorAll('details.pop');
  for (const p of pops) p.addEventListener('toggle', () => { if (p.open) for (const o of pops) if (o !== p) o.open = false; });
  // (Un clic en algo que se acaba de redibujar, como "+ Añadir dato", no cierra el menú.)
  document.addEventListener('click', (e) => { if (!e.target.isConnected) return; for (const p of pops) if (p.open && !p.contains(e.target)) p.open = false; });
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
  if (saved.colKinds && typeof saved.colKinds === 'object') state.colKinds = { ...state.colKinds, ...saved.colKinds };
  if (Array.isArray(saved.addedCols)) state.addedCols = saved.addedCols.filter((k) => RANKING_COLUMNS.some((c) => c.key === k));
  $('#show-exp').checked = state.showExp;
  updateFiltersSummary();
  const syncKinds = bindDataKinds();
  $('#show-exp').addEventListener('change', (e) => {
    state.showExp = e.target.checked; prefs.save({ showExp: state.showExp });
    if (!visibleColumns().some((c) => c.key === state.sort.key)) resetSortIf('exp');
    syncKinds(); refresh();
  });
  bindSegmented('#role-group-buttons', 'group', (v) => { state.roleGroup = v; refresh(); });
  bindSegmented('#role-mode-buttons', 'mode', (v) => { state.roleMode = v; refresh(); });
  $('#h2h-a').addEventListener('change', (e) => { state.h2h.a = Number(e.target.value); renderH2h(); });
  $('#h2h-b').addEventListener('change', (e) => { state.h2h.b = pickerValue(e.target.value); renderH2h(); });
  // El promedio del equipo solo va en el lado B: al intercambiar, se queda ahí.
  $('#h2h-swap').addEventListener('click', () => { if (state.h2h.b !== TEAM) state.h2h = { a: state.h2h.b, b: state.h2h.a }; renderH2h(); });
  // Enlace compartido de Cara a cara: …/?a=ID&b=ID (b=team: promedio del equipo)
  const qs = new URLSearchParams(location.search);
  const startH2h = qs.has('a') && qs.has('b');
  if (startH2h) state.h2h = { a: Number(qs.get('a')), b: pickerValue(qs.get('b')) };
  $('#pairs-person').addEventListener('change', (e) => { state.pairsPerson = Number(e.target.value); renderPairs(); });
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
