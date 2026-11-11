# Cambios de club y de temporada

Paso a paso para dos momentos que solo pasan una vez:

- **A.** Pasar del club de prueba ("Aston Huila") al club real, **FC Aston Huila**.
- **B.** Pasar de FC 27 a FC 28.

En cada paso se marca qué está **verificado** y qué es un **supuesto**.

Recordatorios:

- EA solo guarda los **últimos 10 partidos** de cada tipo. El colector tiene que estar capturando el club correcto **antes** de que se jueguen muchos partidos.
- Nada de esto cuesta dinero: todo son variables del repo y consultas en el SQL Editor de Supabase.

---

## A. Del club de prueba al club real (FC Aston Huila)

### Antes del primer partido

1. Comprobar que la captura funciona.
   - En el dashboard, la cabecera debe decir "Captura automática · hace X min", **sin** avisos rojos.
   - Supabase dispara el colector cada 15 min y el cron de GitHub queda de respaldo.

### Justo después del primer partido del club real

2. **Configurar el club.** En GitHub: *Settings → Secrets and variables → Actions → Variables*.
   - Crear o editar `EA_CLUB_NAMES` con el valor `FC Aston Huila`.
   - Para seguir también al segundo equipo propio: `FC Aston Huila;Otro Club`, separados por `;`.
   - Esto no requiere tocar código.
3. **Ejecutar el colector a mano** para no esperar: *Actions → Colector → Run workflow*.
   - Si el registro dice `Club "FC Aston Huila" -> clubId ...`, quedó bien.
   - **Supuesto sin verificar:** EA solo lista en la búsqueda los clubes que ya jugaron algún partido. Si dice "no se encontró", es eso: esperar al primer partido y repetir.
   - La coincidencia del nombre es **exacta**, así que el colector no confunde "FC Aston Huila" con "Aston Huila".
4. **Unir las cuentas de una misma persona.** Por ejemplo, Hecodes98 juega en PS5 y en PC. En el SQL Editor de Supabase:

   ```sql
   -- Ver cuentas y personas
   select a.player_id, a.last_known_name, a.platform, a.person_id from public.accounts a order by a.last_known_name;
   -- Unir: la segunda persona se absorbe en la primera
   select public.merge_persons(<person_id_que_queda>, <person_id_que_se_absorbe>);
   ```

### Cuando ya se vean partidos del club real en el dashboard

5. **Borrar el club de prueba.** Son datos de terceros y no deben mezclarse.

   ```sql
   select public.purge_club(1330384);  -- "Aston Huila", el club de prueba
   ```

   Borra sus partidos, fotos y las cuentas que quedaron sin partidos. Conserva el registro de ejecuciones.
   Es **irreversible**, salvo con un respaldo (rama `backups`).
6. Actualizar `CLAUDE.md`, sección 5: el club real ya está en uso y el club de prueba fue borrado.

---

## B. De FC 27 a FC 28

### Antes de que salga FC 28

1. **Decidir el mejor jugador de FC 27**, que es el objetivo del proyecto, con los datos del dashboard.
   - La fórmula sigue pendiente.
2. **Hacer un respaldo a mano:** *Actions → Respaldo → Run workflow*. Así no depende del domingo siguiente.
3. **Revisar la fecha de vencimiento del token** de GitHub, si vence pronto. Ver `CLAUDE.md`, pendiente 8.

### Cuando salga FC 28 (todo esto es supuesto hasta comprobarlo)

4. **Comprobar que la API de EA y el SDK funcionan con FC 28.**
   - Ejecutar *Actions → Cambios en la API de EA* (`ea-drift.yml`).
   - Mirar si Dependabot propone una versión nueva de `proclubs-sdk`.
   - **Supuestos:**
     - la dirección `proclubs.ea.com/api/fc/` se mantiene;
     - la plataforma sigue siendo `common-gen5` (en FC 27, `common-gen4` dejó de funcionar);
     - con la salida de FC 28, la API pasa a devolver datos de FC 28.
   - Si algo cambió, el colector falla con un error claro, y llegan el correo y el aviso de Discord, si está configurado.
5. **Crear o reactivar el club en FC 28 y jugar un partido.**
   - **Verificado en FC 27:** los ID de club cambian cada año. Por eso el colector busca el club por **nombre** y nunca guarda un ID fijo.
6. **Cambiar la temporada.** En *Variables*, `SEASON` = `FC28`.
   - Si el club cambia de nombre, actualizar también `EA_CLUB_NAMES`.
7. **Ejecutar el colector a mano** y revisar el dashboard:
   - **El selector de club** muestra "FC Aston Huila · FC28" y "FC Aston Huila · FC27". Por defecto abre el más reciente.
   - **El título** dice "EA SPORTS FC 28", porque sale de la temporada.
   - **Las personas son globales:** las uniones de cuentas del paso A.4 se conservan, y cada temporada se ve por separado con el selector.
8. **No borrar FC 27.** Es el historial; solo se borró el club de prueba en el paso A.5.
9. Actualizar `CLAUDE.md` con lo que se haya verificado de FC 28: plataforma, SDK, campos nuevos o eliminados.
