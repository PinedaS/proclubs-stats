// Genera el SQL de restauración a partir de un respaldo (rama `backups`).
// Uso: node scripts/restore-sql.ts <directorio-del-respaldo> > restore.sql
import { buildRestoreSql } from '../src/backup.ts';

const dir = process.argv[2];
if (!dir) {
  console.error('Uso: node scripts/restore-sql.ts <directorio-del-respaldo> > restore.sql');
  process.exit(1);
}
process.stdout.write(await buildRestoreSql(dir));
