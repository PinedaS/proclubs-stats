// Aviso opcional a Discord cuando el colector falla seguido o se recupera.
// Lo corre collect.yml después del colector, haya fallado o no.
// Sin el secreto DISCORD_WEBHOOK_URL no hace nada (el aviso es opcional).
// Uso: node --env-file-if-exists=.env scripts/notify.ts
import { alertMessage, decideAlert, type RunStatus } from '../src/alerts.ts';
import { createServiceClient } from '../src/repository.ts';

const webhook = process.env.DISCORD_WEBHOOK_URL?.trim();
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const runUrl = process.env.RUN_URL ?? null;

if (!webhook) {
  console.log('Avisos: sin DISCORD_WEBHOOK_URL, no se envía nada.');
  process.exit(0);
}
if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhook)) {
  console.error('Avisos: DISCORD_WEBHOOK_URL no parece un webhook de Discord; no se envía nada.');
  process.exit(0);
}
if (!url || !key) {
  console.error('Avisos: faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(0);
}

const db = createServiceClient(url, key);
const { data: runs, error } = await db
  .from('collector_runs')
  .select('club_id, status, error_message, started_at')
  .order('started_at', { ascending: false })
  .limit(200);
if (error) {
  console.error(`Avisos: no se pudieron leer las ejecuciones: ${error.message}`);
  process.exit(0);
}
const { data: clubs } = await db.from('clubs').select('club_id, name');
const names = new Map((clubs ?? []).map((c: { club_id: number; name: string }) => [c.club_id, c.name]));

// Una decisión por club (las fallas antes de encontrar el club quedan sin club_id).
const byClub = new Map<number | null, { status: RunStatus; error_message: string | null }[]>();
for (const r of runs as { club_id: number | null; status: RunStatus; error_message: string | null }[]) {
  if (!byClub.has(r.club_id)) byClub.set(r.club_id, []);
  byClub.get(r.club_id)!.push(r);
}

let sent = 0;
for (const [clubId, list] of byClub) {
  const alert = decideAlert(list.map((r) => r.status));
  if (!alert) continue;
  const name = clubId == null ? 'un club configurado (no se encontró en EA)' : names.get(clubId) ?? `club ${clubId}`;
  const lastError = list.find((r) => r.status === 'error')?.error_message ?? null;
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: alertMessage(alert, name, runUrl, lastError), allowed_mentions: { parse: [] } }),
  });
  if (res.ok) sent++;
  else console.error(`Avisos: Discord respondió ${res.status}.`); // nunca se imprime la URL del webhook
}
console.log(`Avisos: ${sent} enviado(s).`);
