// Service worker mínimo para que el dashboard se pueda instalar como app.
// A propósito NO guarda nada en caché: cada petición va a la red, así nunca se ve
// una versión vieja del dashboard ni datos viejos. Sin conexión, no carga (igual que la web).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return; // POST (consultas a Supabase): el navegador las hace solo
  event.respondWith(fetch(event.request));
});
