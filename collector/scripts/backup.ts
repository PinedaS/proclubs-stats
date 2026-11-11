// Exporta todas las tablas a <dir>/*.jsonl (lo usa .github/workflows/backup.yml).
// Uso: node --env-file-if-exists=.env scripts/backup.ts <directorio>
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKUP_TABLES, exportTables } from '../src/backup.ts';
import { createServiceClient } from '../src/repository.ts';

const dir = process.argv[2];
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dir || !url || !key) {
  console.error('Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backup.ts <directorio>');
  process.exit(1);
}

const counts = await exportTables(createServiceClient(url, key), dir);
const readme = [
  '# Respaldo de proclubs-stats',
  '',
  'Rama generada automáticamente por `.github/workflows/backup.yml` (semanal). Cada commit es un respaldo completo.',
  '',
  '| Tabla | Filas |',
  '|---|---|',
  ...BACKUP_TABLES.map(({ name }) => `| ${name} | ${counts[name]} |`),
  '',
  '## Restaurar',
  '',
  '1. Crear un proyecto de Supabase y aplicar `supabase/migrations/*.sql` (rama `main`).',
  '2. En `collector/`: `node scripts/restore-sql.ts <carpeta-de-este-respaldo> > restore.sql`.',
  '3. Ejecutar `restore.sql` en el SQL Editor (o con `psql`).',
  '',
].join('\n');
await writeFile(join(dir, 'README.md'), readme);
console.log('Respaldo:', JSON.stringify(counts));
