// Punto de entrada: arma las dependencias reales y define el código de salida.
// Código distinto de 0 si algo falló, para que GitHub Actions marque la ejecución.
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

  const result = await collect({ config, source, repo, log });
  log.info(`Fin: ${result.status}, ${result.matchesSeen} vistos, ${result.matchesNew} nuevos`);
  if (result.status !== 'success') {
    log.error(result.errorMessage ?? 'falla sin detalle');
    process.exitCode = 1;
  }
} catch (err) {
  log.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  process.exitCode = 1;
}
