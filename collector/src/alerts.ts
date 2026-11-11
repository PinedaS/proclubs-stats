// Decide si avisar a Discord según las últimas ejecuciones de UN club.
// Lógica pura (sin red): se prueba con listas de estados.

export type RunStatus = 'success' | 'error' | 'running';

export interface Alert {
  kind: 'failing' | 'recovered';
  /** Fallas seguidas (en 'recovered': las que hubo antes de volver a funcionar). */
  failures: number;
}

/** Primer aviso a la 3.ª falla seguida (~45 min); luego, uno cada 24 fallas (~6 h). */
export const FIRST_ALERT_AT = 3;
export const REPEAT_EVERY = 24;

/**
 * @param statuses estados de las ejecuciones terminadas, de la MÁS RECIENTE a la más vieja.
 * Avisa solo en momentos puntuales para no llenar el canal:
 *  - la falla número 3, 27, 51…;
 *  - la primera ejecución exitosa después de 3 o más fallas.
 */
export function decideAlert(statuses: readonly RunStatus[]): Alert | null {
  const done = statuses.filter((s) => s !== 'running');
  if (done.length === 0) return null;
  const errorsFrom = (start: number) => {
    let n = 0;
    while (done[start + n] === 'error') n++;
    return n;
  };
  if (done[0] === 'error') {
    const n = errorsFrom(0);
    const due = n === FIRST_ALERT_AT || (n > FIRST_ALERT_AT && (n - FIRST_ALERT_AT) % REPEAT_EVERY === 0);
    return due ? { kind: 'failing', failures: n } : null;
  }
  const before = errorsFrom(1);
  return before >= FIRST_ALERT_AT ? { kind: 'recovered', failures: before } : null;
}

/** Texto del aviso. Sin datos sensibles: solo el club, el conteo y el enlace a la ejecución. */
export function alertMessage(alert: Alert, clubName: string, runUrl: string | null, lastError: string | null): string {
  const link = runUrl ? `\n${runUrl}` : '';
  if (alert.kind === 'recovered') {
    return `✅ Colector de ${clubName} funcionando otra vez, después de ${alert.failures} fallas seguidas.${link}`;
  }
  const why = lastError ? `\nÚltimo error: ${lastError.slice(0, 300)}` : '';
  return `⚠️ El colector de ${clubName} lleva ${alert.failures} ejecuciones fallidas seguidas. ` +
    `Si EA o GitHub no se recuperan, los partidos más viejos de la ventana de 10 se pueden perder.${why}${link}`;
}
