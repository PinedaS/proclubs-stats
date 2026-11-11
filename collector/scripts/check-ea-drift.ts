// Detección de cambios en la API de EA (lo usa .github/workflows/ea-drift.yml).
// Usa runCompatibilityCheck() de proclubs-sdk: consulta los endpoints reales y
// compara sus respuestas con los contratos del SDK.
// Sale con código 1 si hay cambios que requieren revisión, para que GitHub avise.
import { appendFile } from 'node:fs/promises';
import { runCompatibilityCheck } from 'proclubs-sdk';

const result = await runCompatibilityCheck({
  platform: 'common-gen5',
  searchQuery: process.env.EA_CLUB_NAME || 'Aston Huila',
  timeoutMs: 20_000,
});
const { report } = result;

const lines = [
  `## Compatibilidad con la API de EA (${report.timestamp})`,
  '',
  `Estado: **${report.summary.status}** · Recomendación del SDK: **${report.summary.recommendation}**`,
  result.stoppedEarly ? `Detenido antes de terminar: ${result.stopReason ?? 'sin motivo'}` : '',
  '',
  '| Endpoint | Estado | Cambios |',
  '|---|---|---|',
  ...Object.values(report.endpoints).map((e) => {
    // Agrupa por tipo de cambio y campo (sin índices de arreglo) para no repetir cien veces lo mismo.
    const groups = new Map<string, number>();
    for (const i of e.issues) {
      const key = `${i.kind} \`${i.path.replace(/\[\d+\]/g, '[]')}\``;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    const text = [...groups].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join('<br>') || '—';
    return `| ${e.endpoint} | ${e.status} | ${text} |`;
  }),
  '',
  '`unknown_value` = un código que el SDK no sabe traducir (p. ej. una región nueva). No rompe nada.',
];
const md = lines.filter((l) => l !== null).join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);

// Campos nuevos (field_added) no rompen nada; quitados o con otro tipo, sí.
const breaking = Object.values(report.endpoints)
  .flatMap((e) => e.issues)
  .filter((i) => i.kind === 'field_removed' || i.kind === 'type_changed' || i.kind === 'envelope_changed');
if (breaking.length > 0 || report.summary.status === 'stopped') {
  console.error(`Cambios que pueden romper el colector: ${breaking.length}`);
  process.exit(1);
}
