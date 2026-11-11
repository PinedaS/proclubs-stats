// Respaldo y restauración. Supabase Free NO incluye respaldos (verificado el
// 2026-11-11), y los partidos no se pueden volver a pedir a EA: esto es la red
// de seguridad.
//
//   * exportTables(): cada tabla -> <tabla>.jsonl, ordenada por llave primaria.
//     Un JSON por línea y orden estable: git guarda solo las líneas nuevas.
//   * buildRestoreSql(): genera un .sql para pegar en el SQL Editor (o psql) de un
//     proyecto con las migraciones aplicadas. Conserva los IDs originales.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

/** En orden de dependencias (FK): así también se restauran. */
export const BACKUP_TABLES: { name: string; orderBy: string[] }[] = [
  { name: 'clubs', orderBy: ['club_id'] },
  { name: 'persons', orderBy: ['person_id'] },
  { name: 'accounts', orderBy: ['player_id'] },
  { name: 'matches', orderBy: ['match_id'] },
  { name: 'match_raw', orderBy: ['match_id'] },
  { name: 'player_match_stats', orderBy: ['match_id', 'player_id'] },
  { name: 'collector_runs', orderBy: ['run_id'] },
  { name: 'member_snapshots', orderBy: ['club_id', 'member_name', 'snapshot_date'] },
  { name: 'club_snapshots', orderBy: ['club_id', 'snapshot_date'] },
];

/** Tablas con identidad: tras restaurar hay que mover su secuencia. */
const IDENTITY_COLUMNS: Record<string, string> = { persons: 'person_id', collector_runs: 'run_id' };

const PAGE_SIZE = 1000; // máximo de filas por petición en Supabase

export async function exportTables(db: SupabaseClient, dir: string): Promise<Record<string, number>> {
  await mkdir(dir, { recursive: true });
  const counts: Record<string, number> = {};
  for (const { name, orderBy } of BACKUP_TABLES) {
    const lines: string[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = db.from(name).select('*');
      for (const col of orderBy) query = query.order(col, { ascending: true });
      const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`Respaldo de ${name}: ${error.message}`);
      for (const row of data ?? []) lines.push(JSON.stringify(row));
      if (!data || data.length < PAGE_SIZE) break;
    }
    await writeFile(join(dir, `${name}.jsonl`), lines.length ? `${lines.join('\n')}\n` : '');
    counts[name] = lines.length;
  }
  return counts;
}

/** Etiqueta de dollar-quoting que no aparezca en los datos. */
function dollarTag(text: string): string {
  for (let i = 0; ; i++) {
    const tag = `$bk${i}$`;
    if (!text.includes(tag)) return tag;
  }
}

export async function buildRestoreSql(dir: string): Promise<string> {
  const out: string[] = [
    '-- Restauración generada por collector/scripts/restore-sql.ts',
    '-- Requisito: proyecto con todas las migraciones de supabase/migrations aplicadas y tablas vacías.',
    'begin;',
  ];
  for (const { name } of BACKUP_TABLES) {
    let text: string;
    try {
      text = await readFile(join(dir, `${name}.jsonl`), 'utf8');
    } catch {
      out.push(`-- ${name}: sin archivo en el respaldo`);
      continue;
    }
    const rows = text.split('\n').filter(Boolean);
    if (rows.length === 0) {
      out.push(`-- ${name}: vacía`);
      continue;
    }
    const json = `[${rows.join(',')}]`;
    const tag = dollarTag(json);
    out.push(
      `-- ${name}: ${rows.length} filas`,
      `insert into public.${name} overriding system value`,
      `select * from jsonb_populate_recordset(null::public.${name}, ${tag}${json}${tag}::jsonb);`,
    );
  }
  for (const [table, column] of Object.entries(IDENTITY_COLUMNS)) {
    out.push(
      `select setval(pg_get_serial_sequence('public.${table}', '${column}'),`,
      `              coalesce((select max(${column}) from public.${table}), 0) + 1, false);`,
    );
  }
  out.push('commit;', '');
  return out.join('\n');
}
