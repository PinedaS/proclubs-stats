// Dashboard de solo lectura. Todo el texto que viene de EA (nombres, rivales)
// se inserta como TEXTO, nunca como HTML: evita inyección de código (XSS).
import * as api from './api.js?v=__V__';
import { STALE_CRITICAL_MINUTES, STALE_WARNING_MINUTES } from './config.js?v=__V__';

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
  showExp: true,
  showAdv: true,
  ranking: [],
  records: new Map(),
  members: null,
  clubSnaps: null,
  personId: null,
  split: 'rival',
  splitMetric: 'avg_rating',
  position: 'forward',
  roleGroup: 'position',
  roleSort: { key: 'rating_idx', dir: -1 },
  relative: new Map(),
  clubs: [],
  clubId: null, // club seleccionado (todas las consultas se filtran por él)
  requestId: 0,
};

const $ = (sel) => document.querySelector(sel);

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

const avatar = (name, big = false) => el('span', { class: big ? 'avatar lg' : 'avatar', 'aria-hidden': 'true' }, initials(name));
const POS_SHORT = { forward: 'DEL', midfielder: 'MED', defender: 'DEF', goalkeeper: 'POR' };
/** Insignia de posición: texto completo en escritorio, abreviado en el celular (CSS). */
const posBadge = (pos) => (pos ? el('span', { class: `badge pos-${pos}`, title: POS_LABEL[pos] ?? pos },
  el('span', { class: 'pos-long' }, POS_LABEL[pos] ?? pos), el('span', { class: 'pos-short' }, POS_SHORT[pos] ?? pos)) : null);
const platformLabel = (p) => PLATFORM_LABEL[p] ?? p;

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

async function renderStatus() {
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
    $('#club-season').textContent = `Temporada ${club.season}`;
    document.title = `${club.name} · Stats EA FC 27`;
  }
  const last = snaps.at(-1);
  const first = snaps[0];
  const delta = last && first && last.skill_rating != null && first.skill_rating != null ? last.skill_rating - first.skill_rating : null;
  const capturedMatches = state.ranking[0]?.club_matches;
  $('#club-kpis').replaceChildren(
    kpi('Nivel del club', fmtNum(last?.skill_rating),
      delta == null || snaps.length < 2 ? 'skillRating de EA' : `${fmtSigned(delta)} desde ${fmtDate(`${first.snapshot_date}T12:00:00Z`, false)}`,
      delta > 0 ? 'up' : delta < 0 ? 'down' : null),
    kpi('División', last?.current_division != null ? `${last.current_division}ª` : '—', last?.best_division != null ? `Mejor: ${last.best_division}ª` : null),
    kpi('Puntos de liga', fmtNum(last?.season_points), last?.season_games != null ? `${last.season_games} partidos de temporada` : null),
    kpi('Temporada V-E-D', last?.season_wins != null ? `${last.season_wins}-${last.season_draws}-${last.season_losses}` : '—',
      last?.season_goals != null ? `Goles ${last.season_goals} : ${last.season_goals_against}` : null),
    kpi('Racha', last?.unbeaten_streak != null ? `${last.unbeaten_streak} sin perder` : '—', last?.win_streak ? `${last.win_streak} victorias seguidas` : null),
    kpi('Partidos capturados', fmtNum(capturedMatches), 'con los filtros actuales'),
  );
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
  { key: 'goals', label: 'G', title: 'Goles' },
  { key: 'assists', label: 'A', title: 'Asistencias' },
  { key: 'goal_contributions', label: 'G+A', title: 'Goles + asistencias' },
  { key: 'ga_per_match', label: 'G+A/PJ', title: 'Goles + asistencias por partido', digits: 2 },
  { key: 'avg_rating', label: 'Calif.', title: 'Calificación media de EA', digits: 2 },
  { key: 'mom_pct', label: 'MVP %', title: 'Porcentaje de partidos como mejor jugador', digits: 1 },
  { key: 'pass_accuracy_pct', label: 'Pases %', title: 'Pases completados / intentados', digits: 1 },
  { key: 'tackle_success_pct', label: 'Entradas %', title: 'Entradas ganadas / intentadas', digits: 1 },
  { key: 'saves', label: 'Atajadas' },
  { key: 'red_cards', label: 'Rojas', title: 'Tarjetas rojas' },
  // Avanzadas: calculadas con datos oficiales.
  { key: 'minutes_played', label: 'Min.', title: 'Minutos jugados (tiempo de juego)', adv: true },
  { key: 'goals_per90', label: 'G/90', title: 'Goles por cada 90 minutos', digits: 2, adv: true },
  { key: 'assists_per90', label: 'A/90', title: 'Asistencias por cada 90 minutos', digits: 2, adv: true },
  { key: 'ga_per90', label: 'G+A/90', title: 'Goles + asistencias por cada 90 minutos', digits: 2, adv: true },
  { key: 'shot_conversion_pct', label: 'Conv. %', title: 'Goles / tiros', digits: 1, adv: true },
  { key: 'goal_participation_pct', label: 'Part. goles %', title: '(Goles + asistencias) / goles del equipo en sus partidos', digits: 1, adv: true },
  { key: 'goal_diff', label: 'Dif. goles', title: 'Goles a favor menos en contra en los partidos que jugó', adv: true, render: (r) => fmtSigned(r.goal_diff) },
  { key: 'attendance_pct', label: 'Presencia %', title: 'Partidos jugados / partidos del club en el rango filtrado', digits: 1, adv: true },
  { key: 'form_rating', label: 'Forma', title: 'Calificación media de sus últimos 5 partidos', digits: 2, adv: true },
  { key: 'rating_stddev', label: 'Variación', title: 'Desviación de su calificación: más bajo = más regular', digits: 2, adv: true },
  { key: 'clean_sheets', label: 'Vallas', title: 'Vallas invictas (defensa + portero)', adv: true },
  { key: 'save_pct', label: '% Atajadas', title: 'Porteros: atajadas / (atajadas + goles recibidos)', digits: 1, adv: true },
  { key: 'avg_opponent_skill', label: 'Nivel rival', title: 'Nivel medio (skillRating) de los rivales que enfrentó', adv: true },
  { key: 'avg_team_size', label: 'Jug. prom.', title: 'Jugadores del club en cancha, en promedio', digits: 1, adv: true },
  { key: 'incomplete_matches', label: 'Incompl.', title: 'Partidos incompletos (abandono o < 90 % del tiempo)', adv: true },
  // Experimentales: contadores sin documentar de EA (ver nota al pie del dashboard).
  { key: 'shot_accuracy_exp_pct', label: 'A puerta %*', title: 'Experimental: tiros a puerta / tiros (códigos EA 217 y 218)', digits: 1, exp: true },
  { key: 'second_assists_exp', label: '2ª asist.*', title: 'Experimental: segundas asistencias (código EA 115)', exp: true },
  { key: 'dribbles_exp', label: 'Regates*', title: 'Experimental: regates completados (código EA 174)', exp: true },
  { key: 'interceptions_exp', label: 'Intercep.*', title: 'Experimental: intercepciones (código EA 6)', exp: true },
  { key: 'possession_won_exp', label: 'Recup.*', title: 'Experimental: posesiones ganadas (códigos EA 108–110)', exp: true },
  { key: 'possession_lost_exp', label: 'Pérdidas*', title: 'Experimental: posesiones perdidas (códigos EA 105–107)', exp: true },
  { key: 'aerial_duels_won_exp', label: 'Aéreos*', title: 'Experimental: duelos aéreos ganados (códigos EA 265–266)', exp: true },
  { key: 'forward_pass_pct_exp', label: 'Pase adel. %*', title: 'Experimental: pases hacia adelante completados (códigos EA 30 y 31)', digits: 1, exp: true },
  { key: 'through_passes_exp', label: 'Filtrados*', title: 'Experimental: pases filtrados (código EA 152)', exp: true },
  { key: 'cross_pct_exp', label: 'Centros %*', title: 'Experimental: centros completados (códigos EA 36 y 37)', digits: 1, exp: true },
  { key: 'in_position_pct_exp', label: 'En posición %*', title: 'Experimental: veces en posición / (en + fuera de posición) (códigos EA 111 y 219)', digits: 1, exp: true },
  { key: 'best_option_pct_exp', label: 'Decisiones %*', title: 'Experimental: "tomó la mejor opción" / (mejor + "debió pasar a otro") (códigos EA 177 y 182)', digits: 1, exp: true },
  { key: 'fouls_exp', label: 'Faltas*', title: 'Experimental: faltas cometidas (códigos EA 2 y 3)', exp: true },
  { key: 'fouls_won_exp', label: 'F. recibidas*', title: 'Experimental: faltas recibidas (código EA 4)', exp: true },
  { key: 'offsides_exp', label: 'Fuera lugar*', title: 'Experimental: fueras de juego (código EA 104; tiende a contar de menos)', exp: true },
  { key: 'penalties_conceded_exp', label: 'Penales*', title: 'Experimental: penales cometidos (código EA 94)', exp: true },
  { key: 'yellow_cards_exp', label: 'Amarillas*', title: 'Experimental: tarjetas amarillas (códigos EA 95 y 213)', exp: true },
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

function renderPodium(rows) {
  const col = RANKING_COLUMNS.find((c) => c.key === state.sort.key);
  const box = $('#podium');
  if (!col || col.text || rows.length < 3) { box.replaceChildren(); return; }
  const top = rows.filter((r) => r[col.key] != null).slice(0, 3);
  if (top.length < 3) { box.replaceChildren(); return; }
  box.replaceChildren(...top.map((r, i) => el('div', { class: `podium-card p${i + 1}`, ...onActivate(() => openPerson(r.person_id)), 'aria-label': `${i + 1}º ${r.person_name}` },
    el('div', { class: 'medal' }, String(i + 1)),
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
  const body = rows.length
    ? rows.map((r, i) => el('tr', { class: 'clickable', ...onActivate(() => openPerson(r.person_id)) },
        el('td', { class: 'rank' }, String(i + 1)),
        columns.map((c) => el('td', { class: cellClass(c, c.key === state.sort.key && !c.text ? 'sorted' : '') },
          c.render ? c.render(r) : fmtNum(r[c.key], c.digits ?? 0)))))
    : [emptyRow(columns.length + 1)];
  // La columna "#" va primero y es la fija; el nombre queda justo después.
  table.replaceChildren(el('thead', {}, head), el('tbody', {}, body));
}

// ---------------------------------------------------------------------------
// Por rol: rendimiento relativo al promedio del club en cada posición/arquetipo
// ---------------------------------------------------------------------------

const roleLabel = (group, key) => (group === 'archetype' ? (key === '?' ? 'Arquetipo ?' : `Arquetipo #${key}`) : POS_LABEL[key] ?? key);

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
        : roles.map((a) => [el('span', { class: 'badge' }, roleLabel(group, a)), ' '])),
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
  const head = el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Jugador'),
    buckets.map((b) => el('th', { scope: 'col' }, b))));
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
  const cols = ['Fecha', 'Tipo', 'Rival', 'Nivel rival', 'Div.', 'Jug.', 'Marcador', 'Res.'];
  const body = el('tbody');
  if (!shown.length) body.append(emptyRow(cols.length, 'Sin partidos para estos filtros.'));
  for (const m of shown) {
    const f = flags.get(m.match_id);
    const row = el('tr', { class: 'clickable', 'aria-expanded': 'false' },
      el('td', { class: 'left' }, fmtDate(m.played_at)),
      el('td', { class: 'left' }, el('span', { class: 'badge' }, TYPE_LABEL[m.match_type] ?? m.match_type)),
      el('td', { class: 'left' }, m.opponent_name ?? '—', f?.incomplete ? [' ', el('span', { class: 'badge warn', title: 'Abandono o menos del 90 % del tiempo' }, 'incompleto')] : null),
      el('td', {}, fmtNum(m.opponent_skill_rating)),
      el('td', { title: 'División del club ese día (según la foto diaria del club)' }, f?.club_division != null ? `${f.club_division}ª` : '—'),
      el('td', { title: 'Jugadores del club en cancha' }, fmtNum(f?.team_size)),
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
    const players = await api.getMatchPlayers(matchId);
    cell.replaceChildren(el('table', { class: 'data' },
      el('thead', {}, el('tr', {},
        ['Jugador', 'Pos.', 'Calif.', 'G', 'A', 'Tiros', 'Pases', 'Entradas', 'Atajadas', 'MVP'].map((h, i) => el('th', { scope: 'col', class: i < 2 ? 'left' : null }, h)),
        state.showExp ? ['Regates*', 'Intercep.*'].map((h) => el('th', { scope: 'col', class: 'exp' }, h)) : null)),
      el('tbody', {}, players.map((p) => el('tr', { class: 'clickable', ...onActivate(() => openPerson(p.person_id)) },
        el('td', {}, playerCell(p.person_name, p.platform ? platformLabel(p.platform) : null)),
        el('td', { class: 'left' }, posBadge(p.position)),
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
    tooltip: (s) => [el('div', {}, el('strong', {}, `Nivel ${fmtNum(s.skill_rating)}`), s.current_division != null ? ` · ${s.current_division}ª división` : ''),
      el('div', { class: 'muted' }, fmtDate(`${s.snapshot_date}T12:00:00Z`, false))],
  });
  const last = snaps.at(-1);
  $('#club-season-card').replaceChildren(last
    ? el('div', { class: 'season-grid' },
        tile('Puntos', fmtNum(last.season_points)),
        tile('División', last.current_division != null ? `${last.current_division}ª` : '—'),
        tile('Partidos', fmtNum(last.season_games)),
        tile('V-E-D', last.season_wins != null ? `${last.season_wins}-${last.season_draws}-${last.season_losses}` : '—'),
        tile('Goles', last.season_goals != null ? `${last.season_goals} : ${last.season_goals_against}` : '—'),
        tile('Ascensos', fmtNum(last.promotions)), tile('Descensos', fmtNum(last.relegations)),
        tile('Histórico V-E-D', last.wins != null ? `${last.wins}-${last.draws}-${last.losses}` : '—'))
    : el('p', { class: 'muted', style: 'padding: 0 18px 18px' }, 'Sin fotos del club todavía.'));
}

// ---------------------------------------------------------------------------
// Detalle de jugador
// ---------------------------------------------------------------------------

function openPerson(personId) {
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
        el('th', { scope: 'col', title: '100 = promedio del club en esa posición' }, 'Índice vs. la posición'),
        el('th', { scope: 'col', title: 'Cómo se reparte su perfil (goles, asistencias, tiros, pases, entradas, atajadas, intercepciones* y regates* por 90 min) entre las posiciones, según qué tan cerca está del perfil de los demás jugadores en cada una. Suma 100 %.' }, 'Parecido de perfil'))),
      el('tbody', {}, rows.map((f) => el('tr', { class: f === best && played.length >= 2 ? 'fit-best' : null },
        el('td', { class: 'left' }, posBadge(f.player_position)),
        el('td', {}, fmtNum(f.matches)),
        el('td', {}, fmtNum(f.rating, 2)),
        idxCell(f.rating_idx),
        el('td', { title: f.others_matches < MIN_FIT_MATCHES ? 'Pocos datos de otros jugadores en esa posición' : null },
          f.profile_match_pct == null || f.others_matches < MIN_FIT_MATCHES ? '—' : fmtPct(f.profile_match_pct, 0))))))),
    el('p', { class: 'muted small' }, `Orientativo. El índice solo cuenta posiciones con ${MIN_FIT_MATCHES}+ PJ. El parecido de perfil compara su forma de jugar con la de los demás jugadores del club en cada posición (no consigo mismo) y solo usa posiciones donde los demás suman ${MIN_FIT_MATCHES}+ registros.`));
}

function tile(label, value, cls = '') {
  return el('div', { class: `tile ${cls}`.trim() }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value));
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
    tile('Dif. de goles', fmtSigned(summary?.goal_diff)),
    tile('Nivel rival medio', fmtNum(summary?.avg_opponent_skill))) : null;
  const records = rec ? el('div', { class: 'tiles' },
    tile('Más goles en un partido', fmtNum(rec.max_goals_match), 'record'),
    tile('Hat-tricks', fmtNum(rec.hat_tricks), 'record'),
    tile('Mejor calificación', fmtNum(rec.best_rating, 1), 'record'),
    tile('Racha goleadora', `${fmtNum(rec.longest_scoring_streak)} PJ`, 'record'),
    tile('Racha de MVP', `${fmtNum(rec.longest_mom_streak)} PJ`, 'record'),
    tile('Mayor invicto', `${fmtNum(rec.longest_unbeaten_streak)} PJ`, 'record'),
    tile('Invicto actual', `${fmtNum(rec.current_unbeaten_streak)} PJ`, 'record')) : null;

  const chartBox = el('div', { class: 'chart' }, el('h3', {}, 'Calificación por partido'));
  const overallBox = el('div', { class: 'chart' }, el('h3', {}, 'Media del Pro (EA), día a día'));
  const table = el('div', { class: 'table-wrap' }, el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, ['Fecha', 'Tipo', 'Rival', 'Res.', 'Pos.', 'Calif.', 'G', 'A', 'MVP'].map((h, i) =>
      el('th', { scope: 'col', class: i < 3 || i === 4 ? 'left' : null }, h)),
      state.showExp ? ['Regates*', 'Intercep.*', 'Recup.*', 'Pérdidas*'].map((h) => el('th', { scope: 'col', class: 'exp' }, h)) : null)),
    el('tbody', {}, matches.length
      ? [...matches].reverse().map((m) => el('tr', {},
          el('td', { class: 'left' }, fmtDate(m.played_at, false)),
          el('td', { class: 'left' }, el('span', { class: 'badge' }, TYPE_LABEL[m.match_type] ?? m.match_type)),
          el('td', { class: 'left' }, m.opponent_name ?? '—', m.incomplete ? [' ', el('span', { class: 'badge warn' }, 'incompleto')] : null),
          el('td', {}, resultBadge(m.outcome), ` ${m.goals_for}–${m.goals_against}`),
          el('td', { class: 'left' }, posBadge(m.position)),
          el('td', {}, el('strong', {}, fmtNum(m.rating, 1))),
          el('td', {}, fmtNum(m.goals)), el('td', {}, fmtNum(m.assists)),
          el('td', {}, m.is_mom ? '★' : ''),
          state.showExp ? [m.dribbles_exp, m.interceptions_exp, m.possession_won_exp, m.possession_lost_exp].map((v) => el('td', { class: 'exp' }, fmtNum(v))) : null))
      : [emptyRow(state.showExp ? 13 : 9, 'Sin partidos para estos filtros.')])));

  // replaceChildren no aplana listas: se aplanan y se quitan los null aquí.
  box.replaceChildren(...[
    el('div', { class: 'detail-head' },
      el('div', { class: 'detail-id' }, avatar(name, true), el('div', {}, el('h2', {}, name),
        el('div', { class: 'badges' }, posBadge(summary?.main_position), platforms.map((p) => el('span', { class: 'badge' }, platformLabel(p))),
          summary?.pro_overall != null ? el('span', { class: 'badge', title: 'Media (overall) del Pro según EA' }, `Media ${summary.pro_overall}`) : null,
          summary?.pro_name ? el('span', { class: 'badge', title: 'Nombre del personaje' }, summary.pro_name) : null))),
      close),
    el('p', { class: 'section-title' }, 'Resumen'), basics,
    relTiles ? [el('p', { class: 'section-title' }, 'Relativo a su rol (100 = promedio de su posición)'), relTiles] : null,
    fit ? [el('p', { class: 'section-title' }, 'Posición recomendada'), fit] : null,
    advanced ? [el('p', { class: 'section-title' }, 'Avanzadas'), advanced] : null,
    records ? [el('p', { class: 'section-title' }, 'Récords y rachas'), records] : null,
    el('div', { class: 'grid-2' }, chartBox, overallBox),
    el('p', { class: 'section-title' }, 'Partidos'), table,
  ].flat().filter(Boolean));
  box.hidden = false;
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
    const [ranking, records, relative] = filters.types.length
      ? await Promise.all([api.getPersonStats(filters), api.getPersonRecords(filters), api.getRelativeStats('position', filters)])
      : [[], [], []];
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
    state.records = new Map(records.map((r) => [r.person_id, r]));
    renderReconAlert().catch(() => {});
    state.relative = new Map(relative.map((r) => [r.person_id, r]));
    renderRanking();
    renderHeader().catch(() => {});
    const tasks = [];
    if (state.view === 'roles') tasks.push(renderRoles(filters, requestId));
    if (state.view === 'compare') tasks.push(renderCompare(filters, requestId));
    if (state.view === 'pairs') tasks.push(renderPairs(filters, requestId));
    if (state.view === 'positions') tasks.push(renderPositions(filters, requestId));
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
  for (const v of ['ranking', 'roles', 'compare', 'pairs', 'positions', 'matches', 'members', 'club']) $(`#view-${v}`).hidden = v !== view;
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

/** Resumen de los filtros activos (se ve en el celular, con los filtros plegados). */
function updateFiltersSummary() {
  const f = readFilters();
  const types = f.types.length === 3 ? 'Todos los tipos' : f.types.map((t) => TYPE_LABEL[t]).join(', ') || 'Ningún tipo';
  const parts = [types];
  if ($('#from').value || $('#to').value) parts.push('fechas');
  if (f.excludeIncomplete) parts.push('sin incompletos');
  if (state.minMatches > 1) parts.push(`mín. ${state.minMatches} PJ`);
  $('#filters-summary-text').textContent = parts.join(' · ');
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
  // En el celular los filtros arrancan plegados para dejar ver los datos primero.
  if (window.matchMedia('(max-width: 700px)').matches) $('#filters-box').open = false;
  document.querySelector('.filters').addEventListener('change', updateFiltersSummary);
  updateFiltersSummary();
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
  $('#show-exp').addEventListener('change', (e) => { state.showExp = e.target.checked; if (!state.showExp) resetSortIf('exp'); refresh(); });
  $('#show-adv').addEventListener('change', (e) => { state.showAdv = e.target.checked; if (!state.showAdv) resetSortIf('adv'); refresh(); });
  bindSegmented('#role-group-buttons', 'group', (v) => { state.roleGroup = v; refresh(); });
  bindSegmented('#split-buttons', 'split', (v) => { state.split = v; refresh(); });
  bindSegmented('#split-metric', 'metric', (v) => { state.splitMetric = v; refresh(); });
  bindSegmented('#position-buttons', 'pos', (v) => { state.position = v; refresh(); });

  renderStatus();
  setInterval(renderStatus, 60_000);
  if (location.hash === '#verificacion') route();
  else await refresh();
}

init();
