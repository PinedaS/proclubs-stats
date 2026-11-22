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
  pairsPerson: null, // Compañeros: jugador elegido
  scatter: { x: 'avg_rating', y: 'ga_per90' }, // ejes de "Dos datos a la vez"
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
  roleMode: 'relative', // 'relative' (índices vs. la posición) | 'real' (valores por posición)
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
 * Ficha grande de división: ícono + texto. Cuando el ícono carga, el texto del
 * número se oculta a la vista (el ícono ya lo muestra) pero sigue para lectores
 * de pantalla. La División Élite no tiene número en el ícono: su nombre se ve siempre.
 */
function divisionBadge(apiDiv) {
  const text = gameDivision(apiDiv);
  if (text == null) return '—';
  const box = el('span', { class: `div-value${Number(apiDiv) === 1 ? ' elite' : ''}` });
  const icon = divisionIcon(apiDiv, 'lg');
  if (icon) icon.addEventListener('load', () => box.classList.add('icon-ok'));
  box.append(...[icon, el('span', { class: 'div-text' }, Number(apiDiv) === 1 ? 'Élite' : `${text} división`)].filter(Boolean));
  return box;
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

// El mensaje va en un bloque fijo al borde izquierdo: en tablas más anchas que la
// pantalla (celular) se lee completo sin desplazar.
const emptyRow = (cols, text = 'Sin datos para estos filtros.') =>
  el('tr', {}, el('td', { class: 'empty', colspan: cols }, el('span', { class: 'empty-msg' }, text)));

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
    $('#club-season').title = 'Juego, temporada y partidos capturados con los filtros actuales. Las temporadas se numeran como el juego, según su calendario (EA no da el número en la API).';
  }
  const form = el('div', { class: 'form-chips', role: 'img', 'aria-label': `Últimos resultados: ${recent.slice(0, 5).map((m) => OUTCOME[m.outcome]?.label ?? '—').join(', ')}` },
    recent.length ? [...recent.slice(0, 5)].reverse().map((m) => el('span', {
      class: `result ${m.outcome}`, title: `${OUTCOME[m.outcome]?.label ?? ''} ${m.goals_for}–${m.goals_against}${m.opponent_name ? ` vs. ${m.opponent_name}` : ''} · ${fmtDate(m.played_at, false)}`,
    }, OUTCOME[m.outcome]?.letter ?? '?')) : el('span', { class: 'muted' }, '—'));
  $('#club-kpis').replaceChildren(
    kpi('Nivel del club', fmtNum(last?.skill_rating),
      delta == null || snaps.length < 2 ? 'skillRating de EA' : `${fmtSigned(delta)} desde ${fmtDate(`${first.snapshot_date}T12:00:00Z`, false)}`,
      delta > 0 ? 'up' : delta < 0 ? 'down' : null),
    // Sin repetir: el ícono ya trae el número (el texto queda para lectores de pantalla
    // y por si el ícono no carga). "Mejor" solo si es distinta de la actual.
    Object.assign(kpi('División', divisionBadge(last?.current_division),
      last?.best_division != null && last.best_division !== last.current_division ? `Mejor: ${gameDivision(last.best_division)}`
        : last?.current_division != null ? 'Su mejor división hasta ahora' : null), { title: divisionTitle(last?.current_division) ?? '' }),
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
  { key: 'pro_overall', label: 'Media (EA)', kind: 'base', title: 'Media del Pro según EA. Con datos por partido, una por arquetipo (la última con que jugó cada uno); si no, la única que da EA.', render: (r) => archLevelsCell(r) },
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

/**
 * Media del Pro por arquetipo (022): la última media observada después de un
 * partido con cada arquetipo. Map person_id -> [{ arch, ovr, at }] (de más reciente a más vieja).
 */
function archLevelsByPerson(rows) {
  const by = new Map();
  for (const t of rows) {
    if (t.pro_overall == null || t.archetype_id == null) continue;
    if (!by.has(t.person_id)) by.set(t.person_id, new Map());
    const m = by.get(t.person_id), prev = m.get(t.archetype_id);
    if (!prev || t.played_at > prev.at) m.set(t.archetype_id, { arch: t.archetype_id, ovr: Number(t.pro_overall), at: t.played_at });
  }
  return new Map([...by].map(([id, m]) => [id, [...m.values()].sort((a, b) => b.at.localeCompare(a.at))]));
}
/** Celda "Media (EA)": por arquetipo si hay datos por partido; si no, la única media de EA. */
function archLevelsCell(r) {
  const list = state.archLevels?.get(r.person_id);
  if (!list?.length) return fmtNum(r.pro_overall);
  return el('span', { class: 'arch-levels', title: 'Media del Pro con cada arquetipo, observada después de su último partido con él' },
    list.map((a, i) => el('span', { class: i ? 'muted' : null }, `${archetypeName(a.arch)} ${a.ovr}`)));
}

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

  // Gráficas del ranking (se dibujan al ancho real; ocultas no tienen ancho).
  if (state.view === 'ranking') { renderScatter(rows); renderHeatmap(rows); renderRace(rows); }

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
// Por posición: rendimiento relativo al promedio del club en cada posición/arquetipo
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

/** Índice relativo: valor + flecha y color. 100 = promedio de la posición. */
function idxCell(v, extraClass = '') {
  if (v == null) return el('td', { class: `muted ${extraClass}`.trim() }, '—');
  const n = Number(v);
  const dir = n >= 105 ? 'up' : n <= 95 ? 'down' : '';
  return el('td', { class: extraClass || null, title: `${fmtNum(n, 1)} (100 = promedio de la posición)` },
    el('span', { class: `idx ${dir}` }, fmtNum(n, 0), dir ? el('span', { class: 'arrow', 'aria-hidden': 'true' }, dir === 'up' ? '▲' : '▼') : null));
}

const ROLE_COLUMNS = [
  { key: 'rating_idx', label: 'Calificación', title: 'Calificación media vs. la media de la posición' },
  { key: 'ga90_idx', label: 'G+A / 90', title: 'Goles + asistencias por 90 min vs. la posición' },
  { key: 'pass_idx', label: 'Pases %', title: 'Precisión de pase vs. la posición' },
  { key: 'tackles90_idx', label: 'Entradas / 90', title: 'Entradas ganadas por 90 min vs. la posición (clave para posiciones defensivas)' },
  { key: 'save_idx', label: '% Atajadas', title: 'Solo porteros: % de atajadas vs. otros porteros' },
  { key: 'interceptions90_idx_exp', label: 'Intercep. / 90*', title: 'Experimental: intercepciones por 90 min vs. la posición', exp: true },
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
    el('th', { scope: 'col', class: 'left' }, group === 'archetype' ? 'Arquetipos jugados' : 'Posiciones jugadas'),
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
          el('thead', {}, el('tr', {}, [group === 'archetype' ? 'Arquetipo' : 'Posición', 'PJ', 'Calif. (él / promedio)', 'G+A/90 (él / promedio)', 'Pases % (él / promedio)', 'Entradas/90 (él / promedio)', 'Partidos de referencia']
            .map((h, k) => el('th', { scope: 'col', class: k === 0 ? 'left' : null }, h)))),
          el('tbody', {}, parts.map((d) => el('tr', {},
            el('td', { class: 'left' }, group === 'position' ? posBadge(d.group_key) : roleLabel(group, d.group_key)),
            el('td', {}, fmtNum(d.matches)),
            el('td', {}, `${fmtNum(d.rating, 2)} / ${fmtNum(d.group_rating, 2)}`),
            el('td', {}, `${fmtNum(d.ga90, 2)} / ${fmtNum(d.group_ga90, 2)}`),
            el('td', {}, `${fmtNum(d.pass_pct, 1)} / ${fmtNum(d.group_pass_pct, 1)}`),
            el('td', {}, `${fmtNum(d.tackles90, 2)} / ${fmtNum(d.group_tackles90, 2)}`),
            el('td', { title: 'Registros del club en esa posición: con pocos, el promedio es menos confiable' }, fmtNum(d.group_rows)))))))));
    };
    Object.entries(onActivate(toggle)).forEach(([k, v]) => (k.startsWith('on') ? row.addEventListener(k.slice(2), v) : row.setAttribute(k, v)));
    body.append(row);
  });
  $('#roles-table').replaceChildren(el('thead', {}, head), body);
  renderRoleDots(list);
}

// ---------------------------------------------------------------------------
// Cara a cara: dos jugadores, dato por dato, con quién es mejor en cada uno.
// Solo se juzgan tasas (por partido, por 90 min, %), nunca totales: así no gana
// quien jugó más. Los índices relativos a la posición van primero (justos si rotan).
// ---------------------------------------------------------------------------

const per90 = (r, key) => (r[key] == null || !Number(r.minutes_played) ? null : (Number(r[key]) * 90) / Number(r.minutes_played));
const perMatch = (r, key) => (r[key] == null || !r.matches ? null : Number(r[key]) / r.matches);

/**
 * better: 'high' (más es mejor), 'low' (menos es mejor) o null (solo contexto).
 * Orden por importancia (decisión del usuario, 2026-11-15): rendimiento primero,
 * luego relativo a su posición, experimentales y contexto.
 */
const H2H_RELATIVE = {
  title: 'Relativo a su posición (100 = promedio de esa posición)',
  source: 'relative',
  rows: [
    { label: 'Calificación vs. su posición', key: 'rating_idx', better: 'high' },
    { label: 'G+A/90 vs. su posición', key: 'ga90_idx', better: 'high' },
    { label: 'Pases % vs. su posición', key: 'pass_idx', better: 'high' },
    { label: 'Entradas/90 vs. su posición', key: 'tackles90_idx', better: 'high' },
    { label: '% Atajadas vs. porteros', key: 'save_idx', better: 'high' },
    { label: 'Intercepciones/90 vs. su posición*', key: 'interceptions90_idx_exp', better: 'high', exp: true },
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

/** Índices relativos a la posición del "equipo": promedio ponderado por partidos (≈100). */
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
    differentRoles ? el('p', { class: 'h2h-note' }, `Juegan en posiciones distintas (${POS_LABEL[A.main_position] ?? '—'} y ${POS_LABEL[B.main_position] ?? '—'}): para compararlos de forma justa, fíjate también en "Relativo a su posición".`) : null,
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
  opp_humans: 'Cuántos humanos tenía el rival (el resto de su equipo es IA). El MVP se elige entre los humanos de los dos equipos, así que con más rivales humanos es más difícil ganarlo.',
  division: 'División del club el día del partido, según la foto diaria del club (aproximada; los partidos anteriores a la primera foto salen como "Sin dato"). Mira los PJ de cada celda: pocos partidos en una división no son comparables con muchos en otra.',
};
// Datos de Comparar. Los 4 "General" los calcula la base (person_split_stats); el resto
// (v2.23, elegidos por el usuario) se calculan en el navegador con la línea de tiempo y
// los mismos grupos (splitBucket). p90: suma × 5400 / segundos; ratio: num / den en %.
const n0 = (k) => (t) => Number(t[k] ?? 0);
const METRIC = {
  avg_rating: { label: 'Calificación', digits: 2, theme: 'General' },
  ga_per90: { label: 'G+A / 90', digits: 2, theme: 'General' },
  win_pct: { label: '% Victorias', digits: 1, theme: 'General' },
  mom_pct: { label: '% MVP', digits: 1, theme: 'General' },
  goals_p90: { label: 'Goles / 90', digits: 2, theme: 'Ataque', p90: n0('goals') },
  assists_p90: { label: 'Asistencias / 90', digits: 2, theme: 'Ataque', p90: n0('assists') },
  shots_p90: { label: 'Tiros / 90', digits: 2, theme: 'Ataque', p90: n0('shots') },
  conversion_pct: { label: 'Conversión %', digits: 1, theme: 'Ataque', num: n0('goals'), den: n0('shots') },
  dribbles_p90: { label: 'Regates / 90*', digits: 2, theme: 'Ataque', p90: n0('dribbles_exp'), exp: 'dribbles_exp' },
  pass_pct: { label: 'Precisión de pase %', digits: 1, theme: 'Pase', num: n0('passes_made'), den: n0('pass_attempts') },
  passes_p90: { label: 'Pases / 90', digits: 1, theme: 'Pase', p90: n0('passes_made') },
  through_p90: { label: 'Filtrados / 90*', digits: 2, theme: 'Pase', p90: n0('through_passes_exp'), exp: 'through_passes_exp' },
  lost_p90: { label: 'Pérdidas / 90* (menos es mejor)', digits: 2, theme: 'Pase', p90: n0('possession_lost_exp'), exp: 'possession_lost_exp', low: true },
  tackles_p90: { label: 'Entradas / 90', digits: 2, theme: 'Defensa', p90: n0('tackles_made') },
  tackle_pct: { label: '% de entradas', digits: 1, theme: 'Defensa', num: n0('tackles_made'), den: n0('tackle_attempts') },
  interceptions_p90: { label: 'Intercepciones / 90*', digits: 2, theme: 'Defensa', p90: n0('interceptions_exp'), exp: 'interceptions_exp' },
  recoveries_p90: { label: 'Recuperaciones / 90*', digits: 2, theme: 'Defensa', p90: n0('possession_won_exp'), exp: 'possession_won_exp' },
};

/** Grupo de un partido, igual que person_split_stats en la base (misma etiqueta). */
function splitBucket(t, split, median) {
  if (split === 'rival') return t.opponent_skill_rating == null ? 'Sin dato' : Number(t.opponent_skill_rating) >= median ? 'Rival fuerte' : 'Rival débil';
  if (split === 'type') return t.match_type === 'leagueMatch' ? 'Liga' : t.match_type === 'playoffMatch' ? 'Play-off' : 'Amistoso';
  if (split === 'team_size') return t.team_size == null ? null : `${t.team_size} jugadores`;
  if (split === 'division') return t.club_division == null ? 'Sin dato' : `División ${t.club_division}`;
  if (split === 'opp_humans') return t.opponent_humans == null ? 'Sin dato' : `${t.opponent_humans} ${Number(t.opponent_humans) === 1 ? 'rival humano' : 'rivales humanos'}`;
  return null;
}

/**
 * v2.28: grupos que la base no calcula (humanos del rival). Arma las mismas filas que
 * person_split_stats (PJ, V-E-D, calificación, G+A/90, % victorias, % MVP) desde la
 * línea de tiempo, con los mismos criterios que el SQL de la 011.
 */
function clientSplitRows(split) {
  const acc = new Map();
  for (const t of state.timeline) {
    const b = splitBucket(t, split, 0);
    if (b == null) continue;
    const k = `${t.person_id}|${b}`;
    const a = acc.get(k) ?? { person_id: t.person_id, person_name: t.person_name, bucket: b, bucket_order: b === 'Sin dato' ? 99 : Number(t.opponent_humans), ids: new Map(), ratings: [], ga: 0, sec: 0, mom: 0 };
    a.ids.set(t.match_id, t.outcome);
    if (t.rating != null) a.ratings.push(Number(t.rating));
    a.ga += Number(t.goals ?? 0) + Number(t.assists ?? 0);
    a.sec += Number(t.seconds_played ?? 0);
    if (t.is_mom) a.mom++;
    acc.set(k, a);
  }
  return [...acc.values()].map((a) => {
    const n = a.ids.size, out = [...a.ids.values()];
    const c = (o) => out.filter((x) => x === o).length;
    return {
      person_id: a.person_id, person_name: a.person_name, bucket: a.bucket, bucket_order: a.bucket_order,
      matches: n, wins: c('win'), draws: c('draw'), losses: c('loss'),
      win_pct: n ? Math.round((1000 * c('win')) / n) / 10 : null,
      ga_per90: a.sec ? Math.round((a.ga * 540000) / a.sec) / 100 : null,
      avg_rating: a.ratings.length ? Math.round((100 * a.ratings.reduce((x, y) => x + y, 0)) / a.ratings.length) / 100 : null,
      mom_pct: n ? Math.round((1000 * a.mom) / n) / 10 : null,
    };
  });
}

/** Calcula en el navegador un dato de Comparar por persona y grupo: Map("persona|grupo" → valor). */
function splitExtra(metric, split) {
  const m = METRIC[metric];
  const opps = [...new Map(state.timeline.filter((t) => t.opponent_skill_rating != null).map((t) => [t.match_id, Number(t.opponent_skill_rating)])).values()].sort((a, b) => a - b);
  const median = opps.length ? (opps.length % 2 ? opps[(opps.length - 1) / 2] : (opps[opps.length / 2 - 1] + opps[opps.length / 2]) / 2) : 0;
  const acc = new Map();
  for (const t of state.timeline) {
    if (m.exp && t[m.exp] == null) continue; // dato experimental que falta en ese partido
    const b = splitBucket(t, split, median);
    if (b == null) continue;
    const k = `${t.person_id}|${b}`;
    const a = acc.get(k) ?? { num: 0, den: 0 };
    if (m.p90) { a.num += m.p90(t); a.den += Number(t.seconds_played ?? 0); } else { a.num += m.num(t); a.den += m.den(t); }
    acc.set(k, a);
  }
  return new Map([...acc].map(([k, a]) => [k, a.den ? (m.p90 ? (a.num * 5400) / a.den : (100 * a.num) / a.den) : null]));
}

async function renderCompare(filters, requestId) {
  // "Humanos rivales" se calcula en el navegador (la base no tiene ese grupo).
  const rows = !filters.types.length ? [] : state.split === 'opp_humans' ? clientSplitRows('opp_humans') : await api.getSplitStats(state.split, filters);
  if (requestId !== state.requestId) return;
  $('#split-help').textContent = SPLIT_HELP[state.split];
  const metric = METRIC[state.splitMetric] ? state.splitMetric : 'avg_rating';
  // Datos calculados en el navegador: se agregan a cada fila de la base como una columna más.
  if (!(metric in (rows[0] ?? {})) && METRIC[metric].theme !== 'General') {
    const extra = splitExtra(metric, state.split);
    for (const r of rows) r[metric] = extra.get(`${r.person_id}|${r.bucket}`) ?? null;
  }
  const low = Boolean(METRIC[metric].low);
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
    const best = values.length > 1 ? (low ? Math.min(...values) : Math.max(...values)) : null;
    return el('tr', { class: 'clickable', ...onActivate(() => openPerson(id)) },
      el('td', {}, playerCell(p.name)),
      buckets.map((b) => {
        const c = p.cells[b];
        if (!c) return el('td', { class: 'muted' }, '—');
        const v = c[metric];
        if (v == null) return el('td', { class: 'muted', title: 'Sin este dato en esos partidos' }, el('span', { class: 'muted small' }, `${c.matches} PJ · —`));
        return el('td', {}, el('span', { class: `bar-cell ${best != null && Number(v) === best ? 'best' : ''}` },
          el('span', { class: 'muted small' }, `${c.matches} PJ`),
          el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(0, Math.min(100, (Number(v ?? 0) / max) * 100))}%` })),
          el('span', { class: 'val' }, metric.endsWith('pct') ? fmtPct(v) : fmtNum(v, METRIC[metric].digits))));
      }));
  }) : [emptyRow(buckets.length + 1)]);
  table.replaceChildren(head, body);
  renderSlope(list, buckets, metric, bucketLabel);
}

// ---------------------------------------------------------------------------
// Compañeros (antes "Duplas")
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
 * Compañeros (antes "Duplas"; une las antiguas tablas "Duplas" y "Con y sin", pedido del usuario):
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
  renderPairMatrix(all, people.filter((p) => p.matches >= state.minMatches));

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
  renderRivalScatter(shown, flags);
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
      // Fecha en dos líneas (día y hora); en el celular también lleva el tipo, porque esa columna se oculta.
      el('td', { class: 'left date-cell' },
        el('span', {}, new Date(m.played_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })),
        el('span', { class: 'muted small' }, new Date(m.played_at).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })),
        el('span', { class: 'badge m-only' }, TYPE_LABEL[m.match_type] ?? m.match_type)),
      el('td', { class: 'left m-hide' }, el('span', { class: 'badge' }, TYPE_LABEL[m.match_type] ?? m.match_type)),
      el('td', { class: 'left' }, m.opponent_name ?? '—', f?.incomplete ? [' ', el('span', { class: 'badge warn', title: 'El partido se cortó antes del 90 % del tiempo o un equipo abandonó. El marcador es el que da EA.' }, 'Abandonado')] : null, highlights(m, f?.incomplete)),
      covSkill.show ? el('td', { class: 'm-hide' }, fmtNum(m.opponent_skill_rating)) : null,
      covOppDiv.show ? el('td', { class: 'm-hide', title: m.opponent_division != null ? `División del rival al jugar. ${divisionTitle(m.opponent_division)}` : 'Sin dato: se empezó a guardar después' }, m.opponent_division != null ? el('span', { class: 'div-value' }, divisionIcon(m.opponent_division), gameDivision(m.opponent_division)) : '—') : null,
      covDiv.show ? el('td', { class: 'm-hide', title: f?.club_division != null ? `División del club ese día. ${divisionTitle(f.club_division)}` : 'Sin dato de división' }, f?.club_division != null ? el('span', { class: 'div-value' }, divisionIcon(f.club_division), gameDivision(f.club_division)) : '—') : null,
      el('td', { class: 'm-hide', title: 'Jugadores del club en cancha' }, fmtNum(f?.team_size)),
      // Marcador tal cual EA (en un abandono es el que asigna EA; la etiqueta "Abandonado" lo avisa).
      el('td', { class: 'score-cell' }, el('strong', {}, `${m.goals_for} – ${m.goals_against}`), el('span', { class: 'm-only' }, resultBadge(m.outcome, m.winner_by_dnf))),
      el('td', { class: 'm-hide' }, resultBadge(m.outcome, m.winner_by_dnf)));
    const toggle = () => toggleMatchPlayers(row, m.match_id, cols.length);
    Object.entries(onActivate(toggle)).forEach(([k, v]) => (k.startsWith('on') ? row.addEventListener(k.slice(2), v) : row.setAttribute(k, v)));
    body.append(row);
  }
  // En el celular se ocultan las columnas secundarias (m-hide): quedan fecha, rival, marcador y resultado.
  const mobileHidden = new Set(['Tipo', 'Nivel rival', 'Div. rival', 'Div.', 'Jug.', 'Res.']);
  $('#matches-table').replaceChildren(el('thead', {}, el('tr', {}, cols.map((h, i) => (Array.isArray(h)
    ? el('th', { scope: 'col', class: mobileHidden.has(h[0]) ? 'm-hide' : null }, h[0], partialBadge(h[1]))
    : el('th', { scope: 'col', class: [i < 3 ? 'left' : '', mobileHidden.has(h) ? 'm-hide' : ''].join(' ').trim() || null }, h))))), body);
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
  renderDivisionPath($('#club-division'), games, state.timeline);
  renderTeamByOppHumans($('#club-opp-humans'), games, state.timeline);
  renderTeamImprove($('#club-improve'), games, state.timeline);
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

/**
 * v2.29 (pedido del usuario): "Para mejorar como equipo".
 * 1) Victorias frente a derrotas: datos del equipo por jugador humano y por 90 min
 *    (así no pesa cuántos humanos éramos), sin partidos abandonados.
 * 2) Situaciones: puntos por partido según humanos propios y rivales, nivel del rival,
 *    división y tipo de partido; las 3 peores y las 2 mejores con 4+ partidos.
 */
function renderTeamImprove(box, games, timeline) {
  const note = (t) => el('p', { class: 'muted small' }, t);
  const rows = timeline.filter((t) => !t.incomplete && Number(t.seconds_played) > 0);
  const n = (k) => (t) => Number(t[k] ?? 0);
  const METRICS = [
    { label: 'Tiros', p90: n('shots') },
    { label: 'Pases completados', p90: n('passes_made') },
    { label: 'Precisión de pase', pct: [n('passes_made'), n('pass_attempts')] },
    { label: 'Entradas ganadas', p90: n('tackles_made') },
    { label: '% de entradas', pct: [n('tackles_made'), n('tackle_attempts')] },
    { label: 'Intercepciones*', p90: n('interceptions_exp'), exp: 'interceptions_exp' },
    { label: 'Recuperaciones*', p90: n('possession_won_exp'), exp: 'possession_won_exp' },
    { label: 'Pérdidas de balón*', p90: n('possession_lost_exp'), exp: 'possession_lost_exp', low: true },
    { label: 'Regates*', p90: n('dribbles_exp'), exp: 'dribbles_exp' },
  ];
  const val = (list, m) => {
    const ok = m.exp ? list.filter((t) => t[m.exp] != null) : list;
    if (m.pct) { const d = ok.reduce((a, t) => a + m.pct[1](t), 0); return d ? (100 * ok.reduce((a, t) => a + m.pct[0](t), 0)) / d : null; }
    const s = ok.reduce((a, t) => a + Number(t.seconds_played), 0);
    return s ? (5400 * ok.reduce((a, t) => a + m.p90(t), 0)) / s : null;
  };
  const wins = rows.filter((t) => t.outcome === 'win'), losses = rows.filter((t) => t.outcome === 'loss');
  const nW = new Set(wins.map((t) => t.match_id)).size, nL = new Set(losses.map((t) => t.match_id)).size;
  let wl;
  if (nW < 3 || nL < 3) wl = note('Hacen falta al menos 3 victorias y 3 derrotas (sin abandonos) para comparar.');
  else {
    const diffs = METRICS.map((m) => ({ m, w: val(wins, m), l: val(losses, m) })).filter((x) => x.w != null && x.l != null && x.l !== 0)
      .map((x) => ({ ...x, d: x.w / x.l - 1 })).filter((x) => Math.abs(x.d) >= 0.1).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 5);
    const fmtV = (x, v) => (x.m.pct ? `${fmtNum(v, 1)} %` : fmtNum(v, 2));
    // Derecha (azul): más en las victorias; izquierda (naranja): más en las derrotas.
    wl = diffs.length
      ? divergingBars(diffs.sort((a, b) => b.d - a.d).map((x) => ({
          label: x.m.label,
          value: Math.log(Math.min(2.5, Math.max(0.4, x.w / x.l))) / Math.log(2.5),
          text: `${x.d > 0 ? '+' : '−'}${fmtNum(Math.abs(100 * x.d), 0)} %`,
          sub: `victorias ${fmtV(x, x.w)} · derrotas ${fmtV(x, x.l)}${x.m.low ? ' · menos es mejor' : ''}`,
          title: `${x.m.label}: ${fmtV(x, x.w)} en las victorias y ${fmtV(x, x.l)} en las derrotas, por jugador y por 90 min${x.m.exp ? '. Dato experimental' : ''}`,
        })), ['Más en las derrotas', 'Más en las victorias'])
      : note('Ningún dato cambia más de un 10 % entre victorias y derrotas.');
  }
  // Situaciones: puntos por partido por grupo.
  const opps = [...new Map(timeline.filter((t) => t.opponent_skill_rating != null).map((t) => [t.match_id, Number(t.opponent_skill_rating)])).values()].sort((a, b) => a - b);
  const median = opps.length ? opps[Math.floor(opps.length / 2)] : 0;
  const first = new Map(); for (const t of timeline) if (!first.has(t.match_id)) first.set(t.match_id, t);
  const pts = (g) => (g.outcome === 'win' ? 3 : g.outcome === 'draw' ? 1 : 0);
  const ppmAll = games.length ? games.reduce((a, g) => a + pts(g), 0) / games.length : 0;
  const dims = [
    ['humanos propios', (t) => (t.team_size ? `con ${t.team_size} humanos nuestros` : null)],
    ['humanos rivales', (t) => (t.opponent_humans != null ? `contra ${t.opponent_humans} humanos rivales` : null)],
    ['rival', (t) => (t.opponent_skill_rating == null ? null : Number(t.opponent_skill_rating) >= median ? 'contra rivales fuertes' : 'contra rivales débiles')],
    ['división', (t) => (t.club_division == null ? null : `en ${Number(t.club_division) > 1 ? `${gameDivision(t.club_division)} división` : TOP_DIVISION_NAME}`)],
    ['tipo', (t) => TYPE_LABEL[t.match_type] ? `en ${TYPE_LABEL[t.match_type].toLowerCase()}` : null],
  ];
  const groups = [];
  for (const [, f] of dims) {
    const acc = new Map();
    for (const g of games) { const t = first.get(g.id); const k = t ? f(t) : null; if (!k) continue; const a = acc.get(k) ?? { n: 0, p: 0 }; a.n++; a.p += pts(g); acc.set(k, a); }
    if (acc.size < 2) continue; // un solo grupo: nada que comparar
    for (const [k, a] of acc) if (a.n >= 4) groups.push({ k, n: a.n, ppm: a.p / a.n });
  }
  const worst = [...groups].filter((x) => x.ppm < ppmAll - 0.15).sort((a, b) => a.ppm - b.ppm).slice(0, 3);
  const best = [...groups].filter((x) => x.ppm > ppmAll + 0.15).sort((a, b) => b.ppm - a.ppm).slice(0, 2);
  // Barras de puntos por partido (0–3) con una marca en el promedio del equipo:
  // naranja por debajo, azul por encima.
  const sitList = [...worst, ...best.reverse()];
  const sits = sitList.length
    ? el('div', { class: 'hbars' }, sitList.map((x) => el('div', { class: `hbar static ${x.ppm < ppmAll ? 'below' : 'above'}`, title: `${x.k}: ${fmtNum(x.ppm, 2)} puntos por partido en ${x.n} partidos (promedio del equipo: ${fmtNum(ppmAll, 2)})` },
        el('span', { class: 'hbar-name' }, x.k.charAt(0).toUpperCase() + x.k.slice(1)),
        el('span', { class: 'hbar-track avg-track', 'aria-hidden': 'true' }, el('i', { style: `width:${(100 * x.ppm) / 3}%` }), el('b', { class: 'avg-mark', style: `left:${(100 * ppmAll) / 3}%` })),
        el('span', { class: 'hbar-val' }, el('strong', {}, fmtNum(x.ppm, 2)), el('span', { class: 'muted small' }, ` · ${x.n} PJ`)))))
    : note('Ninguna situación con 4+ partidos se aleja claramente del promedio.');
  box.replaceChildren(el('div', { class: 'improve', style: 'padding: 0 18px 18px' },
    el('div', { class: 'grid-2' },
      el('div', {}, el('p', { class: 'improve-title' }, 'Victorias frente a derrotas'), wl,
        note('Por jugador humano y por 90 minutos, para que no influya cuántos éramos. Sin partidos abandonados.')),
      el('div', {}, el('p', { class: 'improve-title' }, 'Dónde nos va peor y mejor'), sits,
        note(`Puntos por partido (máximo 3). La raya es el promedio del equipo: ${fmtNum(ppmAll, 2)}. Solo situaciones con 4 o más partidos. Rival fuerte = nivel igual o mayor que la mediana de los rivales.`)))));
}

/**
 * v2.28: división de cada partido, en escalones (arriba la más alta). Sale de
 * club_division de cada partido (anotada al capturar o, si falta, la foto del día).
 * El color del punto es el del resultado, con la letra en la ayuda.
 */
function renderDivisionPath(box, games, timeline) {
  const divOf = new Map(timeline.filter((t) => t.club_division != null).map((t) => [t.match_id, Number(t.club_division)]));
  const list = games.filter((g) => divOf.has(g.id));
  if (list.length < 2) { box.replaceChildren(el('p', { class: 'muted small chart-empty' }, list.length ? 'Hace falta más de un partido con división registrada.' : 'Sin partidos con división registrada en este rango.')); return; }
  const divs = list.map((g) => divOf.get(g.id));
  const top = Math.min(...divs), bottom = Math.max(...divs);
  const levels = []; for (let d = top; d <= bottom; d++) levels.push(d);
  const W = widthOf(box), H = Math.max(140, 60 + 34 * levels.length), L = 92, R = 14, T = 14, B = 26;
  const sx = (i) => L + (list.length === 1 ? 0 : (i / (list.length - 1)) * (W - L - R));
  const sy = (d) => T + (levels.length === 1 ? (H - T - B) / 2 : ((d - top) / (bottom - top)) * (H - T - B));
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'pchart-svg', role: 'img', 'aria-label': `División de cada uno de los ${list.length} partidos, de ${gameDivision(divs[0])} a ${gameDivision(divs.at(-1))}` });
  for (const d of levels) s.append(svg('line', { x1: L, x2: W - R, y1: sy(d), y2: sy(d), class: 'grid-line' }), svgText(L - 8, sy(d) + 4, d > 1 ? `${gameDivision(d)} división` : TOP_DIVISION_NAME, { class: 'axis', 'text-anchor': 'end' }));
  const pts = list.map((g, i) => [sx(i), sy(divOf.get(g.id))]);
  // Escalón: horizontal hasta el partido siguiente y luego vertical.
  const path = pts.map(([x, y], i) => (i ? `H${x} V${y}` : `M${x} ${y}`)).join(' ');
  s.append(svg('path', { d: path, class: 'step-line' }));
  list.forEach((g, i) => {
    const c = svg('circle', { cx: pts[i][0], cy: pts[i][1], r: 4, class: `dot-${g.outcome ?? 'none'}` });
    svgTitle(c, `${fmtDate(g.at, false)} · ${gameDivision(divOf.get(g.id))}${divOf.get(g.id) > 1 ? ' división' : ''} · ${OUTCOME[g.outcome]?.label ?? '—'} ${g.gf}-${g.ga}`);
    s.append(c);
  });
  s.append(svgText(L, H - 6, fmtDate(list[0].at, false), { class: 'axis' }), svgText(W - R, H - 6, fmtDate(list.at(-1).at, false), { class: 'axis', 'text-anchor': 'end' }));
  box.replaceChildren(s, el('p', { class: 'chart-legend muted small' }, ['win', 'draw', 'loss'].map((o) => el('span', {}, el('span', { class: `sw seg-${o}` }), ` ${OUTCOME[o].letter} ${OUTCOME[o].label}  `))));
}

/**
 * v2.28: resultados del equipo según los humanos del rival (023): puntos por partido
 * en barras, con PJ y goles a favor y en contra por partido de cada grupo.
 */
function renderTeamByOppHumans(box, games, timeline) {
  const oppOf = new Map(timeline.filter((t) => t.opponent_humans != null).map((t) => [t.match_id, Number(t.opponent_humans)]));
  const groups = new Map();
  for (const g of games) {
    if (!oppOf.has(g.id)) continue;
    const k = oppOf.get(g.id);
    const a = groups.get(k) ?? { n: 0, pts: 0, gf: 0, ga: 0, ours: 0 };
    a.n++; a.pts += g.outcome === 'win' ? 3 : g.outcome === 'draw' ? 1 : 0; a.gf += g.gf; a.ga += g.ga; a.ours += g.people.size;
    groups.set(k, a);
  }
  if (!groups.size) { box.replaceChildren(el('p', { class: 'muted small chart-empty' }, 'Sin partidos con el dato de humanos rivales en este rango.')); return; }
  const list = [...groups].sort((a, b) => a[0] - b[0]);
  box.replaceChildren(
    el('div', { class: 'hbars', role: 'list' }, list.map(([k, a]) => {
      const ppm = a.pts / a.n;
      return el('div', { class: `hbar static${a.n < 3 ? ' low-sample' : ''}`, role: 'listitem', title: `${a.n} partidos contra ${k} humanos · ${fmtNum(ppm, 2)} puntos por partido · goles ${fmtNum(a.gf / a.n, 2)} a favor y ${fmtNum(a.ga / a.n, 2)} en contra por partido · nosotros éramos ${fmtNum(a.ours / a.n, 1)} en promedio` },
        el('span', { class: 'hbar-name' }, `${k} rival${k === 1 ? '' : 'es'}`),
        el('span', { class: 'hbar-track', 'aria-hidden': 'true' }, el('i', { style: `width:${(100 * ppm) / 3}%` })),
        el('span', { class: 'hbar-val' }, el('strong', {}, fmtNum(ppm, 2)), el('span', { class: 'muted small' }, ` pts · ${a.n} PJ · ${fmtNum(a.gf / a.n, 1)}-${fmtNum(a.ga / a.n, 1)}`)));
    })),
    el('p', { class: 'muted small' }, 'Barra: puntos por partido (máximo 3). Al lado: partidos jugados y goles a favor-en contra por partido. Atenuado: menos de 3 partidos. Al pasar el cursor se ve cuántos humanos éramos nosotros.'));
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

// ---------------------------------------------------------------------------
// v2.29 (pedido del usuario): "Puntos fuertes y para mejorar". Compara al jugador con
// los demás en su posición principal, dato por dato (los mismos de la fórmula, SUB),
// sin ajustes: valores tal cual, para que se lean fácil. Prioriza lo que más se
// relaciona con ganar según la revisión con datos del 2026-11-22: ataque 1, defensa
// 0,8 y pase 0,5. Solo datos con 5+ partidos suyos y de los demás ahí.
// ---------------------------------------------------------------------------
const IMPROVE_MIN = 5;
const IMPROVE_IMPORTANCE = { attack: 1, defense: 0.8, passing: 0.5, defenseGk: 1 };

/**
 * Barras divergentes desde el centro (v2.29). items: { label, value (−1..1), text, title, sub }.
 * Negativo = izquierda (naranja), positivo = derecha (azul). legend: [izquierda, derecha].
 * El texto de cada fila dice el número, así no se depende solo del color.
 */
function divergingBars(items, legend) {
  return el('div', { class: 'dbars improve-bars', role: 'list' },
    items.map((x) => el('div', { class: 'dbar', role: 'listitem', title: x.title, tabindex: '0' },
      el('span', { class: 'dbar-name' }, x.label, x.sub ? el('span', { class: 'dbar-sub' }, x.sub) : null),
      el('span', { class: 'dbar-track' },
        el('span', { class: 'dbar-neg' }, x.value < 0 ? el('i', { style: `width:${Math.min(100, 100 * -x.value)}%` }) : null),
        el('span', { class: 'dbar-pos' }, x.value > 0 ? el('i', { style: `width:${Math.min(100, 100 * x.value)}%` }) : null)),
      el('span', { class: 'dbar-val' }, x.text))),
    el('p', { class: 'dbar-legend muted small' }, el('span', { class: 'sw neg' }), ` ${legend[0]}  `, el('span', { class: 'sw pos' }), ` ${legend[1]}`));
}

/** Valor de un dato en un grupo de filas: por 90 min, proporción o promedio. Null si hay pocas filas. */
function improveValue(rows, s) {
  const ok = rows.filter((t) => (s.ok ? s.ok(t) : true) && Number(t.seconds_played) > 0);
  if (ok.length < IMPROVE_MIN) return null;
  if (s.kind === 'mean') return ok.reduce((a, t) => a + s.num(t), 0) / ok.length;
  const num = ok.reduce((a, t) => a + s.num(t), 0);
  const den = s.kind === 'p90' ? ok.reduce((a, t) => a + Number(t.seconds_played), 0) / 5400 : ok.reduce((a, t) => a + s.den(t), 0);
  return den > 0 ? num / den : null;
}

function improveSection(personId) {
  const all = state.timeline.filter((t) => t.position && Number(t.seconds_played) > 0);
  const mine = all.filter((t) => t.person_id === personId);
  const note = (text) => el('p', { class: 'muted small' }, text);
  if (mine.length < IMPROVE_MIN) return note(`Hacen falta al menos ${IMPROVE_MIN} partidos con estos filtros para comparar.`);
  const secs = new Map();
  for (const t of mine) secs.set(t.position, (secs.get(t.position) ?? 0) + Number(t.seconds_played));
  const pos = [...secs].sort((a, b) => b[1] - a[1])[0][0];
  const myRows = mine.filter((t) => t.position === pos);
  // Los demás en esa posición, solo quienes la jugaron 3+ veces (sin ocasionales).
  const count = new Map();
  for (const t of all) if (t.position === pos && t.person_id !== personId) count.set(t.person_id, (count.get(t.person_id) ?? 0) + 1);
  const peers = all.filter((t) => t.position === pos && t.person_id !== personId && count.get(t.person_id) >= 3);
  const posName = (POS_LABEL[pos] ?? pos).toLowerCase();
  if (myRows.length < IMPROVE_MIN) return note(`Hacen falta al menos ${IMPROVE_MIN} partidos de ${posName} para comparar (tiene ${myRows.length}).`);
  if (peers.length < IMPROVE_MIN) return note(`No hay suficientes partidos de otros jugadores como ${posName} para comparar.`);
  const rating = { label: 'Calificación', kind: 'mean', num: (t) => Number(t.rating), ok: (t) => t.rating != null };
  // Prioridad de ataque y defensa según la familia de su arquetipo, como en Mejor jugador
  // (ofensivo 20/10, equilibrado 15/15, defensivo 10/20 → relativo a 15).
  const fam = new Map();
  for (const t of myRows) fam.set(archFamily(t.archetype_id), (fam.get(archFamily(t.archetype_id)) ?? 0) + Number(t.seconds_played));
  const famTot = [...fam.values()].reduce((a, v) => a + v, 0) || 1;
  const famW = (k) => [...fam].reduce((a, [f, s]) => a + (s / famTot) * (ARCH_SPLIT[f][k] / 15), 0);
  const importance = { ...IMPROVE_IMPORTANCE, attack: IMPROVE_IMPORTANCE.attack * famW('attack'), defense: IMPROVE_IMPORTANCE.defense * famW('defense') };
  const nPeers = new Set(peers.map((t) => t.person_id)).size;
  const groups = pos === 'goalkeeper' ? [['defenseGk', SUB.defenseGk]] : [['rating', [rating]], ['attack', SUB.attack], ['defense', SUB.defense], ['passing', SUB.passing]];
  const items = [];
  for (const [g, specs] of groups) {
    for (const s of specs) {
      const a = improveValue(myRows, s), b = improveValue(peers, s);
      if (a == null || b == null || b === 0 || (a === 0 && b === 0)) continue;
      const r = s.low ? (a === 0 ? 2.5 : b / a) : a / b; // > 1 = mejor que los demás
      if (Math.abs(r - 1) < 0.1) continue; // menos del 10 %: no se destaca
      items.push({ s, a, b, r, score: Math.abs(Math.log(Math.min(2.5, Math.max(0.25, r)))) * (importance[g] ?? 1) });
    }
  }
  const fmt = (s, v) => (s.kind === 'ratio' && !/por partido/.test(s.label) ? `${fmtNum(100 * v, 1)} %` : fmtNum(v, 2));
  const top = (list) => list.sort((p, q) => q.score - p.score).slice(0, 3);
  const weak = top(items.filter((x) => x.r < 1)), strong = top(items.filter((x) => x.r > 1));
  // Gráfica divergente (v2.29): a la izquierda (naranja) lo que está por debajo de los
  // demás, a la derecha (azul) lo que está por encima. El largo es la razón en escala
  // logarítmica (×2 y ×½ miden lo mismo), hasta ×2,5.
  const rows = [...weak.sort((p, q) => p.r - q.r), ...strong.sort((p, q) => p.r - q.r)];
  const chart = rows.length ? divergingBars(rows.map((x) => ({
    label: x.s.label.replace(/^Arquero: /, ''),
    value: Math.log(Math.min(2.5, Math.max(0.4, x.r))) / Math.log(2.5),
    // En los datos donde menos es mejor, el signo confunde junto a una barra azul: se dice "menos"/"más".
    text: x.s.low ? `${fmtNum(Math.abs(100 * (x.a / x.b - 1)), 0)} % ${x.a < x.b ? 'menos' : 'más'}` : `${x.a >= x.b ? '+' : '−'}${fmtNum(Math.abs(100 * (x.a / x.b - 1)), 0)} %`,
    title: `${x.s.label}: ${fmt(x.s, x.a)} frente a ${fmt(x.s, x.b)} de los demás${x.s.low ? ' (menos es mejor)' : ''}${x.s.label.includes('*') ? '. Dato experimental: interpretación de la comunidad, no oficial de EA' : ''}`,
    sub: `${fmt(x.s, x.a)} · demás ${fmt(x.s, x.b)}${x.s.low ? ' · menos es mejor' : ''}`,
  })), ['Para mejorar', 'Puntos fuertes']) : note('Ningún dato se aleja más de un 10 % de los demás en su posición.');
  return el('div', { class: 'improve' }, chart,
    note(`Comparado con ${nPeers === 1 ? 'el otro jugador' : `los otros ${nPeers} jugadores`} que juega${nPeers === 1 ? '' : 'n'} habitualmente como ${posName} (su posición principal: ${myRows.length} partidos suyos ahí), con los filtros actuales.${nPeers === 1 ? ' Con una sola persona de referencia, "los demás" es esa persona.' : ''} Va primero lo que más se relaciona con ganar: ataque y defensa según su arquetipo, como en Mejor jugador, y después pase. Es una comparación, no un juicio: con pocos partidos puede ser casualidad. * = experimental.`));
}

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
    tile('Calificación vs. su posición', fmtNum(rel.rating_idx, 0)),
    tile('G+A/90 vs. su posición', fmtNum(rel.ga90_idx, 0)),
    tile('Pases vs. su posición', fmtNum(rel.pass_idx, 0)),
    tile('Entradas/90 vs. su posición', fmtNum(rel.tackles90_idx, 0)),
    tile('Posiciones jugadas', el('span', { class: 'badges' }, (rel.roles ?? '').split(', ').filter(Boolean).map(posBadge)))) : null;
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
    resumen: [basics, sec('Puntos fuertes y para mejorar', improveSection(state.personId)), el('div', { class: 'grid-2' }, chartBox, overallBox)],
    // Orden por importancia (decisión del usuario): rendimiento, relativo a la posición,
    // evolución y, al final, la posición recomendada (orientativa).
    rendimiento: [
      sec('Su lugar en el equipo', teamPlaceSection(state.personId)),
      sec('Avanzadas', advanced),
      sec('Relativo a su posición (100 = promedio de esa posición)', relTiles),
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
          ...(state.archLevels?.get(state.personId)?.length
            ? state.archLevels.get(state.personId).map((a) => el('span', { class: 'badge', title: 'Media del Pro con ese arquetipo, después de su último partido con él' }, `${archetypeName(a.arch)} ${a.ovr}`))
            : [summary?.pro_overall != null ? el('span', { class: 'badge', title: 'Media (overall) del Pro según EA (EA da una sola, sin decir de qué arquetipo)' }, `Media ${summary.pro_overall}`) : null]),
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
// Gráficas del equipo (v2.9). Un color fijo por jugador (--s1..--s8, en orden de
// aparición, nunca por puesto: filtrar no repinta a nadie) y SIEMPRE el nombre al
// lado de la marca, porque en modo claro algunos colores tienen poco contraste.
// ---------------------------------------------------------------------------

const colorSlots = new Map(); // person_id -> 1..8 (se asigna una vez por sesión)
function personColor(id) {
  if (!colorSlots.has(id)) colorSlots.set(id, colorSlots.size + 1);
  const n = colorSlots.get(id);
  return n <= 8 ? `var(--s${n})` : 'var(--ink-3)';
}
/** Ancho real del contenedor para dibujar a escala (texto legible en el celular). */
const widthOf = (box, min = 280) => Math.max(min, Math.floor(box.clientWidth || 600));
const median = (vals) => { const v = [...vals].sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
function niceRange(vals, pad = 0.1) {
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}
const colLabel = (key) => { const c = RANKING_COLUMNS.find((x) => x.key === key); return c ? `${c.title ?? c.label}${c.exp ? ' *' : ''}` : key; };
const colValue = (key, r) => { const c = RANKING_COLUMNS.find((x) => x.key === key); return c?.render ? null : fmtNum(r[key], c?.digits ?? 0); };
/** Datos numéricos que tienen sentido en un eje o en el mapa de calor. */
const numericColumns = () => RANKING_COLUMNS.filter((c) => !c.text && c.key !== 'wins');

/** 1. Dos datos a la vez: dispersión con ejes a elegir; el tamaño es PJ y las líneas punteadas, la mediana. */
function renderScatter(rows) {
  const box = $('#rk-scatter');
  const cols = numericColumns();
  for (const [sel, key] of [['#sc-x', 'x'], ['#sc-y', 'y']]) {
    const s = $(sel);
    if (!s.options.length) s.replaceChildren(...cols.map((c) => el('option', { value: c.key }, `${c.title ?? c.label}${c.exp ? ' *' : ''}`)));
    s.value = state.scatter[key];
  }
  const { x: kx, y: ky } = state.scatter;
  const pts = rows.filter((r) => r[kx] != null && r[ky] != null).map((r) => ({ r, x: Number(r[kx]), y: Number(r[ky]) }));
  if (pts.length < 2) { box.replaceChildren(el('p', { class: 'muted small' }, 'Hacen falta al menos 2 jugadores con los dos datos.')); return; }
  const W = widthOf(box), H = Math.round(Math.min(340, Math.max(240, W * 0.5))), L = 44, R = 16, T = 14, B = 36;
  const [x0, x1] = niceRange(pts.map((p) => p.x)), [y0, y1] = niceRange(pts.map((p) => p.y));
  const sx = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R), sy = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const maxPj = Math.max(...pts.map((p) => p.r.matches));
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'pchart-svg', role: 'img', 'aria-label': `${colLabel(kx)} contra ${colLabel(ky)} por jugador` });
  for (let i = 0; i <= 4; i++) {
    const yv = y0 + ((y1 - y0) * i) / 4;
    s.append(svg('line', { x1: L, x2: W - R, y1: sy(yv), y2: sy(yv), class: 'grid-line' }), svgText(L - 6, sy(yv) + 4, fmtNum(yv, Math.abs(y1 - y0) < 10 ? 1 : 0), { class: 'axis', 'text-anchor': 'end' }));
  }
  s.append(svgText(L, H - 8, fmtNum(x0, Math.abs(x1 - x0) < 10 ? 1 : 0), { class: 'axis' }), svgText(W - R, H - 8, fmtNum(x1, Math.abs(x1 - x0) < 10 ? 1 : 0), { class: 'axis', 'text-anchor': 'end' }));
  s.append(svgText((L + W - R) / 2, H - 8, `${state.scatter.xLabel ?? colLabel(kx)} →`, { class: 'axis', 'text-anchor': 'middle' }));
  const mx = median(pts.map((p) => p.x)), my = median(pts.map((p) => p.y));
  s.append(svg('line', { x1: sx(mx), x2: sx(mx), y1: T, y2: H - B, class: 'median-line' }), svg('line', { x1: L, x2: W - R, y1: sy(my), y2: sy(my), class: 'median-line' }));
  const placed = [];
  for (const p of [...pts].sort((a, b) => b.r.matches - a.r.matches)) {
    const rr = 5 + 9 * Math.sqrt(p.r.matches / maxPj);
    const few = p.r.matches < PODIUM_MIN_MATCHES;
    const g = svg('g', { class: `sc-dot${few ? ' few' : ''}`, tabindex: '0' });
    g.append(svg('circle', { cx: sx(p.x), cy: sy(p.y), r: rr, style: `fill:${few ? 'var(--ink-3)' : personColor(p.r.person_id)}` }));
    const right = sx(p.x) < W - 110;
    // Etiquetas sin pisarse: si choca con una ya puesta, baja 14 px.
    const lx = sx(p.x) + (right ? rr + 4 : -rr - 4), lw = p.r.person_name.length * 7;
    const x0b = right ? lx : lx - lw;
    let ly = sy(p.y) + 4;
    while (placed.some((b) => Math.abs(b.y - ly) < 13 && x0b < b.x1 && x0b + lw > b.x0)) ly += 14;
    placed.push({ x0: x0b, x1: x0b + lw, y: ly });
    g.append(svgText(lx, ly, p.r.person_name, { class: 'dot-label', 'text-anchor': right ? 'start' : 'end' }));
    svgTitle(g, `${p.r.person_name} (${p.r.matches} PJ): ${colLabel(kx)} ${colValue(kx, p.r) ?? p.x} · ${colLabel(ky)} ${colValue(ky, p.r) ?? p.y}`);
    g.addEventListener('click', () => openPerson(p.r.person_id));
    s.append(g);
  }
  box.replaceChildren(el('div', { class: 'sc-ylabel muted small' }, `↑ ${colLabel(ky)}`), s,
    el('p', { class: 'muted small' }, 'Las líneas punteadas son la mediana del equipo: arriba a la derecha, mejor en los dos datos (si en alguno menos es mejor, al revés). El tamaño del punto es la cantidad de partidos; en gris, menos de 3.'));
}

/** 2. Mapa de calor: jugador × dato, color según el puesto en el equipo (más intenso = mejor). */
function renderHeatmap(rows) {
  const box = $('#rk-heat');
  const cols = visibleColumns().filter((c) => !c.text && c.kind !== 'base' && betterOf(c));
  const people = rows.filter((r) => r.matches >= state.minMatches);
  if (people.length < 2 || !cols.length) { box.replaceChildren(el('p', { class: 'muted small' }, 'Hacen falta al menos 2 jugadores.')); return; }
  const places = new Map(cols.map((c) => { const o = bestFirst(people, c) ?? []; return [c.key, { p: placesOf(o, c), n: o.length }]; }));
  const shade = (place, n) => (n < 2 ? 50 : Math.round(15 + 85 * (1 - (place - 1) / (n - 1))));
  const head = el('tr', {}, el('th', { scope: 'col', class: 'left' }, 'Jugador'), cols.map((c) => el('th', { scope: 'col', class: c.exp ? 'exp' : null, title: c.title }, c.label)));
  const body = people.map((r) => el('tr', { class: `clickable${r.matches < PODIUM_MIN_MATCHES ? ' low-sample' : ''}`, ...onActivate(() => openPerson(r.person_id)) },
    el('td', { class: 'left' }, playerCell(r.person_name)),
    cols.map((c) => {
      const { p, n } = places.get(c.key);
      const place = p.get(r.person_id);
      if (r[c.key] == null || place == null) return el('td', { class: 'muted' }, '—');
      const pct = shade(place, n);
      return el('td', { class: 'heat', style: `--heat:${pct}%`, title: `${c.title ?? c.label}: ${place}º de ${n}` }, c.render ? c.render(r) : fmtNum(r[c.key], c.digits ?? 0));
    })));
  box.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { class: 'data heatmap' }, el('thead', {}, head), el('tbody', {}, body))),
    el('p', { class: 'muted small heat-legend' }, 'Puesto en el equipo: ', el('span', { class: 'heat-sw', style: '--heat:15%' }), ' último ', el('span', { class: 'heat-sw', style: '--heat:57%' }), ' medio ', el('span', { class: 'heat-sw', style: '--heat:100%' }), ' primero. En los datos donde menos es mejor, el primero es quien tiene menos. Usa los mismos datos que la tabla ("Datos" y "+ Añadir dato").'));
}

/** 3. Carrera: calificación media acumulada partido a partido, una línea por jugador. */
function renderRace(rows) {
  const box = $('#rk-race');
  const series = rows.filter((r) => r.matches >= state.minMatches).map((r) => {
    const v = state.trend.get(r.person_id) ?? [];
    let sum = 0;
    return { r, pts: v.map((x, i) => (sum += x) / (i + 1)) };
  }).filter((s) => s.pts.length >= 2);
  if (!series.length) { box.replaceChildren(el('p', { class: 'muted small' }, 'Hacen falta jugadores con al menos 2 partidos.')); return; }
  const W = widthOf(box), H = 260, L = 34, R = 110, T = 12, B = 30;
  const maxN = Math.max(...series.map((s) => s.pts.length));
  const [y0, y1] = niceRange(series.flatMap((s) => s.pts), 0.15);
  const sx = (i) => L + (maxN === 1 ? 0 : (i / (maxN - 1)) * (W - L - R)), sy = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'pchart-svg', role: 'img', 'aria-label': 'Calificación media acumulada de cada jugador, partido a partido' });
  for (let i = 0; i <= 4; i++) { const v = y0 + ((y1 - y0) * i) / 4; s.append(svg('line', { x1: L, x2: W - R, y1: sy(v), y2: sy(v), class: 'grid-line' }), svgText(L - 6, sy(v) + 4, fmtNum(v, 1), { class: 'axis', 'text-anchor': 'end' })); }
  s.append(svgText(L, H - 8, 'Partido 1', { class: 'axis' }), svgText(W - R, H - 8, `Partido ${maxN}`, { class: 'axis', 'text-anchor': 'end' }));
  // Etiquetas al final de cada línea, separadas para que no se pisen.
  const ends = series.map((x) => ({ x, y: sy(x.pts.at(-1)) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  for (const { x: se, y: ly } of ends) {
    const color = personColor(se.r.person_id);
    const g = svg('g', { class: 'race-line', tabindex: '0' });
    g.append(svg('polyline', { points: se.pts.map((v, i) => `${sx(i)},${sy(v)}`).join(' '), style: `stroke:${color}` }));
    g.append(svg('circle', { cx: sx(se.pts.length - 1), cy: sy(se.pts.at(-1)), r: 4, style: `fill:${color}` }));
    g.append(svgText(sx(se.pts.length - 1) + 8, ly + 4, `${se.r.person_name} ${fmtNum(se.pts.at(-1), 2)}`, { class: 'dot-label' }));
    svgTitle(g, `${se.r.person_name}: ${se.pts.map((v) => fmtNum(v, 2)).join(' → ')}`);
    g.addEventListener('click', () => openPerson(se.r.person_id));
    s.append(g);
  }
  box.replaceChildren(s, el('p', { class: 'muted small' }, 'Cada punto es su calificación media hasta ese partido (el eje cuenta sus partidos, no fechas). Al principio la línea salta mucho; con más partidos se estabiliza.'));
}

/** 4. Por posición: cada índice como un punto por jugador alrededor de la línea 100. */
function renderRoleDots(rows) {
  const box = $('#roles-chart');
  const cols = ROLE_COLUMNS.filter((c) => state.showExp || !c.exp);
  const people = rows.filter((r) => r.matches >= state.minMatches);
  const vals = people.flatMap((r) => cols.map((c) => r[c.key]).filter((v) => v != null).map(Number));
  if (!vals.length) { box.replaceChildren(el('p', { class: 'muted small chart-empty' }, 'Sin índices para estos filtros.')); return; }
  // Si todos dan 100, nadie comparte posición con otro (p. ej. cada uno con un arquetipo
  // distinto): cada uno ES el promedio de su posición y no hay con quién compararlo.
  if (vals.every((v) => Math.abs(v - 100) < 0.5)) {
    box.replaceChildren(el('p', { class: 'muted small' }, state.roleGroup === 'archetype'
      ? 'Todos dan 100 porque nadie comparte arquetipo con otro jugador del club: cada uno es el promedio de su propio arquetipo y no hay con quién compararlo. Usa "Por posición", o espera a que más jugadores usen el mismo arquetipo.'
      : 'Todos dan 100 porque nadie comparte posición con otro jugador del club en estos partidos: no hay con quién compararlo.'));
    return;
  }
  // Escala limitada a ±60: un valor extremo (p. ej. 332 con 2 PJ) no aplasta a los demás;
  // se dibuja en el borde, hueco y con su número.
  const CAP = 60;
  const span = Math.min(CAP, Math.max(30, ...vals.map((v) => Math.abs(v - 100)))) * 1.1;
  const W = widthOf(box), L = 120, R = 44, rowH = 34, T = 10, H = T + cols.length * rowH + 26;
  const sxRaw = (v) => L + ((v - (100 - span)) / (2 * span)) * (W - L - R);
  const sx = (v) => sxRaw(Math.max(100 - span, Math.min(100 + span, v)));
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'pchart-svg', role: 'img', 'aria-label': 'Índices relativos a la posición de cada jugador alrededor de 100' });
  // En pantallas angostas, textos cortos para que no se pisen.
  const narrow = W < 460;
  s.append(svg('line', { x1: sx(100), x2: sx(100), y1: T - 4, y2: H - 24, class: 'axis-line' }), svgText(sx(100), H - 8, narrow ? '100' : '100 = promedio de la posición', { class: 'axis', 'text-anchor': 'middle' }));
  s.append(svgText(L, H - 8, narrow ? `${fmtNum(100 - span)}` : `${fmtNum(100 - span)} peor`, { class: 'axis' }), svgText(W - R, H - 8, narrow ? `${fmtNum(100 + span)}` : `mejor ${fmtNum(100 + span)}`, { class: 'axis', 'text-anchor': 'end' }));
  cols.forEach((c, i) => {
    const y = T + i * rowH + rowH / 2;
    s.append(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'grid-line' }), svgText(L - 8, y + 4, c.label, { class: 'axis strong', 'text-anchor': 'end' }));
    for (const r of people) {
      if (r[c.key] == null) continue;
      const v = Number(r[c.key]);
      const g = svg('g', { tabindex: '0' });
      const out = Math.abs(v - 100) > span;
      g.append(svg('line', { x1: sx(100), x2: sx(v), y1: y, y2: y, style: `stroke:${personColor(r.person_id)}`, class: 'lolli' }),
        svg('circle', { cx: sx(v), cy: y, r: 6, style: out ? `fill:none;stroke:${personColor(r.person_id)};stroke-width:2.5` : `fill:${personColor(r.person_id)}` }));
      if (out) g.append(svgText(sx(v) + (v > 100 ? 9 : -9), y + 4, fmtNum(v, 0), { class: 'axis strong', 'text-anchor': v > 100 ? 'start' : 'end' }));
      svgTitle(g, `${r.person_name} · ${c.label}: ${fmtNum(v, 0)} (${r.matches} PJ)${out ? ' · fuera de la escala' : ''}`);
      s.append(g);
    }
  });
  box.replaceChildren(s, el('p', { class: 'chart-legend muted small' }, people.map((r) => el('span', {}, el('span', { class: 'sw', style: `background:${personColor(r.person_id)}` }), ` ${r.person_name}  `))),
    el('p', { class: 'muted small' }, 'Pasa el cursor sobre un punto para ver de quién es y su índice. Un círculo hueco en el borde está fuera de la escala; lleva su valor al lado (suele pasar con pocos partidos).'));
}

/** 5. Comparar: una línea por jugador entre los grupos (p. ej. rival débil → fuerte). */
function renderSlope(list, buckets, metric, bucketLabel) {
  const box = $('#compare-chart');
  // La gráfica compara grupos: con uno solo (p. ej. todos los partidos de liga) no hay nada que unir.
  if (buckets.length < 2) {
    box.replaceChildren(el('p', { class: 'muted small chart-empty' }, buckets.length
      ? `Todos los partidos con estos filtros caen en un solo grupo (${bucketLabel(buckets[0]).text}): la gráfica aparece cuando haya partidos en al menos dos grupos. Mientras tanto, la tabla de abajo muestra ese grupo.`
      : 'Sin partidos para estos filtros.'));
    return;
  }
  const series = list.map(([id, p]) => ({ id, name: p.name, pts: buckets.map((b, i) => ({ i, b, v: p.cells[b]?.[metric] == null ? null : Number(p.cells[b][metric]), n: p.cells[b]?.matches })) }))
    .filter((s) => s.pts.filter((p) => p.v != null).length >= 2);
  if (!series.length) { box.replaceChildren(el('p', { class: 'muted small' }, 'Nadie tiene datos en al menos dos grupos todavía.')); return; }
  const W = widthOf(box), H = 240, L = 40, R = 120, T = 14, B = 30;
  const [y0, y1] = niceRange(series.flatMap((s) => s.pts.filter((p) => p.v != null).map((p) => p.v)), 0.15);
  const sx = (i) => L + (i / (buckets.length - 1)) * (W - L - R), sy = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const digits = METRIC[metric]?.digits ?? 1;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'pchart-svg', role: 'img', 'aria-label': `${METRIC[metric]?.label ?? metric} de cada jugador en cada grupo` });
  for (let i = 0; i <= 4; i++) { const v = y0 + ((y1 - y0) * i) / 4; s.append(svg('line', { x1: L, x2: W - R, y1: sy(v), y2: sy(v), class: 'grid-line' }), svgText(L - 6, sy(v) + 4, fmtNum(v, digits), { class: 'axis', 'text-anchor': 'end' })); }
  buckets.forEach((b, i) => s.append(svg('line', { x1: sx(i), x2: sx(i), y1: T, y2: H - B, class: 'grid-line' }), svgText(sx(i), H - 8, bucketLabel(b).text, { class: 'axis', 'text-anchor': i === 0 ? 'start' : i === buckets.length - 1 ? 'end' : 'middle' })));
  const ends = series.map((se) => ({ se, last: se.pts.filter((p) => p.v != null).at(-1) })).map((e) => ({ ...e, y: sy(e.last.v) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  for (const { se, last, y } of ends) {
    const color = personColor(se.id);
    const g = svg('g', { class: 'race-line', tabindex: '0' });
    const ok = se.pts.filter((p) => p.v != null);
    g.append(svg('polyline', { points: ok.map((p) => `${sx(p.i)},${sy(p.v)}`).join(' '), style: `stroke:${color}` }));
    for (const p of ok) g.append(svg('circle', { cx: sx(p.i), cy: sy(p.v), r: 4 + Math.min(4, (p.n ?? 1) / 3), style: `fill:${color}` }));
    g.append(svgText(sx(last.i) + 10, y + 4, `${se.name}`, { class: 'dot-label' }));
    svgTitle(g, `${se.name}: ${ok.map((p) => `${bucketLabel(p.b).text} ${fmtNum(p.v, digits)} (${p.n} PJ)`).join(' · ')}`);
    g.addEventListener('click', () => openPerson(se.id));
    s.append(g);
  }
  box.replaceChildren(s, el('p', { class: 'muted small' }, `Una línea por jugador. ${METRIC[metric]?.low ? 'En este dato menos es mejor: si sube de izquierda a derecha, rinde peor en el grupo de la derecha.' : 'Si baja de izquierda a derecha, rinde menos en el grupo de la derecha.'} El punto más grande = más partidos ahí; con pocos partidos la diferencia puede ser casualidad.`));
}

/** 6. Matriz de duplas: % de victorias cuando dos juegan juntos (gris = menos de 3 partidos juntos). */
function renderPairMatrix(all, people) {
  const box = $('#pairs-matrix');
  const ppl = people.slice(0, 10);
  if (ppl.length < 2) { box.replaceChildren(el('p', { class: 'muted small chart-empty' }, 'La matriz aparece cuando haya al menos 2 jugadores con el mínimo de partidos.')); return; }
  const head = el('tr', {}, el('th', { scope: 'col' }), ppl.map((p) => el('th', { scope: 'col', title: p.person_name }, p.person_name)));
  const body = ppl.map((a) => el('tr', {}, el('th', { scope: 'row', class: 'left' }, a.person_name), ppl.map((b) => {
    if (a.person_id === b.person_id) return el('td', { class: 'pm-self' }, '');
    const t = teamResults(all.filter((m) => m.people.has(a.person_id) && m.people.has(b.person_id)));
    if (!t.n) return el('td', { class: 'muted' }, '—');
    const few = t.n < PODIUM_MIN_MATCHES;
    return el('td', { class: `heat${few ? ' few' : ''}`, style: few ? null : `--heat:${Math.round(15 + 0.85 * t.winPct)}%`,
      title: `${a.person_name} + ${b.person_name}: ${t.n} PJ juntos, ${vedText(t)} (${fmtNum(t.winPct, 0)} % de victorias)${few ? '. Pocos partidos: no es confiable' : ''}` },
    el('strong', {}, `${fmtNum(t.winPct, 0)} %`), el('span', { class: 'muted small' }, ` ${t.n} PJ`));
  })));
  box.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { class: 'data heatmap matrix' }, el('thead', {}, head), el('tbody', {}, body))),
    el('p', { class: 'muted small heat-legend' }, '% de victorias cuando juegan juntos: ', el('span', { class: 'heat-sw', style: '--heat:15%' }), ' 0 % ', el('span', { class: 'heat-sw', style: '--heat:100%' }), ' 100 %. En gris, menos de 3 partidos juntos (no es confiable).'));
}

/** 8. Nivel del rival contra diferencia de goles: un punto por partido y la tendencia. */
function renderRivalScatter(matches, flags) {
  const box = $('#matches-chart');
  const pts = matches.filter((m) => m.opponent_skill_rating != null).map((m) => ({ m, x: Number(m.opponent_skill_rating), y: m.goals_for - m.goals_against, inc: flags.get(m.match_id)?.incomplete }));
  if (pts.length < 3) { box.replaceChildren(el('p', { class: 'muted small' }, 'Hacen falta al menos 3 partidos con el nivel del rival.')); return; }
  const W = widthOf(box), H = 240, L = 36, R = 14, T = 12, B = 32;
  const [x0, x1] = niceRange(pts.map((p) => p.x)), yMax = Math.max(1, ...pts.map((p) => Math.abs(p.y))) + 0.5;
  const sx = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R), sy = (v) => T + (1 - (v + yMax) / (2 * yMax)) * (H - T - B);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'pchart-svg', role: 'img', 'aria-label': 'Diferencia de goles de cada partido según el nivel del rival' });
  for (const v of [-Math.floor(yMax), 0, Math.floor(yMax)]) s.append(svg('line', { x1: L, x2: W - R, y1: sy(v), y2: sy(v), class: v === 0 ? 'axis-line' : 'grid-line' }), svgText(L - 6, sy(v) + 4, v > 0 ? `+${v}` : String(v), { class: 'axis', 'text-anchor': 'end' }));
  s.append(svgText(L, H - 8, fmtNum(x0), { class: 'axis' }), svgText(W - R, H - 8, fmtNum(x1), { class: 'axis', 'text-anchor': 'end' }), svgText((L + W - R) / 2, H - 8, 'Nivel del rival →', { class: 'axis', 'text-anchor': 'middle' }));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y), mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  let note = 'Cada punto es un partido.';
  if (den > 0) {
    const b = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den, a = my - b * mx;
    s.append(svg('line', { x1: sx(x0), y1: sy(a + b * x0), x2: sx(x1), y2: sy(a + b * x1), class: 'trend-line' }));
    note = Math.abs(b * 100) < 0.1 ? 'El resultado casi no cambia con el nivel del rival.' : `Por cada 100 puntos más de nivel del rival, la diferencia de goles ${b < 0 ? 'baja' : 'sube'} ${fmtNum(Math.abs(b * 100), 2)} en promedio.`;
  }
  for (const p of pts) {
    const c = svg('circle', { cx: sx(p.x), cy: sy(p.y), r: 6, class: `rv-dot ${p.m.outcome}${p.inc ? ' abandoned' : ''}` });
    s.append(svgTitle(c, `${fmtDate(p.m.played_at, false)} · ${p.m.opponent_name ?? 'Rival'} (nivel ${fmtNum(p.x)}) · ${p.m.goals_for}–${p.m.goals_against}${p.inc ? ' · Abandonado' : ''}`));
  }
  box.replaceChildren(s, el('p', { class: 'chart-legend muted small' }, ['win', 'draw', 'loss'].map((o) => el('span', {}, el('span', { class: `sw seg-${o}` }), ` ${OUTCOME[o].label}  `)), el('span', {}, el('span', { class: 'sw hollow' }), ' Abandonado'), ` · ${note}`));
}

/** 11. Su lugar en el equipo: por cada dato, de último a primero, entre quienes cumplen el mínimo de partidos. */
function teamPlaceSection(personId) {
  const people = state.ranking.filter((r) => r.matches >= state.minMatches);
  const me = people.find((r) => r.person_id === personId);
  if (!me || people.length < 2) return null;
  const cols = visibleColumns().filter((c) => !c.text && c.kind !== 'base' && betterOf(c) && me[c.key] != null);
  const rows = cols.map((c) => {
    const o = bestFirst(people, c) ?? [];
    const place = placesOf(o, c).get(personId), n = o.length;
    return { c, place, n, pct: n < 2 ? 50 : (100 * (n - place)) / (n - 1) };
  }).filter((x) => x.place != null);
  return el('div', {}, el('div', { class: 'place-rows' }, rows.map(({ c, place, n, pct }) => el('div', { class: `place-row${c.exp ? ' exp' : ''}`, title: `${c.title ?? c.label}: ${place}º de ${n}` },
    el('span', { class: 'place-label' }, `${c.title ?? c.label}${c.exp ? ' *' : ''}`),
    el('span', { class: 'place-track' }, el('i', { style: `width:${Math.max(3, pct)}%` }), el('b', { 'aria-hidden': 'true' })),
    el('span', { class: 'place-val' }, `${place}º de ${n}`)))),
  el('p', { class: 'muted small' }, `La barra llena = el mejor del equipo en ese dato; la marca del centro = la mitad. Entre los ${people.length} jugadores con el mínimo de partidos. Usa los mismos datos que la tabla del ranking.`));
}

// ---------------------------------------------------------------------------
// Mejor jugador (EXPERIMENTAL). Fórmula aprobada por el usuario el 2026-11-16
// (v2.10) y ampliada el mismo día (v2.12): criterios y pesos FIJOS (todos ven el
// mismo ranking) y mínimo del 30 % de los partidos del club. No cambia ningún
// dato de EA: es un cálculo encima.
//
//   1. Cada criterio es un índice: 100 = promedio (de la posición, cuando aplica).
//      Calificación, ataque, defensa y pase se comparan con el promedio del club
//      en las posiciones que jugó, ponderado por sus minutos en cada una.
//   2. Dificultad (v2.12): en esos cuatro, cada partido pesa según la división
//      (+5 % por división sobre la 5ª) y el nivel del rival (su nivel / el medio
//      de los rivales, entre ×0,85 y ×1,15). Lo bueno se multiplica; lo malo
//      (pérdidas, entradas peligrosas) se divide.
//   3. Corrección por pocos partidos: 100 + (índice − 100) × PJ / (PJ + 5).
//   4. Nota 0–100: 50 + (índice − 100), recortada a [0, 100].
//   5. Puntaje = promedio ponderado de las notas. Si a alguien le falta un
//      criterio o un dato, su peso se reparte entre los demás (se avisa).
// ---------------------------------------------------------------------------

const BEST_MIN_SHARE = 0.3; // 30 % de los partidos del club en el rango filtrado
const BEST_SHRINK_K = 5;
// v2.21 (decisión del usuario): para servir de comparación en los promedios por posición
// hace falta el 15 % de los partidos del club y al menos 5 PJ (el mismo 5 de la corrección).
const BEST_PEER_SHARE = 0.15;
const BEST_PEER_MIN = 5;
// Nota (v2.16): 50 + BEST_NOTE_PER_SD × (índice corregido − 100) / dispersión del criterio.
// La dispersión mínima evita que diferencias mínimas se agranden con pocos jugadores.
const BEST_NOTE_PER_SD = 15;
const BEST_MIN_SPREAD = 5;
// v2.17 (aprobado por el usuario): en la fórmula, un amistoso vale la mitad que un
// partido de liga o de play-off. Los datos y las demás pestañas no cambian.
const BEST_FRIENDLY_WEIGHT = 0.5;
// v2.17: Impacto se corrige por el menor entre partidos con él y sin él, y queda
// neutro (100) con menos de este número de partidos sin él.
const BEST_IMPACT_MIN_WITHOUT = 5;
const matchWeight = (t) => (t.match_type === 'friendlyMatch' ? BEST_FRIENDLY_WEIGHT : 1);
const DIV_STEP = 0.05; // +5 % por división sobre la 5ª del juego (API 6)
const RIVAL_CAP = 0.15; // factor del rival entre ×0,85 y ×1,15
const LEVEL_CAP = 0.10; // factor de nivel del jugador entre ×0,90 y ×1,10 (v2.13)
// v2.27 (aprobado por el usuario): el factor de nivel vale la mitad. Factor =
// (media del equipo / su media) ^ 0,5. Con los datos del 2026-11-22 (128 partidos con la
// media exacta) la calificación subía ~0,05 por punto de media (± 0,16), y el factor
// proporcional suponía ~0,10. Revisar con ~50 partidos por club.
const LEVEL_ELASTICITY = 0.5;

// Encabezados de la tabla de criterios del mejor jugador, con la explicación
// que se ve al pasar el cursor (title).
const BEST_COLS = [
  ['Criterio', 'Qué se mide. Los datos pequeños de abajo son los que forman el criterio, cada uno con su índice (100 = promedio de los demás en su posición). Los marcados con * son experimentales.'],
  ['Índice', 'Cómo le fue frente al promedio: 100 = igual al promedio de los DEMÁS jugadores en su posición (la general que da EA: delantero, medio, defensa o arquero; no distingue extremo de delantero centro) (no se cuenta a sí mismo; si nadie más jugó esa posición, esos minutos no cuentan, y si los demás jugaron pocos partidos ahí, la comparación pesa menos). En MVP, juego limpio y regularidad, al de los jugadores del ranking). 120 = 20 % mejor; 80 = 20 % peor. En Impacto es 100 + (% de victorias con él − % sin él). En Ubicación es su % en posición, tal cual, y no se corrige. En calificación, ataque, defensa y pase ya incluye el ajuste por la dificultad de cada partido y por su nivel.'],
  ['Con corrección', `El índice acercado a 100 según cuántos partidos jugó, para que pocos partidos no den un número extremo por suerte: 100 + (índice − 100) × PJ / (PJ + ${BEST_SHRINK_K}), donde un amistoso cuenta como medio partido. En Impacto, PJ es el menor entre partidos con él y sin él. Con muchos partidos casi no cambia.`],
  ['Nota', `El índice corregido pasado a una nota de 0 a 100: 50 + ${BEST_NOTE_PER_SD} × (índice corregido − 100) ÷ dispersión del criterio entre los jugadores del ranking (mínimo ${BEST_MIN_SPREAD}). Así cada criterio mueve el puntaje según su peso y no según lo disperso que sea. 50 = promedio; se recorta a 0 y 100. En Ubicación, la nota es el % tal cual.`],
  ['Peso', 'Cuánto vale este criterio en el puntaje final. Son fijos, salvo ataque y defensa (30 % entre los dos), que se reparten según la familia de su arquetipo: ofensivo 20/10, equilibrado 15/15, defensivo 10/20.'],
  ['Aporta', 'Puntos que suma este criterio al puntaje final: nota × peso. Si falta algún criterio, su peso se reparte entre los demás, por eso puede dar algo más que nota × peso. La suma de esta columna es el puntaje.'],
];

/**
 * Media del Pro de una cuenta el día del partido (v2.13, aprobado por el usuario):
 * la foto diaria de ese día o la anterior más cercana; si el partido es anterior a
 * la primera foto, la primera. null si EA no tiene fotos de esa cuenta.
 */
function levelOn(playername, playedAt) {
  const list = state.levels?.get(playername);
  if (!list?.length) return null;
  const day = String(playedAt).slice(0, 10);
  let best = list[0];
  for (const s of list) if (s.snapshot_date <= day) best = s;
  return Number(best.pro_overall);
}
const BEST_CRITERIA = [
  { key: 'rating', label: 'Calificación frente a su posición', weight: 25, help: 'Su calificación de EA frente al promedio del club en las posiciones que jugó, ajustada por la dificultad de cada partido.' },
  { key: 'attack', label: 'Ataque frente a su posición', weight: 15, help: 'G+A, conversión, regates*, rival superado*, segundas asistencias*, tiros, tiros a puerta*, conducciones* y faltas recibidas* frente a su posición, ajustados por dificultad.' },
  { key: 'defense', label: 'Defensa frente a su posición', weight: 15, help: 'Entradas, % de entradas, intercepciones*, recuperaciones*, balones quitados*, duelos aéreos*, % de entradas limpias* y entradas peligrosas* (menos es mejor) frente a su posición, ajustados por dificultad. Sus minutos de arquero se miden con % de atajadas, goles recibidos (menos es mejor), atajadas y vallas invictas.' },
  { key: 'passing', label: 'Pase frente a su posición', weight: 10, help: 'Precisión, pases completados, filtrados*, pérdidas* (menos es mejor), pase adelante*, pase largo*, primer toque*, decisiones* y pases a fuera de juego* (menos es mejor) frente a su posición, ajustados por dificultad.' },
  // Ubicación (aprobada por el usuario): su propio % en posición, sin compararlo con los demás de su posición
  // ni corregirlo por pocos partidos. La nota es el % tal cual.
  { key: 'positioning', label: 'Ubicación*', weight: 5, absolute: true, help: 'Su % de veces en posición frente a fuera de posición, según los avisos del juego. Se mide por su cuenta, sin compararlo con los demás de su posición: la nota es el % tal cual (98 % en posición = nota 98).' },
  { key: 'impact', label: 'Impacto en el equipo', weight: 10, help: '% de puntos que gana el equipo con él (victoria 3, empate 1, derrota 0) menos el % sin él, comparando solo partidos con el mismo número de humanos (cuando alguien falta hay menos humanos, y eso cambia los resultados); cada punto de diferencia suma o resta un punto al índice. Se corrige según el menor entre partidos con él y sin él, y con menos de 5 partidos sin él queda en 100.' },
  { key: 'mvp', label: 'MVP', weight: 10, help: 'Su % de MVP frente al promedio de los jugadores que entran al ranking. Cada MVP vale según la dificultad del partido, su nivel y los humanos en cancha de los dos equipos: el MVP se elige entre todos ellos, así que ganarlo entre 8 humanos vale el doble que entre 4.' },
  { key: 'fairplay', label: 'Juego limpio', weight: 5, help: 'Sanciones por 90 min frente al promedio: roja 3, amarilla* 1, penal cometido* 1, falta* 0,25. Menos sanciones = más puntos.' },
  { key: 'regularity', label: 'Regularidad', weight: 5, help: 'Qué tan estable es su calificación (ajustada por dificultad y nivel): solo cuentan los partidos por debajo de su media, así un partido excepcional no le resta. Menos caídas que el promedio = índice mayor.' },
];

// Datos de cada criterio por posición. kind: 'p90' = por 90 min; 'ratio' = num / den.
// low: menos es mejor. w: peso dentro del criterio (aprobado por el usuario).
const n = (k) => (t) => Number(t[k] ?? 0);
const sum = (...ks) => (t) => ks.reduce((a, k) => a + Number(t[k] ?? 0), 0);
const has = (...ks) => (t) => ks.every((k) => t[k] != null);
const SUB = {
  attack: [
    { label: 'G+A por 90', w: 30, kind: 'p90', num: sum('goals', 'assists') },
    { label: 'Conversión', w: 15, kind: 'ratio', num: n('goals'), den: n('shots') },
    { label: 'Regates por 90*', w: 10, kind: 'p90', num: n('dribbles_exp'), ok: has('dribbles_exp') },
    { label: 'Rival superado por 90*', w: 10, kind: 'p90', num: n('beats_exp'), ok: has('beats_exp') },
    { label: '2ª asistencias por 90*', w: 10, kind: 'p90', num: n('second_assists_exp'), ok: has('second_assists_exp') },
    { label: 'Tiros por 90', w: 10, kind: 'p90', num: n('shots') },
    { label: 'Tiros a puerta %*', w: 5, kind: 'ratio', num: n('shots_on_target_exp'), den: sum('shots_on_target_exp', 'shots_off_target_exp'), ok: has('shots_on_target_exp') },
    { label: 'Conducciones por 90*', w: 5, kind: 'p90', num: n('carries_exp'), ok: has('carries_exp') },
    { label: 'Faltas recibidas por 90*', w: 5, kind: 'p90', num: n('fouls_won_exp'), ok: has('fouls_won_exp') },
  ],
  defense: [
    { label: 'Entradas por 90', w: 20, kind: 'p90', num: n('tackles_made') },
    { label: '% de entradas', w: 15, kind: 'ratio', num: n('tackles_made'), den: n('tackle_attempts') },
    { label: 'Intercepciones por 90*', w: 20, kind: 'p90', num: n('interceptions_exp'), ok: has('interceptions_exp') },
    { label: 'Recuperaciones por 90*', w: 15, kind: 'p90', num: n('possession_won_exp'), ok: has('possession_won_exp') },
    { label: 'Balones quitados por 90*', w: 10, kind: 'p90', num: n('dispossessed_exp'), ok: has('dispossessed_exp') },
    { label: 'Duelos aéreos por 90*', w: 10, kind: 'p90', num: n('aerial_duels_won_exp'), ok: has('aerial_duels_won_exp') },
    { label: '% de entradas limpias*', w: 5, kind: 'ratio', num: n('clean_tackles_exp'), den: n('tackles_made'), ok: has('clean_tackles_exp') },
    { label: 'Entradas peligrosas por 90*', w: 5, kind: 'p90', low: true, num: n('dangerous_tackles_exp'), ok: has('dangerous_tackles_exp') },
  ],
  // Arquero (aprobado por el usuario el 2026-11-16): se usa en los minutos que jugó de arquero.
  defenseGk: [
    { label: 'Arquero: % de atajadas', w: 50, kind: 'ratio', num: n('saves'), den: sum('saves', 'goals_conceded') },
    { label: 'Arquero: goles recibidos por 90', w: 20, kind: 'p90', low: true, num: n('goals_conceded') },
    { label: 'Arquero: atajadas por 90', w: 15, kind: 'p90', num: n('saves') },
    { label: 'Arquero: vallas invictas por partido', w: 15, kind: 'ratio', num: n('clean_sheets_gk'), den: () => 1 },
  ],
  passing: [
    { label: 'Precisión de pase', w: 25, kind: 'ratio', num: n('passes_made'), den: n('pass_attempts') },
    { label: 'Pases por 90', w: 15, kind: 'p90', num: n('passes_made') },
    { label: 'Filtrados por 90*', w: 15, kind: 'p90', num: n('through_passes_exp'), ok: has('through_passes_exp') },
    { label: 'Pérdidas por 90*', w: 15, kind: 'p90', low: true, num: n('possession_lost_exp'), ok: has('possession_lost_exp') },
    { label: 'Pase adelante %*', w: 10, kind: 'ratio', num: n('forward_passes_ok_exp'), den: sum('forward_passes_ok_exp', 'forward_passes_failed_exp'), ok: has('forward_passes_ok_exp') },
    { label: 'Pase largo %*', w: 5, kind: 'ratio', num: n('long_passes_ok_exp'), den: sum('long_passes_ok_exp', 'long_passes_failed_exp'), ok: has('long_passes_ok_exp') },
    { label: 'Primer toque por 90*', w: 5, kind: 'p90', num: n('first_time_passes_exp'), ok: has('first_time_passes_exp') },
    { label: 'Decisiones %*', w: 5, kind: 'ratio', num: n('best_option_exp'), den: sum('best_option_exp', 'should_have_passed_exp'), ok: has('best_option_exp') },
    { label: 'Pases a fuera de juego por 90*', w: 5, kind: 'p90', low: true, num: n('offside_passes_exp'), ok: has('offside_passes_exp') },
  ],
};

/** Factor de dificultad de un partido: división × nivel del rival (1 si falta el dato). */
function difficultyOf(t, meanSkill) {
  const div = Number(t.club_division);
  const fDiv = Number.isInteger(div) && div >= 1 && div <= 6 ? 1 + DIV_STEP * (6 - div) : 1;
  const sk = Number(t.opponent_skill_rating);
  const fRival = sk > 0 && meanSkill ? Math.min(1 + RIVAL_CAP, Math.max(1 - RIVAL_CAP, sk / meanSkill)) : 1;
  return fDiv * fRival;
}

/**
 * Índice de un dato frente a la posición: para cada posición que jugó, su valor (con la
 * dificultad de cada partido) dividido por el promedio del club en esa posición;
 * luego se promedian las posiciones por sus minutos. Recortado a ×0,25–×2,5 por dato.
 */
function roleIndex(rows, all, spec, peers = all) {
  const valid = (t) => (spec.ok ? spec.ok(t) : true) && Number(t.seconds_played ?? 0) > 0;
  // v2.16: el promedio de la posición es el de los DEMÁS (sin él). Sin nadie más en
  // esa posición, sus minutos ahí no cuentan; con pocos partidos de los demás, la
  // comparación se acerca a 1 (peerTrust).
  const self = rows[0]?.person_id;
  const sizeF = teamSizeFactors(all, spec, valid);
  const num = (t) => spec.num(t) / sizeF(t);
  const base = new Map();
  // v2.21: el promedio de la posición sale solo de los jugadores del ranking (peers).
  for (const t of peers) {
    if (!valid(t) || !t.position || t.person_id === self) continue;
    const b = base.get(t.position) ?? { num: 0, den: 0, n: 0 };
    const mw = t._mw ?? 1; // v2.17: amistoso = ½
    b.num += mw * num(t); b.den += mw * (spec.kind === 'p90' ? Number(t.seconds_played) : spec.den(t)); b.n += mw;
    base.set(t.position, b);
  }
  const mine = new Map();
  for (const t of rows) {
    if (!valid(t) || !t.position) continue;
    const m = mine.get(t.position) ?? { num: 0, den: 0, sec: 0 };
    const mw = t._mw ?? 1;
    m.num += mw * (spec.low ? num(t) / t._d : num(t) * t._d);
    m.den += mw * (spec.kind === 'p90' ? Number(t.seconds_played) : spec.den(t));
    m.sec += mw * Number(t.seconds_played);
    mine.set(t.position, m);
  }
  let acc = 0, w = 0;
  for (const [pos, m] of mine) {
    const b = base.get(pos);
    if (!b || !b.den || !m.den) continue;
    const bv = b.num / b.den, mv = m.num / m.den;
    let r;
    if (spec.low) r = mv === 0 ? (bv === 0 ? 1 : 2.5) : bv / mv;
    else r = bv === 0 ? (mv === 0 ? 1 : 2.5) : mv / bv;
    r = Math.min(2.5, Math.max(0.25, r));
    acc += m.sec * (1 + (r - 1) * peerTrust(b.n)); w += m.sec;
  }
  return w ? 100 * (acc / w) : null;
}

// Familias de arquetipo (v2.16, aprobadas por el usuario) y su reparto de los 30
// puntos de ataque + defensa. Nombres según la comunidad (ver ARCHETYPES).
const ARCH_FAMILY = { 9: 'offensive', 10: 'offensive', 11: 'offensive', 12: 'offensive', 13: 'offensive', 6: 'balanced', 8: 'balanced', 3: 'defensive', 4: 'defensive', 5: 'defensive', 7: 'defensive' };
const ARCH_SPLIT = { offensive: { attack: 20, defense: 10 }, balanced: { attack: 15, defense: 15 }, defensive: { attack: 10, defense: 20 } };
const ARCH_FAMILY_LABEL = { offensive: 'ofensivo', balanced: 'equilibrado', defensive: 'defensivo' };
const archFamily = (id) => ARCH_FAMILY[Number(id)] ?? 'balanced';

/**
 * v2.18 (aprobado por el usuario): jugadores en cancha. Con menos humanos cada uno toca
 * más el balón y sus datos por 90 min se inflan. Para cada dato por 90, factor = lo que
 * produce el club por 90 min con ese número de humanos ÷ lo que produce en general,
 * acercado a 1 con pocos partidos (n ÷ (n + 5)) y recortado a ×0,5–×2. Los % no se ajustan.
 */
function teamSizeFactors(all, spec, valid) {
  if (spec.kind !== 'p90') return () => 1;
  const by = new Map();
  let num = 0, sec = 0;
  for (const t of all) {
    if (!valid(t)) continue;
    const k = Number(t.team_size) || 0, mw = t._mw ?? 1;
    const b = by.get(k) ?? { num: 0, sec: 0, ids: new Set() };
    b.num += mw * spec.num(t); b.sec += mw * Number(t.seconds_played); b.ids.add(t.match_id);
    by.set(k, b);
    num += mw * spec.num(t); sec += mw * Number(t.seconds_played);
  }
  const overall = sec ? num / sec : 0;
  const f = new Map();
  for (const [k, b] of by) {
    const raw = overall > 0 && b.sec ? b.num / b.sec / overall : 1;
    const n = b.ids.size; // partidos con ese número de humanos
    const shrunk = 1 + (raw - 1) * (n / (n + BEST_SHRINK_K));
    f.set(k, Math.min(2, Math.max(0.5, shrunk)));
  }
  return (t) => f.get(Number(t.team_size) || 0) ?? 1;
}

/** Confianza en el promedio de los demás en una posición: partidos de ellos ÷ (partidos + 5). */
function peerTrust(peerMatches) {
  return peerMatches > 0 ? peerMatches / (peerMatches + BEST_SHRINK_K) : 0;
}

/** Índice compuesto de un criterio: promedio ponderado de sus datos (los que faltan se omiten). */
function compositeIndex(rows, all, specs, peers = all) {
  const parts = specs.map((s) => ({ label: s.label, w: s.w, v: roleIndex(rows, all, s, peers) }));
  const ok = parts.filter((x) => x.v != null);
  const ws = ok.reduce((a, x) => a + x.w, 0);
  return { v: ws ? ok.reduce((a, x) => a + x.v * x.w, 0) / ws : null, parts };
}

/** Índices de cada criterio por persona (sin corregir) y el desglose de los compuestos. */
function bestIndices(people, timeline, peerIds = new Set(people.map((p) => p.person_id))) {
  const out = new Map(people.map((p) => [p.person_id, { sub: {} }]));
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const roster = [...matchRoster(timeline).values()];
  const meanSkill = avg(roster.map((m) => m.opp).filter((v) => v != null).map(Number));
  // Nivel (v2.13): la misma actuación vale más con una media del Pro más baja.
  // Factor = media del equipo / su media ese día, entre ×0,90 y ×1,10; se combina con la dificultad.
  // Media del partido (022, por arquetipo) si existe; si no, la foto diaria (aproximada).
  // v2.18: un partido abandonado cuenta según los minutos que duró (el mayor tiempo de
  // juego de sus jugadores ÷ 90 min). Los datos se siguen mostrando tal cual.
  const matchSec = new Map();
  for (const t of timeline) matchSec.set(t.match_id, Math.max(matchSec.get(t.match_id) ?? 0, Number(t.seconds_played ?? 0)));
  const abandonedWeight = (t) => (t.incomplete ? Math.min(1, Math.max(0.05, (matchSec.get(t.match_id) ?? 0) / 5400)) : 1);
  const withLevel = timeline.map((t) => ({ ...t, _exact: t.pro_overall != null, _ovr: t.pro_overall != null ? Number(t.pro_overall) : levelOn(t.playername, t.played_at) }));
  const meanOvr = avg(withLevel.map((t) => t._ovr).filter((v) => v != null));
  const rows = withLevel.map((t) => {
    const diff = difficultyOf(t, meanSkill);
    const lvl = t._ovr && meanOvr ? Math.min(1 + LEVEL_CAP, Math.max(1 - LEVEL_CAP, (meanOvr / t._ovr) ** LEVEL_ELASTICITY)) : 1;
    return { ...t, _diff: diff, _lvl: lvl, _d: diff * lvl, _mw: matchWeight(t) * abandonedWeight(t) };
  });
  // v2.21 (aprobado por el usuario): la calificación de EA sube con menos humanos en
  // cancha (8,13 con 2 frente a 7,17 con 3 al 18-nov). Factor por número de humanos =
  // calificación media del club con ese número ÷ la general, acercado a 1 con
  // n ÷ (n + 5) partidos y recortado a ×0,8–×1,25. _rat = calificación ÷ factor.
  {
    const by = new Map();
    let s = 0, w = 0;
    for (const t of rows) {
      if (t.rating == null) continue;
      const k = Number(t.team_size) || 0;
      const b = by.get(k) ?? { s: 0, w: 0, ids: new Set() };
      b.s += t._mw * Number(t.rating); b.w += t._mw; b.ids.add(t.match_id); by.set(k, b);
      s += t._mw * Number(t.rating); w += t._mw;
    }
    const overall = w ? s / w : 0;
    const f = new Map([...by].map(([k, b]) => {
      const raw = overall && b.w ? b.s / b.w / overall : 1;
      const n = b.ids.size;
      return [k, Math.min(1.25, Math.max(0.8, 1 + (raw - 1) * (n / (n + BEST_SHRINK_K))))];
    }));
    for (const t of rows) {
      t._sizeF = f.get(Number(t.team_size) || 0) ?? 1;
      t._rat = t.rating == null ? null : Number(t.rating) / t._sizeF;
    }
  }
  const mwOf = new Map(rows.map((t) => [t.match_id, t._mw]));
  const diffOf = new Map(rows.map((t) => [t.match_id, t._diff])); // división × rival del partido
  const byPerson = new Map();
  for (const t of rows) { if (!byPerson.has(t.person_id)) byPerson.set(t.person_id, []); byPerson.get(t.person_id).push(t); }

  // Calificación frente a la posición, con dificultad: Σ seg × (calif × d / promedio de la posición) / Σ seg.
  // v2.21 (aprobado por el usuario): los promedios por posición salen solo de los
  // jugadores con al menos el 15 % de los partidos del club y 5 PJ (peerIds), para que
  // un jugador ocasional no baje ni suba el promedio contra el que se comparan los demás.
  const peerRows = rows.filter((t) => peerIds.has(t.person_id));
  const posAvg = new Map();
  for (const t of peerRows) {
    if (t.rating == null || !t.position) continue;
    const e = posAvg.get(t.position) ?? { s: 0, n: 0 }; e.s += t._mw * t._rat; e.n += t._mw; posAvg.set(t.position, e);
  }
  for (const p of people) {
    const mine = byPerson.get(p.person_id) ?? [];
    // v2.16: promedio de los DEMÁS en la posición (se le restan sus propios partidos).
    const own = new Map();
    for (const t of mine) {
      if (t.rating == null || !t.position) continue;
      const e = own.get(t.position) ?? { s: 0, n: 0 }; e.s += t._mw * t._rat; e.n += t._mw; own.set(t.position, e);
    }
    let num = 0, den = 0;
    for (const t of mine) {
      const pa = posAvg.get(t.position), o = own.get(t.position);
      if (t.rating == null || !pa || !o) continue;
      const peerN = pa.n - o.n;
      if (peerN <= 1e-9) continue; // nadie más jugó esa posición: no cuenta
      const r = (t._rat * t._d) / ((pa.s - o.s) / peerN);
      const w = t._mw * (Number(t.seconds_played ?? 0) || 1);
      num += w * (1 + (r - 1) * peerTrust(peerN)); den += w;
    }
    const o = out.get(p.person_id);
    o.rating = den ? 100 * (num / den) : null;
    o.difficulty = avg(mine.map((t) => t._diff));
    o.level = avg(mine.map((t) => t._lvl));
    o.ovr = avg(mine.map((t) => t._ovr).filter((v) => v != null));
    o.meanOvr = meanOvr;
    o.exactLevels = mine.filter((t) => t._exact).length;
    o.levelRows = mine.length;
    // Por posición (aprobado por el usuario): los minutos de arquero se miden con la
    // defensa de arquero y no cuentan en el ataque; los de campo, con la de campo.
    // Si jugó de las dos formas, la defensa combina ambas según sus minutos.
    const field = mine.filter((t) => t.position !== 'goalkeeper');
    const keeper = mine.filter((t) => t.position === 'goalkeeper');
    const secs = (list) => list.reduce((a, t) => a + t._mw * Number(t.seconds_played ?? 0), 0);
    // Partidos efectivos (amistoso = ½) para la corrección por pocos partidos.
    o.effMatches = [...new Map(mine.map((t) => [t.match_id, t._mw])).values()].reduce((a, v) => a + v, 0);
    const att = field.length ? compositeIndex(field, rows, SUB.attack, peerRows) : null;
    o.attack = att?.v ?? null; o.sub.attack = att?.parts;
    const defF = field.length ? compositeIndex(field, rows, SUB.defense, peerRows) : null;
    const defK = keeper.length ? compositeIndex(keeper, rows, SUB.defenseGk, peerRows) : null;
    const parts = [[defF, secs(field)], [defK, secs(keeper)]].filter(([c, s]) => c?.v != null && s > 0);
    const ws = parts.reduce((a, [, s]) => a + s, 0);
    o.defense = ws ? parts.reduce((a, [c, s]) => a + c.v * s, 0) / ws : null;
    o.sub.defense = [...(defF?.parts ?? []), ...(defK?.parts ?? [])];
    o.keeperShare = mine.length ? secs(keeper) / (secs(mine) || 1) : 0;
    // v2.16: ataque y defensa (30 % entre los dos) se reparten según la familia del
    // arquetipo de cada partido de campo, por minutos. Sin arquetipo conocido: 15/15.
    const fs = secs(field);
    const share = (fam) => (fs ? secs(field.filter((t) => archFamily(t.archetype_id) === fam)) / fs : 0);
    o.families = Object.fromEntries(Object.keys(ARCH_SPLIT).map((f) => [f, share(f)]));
    o.weights = fs ? Object.fromEntries(['attack', 'defense'].map((k) => [k, Object.entries(o.families).reduce((a, [f, s]) => a + s * ARCH_SPLIT[f][k], 0)])) : null;
    const pas = compositeIndex(mine, rows, SUB.passing, peerRows);
    o.passing = pas.v; o.sub.passing = pas.parts;
  }
  // v2.16: si jugó pero nadie más jugó sus posiciones, el criterio frente a la posición queda
  // neutro (100): ni premia ni castiga. Sin esto, su peso se repartía entre el resto.
  for (const p of people) {
    const o = out.get(p.person_id);
    const mine = byPerson.get(p.person_id) ?? [];
    const hasField = mine.some((t) => t.position !== 'goalkeeper');
    const can = { rating: mine.length > 0, passing: mine.length > 0, attack: hasField, defense: mine.length > 0 };
    o.neutral = Object.keys(can).filter((k) => can[k] && o[k] == null);
    for (const k of o.neutral) o[k] = 100;
  }
  // Ubicación*: su propio % en posición (en / (en + fuera)), tal cual, sin comparar con la posición ni dificultad.
  for (const p of people) {
    const mine = (byPerson.get(p.person_id) ?? []).filter((t) => t.in_position_exp != null);
    const inPos = mine.reduce((a, t) => a + t._mw * Number(t.in_position_exp), 0);
    const outPos = mine.reduce((a, t) => a + t._mw * Number(t.out_of_position_exp ?? 0), 0);
    out.get(p.person_id).positioning = inPos + outPos > 0 ? (100 * inPos) / (inPos + outPos) : null;
  }
  // Arqueros del club en el rango: con uno solo, sus índices de arquero dan 100 (no hay con quién compararlo).
  const keepers = new Set(rows.filter((t) => t.position === 'goalkeeper').map((t) => t.person_id));
  for (const p of people) out.get(p.person_id).onlyKeeper = keepers.size === 1 && keepers.has(p.person_id);
  // Impacto: % de victorias con él menos sin él (amistoso = ½). v2.17: se corrige por el
  // menor entre partidos con él y sin él (impactN), y con menos de 5 sin él queda en 100.
  // v2.18: cada victoria vale según la división y el rival del partido (no el nivel del
  // jugador: es un resultado del equipo).
  // v2.20: % de puntos posibles (victoria 3, empate 1, derrota 0), no solo victorias.
  const POINTS = { win: 3, draw: 1, loss: 0 };
  const winPct = (list) => {
    const n = list.reduce((a, m) => a + (mwOf.get(m.id) ?? 1), 0);
    return { n, pct: n ? (100 * list.reduce((a, m) => a + (POINTS[m.outcome] ?? 0) * (mwOf.get(m.id) ?? 1) * (diffOf.get(m.id) ?? 1), 0)) / (3 * n) : null };
  };
  // v2.25 (aprobado por el usuario): con y sin él se compara SOLO entre partidos con el
  // mismo número de humanos. Cuando alguien falta hay menos humanos, y eso cambia los
  // resultados del equipo (en CILANTRO se ganaban más puntos con 2 que con 3): sin esto,
  // parte del impacto era efecto del tamaño y no del jugador. Cada tamaño pesa
  // n_con × n_sin / (n_con + n_sin); "partidos sin él" cuenta solo los comparables.
  const sizeOf = new Map(rows.map((t) => [t.match_id, Number(t.team_size) || 0]));
  const sizes = [...new Set(roster.map((m) => sizeOf.get(m.id) ?? 0))];
  for (const p of people) {
    const o = out.get(p.person_id);
    let num = 0, den = 0, nWith = 0, nWithout = 0, nMin = 0;
    for (const k of sizes) {
      const same = roster.filter((m) => (sizeOf.get(m.id) ?? 0) === k);
      const w = winPct(same.filter((m) => m.people.has(p.person_id)));
      const wo = winPct(same.filter((m) => !m.people.has(p.person_id)));
      if (!w.n || !wo.n) continue; // sin partidos con y sin él de ese tamaño: no hay comparación
      const weight = (w.n * wo.n) / (w.n + wo.n);
      num += weight * (w.pct - wo.pct); den += weight;
      nWith += w.n; nWithout += wo.n; nMin += Math.min(w.n, wo.n);
    }
    const playedAny = roster.some((m) => m.people.has(p.person_id));
    o.impactWithout = nWithout;
    o.impactN = nMin;
    if (den && nWithout >= BEST_IMPACT_MIN_WITHOUT) o.impact = 100 + num / den;
    else if (playedAny) { o.impact = 100; o.impactNeutral = true; }
    else o.impact = null;
  }
  // v2.26: el MVP se elige entre los humanos de LOS DOS equipos (verificado el
  // 2026-11-22), así que cada MVP vale según el total de humanos en cancha: nuestros
  // + del rival (023). Si falta el dato del rival, se usa el promedio de los rivales.
  const oppOf = new Map(rows.filter((t) => t.opponent_humans != null).map((t) => [t.match_id, Number(t.opponent_humans)]));
  const meanOpp = avg([...oppOf.values()]) ?? 0;
  const totalHumans = (t) => (Number(t.team_size) || 0) + (oppOf.get(t.match_id) ?? meanOpp);
  const meanTotal = avg(roster.map((m) => (sizeOf.get(m.id) ?? 0) + (oppOf.get(m.id) ?? meanOpp)).filter((v) => v > 0)) || 1;
  // MVP frente al promedio de los que entran (amistoso = ½).
  const mvpPct = (p) => {
    const mine = byPerson.get(p.person_id) ?? [];
    const n = mine.reduce((a, t) => a + t._mw, 0);
    // v2.18: cada MVP vale según la dificultad del partido y su nivel (_d), y según
    // cuántos humanos había en cancha: ganarlo entre 8 vale el doble que entre 4. Se
    // divide por el promedio para no inflar el total.
    return n ? (100 * mine.reduce((a, t) => a + (t.is_mom ? t._mw * t._d * ((totalHumans(t) || meanTotal) / meanTotal) : 0), 0)) / n : null;
  };
  const mvps = new Map(people.map((p) => [p.person_id, mvpPct(p)]));
  const mvpMean = avg([...mvps.values()].filter((v) => v != null));
  for (const p of people) { const v = mvps.get(p.person_id); out.get(p.person_id).mvp = mvpMean && v != null ? (100 * v) / mvpMean : null; }
  // Juego limpio: puntos de sanción por 90 (roja 3, amarilla* 1, penal* 1, falta* 0,25) frente al promedio.
  const sanction = (p) => {
    const mine = byPerson.get(p.person_id) ?? [];
    const sec = mine.reduce((a, t) => a + t._mw * Number(t.seconds_played ?? 0), 0);
    if (!sec) return null;
    // v2.18: lo malo se divide por la dificultad y el nivel (_d), como en los otros criterios.
    const pts = mine.reduce((a, t) => a + (t._mw / t._d) * (3 * Number(t.red_cards ?? 0) + Number(t.yellow_cards_exp ?? 0) + Number(t.penalties_conceded_exp ?? 0) + 0.25 * Number(t.fouls_exp ?? 0)), 0);
    return (pts * 5400) / sec;
  };
  const sanctions = new Map(people.map((p) => [p.person_id, sanction(p)]));
  const sMean = avg([...sanctions.values()].filter((v) => v != null));
  for (const p of people) {
    const s = sanctions.get(p.person_id);
    // ε evita dividir por cero: quien no tiene sanciones queda arriba, sin un índice infinito.
    const eps = Math.max(0.05, 0.1 * (sMean ?? 0));
    out.get(p.person_id).fairplay = s == null || sMean == null ? null : (100 * (sMean + eps)) / (s + eps);
  }
  // Regularidad: variación media del grupo / la suya (menos variación = más de 100).
  // v2.17: desviación ponderada (amistoso = ½) de sus calificaciones, calculada aquí.
  const wStd = (p) => {
    const mine = (byPerson.get(p.person_id) ?? []).filter((t) => t.rating != null);
    const n = mine.reduce((a, t) => a + t._mw, 0);
    if (mine.length < 2 || !n) return null;
    // v2.18: sobre las calificaciones ajustadas por dificultad y nivel (_d).
    const m = mine.reduce((a, t) => a + t._mw * t._rat * t._d, 0) / n;
    // v2.18: solo cuentan los partidos POR DEBAJO de su media (semidesviación): un
    // partido excepcional no le resta regularidad.
    return Math.sqrt(mine.reduce((a, t) => a + t._mw * Math.min(0, t._rat * t._d - m) ** 2, 0) / n);
  };
  const stds = new Map(people.map((p) => [p.person_id, wStd(p)]));
  const stdMean = avg([...stds.values()].filter((v) => v != null));
  for (const p of people) { const s = stds.get(p.person_id); out.get(p.person_id).regularity = s != null && s > 0 && stdMean ? (100 * stdMean) / s : null; }
  return out;
}

/** Ranking del mejor jugador con el desglose de cada criterio. */
function computeBest() {
  const clubMatches = state.ranking[0]?.club_matches ?? 0;
  const min = Math.max(1, Math.ceil(BEST_MIN_SHARE * clubMatches));
  const eligible = state.ranking.filter((r) => r.matches >= min);
  const others = state.ranking.filter((r) => r.matches < min);
  // Quiénes sirven de comparación en los promedios por posición (v2.21).
  const peerMin = Math.max(BEST_PEER_MIN, Math.ceil(BEST_PEER_SHARE * clubMatches));
  const peerIds = new Set(state.ranking.filter((r) => r.matches >= peerMin).map((r) => r.person_id));
  const idx = bestIndices(eligible, state.timeline, peerIds);
  // 1) Índice y corrección por pocos partidos de cada criterio.
  const pre = eligible.map((p) => {
    const raw = idx.get(p.person_id);
    const parts = BEST_CRITERIA.map((c) => {
      const v = raw[c.key];
      // Peso de la persona: ataque y defensa según su arquetipo (v2.16); el resto, fijo.
      const weight = raw.weights?.[c.key] ?? c.weight;
      if (v == null || !Number.isFinite(v)) return { c, weight, idx: null, adj: null, sub: raw.sub[c.key] };
      // v2.17: partidos efectivos (amistoso = ½); Impacto, por el menor entre con y sin él.
      const n = c.key === 'impact' ? raw.impactN ?? 0 : raw.effMatches ?? p.matches;
      const adj = c.absolute ? v : 100 + (v - 100) * (n / (n + BEST_SHRINK_K));
      return { c, weight, idx: v, adj, sub: raw.sub[c.key] };
    });
    return { p, raw, parts };
  });
  // 2) Dispersión de cada criterio entre los jugadores del ranking (v2.16): así cada
  //    criterio mueve el puntaje según su peso y no según lo disperso que sea.
  const spread = new Map(BEST_CRITERIA.map((c, k) => {
    const vals = pre.map((r) => r.parts[k].adj).filter((v) => v != null);
    const m = vals.reduce((a, v) => a + v, 0) / (vals.length || 1);
    const sd = Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / (vals.length || 1));
    return [c.key, Math.max(BEST_MIN_SPREAD, sd)];
  }));
  const rows = pre.map(({ p, raw, parts }) => {
    for (const x of parts) {
      if (x.adj == null) { x.score = null; continue; }
      // Absoluto (Ubicación): la nota es el % tal cual. El resto: 50 + 15 por cada
      // desviación típica sobre 100 (el promedio), recortada a 0–100.
      x.score = Math.max(0, Math.min(100, x.c.absolute ? x.adj : 50 + (BEST_NOTE_PER_SD * (x.adj - 100)) / spread.get(x.c.key)));
    }
    const used = parts.filter((x) => x.score != null);
    const wsum = used.reduce((a, x) => a + x.weight, 0);
    for (const x of parts) x.points = x.score == null || !wsum ? null : (x.score * x.weight) / wsum;
    return { p, parts, impactNeutral: raw.impactNeutral, impactWithout: raw.impactWithout, families: raw.families, neutral: BEST_CRITERIA.filter((c) => raw.neutral?.includes(c.key)).map((c) => c.label), difficulty: raw.difficulty, level: raw.level, ovr: raw.ovr, meanOvr: raw.meanOvr, exactLevels: raw.exactLevels, levelRows: raw.levelRows, keeperShare: raw.keeperShare, onlyKeeper: raw.onlyKeeper, total: wsum ? used.reduce((a, x) => a + x.points, 0) : null, missing: parts.filter((x) => x.score == null).map((x) => x.c.label) };
  }).sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  return { rows, others, min, clubMatches };
}

async function renderBest() {
  // Medias del Pro día a día del club (factor de nivel); se piden una vez por club.
  if (state.levelsClub !== state.clubId) {
    const snaps = await api.getMemberLevels(state.clubId).catch(() => []);
    state.levels = new Map();
    for (const s of snaps) {
      if (!state.levels.has(s.member_name)) state.levels.set(s.member_name, []);
      state.levels.get(s.member_name).push(s);
    }
    state.levelsClub = state.clubId;
  }
  const { rows, others, min, clubMatches } = computeBest();
  const box = $('#best-body');
  $('#best-weights').replaceChildren(...BEST_CRITERIA.map((c) => el('tr', {}, el('td', { class: 'left' }, c.label), el('td', {}, c.key === 'attack' || c.key === 'defense' ? '10–20 %' : `${c.weight} %`), el('td', { class: 'left muted small' }, c.help))));
  $('#best-min').textContent = `${min} partidos (30 % de los ${clubMatches} del club con los filtros actuales)`;
  if (!rows.length) {
    box.replaceChildren(el('p', { class: 'muted', style: 'padding: 0 18px 18px' }, `Nadie tiene todavía el mínimo de ${min} partidos (30 % de los ${clubMatches} del club con estos filtros).`));
    return;
  }
  const subLine = (sub) => (sub?.length
    ? el('div', { class: 'best-sub muted small' }, sub.map((s) => el('span', { title: s.v == null ? 'Sin dato: su peso se reparte' : null }, `${s.label} ${s.v == null ? '—' : fmtNum(s.v, 0)}`)))
    : null);
  const list = el('div', { class: 'best-list' }, rows.map((r, i) => {
    const detail = el('div', { class: 'best-detail', hidden: true },
      r.difficulty != null ? el('p', { class: 'muted small' }, `Dificultad media de sus partidos: ×${fmtNum(r.difficulty, 2)} (1,00 = 5ª división y rival de nivel medio).`) : null,
      r.level != null ? el('p', { class: 'muted small' }, r.ovr != null
        ? `Factor de nivel: ×${fmtNum(r.level, 2)} (su media del Pro, ${fmtNum(r.ovr, 0)} en promedio, frente a ${fmtNum(r.meanOvr, 0)} del equipo; más bajo = más mérito).`
        : 'Factor de nivel: ×1,00 (EA no tiene fotos de su media del Pro).') : null,
      r.levelRows ? el('p', { class: 'muted small' }, r.exactLevels === r.levelRows
        ? 'Media del Pro de cada partido: exacta en todos (la del arquetipo con que jugó).'
        : `Media del Pro exacta del partido en ${r.exactLevels} de ${r.levelRows}; en el resto, aproximada con la foto del día (puede ser la de otro arquetipo).`) : null,
      r.keeperShare > 0 ? el('p', { class: 'muted small' }, `Jugó de arquero el ${fmtNum(100 * r.keeperShare, 0)} % de sus minutos: esos minutos se miden con la defensa de arquero y no cuentan en el ataque.${r.onlyKeeper ? ' Es el único arquero del club en estos partidos: sin nadie con quién compararlo, esos minutos no cuentan en la defensa.' : ''}`) : null,
      r.impactNeutral ? el('p', { class: 'muted small' }, `Impacto en el equipo queda en 100 (ni premia ni castiga): el club jugó ${fmtNum(r.impactWithout ?? 0, Number.isInteger(r.impactWithout ?? 0) ? 0 : 1)} partidos sin él con el mismo número de humanos que cuando juega él, y hacen falta al menos ${BEST_IMPACT_MIN_WITHOUT} para comparar.`) : null,
      r.neutral?.length ? el('p', { class: 'muted small' }, `Nadie más jugó sus posiciones en estos partidos, así que no hay con quién compararlo en: ${r.neutral.join(', ')}. Quedan en 100 (el promedio): ni premian ni castigan.`) : null,
      r.families && Object.values(r.families).some((s) => s > 0) ? el('p', { class: 'muted small' }, `Ataque y defensa según su arquetipo: ${Object.entries(r.families).filter(([, s]) => s > 0).map(([f, s]) => `${ARCH_FAMILY_LABEL[f]} ${fmtNum(100 * s, 0)} %`).join(', ')} de sus minutos de campo (ofensivo 20/10, equilibrado 15/15, defensivo 10/20).`) : null,
      el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
        el('thead', {}, el('tr', {}, BEST_COLS.map(([h, tip], k) => el('th', { scope: 'col', class: k === 0 ? 'left has-tip' : 'has-tip', title: tip }, h)))),
        el('tbody', {}, r.parts.map((x) => el('tr', { title: x.c.help },
          el('td', { class: 'left' }, x.c.label, subLine(x.sub)),
          el('td', {}, x.idx == null ? '—' : fmtNum(x.idx, 0)),
          el('td', {}, x.adj == null ? '—' : fmtNum(x.adj, 0)),
          el('td', {}, x.score == null ? '—' : fmtNum(x.score, 0)),
          el('td', {}, `${fmtNum(x.weight, Number.isInteger(x.weight) ? 0 : 1)} %`),
          el('td', {}, el('strong', {}, x.points == null ? '—' : fmtNum(x.points, 1)))))))),
      r.missing.length ? el('p', { class: 'muted small' }, `Sin dato en: ${r.missing.join(', ')}. Su peso se repartió entre los demás criterios.`) : null,
      // Las explicaciones al pasar el cursor (title) no existen en el celular:
      // el mismo texto, en un desplegable que se abre tocando.
      el('details', { class: 'col-help small' },
        el('summary', {}, '¿Qué significa cada columna y cada criterio?'),
        el('dl', {}, BEST_COLS.flatMap(([h, tip]) => [el('dt', {}, h), el('dd', {}, tip)])),
        el('dl', {}, r.parts.flatMap((x) => [el('dt', {}, x.c.label), el('dd', {}, x.c.help)]))));
    const head = el('button', { type: 'button', class: 'best-row', 'aria-expanded': 'false', onclick: () => {
      detail.hidden = !detail.hidden; head.setAttribute('aria-expanded', String(!detail.hidden));
    } },
      el('span', { class: `best-place m${i + 1}` }, String(i + 1)),
      avatar(r.p.person_name),
      el('span', { class: 'best-name' }, r.p.person_name, el('span', { class: 'muted small' }, ` ${r.p.matches} PJ`)),
      el('span', { class: 'best-bar' }, el('i', { style: `width:${Math.max(2, r.total ?? 0)}%` })),
      el('span', { class: 'best-score' }, r.total == null ? '—' : fmtNum(r.total, 1)));
    return el('div', { class: 'best-item' }, head, detail);
  }));
  box.replaceChildren(...[
    list,
    others.length ? el('p', { class: 'muted small best-others' }, `Todavía sin el mínimo de ${min} partidos: ${others.map((o) => `${o.person_name} (${o.matches} PJ)`).join(', ')}.`) : null,
    clubMatches < FEW_MATCHES ? el('p', { class: 'few-data' }, `Con ${clubMatches} partidos del club, este ranking todavía puede cambiar mucho.`) : null,
  ].filter(Boolean));
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
    state.archLevels = archLevelsByPerson(timeline);
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
    if (state.view === 'best') tasks.push(renderBest());
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
  for (const v of ['ranking', 'best', 'roles', 'h2h', 'compare', 'pairs', 'matches', 'members', 'club']) $(`#view-${v}`).hidden = v !== view;
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
    el('p', { class: 'beta-note' }, el('span', { class: 'beta-tag' }, 'Beta'), ' Las pestañas, gráficas y cálculos todavía cambian y pueden moverse o desaparecer. Los datos de EA no: se guardan completos y tal cual, y no se pierden con estos cambios.'),
    ...CHANGELOG.map((v, i) => el('details', { class: 'release', open: i === 0 },
      el('summary', {},
        el('span', { class: 'release-version' }, `v${v.version}`),
        el('span', { class: 'release-title' }, v.title),
        el('span', { class: 'muted small' }, fmtDate(`${v.date}T12:00:00`, false))),
      el('ul', {}, v.changes.map((c) => el('li', {}, c))))),
    commit && /^[0-9a-f]{7,40}$/.test(commit) ? el('p', { class: 'muted small' }, `Publicación ${commit}`) : null,
  ].filter(Boolean));
}

/**
 * Mostrar/ocultar gráficas (pedido del usuario): cada gráfica ([data-chart]) tiene su
 * botón y se recuerda en este navegador; "Gráficas" en "Vista" apaga o prende todas.
 * Una gráfica oculta no tiene ancho: al mostrarla se vuelve a dibujar (refresh).
 */
function setupChartToggles() {
  const hidden = new Set(prefs.load().hiddenCharts ?? []);
  for (const box of document.querySelectorAll('[data-chart]')) {
    const id = box.id;
    const btn = el('button', { type: 'button', class: 'chart-toggle', 'aria-controls': id });
    const apply = () => {
      const off = hidden.has(id);
      box.classList.toggle('collapsed', off);
      btn.textContent = off ? '▸ Mostrar gráfica' : '▾ Ocultar gráfica';
      btn.setAttribute('aria-expanded', String(!off));
    };
    btn.addEventListener('click', () => {
      if (hidden.has(id)) hidden.delete(id); else hidden.add(id);
      prefs.save({ hiddenCharts: [...hidden] });
      apply();
      if (!hidden.has(id)) refresh();
    });
    box.before(btn);
    apply();
  }
  const sw = $('#show-charts');
  const saved = prefs.load().showCharts;
  sw.checked = saved !== false;
  document.body.classList.toggle('no-charts', !sw.checked);
  sw.addEventListener('change', () => {
    prefs.save({ showCharts: sw.checked });
    document.body.classList.toggle('no-charts', !sw.checked);
    if (sw.checked) refresh();
  });
}

/**
 * App instalable (PWA): el service worker solo deja pasar las peticiones a la red
 * (no guarda nada en caché), así nunca se ve una versión vieja. Chrome lo pide,
 * junto con manifest.webmanifest, para ofrecer "Instalar".
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  navigator.serviceWorker.register('sw.js').catch(() => { /* sin instalación: el dashboard funciona igual */ });
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
  if (!$('#show-charts').checked) opts.push('sin gráficas');
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
  setupChartToggles();
  registerServiceWorker();
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
  if (saved.scatter && RANKING_COLUMNS.some((c) => c.key === saved.scatter.x) && RANKING_COLUMNS.some((c) => c.key === saved.scatter.y)) state.scatter = { x: saved.scatter.x, y: saved.scatter.y };
  for (const [sel, key] of [['#sc-x', 'x'], ['#sc-y', 'y']]) {
    $(sel).addEventListener('change', (e) => { state.scatter = { ...state.scatter, [key]: e.target.value }; prefs.save({ scatter: state.scatter }); renderScatter(sortRows(state.ranking.filter((r) => r.matches >= state.minMatches))); });
  }
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
  // Comparar: menú de datos agrupado por tema (v2.23). * = experimental.
  {
    const sel = $('#split-metric');
    const themes = [...new Set(Object.values(METRIC).map((m) => m.theme))];
    sel.replaceChildren(...themes.map((th) => el('optgroup', { label: th },
      Object.entries(METRIC).filter(([, m]) => m.theme === th).map(([k, m]) => el('option', { value: k }, m.label)))));
    sel.value = state.splitMetric;
    sel.addEventListener('change', () => { state.splitMetric = sel.value; refresh(); });
  }
  bindSegmented('#position-buttons', 'pos', (v) => { state.position = v; refresh(); });

  renderStatus();
  setInterval(renderStatus, 60_000);
  if (location.hash === '#verificacion') route();
  else if (startH2h) setView('h2h');
  else await refresh();
}

init();
