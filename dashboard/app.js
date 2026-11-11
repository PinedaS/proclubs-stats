// Dashboard de solo lectura. Todo el texto que viene de EA (nombres, rivales)
// se inserta como TEXTO, nunca como HTML: evita inyección de código (XSS).
import * as api from './api.js';
import { STALE_CRITICAL_MINUTES, STALE_WARNING_MINUTES } from './config.js';

const TYPE_LABEL = { leagueMatch: 'Liga', playoffMatch: 'Play-off', friendlyMatch: 'Amistoso' };
const POS_LABEL = { forward: 'Delantero', midfielder: 'Mediocampista', defender: 'Defensa', goalkeeper: 'Portero' };
const OUTCOME = {
  win: { letter: 'V', label: 'Victoria' },
  draw: { letter: 'E', label: 'Empate' },
  loss: { letter: 'D', label: 'Derrota' },
};

const state = {
  view: 'ranking',
  sort: { key: 'avg_rating', dir: -1 },
  minMatches: 1,
  ranking: [],
  personId: null,
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
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
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
  if (value == null || Number.isNaN(Number(value))) return '—';
  if (!fmtCache.has(digits)) {
    fmtCache.set(digits, new Intl.NumberFormat('es-CO', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return fmtCache.get(digits).format(Number(value));
}

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

function resultBadge(outcome, dnf) {
  const o = OUTCOME[outcome];
  if (!o) return el('span', { class: 'muted' }, '—');
  return el('span', { class: `result ${outcome}`, title: o.label + (dnf ? ' (por abandono)' : '') }, o.letter + (dnf ? '*' : ''));
}

function showError(err) {
  const box = $('#error');
  if (!err) { box.hidden = true; return; }
  box.textContent = `No se pudieron cargar los datos. ${err.message ?? err}`;
  box.hidden = false;
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
  return { types, from: day($('#from').value), to: day($('#to').value, 1) };
}

// ---------------------------------------------------------------------------
// Estado del colector
// ---------------------------------------------------------------------------

async function renderStatus() {
  const box = $('#collector-status');
  try {
    const s = await api.getCollectorStatus();
    const last = s?.last_success_at ? new Date(s.last_success_at) : null;
    const minutes = last ? (Date.now() - last.getTime()) / 60000 : Infinity;
    let level = 'good', icon = '✓', text;
    if (!last) { level = 'critical'; icon = '✕'; text = 'Sin capturas exitosas todavía'; }
    else {
      if (minutes > STALE_CRITICAL_MINUTES) { level = 'critical'; icon = '✕'; }
      else if (minutes > STALE_WARNING_MINUTES) { level = 'warning'; icon = '⚠'; }
      text = `Última captura ${fmtAgo(minutes)}`;
    }
    const failures = Number(s?.consecutive_failures ?? 0);
    if (failures > 0 && level === 'good') { level = 'warning'; icon = '⚠'; }
    box.className = `status ${level}`;
    box.replaceChildren(
      el('span', { class: 'icon', 'aria-hidden': 'true' }, icon),
      el('span', {}, text + (failures > 0 ? ` · ${failures} falla${failures === 1 ? '' : 's'} seguida${failures === 1 ? '' : 's'}` : '')),
    );
    box.title = last ? `Última captura exitosa: ${fmtDate(last.toISOString())}` : '';
  } catch (err) {
    box.className = 'status critical';
    box.replaceChildren(el('span', { class: 'icon', 'aria-hidden': 'true' }, '✕'), el('span', {}, 'Estado no disponible'));
  }
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

const RANKING_COLUMNS = [
  { key: 'person_name', label: 'Jugador', text: true, render: (r) => el('span', { class: 'person' }, r.person_name) },
  { key: 'main_position', label: 'Pos.', text: true, title: 'Posición más jugada', render: (r) => POS_LABEL[r.main_position] ?? r.main_position ?? '—' },
  { key: 'matches', label: 'PJ', title: 'Partidos jugados' },
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
];

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

function renderRanking() {
  const table = $('#ranking-table');
  const head = el('tr', {}, RANKING_COLUMNS.map((c) => {
    const active = state.sort.key === c.key;
    return el('th', {
      class: c.text ? 'left' : null,
      scope: 'col',
      title: c.title,
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
  const body = rows.length
    ? rows.map((r) => el('tr', {
        class: 'clickable',
        tabindex: '0',
        onclick: () => openPerson(r.person_id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPerson(r.person_id); } },
      }, RANKING_COLUMNS.map((c) => el('td', { class: c.text ? 'left' : null },
        c.render ? c.render(r) : fmtNum(r[c.key], c.digits ?? 0)))))
    : [el('tr', {}, el('td', { class: 'empty', colspan: RANKING_COLUMNS.length }, 'Sin datos para estos filtros.'))];

  table.replaceChildren(el('thead', {}, head), el('tbody', {}, body));
}

// ---------------------------------------------------------------------------
// Partidos
// ---------------------------------------------------------------------------

async function renderMatches(filters, requestId) {
  const table = $('#matches-table');
  const head = el('thead', {}, el('tr', {},
    el('th', { scope: 'col' }, 'Fecha'), el('th', { scope: 'col', class: 'left' }, 'Tipo'),
    el('th', { scope: 'col', class: 'left' }, 'Rival'), el('th', { scope: 'col' }, 'Marcador'),
    el('th', { scope: 'col' }, 'Resultado')));
  const matches = filters.types.length ? await api.getMatches(filters) : [];
  if (requestId !== state.requestId) return;

  const body = el('tbody');
  if (!matches.length) {
    body.append(el('tr', {}, el('td', { class: 'empty', colspan: 5 }, 'Sin partidos para estos filtros.')));
  }
  for (const m of matches) {
    const row = el('tr', { class: 'clickable', tabindex: '0', 'aria-expanded': 'false' },
      el('td', { class: 'left' }, fmtDate(m.played_at)),
      el('td', { class: 'left' }, TYPE_LABEL[m.match_type] ?? m.match_type),
      el('td', { class: 'left' }, m.opponent_name ?? '—'),
      el('td', {}, `${m.goals_for} – ${m.goals_against}`),
      el('td', {}, resultBadge(m.outcome, m.winner_by_dnf)));
    const toggle = () => toggleMatchPlayers(row, m.match_id);
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    body.append(row);
  }
  table.replaceChildren(head, body);
}

async function toggleMatchPlayers(row, matchId) {
  const next = row.nextElementSibling;
  if (next?.classList.contains('match-players')) {
    next.remove();
    row.setAttribute('aria-expanded', 'false');
    return;
  }
  row.setAttribute('aria-expanded', 'true');
  const cell = el('td', { colspan: 5 }, el('span', { class: 'muted' }, 'Cargando jugadores…'));
  row.after(el('tr', { class: 'match-players' }, cell));
  try {
    const players = await api.getMatchPlayers(matchId);
    const t = el('table', {},
      el('thead', {}, el('tr', {},
        ['Jugador', 'Pos.', 'Calif.', 'G', 'A', 'Tiros', 'Pases', 'Entradas', 'Atajadas', 'MVP'].map((h, i) =>
          el('th', { scope: 'col', class: i < 2 ? 'left' : null }, h)))),
      el('tbody', {}, players.map((p) => el('tr', {},
        el('td', { class: 'left person' }, p.person_name),
        el('td', { class: 'left' }, POS_LABEL[p.position] ?? p.position),
        el('td', {}, fmtNum(p.rating, 1)),
        el('td', {}, fmtNum(p.goals)), el('td', {}, fmtNum(p.assists)), el('td', {}, fmtNum(p.shots)),
        el('td', {}, `${p.passes_made}/${p.pass_attempts}`),
        el('td', {}, fmtNum(p.tackles_made)), el('td', {}, fmtNum(p.saves)),
        el('td', {}, p.is_mom ? '★' : '')))));
    cell.replaceChildren(t);
  } catch (err) {
    cell.replaceChildren(el('span', { class: 'muted' }, `Error: ${err.message}`));
  }
}

// ---------------------------------------------------------------------------
// Detalle de jugador
// ---------------------------------------------------------------------------

function openPerson(personId) {
  state.personId = personId;
  renderPerson(readFilters(), state.requestId).catch(showError);
}

async function renderPerson(filters, requestId) {
  const box = $('#person-detail');
  if (state.personId == null) { box.hidden = true; return; }
  const summary = state.ranking.find((r) => r.person_id === state.personId);
  const matches = filters.types.length ? await api.getPersonMatches(state.personId, filters) : [];
  if (requestId !== state.requestId) return;

  const close = el('button', { type: 'button', class: 'close', onclick: () => { state.personId = null; box.hidden = true; } }, 'Cerrar');
  const name = summary?.person_name ?? matches.at(-1)?.playername ?? 'Jugador';

  const tiles = el('div', { class: 'tiles' },
    tile('Partidos', fmtNum(summary?.matches ?? matches.length)),
    tile('Goles + asist.', fmtNum(summary?.goal_contributions)),
    tile('Calif. media', fmtNum(summary?.avg_rating, 2)),
    tile('MVP', summary ? `${fmtNum(summary.mom_pct, 1)} %` : '—'),
    tile('Pases', summary?.pass_accuracy_pct != null ? `${fmtNum(summary.pass_accuracy_pct, 1)} %` : '—'));

  const chartBox = el('div', { class: 'chart' }, el('h3', {}, 'Calificación por partido'));
  const table = el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, ['Fecha', 'Tipo', 'Rival', 'Res.', 'Pos.', 'Calif.', 'G', 'A', 'MVP'].map((h, i) =>
      el('th', { scope: 'col', class: i < 3 || i === 4 ? 'left' : null }, h)))),
    el('tbody', {}, matches.length
      ? [...matches].reverse().map((m) => el('tr', {},
          el('td', { class: 'left' }, fmtDate(m.played_at, false)),
          el('td', { class: 'left' }, TYPE_LABEL[m.match_type] ?? m.match_type),
          el('td', { class: 'left' }, m.opponent_name ?? '—'),
          el('td', {}, resultBadge(m.outcome), ` ${m.goals_for}–${m.goals_against}`),
          el('td', { class: 'left' }, POS_LABEL[m.position] ?? m.position),
          el('td', {}, fmtNum(m.rating, 1)),
          el('td', {}, fmtNum(m.goals)), el('td', {}, fmtNum(m.assists)),
          el('td', {}, m.is_mom ? '★' : '')))
      : [el('tr', {}, el('td', { class: 'empty', colspan: 9 }, 'Sin partidos para estos filtros.'))])));

  box.replaceChildren(
    el('div', { class: 'detail-head' }, el('div', {}, el('h2', {}, name),
      el('p', { class: 'subtitle' }, POS_LABEL[summary?.main_position] ?? '')), close),
    tiles, chartBox, table);
  box.hidden = false;
  drawRatingChart(chartBox, matches.filter((m) => m.rating != null));
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function tile(label, value) {
  return el('div', { class: 'tile' }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value));
}

/** Línea de calificación (una sola serie: sin leyenda; el título la nombra). */
function drawRatingChart(container, points) {
  if (points.length === 0) {
    container.append(el('p', { class: 'muted' }, 'Sin calificaciones en este rango.'));
    return;
  }
  const W = Math.max(280, container.clientWidth || 600), H = 200;
  const pad = { l: 30, r: 12, t: 10, b: 24 };
  const ratings = points.map((p) => Number(p.rating));
  const yMin = Math.max(0, Math.floor(Math.min(...ratings) - 0.5));
  const yMax = Math.min(10, Math.ceil(Math.max(...ratings) + 0.5));
  const x = (i) => points.length === 1 ? (pad.l + W - pad.r) / 2 : pad.l + (i * (W - pad.l - pad.r)) / (points.length - 1);
  const y = (v) => pad.t + ((yMax - v) * (H - pad.t - pad.b)) / (yMax - yMin || 1);

  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Calificación en ${points.length} partidos, entre ${yMin} y ${yMax}` });
  for (let v = yMin; v <= yMax; v++) {
    chart.append(svg('line', { class: 'gridline', x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }));
    const label = svg('text', { class: 'axis-label', x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end' });
    label.textContent = String(v);
    chart.append(label);
  }
  const first = svg('text', { class: 'axis-label', x: x(0), y: H - 6, 'text-anchor': points.length === 1 ? 'middle' : 'start' });
  first.textContent = fmtDate(points[0].played_at, false);
  chart.append(first);
  if (points.length > 1) {
    const last = svg('text', { class: 'axis-label', x: x(points.length - 1), y: H - 6, 'text-anchor': 'end' });
    last.textContent = fmtDate(points.at(-1).played_at, false);
    chart.append(last);
  }
  chart.append(svg('path', { class: 'line', d: points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(Number(p.rating))}`).join('') }));
  if (points.length <= 40) {
    points.forEach((p, i) => chart.append(svg('circle', { class: 'dot', cx: x(i), cy: y(Number(p.rating)), r: 4 })));
  }

  // Capa de hover: línea guía + punto resaltado + tooltip.
  const cross = svg('line', { class: 'crosshair', y1: pad.t, y2: H - pad.b, visibility: 'hidden' });
  const focus = svg('circle', { class: 'dot', r: 6, visibility: 'hidden' });
  const hit = svg('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' });
  chart.append(cross, focus, hit);
  const tip = el('div', { class: 'tooltip', hidden: true });

  const onMove = (ev) => {
    const rect = chart.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * W;
    let i = 0;
    for (let k = 1; k < points.length; k++) if (Math.abs(x(k) - px) < Math.abs(x(i) - px)) i = k;
    const p = points[i];
    for (const [node, attrs] of [[cross, { x1: x(i), x2: x(i) }], [focus, { cx: x(i), cy: y(Number(p.rating)) }]]) {
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      node.setAttribute('visibility', 'visible');
    }
    tip.replaceChildren(
      el('div', {}, el('strong', {}, fmtNum(p.rating, 1)), ` · ${OUTCOME[p.outcome]?.label ?? ''} ${p.goals_for}–${p.goals_against}`),
      el('div', { class: 'muted' }, `${fmtDate(p.played_at, false)} · ${p.opponent_name ?? ''}`),
      el('div', {}, `G ${p.goals} · A ${p.assists}${p.is_mom ? ' · ★ MVP' : ''}`));
    tip.hidden = false;
    // Coordenadas relativas al contenedor (que también incluye el título).
    const box = container.getBoundingClientRect();
    const left = rect.left - box.left + (x(i) / W) * rect.width;
    const top = rect.top - box.top + (y(Number(p.rating)) / H) * rect.height;
    tip.style.left = `${Math.min(Math.max(left - 70, 0), box.width - 170)}px`;
    tip.style.top = `${top + 14}px`;
  };
  const onLeave = () => { cross.setAttribute('visibility', 'hidden'); focus.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  hit.addEventListener('pointermove', onMove);
  hit.addEventListener('pointerleave', onLeave);

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
    state.ranking = filters.types.length ? await api.getPersonStats(filters) : [];
    if (requestId !== state.requestId) return;
    renderRanking();
    const tasks = [];
    if (state.view === 'matches') tasks.push(renderMatches(filters, requestId));
    if (state.personId != null) tasks.push(renderPerson(filters, requestId));
    await Promise.all(tasks);
  } catch (err) {
    if (requestId === state.requestId) showError(err);
  }
}

function setView(view) {
  state.view = view;
  for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  $('#view-ranking').hidden = view !== 'ranking';
  $('#view-matches').hidden = view !== 'matches';
  if (view === 'matches') refresh();
}

async function init() {
  for (const input of document.querySelectorAll('input[name="type"], #from, #to')) {
    input.addEventListener('change', refresh);
  }
  $('#min-matches').addEventListener('input', (e) => {
    state.minMatches = Math.max(1, Number(e.target.value) || 1);
    renderRanking();
  });
  for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => setView(b.dataset.view));

  api.getClub().then((club) => {
    if (!club) return;
    $('#club-name').textContent = club.name;
    $('#club-season').textContent = `EA FC 27 · Clubes · temporada ${club.season}`;
    document.title = `${club.name} · Stats EA FC 27`;
  }).catch(() => {});

  renderStatus();
  setInterval(renderStatus, 60_000);
  await refresh();
}

init();
