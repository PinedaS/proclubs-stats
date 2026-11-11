// Configuración pública del dashboard.
// La clave PUBLICABLE está hecha para ir en el navegador: solo puede leer lo que
// permiten RLS y los GRANT de las migraciones (verificado el 2026-11-11).
// La clave secreta del colector NUNCA va aquí.
export const SUPABASE_URL = 'https://lubikomzgxzuxdaosqxb.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_mg7sp-PxZB8FQfM0RdlTog_rq-87KLT';

// Minutos sin captura exitosa antes de mostrar alerta.
export const STALE_WARNING_MINUTES = 120;
export const STALE_CRITICAL_MINUTES = 24 * 60;

// Partidos más recientes que se listan en la vista de partidos.
export const MATCH_LIST_LIMIT = 200;
