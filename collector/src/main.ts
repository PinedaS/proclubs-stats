// Punto de entrada: arma las dependencias reales y define el código de salida.
// Recorre todos los clubes configurados; la falla de uno NO impide capturar los
// demás, pero el proceso sale con código 1 para que GitHub Actions lo marque.
import { collect, type Logger } from './collect.ts';
import { loadConfig } from './config.ts';
import { EaMatchSource } from './ea-source.ts';
import { SupabaseStatsRepository, createServiceClient } from './repository.ts';

const log: Logger = {
  info: (msg) => console.log(`[${new Date().toISOString()}] ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] ERROR ${msg}`),
};

try {
  const config = loadConfig();
  const repo = new SupabaseStatsRepository(createServiceClient(config.supabaseUrl, config.supabaseServiceRoleKey));
  const source = new EaMatchSource(config.platform);

  for (const clubName of config.clubNames) {
    const prefix = `[${clubName}]`;
    const clubLog: Logger = { info: (m) => log.info(`${prefix} ${m}`), error: (m) => log.error(`${prefix} ${m}`) };
    try {
      const result = await collect({ config: { ...config, clubName }, source, repo, log: clubLog });
      clubLog.info(`Fin: ${result.status}, ${result.matchesSeen} vistos, ${result.matchesNew} nuevos`);
      if (result.status !== 'success') {
        clubLog.error(result.errorMessage ?? 'falla sin detalle');
        process.exitCode = 1;
      }
    } catch (err) {
      // collect() ya registró la falla en collector_runs; seguimos con el siguiente club.
      clubLog.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      process.exitCode = 1;
    }
  }
} catch (err) {
  log.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  process.exitCode = 1;
}
