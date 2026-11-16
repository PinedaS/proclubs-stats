# Stats de Clubes FC 27 — contexto del proyecto

Documento de traspaso (handoff) desde un chat de diseño en claude.ai (2026-11-10).
Contiene las decisiones tomadas, los hallazgos verificados y lo que falta. Léelo completo antes de escribir código.

## 1. Objetivo

Guardar **todos los stats de los jugadores de nuestro club de Clubes (Pro Clubs) de EA FC 27**, por partido y en total, y visualizarlos.
- **Uso principal:** decidir quién fue el **mejor jugador de FC 27** antes de que salga FC 28.
- Habrá otros usos después (comparativas, evolución, etc.), por eso se eligió SQL.

## 2. Requisitos acordados con el usuario

- **Captura 100 % automática.** Nadie carga datos a mano, y el colector **no puede depender de la PC del usuario**, porque él no está en todos los partidos.
- **Tipos de partido:** liga (`leagueMatch`), play-off (`playoffMatch`) y amistosos (`friendlyMatch`). Los tres cuentan para el ranking, pero el dashboard debe permitir filtrar por tipo, porque en amistosos el rival puede ser más débil y eso infla los números.
- **Usuarios:** todo el equipo **consulta** el dashboard; nadie escribe.
- **Costo cero (requisito del usuario, 2026-11-11):** todo debe ser **gratis**, sin excepciones.
  - Solo planes gratuitos: GitHub Free con repo público, Supabase Free y GitHub Pages.
  - No activar nada que pueda cobrar: complementos (*add-ons*), cómputo mayor, *spend cap* desactivado ni tarjeta registrada.
  - Ante cualquier opción con costo, preguntar antes.
- **Preferencias del usuario (es programador):**
  - Buenas prácticas, indicando cuáles se aplicaron.
  - Explicar el porqué de las decisiones.
  - Distinguir siempre lo verificado de lo supuesto.
  - Responder en español, con los términos en inglés traducidos entre paréntesis.

## 3. Arquitectura decidida

```
API no oficial de EA ──► Colector (GitHub Actions, cada 30 min) ──► Supabase (Postgres) ──► Dashboard web (link para el equipo)
```

1. **Colector** en Node.js (**≥ 22.18**, lo exige `proclubs-sdk` 0.3.4) con `proclubs-sdk`. Código en `collector/` (TypeScript sin compilar, *type stripping*).
   - Corre en **GitHub Actions** con *cron* (programación periódica) **cada 30 min**.
   - Consulta los 3 tipos de partido.
   - Hace *upsert* (insertar o actualizar) idempotente por `matchId`: correr dos veces no duplica nada.
2. **Almacenamiento:** **Supabase Postgres**, plan gratis.
   - El colector escribe a través de una **interfaz de almacenamiento (patrón Repository)**, para poder cambiar de proveedor sin tocar la lógica.
   - Guardar el **JSON crudo de cada partido** en una columna `jsonb`, además de las tablas normalizadas, para poder reprocesar si EA cambia campos o si se descifra `match_event_aggregate`.
3. **Dashboard:** web estática que lee Supabase con una clave de solo lectura (`anon` + RLS, *Row Level Security*: seguridad a nivel de fila).
   - **Publicado (2026-11-11):** https://pinedas.github.io/proclubs-stats/, en GitHub Pages, gratis. El workflow `pages.yml` despliega la carpeta `dashboard/` en cada push.
   - HTML, CSS y JS sin compilar ni dependencias externas. Lee la API REST de Supabase con `fetch` y la clave **publicable** (`dashboard/config.js`).
   - Pestañas (2026-11-11):
     - **Ranking:** `person_stats`, con podio, columna "Media (EA)" y columnas avanzadas y experimentales.
     - **Por rol:** `relative_stats`, índices relativos a la posición o arquetipo; 100 = promedio del rol.
     - **Comparar:** `person_split_stats`, rival fuerte/débil, tipo de partido, jugadores en cancha y **división** (011).
     - **Duplas:** `pair_stats`, más la tabla **"Con y sin"** (`with_without_stats`, 011): cómo rinde cada jugador con y sin cada compañero. Es una correlación, no una causa.
     - **Partidos.**
     - **Club:** `club_snapshots`.
   - **Vista oculta `#verificacion`:** conciliación EA vs. capturado (`v_reconciliation`) y la antigua pestaña de miembros. Si faltan partidos, aparece un aviso en la cabecera.
   - Detalle por jugador: resumen, relativo a su rol, **posición recomendada**, avanzadas, récords (`person_records`) y gráficos de calificación y de media del Pro.
   - **Sugerencias de Campuzano (compañero de equipo, 2026-11-11), implementadas en 011–013:**
     - **Posición recomendada** (`position_fit`): índice de calificación en cada posición jugada (100 = promedio del club ahí; solo con 3+ PJ) y "parecido de perfil", el reparto en % entre posiciones según la distancia de su perfil por 90 min al de los **demás** jugadores en cada posición.
       - La escala es la dispersión entre perfiles individuales (013). Con la coseno (011) y con la escala entre promedios de posición (012), los resultados con datos reales eran engañosos.
       - Es orientativo y no es la fórmula de "mejor jugador".
     - **División por partido** (`v_player_match_stats.club_division`): sale de la foto diaria `club_snapshots` del mismo día o la anterior. Es **aproximada**, y los partidos previos a la primera foto (2026-11-11) quedan sin dato. EA no da la división del rival.
     - **Química por pases: imposible.** EA no expone quién le pasa a quién. Se reemplazó por "Con y sin".
   - Filtros: tipo de partido, fechas, mínimo de partidos y excluir incompletos.
   - Los archivos se versionan con el commit en `pages.yml` (`__V__`), para no mezclar versiones viejas desde la caché de Pages.
   - Probado en Chrome con los datos del club de prueba.
   - **Migraciones aplicadas en Supabase:** 001–021, cada una verificada después de aplicarla.
   - **BETA (decidido con el usuario el 2026-11-16, v2.10):** etiqueta "Beta" junto a la versión.
     - **Qué es beta:** solo la forma de mostrar y analizar (pestañas, gráficas y fórmula). **Los datos de EA no.** El texto lo aclara.
     - **Criterios de salida (las tres condiciones):**
       1. La detección de temporadas funciona en un reinicio real, alrededor del 3-dic-2026.
       2. Hay al menos 50 partidos capturados.
       3. Pasan dos semanas sin cambios de estructura: pestañas nuevas o quitadas, o cambios en la fórmula. Las correcciones no cuentan.
     - **Revisar a mediados de diciembre de 2026.** Para quitarla: borrar el `.beta-tag` de `index.html` y la nota de `renderChangelog`.
   - **v2.11 (2026-11-16):**
     - **Gráficas a elección:** cada `[data-chart]` tiene un botón para mostrarla u ocultarla, recordado en `prefs.hiddenCharts`. "Vista → Gráficas" pone `body.no-charts` y oculta todas las `.chart-card`.
     - **App instalable (PWA):**
       - Archivos: `manifest.webmanifest`, `icons/` (generados con un script de Node propio, sin dependencias) y `sw.js`.
       - El service worker **no guarda nada en caché** a propósito: todo va a la red, así nunca se ve una versión vieja.
       - Solo se registra en https. **No se probó la instalación en un celular real.**
     - **Celular:** en Partidos se ocultan las columnas secundarias (`.m-hide`). El mensaje de las tablas vacías queda fijo a la izquierda.
   - **Documentación (2026-11-16):** `README.md`, `docs/manual-de-usuario.md` (para el equipo) y `docs/arquitectura.md` (técnica, con diagramas Mermaid). Actualizarlas al cambiar funciones.
   - **v2.7 (2026-11-16, pedidos del usuario):**
     - **Ranking:**
       - Botones "Datos": Totales / Proporciones / Oficiales / Experimentales.
       - "+ Añadir dato" para datos menos importantes, que se quitan con la ×. Se guardan en `localStorage`.
       - Se quitó el interruptor "Métricas avanzadas".
       - "Posiciones": todas, con el % de minutos, en vez de una sola.
       - Gráfica del dato ordenado.
     - **Cara a cara:** el jugador B puede ser el "Promedio del equipo". Los totales se suman y las tasas se recalculan; ver `teamAverageRow`.
     - **Duplas unificada,** calculada en el navegador: el equipo con y sin cada jugador, con gráfica divergente, y por jugador elegido las secciones "Con él" (junto a cada compañero) y "Sin él".
     - **Club:** resultados por semana y goles por partido.
     - **Datos parciales** (pedido del usuario): etiqueta "Parcial" si un dato falta en algunos partidos, y la columna se oculta si falta en más del 50 % (`coverage()`).
     - **Textos para el equipo:** sin códigos de EA.
     - **Fechas de Novedades:** se usa la hora de Colombia. La v2.4–2.6 decía 16/11 y era el 15/11.
     - **Ni goles de penal ni % de regates:** EA no los da. Ver `datos-ea.md` §2b.
   - **Mejoras del 2026-11-11 (noche):**
     - **Vista simple:** "Métricas avanzadas" arranca apagada y "Experimentales" activa (decisión del usuario). Cada navegador recuerda lo elegido en `localStorage`.
     - **Guía:** botón "Cómo leer esto" en la cabecera, un `<dialog>` con la explicación de cada pestaña.
     - **Título:** "EA SPORTS FC NN" sale de la temporada del club.
     - **Avisos de fallas:**
       - **Correo:** verificado en la configuración del usuario, *Actions: Email, Failed workflows only*. Los disparos van con su token, así que los correos le llegan a él.
       - **Discord, opcional:** `collector/scripts/notify.ts` (lógica en `src/alerts.ts`, con tests) avisa a la 3.ª falla seguida, cada 24 fallas después, y cuando el colector se recupera. Solo actúa si existe el secreto `DISCORD_WEBHOOK_URL`, que debe crear el usuario.
     - **API de GitHub `2026-03-10` (015):** la `2022-11-28` vence el 10-mar-2028. En la versión nueva el disparo responde 200, no 204.
     - **Dependabot:**
       - PR #1 (acciones v7) integrado.
       - Del PR #2 solo se aplicó `zod` 4.6.7.
       - `@types/node` queda en 22.x mientras el colector use Node 22: `dependabot.yml` ignora sus saltos mayores.
     - **Cambio de club y de temporada:** paso a paso en `docs/cambio-de-temporada.md`.
     - **Cara a cara** (pestaña nueva): compara dos jugadores dato por dato, de forma **visual**, sin texto de "es mejor en…" (pedido del usuario).
       - **Filas:** barras enfrentadas desde el centro, azul (A) y naranja (B). La paleta pasó `validate_palette.js` en los dos modos. Quien gana el dato lleva su barra en color fuerte y la del otro va atenuada.
       - **Marcador arriba:** datos ganados, empates y datos perdidos.
       - **Qué se juzga:** solo tasas (por partido, por 90 min, %), nunca totales. Primero va el rendimiento y después los índices relativos al rol.
       - **Empate (2026-11-15, pedido del usuario):** solo si los dos valores son iguales redondeados a los decimales que se muestran. Antes había un margen del 3 %, que el usuario cerró: 6,90 contra 6,70 debe tener ganador.
       - **Experimentales (*) dentro de cada tema** (ataque, pase, defensa, disciplina), no en una sección aparte. Llevan fondo teñido y aviso al pasar el cursor. El ranking ordena sus columnas igual.
       - El enlace `?a=ID&b=ID` sirve para compartir, y el detalle de cada jugador tiene un botón "Comparar con…".
     - **Podio y puesto (#):** siguen siempre al **mejor** de cada dato, no al orden de la tabla. Así el peor no sale "1º" al ordenar de menor a mayor.
       - Las columnas llevan `better`: `'low'` en rojas, variación, pérdidas, faltas, fueras de juego, penales y amarillas; `null` (sin podio) en nivel del rival, jugadores en cancha e incompletos.
       - Los empates comparten puesto. Sin podio si más de 3 empatan en el primero.
       - Solo suben al podio quienes tienen 3 o más PJ.
     - **Mejor división (verificado el 2026-11-11):** EA manda dos `bestDivision` contradictorios: `overallStats` = 4 y ranking de la temporada = 3, con la actual también en 3. La 1 es la más alta.
       - Hipótesis sin confirmar: la de `overallStats` cuenta otra cosa o está desactualizada.
       - `club.ts` ahora guarda la más alta entre las dos y la actual. Las fotos de días anteriores conservan el 4.
     - **"Nivel y división" en el detalle del jugador (2026-11-15, pedido del usuario):** contexto para valorar su rendimiento. **No** entra en ninguna fórmula; eso sigue pendiente.
       - **Fichas:**
         - Media al entrar y media actual, de la primera y la última foto de `member_snapshots`, tomando la más alta si tiene varias cuentas.
         - Si en la primera foto EA ya contaba partidos que no capturamos, la ficha dice "al iniciar registro".
         - División del primer partido con división registrada.
         - Nivel medio de los rivales.
       - **Tabla por división:** PJ, calificación media, V-E-D y nivel del rival.
     - **⚠️ División del juego = número de la API − 1 (confirmado por el usuario el 2026-11-16, v2.6).**
       - **Evidencia:** 100 D CILANTRO empezó en la 5ª del juego (API: 6) y hoy está en la 4ª (API: `currentDivision` 5, con 1 ascenso).
       - Por encima de la 1ª del juego está la **División Élite** (API: 1), identificada por el ícono que mostró el usuario (escudo morado con león). El análisis de Clubes de EA para FC 24 describe la pirámide "de la División 5 a la División Élite". En el código es `TOP_DIVISION_NAME` en `app.js`.
       - **En la base se guarda el número de EA tal cual**; `gameDivision()` traduce solo al mostrar, y el tooltip dice cómo lo envía EA.
     - **Divisiones (verificado en la respuesta de EA):** hay **6**. `overallStats` trae `finishesInDivision1..6`, y la 1 es la más alta.
       - 100 D CILANTRO, con su primer partido, quedó en 6ª.
       - No hay documentación oficial que lo confirme.
     - **Idea del usuario para la fórmula futura:** pesar el rendimiento según el nivel con que cada uno entra y la división.
       - Recomendación dada: usar el **nivel del rival por partido**, que es más fino que la división.
       - No usar la media del Pro para ponderar sin pensarlo, porque mide progreso del personaje, no rendimiento.
     - **Rediseño v2.0 (2026-11-15):**
       - **Paleta "grafito y azul eléctrico"**, elegida por el usuario entre 4 muestras.
       - **Cabecera:** 4 fichas (nivel, división, temporada y forma de los últimos 5) y la racha calculada con los partidos capturados.
       - **Filtros:** en una franja con menús "Fechas" y "Vista".
       - **Pocos datos:** aviso con menos de 10 partidos. Los jugadores con menos de 3 PJ se ven atenuados, y el podio vacío muestra un mensaje.
       - **Ranking en el celular:** tarjetas con un selector "Ordenar por", y mini tendencia de las últimas 5 calificaciones.
       - **Detalle del jugador:** pestañas Resumen, Rendimiento, Contexto y Partidos.
       - **Partidos:** goleadores y MVP de cada uno.
       - **Evolución semanal:** del equipo en Club y del jugador en Rendimiento.
       - **Duplicados quitados:** el nivel del rival en Avanzadas, y en Club la división, el V-E-D y los puntos.
     - **Versiones:** `dashboard/changelog.js` guarda la lista de versiones. La cabecera muestra la versión ("v2.0 · Novedades") y abre una ventana con los cambios de cada una.
       - **Al publicar un cambio visible, agregar una entrada arriba.**
       - **No atribuir funciones a personas** en lo que ve el equipo (pedido del usuario, 2026-11-15). Nada de "sugerencias de X": se describe lo que cambia.
     - **Fotos de jugadores (v2.1, migración 016, 2026-11-15):** bucket público `player-photos` de Supabase Storage, con un archivo `<person_id>.webp` por persona.
       - **Decisión del usuario, con el riesgo explicado:** cualquiera con el enlace puede subir, cambiar o quitar cualquier foto, **sin iniciar sesión**.
       - **Límites:** webp/jpeg/png de hasta 200 KB. Solo se aceptan nombres de personas que existen (`is_valid_player_photo_name`). El dashboard achica la imagen a 256 px webp antes de subirla.
       - **Verificado con la clave pública el 2026-11-15:**
         - Subir, listar, descargar y borrar funciona.
         - Una persona inexistente se rechaza (403), un archivo de otro nombre se rechaza y uno de 300 KB también (413).
         - La foto de prueba se borró.
       - **Costo:** el plan Free incluye 1 GB de Storage y 5 GB de transferencia; si se superan, no cobra.
       - Las fotos de personas borradas con `purge_club` quedan huérfanas; se pueden borrar desde Storage.
     - **Orden por importancia (pedido del usuario):** en Cara a cara y en la pestaña Rendimiento del detalle va primero el rendimiento y después "Relativo a su rol". La posición recomendada va al final.
     - **Gráficas del jugador (v2.2, 2026-11-15):**
       - **Rendimiento:** calificación vs. nivel del rival (dispersión con tendencia desde 3 PJ) y regularidad (histograma de calificaciones).
       - **Contexto:** dónde juega (minutos por posición) y calendario (días coloreados por calificación).
       - Las de ejes se dibujan al ancho real al mostrarse la pestaña, para que el texto no se encoja en el celular.
       - **El usuario autorizó usar los datos experimentales** en comparaciones y gráficas, siempre marcados con *.
     - **⚠️ REGLA DEL USUARIO (2026-11-16, v2.5, migración 018): guardar y mostrar los datos TAL CUAL los da EA. No ajustarlos.** Lo especial se señala con etiquetas, sin tocar los números.
       - 018 deshace la ponderación por minutos de 017: la calificación media y el % MVP vuelven a ser los de EA.
       - Los partidos abandonados vuelven a contar por defecto ("Excluir partidos abandonados" está apagado). Muestran el marcador de EA con la etiqueta "Abandonado".
       - **Etiquetas "↑ Entró X'" y "↓ Salió Y'"**, en Partidos, en el detalle del jugador y al desplegar los jugadores de un partido. Se deducen de `secondsPlayed` y `gameTime` (columna `player_match_stats.game_time`):
         - `gameTime` parece ser el reloj del partido cuando terminó la participación del jugador. Entró tarde si `gameTime − secondsPlayed > 60 s`; salió antes si su `gameTime` está más de 60 s por debajo del mayor del partido.
         - **Verificado en 2 casos reales:** AlxCampu, 2.845 s con `gameTime` 5.545 (entró al 45'); Andresjimene, 1.120 s con `gameTime` 1.120 cuando el partido llegó a 5.487 (salió al 19'). **No está documentado por EA.**
       - Lo que sigue de abajo sobre la ponderación y la exclusión por defecto quedó **reemplazado** por esta regla.
     - **Banca, abandonos e IA (v2.4, migración 017, 2026-11-16; verificado con datos reales de 100 D CILANTRO):**
       - **Banca:** un jugador jugó 47 de 92 min. `person_stats` pondera la calificación media y el % MVP por segundos jugados; los PJ siguen contando enteros.
         - Partidos y el detalle del jugador marcan "Parcial" con menos del 75 % del tiempo.
         - EA no dice si entró tarde o salió antes.
       - **Abandonos:** hubo partidos cortados en 29 y 65 min, con marcadores asignados por EA (3-0 y 0-3). En el de 0-3 un jugador había marcado.
         - "Excluir incompletos" viene **activado por defecto**.
         - Si se incluyen, el marcador se muestra como "por abandono".
       - **IA:** EA solo da las estadísticas de los humanos, pero `goals_for` incluye los goles de la IA (por ejemplo, en un 5-2, 3 fueron de la IA). Goles de la IA = `goals_for` − goles humanos, sin abandonos.
         - Se muestran en Partidos y en Club ("Goles: jugadores / IA").
         - **No se cambió el denominador de "Participación en goles"**, que sigue usando todos los goles del equipo. Con solo los goles humanos podría pasar del 100 %, porque una asistencia a un gol de la IA cuenta como G+A pero ese gol no estaría en el denominador. EA no dice qué gol asistió cada uno.
     - **Escudo real:** EA manda `details.customKit.crestAssetId` (99020510 para 100 D CILANTRO) y `crestColor`. **Desde la v2.8 (020) sí se usa:** la dirección de la imagen sale de la investigación de la comunidad, se verificó (HTTP 200) y el usuario confirmó que es su escudo.
     - **Nombres de arquetipos:** mapeo de la comunidad (Interactive-63, issue #5, nov. 2026), no oficial.
       - Los deducidos sin confirmar llevan "?": 1 y 2 (porteros), 4 (Boss), 7 y 9.
       - Contrastado con nuestros datos: 4, 5 y 8 cuadran con las posiciones jugadas. El 13 (Target Man) aparece sobre todo en el medio, aunque la comunidad lo ve un 95 % de las veces como delantero.
       - El número 30 aparece en porteros y no tiene nombre conocido.
   - **Cambios del 2026-11-11 (tarde):**
     - La pestaña "Por posición" se unió a "Por rol", con un selector "Relativo al rol / Valores reales por posición", porque era redundante.
     - Se eliminó `ea-probe.yml`.
     - La cabecera muestra un aviso del disparo desde Supabase (`dispatch_status()`, 014) solo si falta el token, si GitHub lo rechaza o si no hay respuestas recientes.
     - **División al capturar (014):** el colector anota `matches.club_division` en partidos **nuevos** de menos de 6 h, con la división leída en esa misma ejecución. Nunca la pisa después. La vista usa esa división y, si falta, la foto diaria.
     - Revisado en celular (375 px): ninguna pestaña desborda la página.

### Por qué así (no reabrir sin un motivo nuevo)

- **Postgres en vez de archivos JSON en el repo.** El espacio no es el motivo: son ≈12 KB por partido, unos 12 MB por año con 1.000 partidos. Se eligió por la **flexibilidad de consultas** (SQL), las varias temporadas y la posibilidad de un repo privado.
- **Cada 30 min y no cada 15:**
  - En repos privados, GitHub Free incluye 2.000 min/mes de Actions y redondea cada ejecución al minuto entero. Cada 15 min serían ≈2.880 min, por encima del límite; cada 30 min, ≈1.440.
  - 30 min es seguro frente al límite de 10 partidos: cada partido dura ~20 min reales, así que 10 partidos son ~3 h.
  - En repos públicos los minutos son ilimitados, y se podría bajar a 15 min.
- **Nube y no la PC del usuario:** él no está presente en todos los partidos.

## 4. Hallazgos verificados de la API de EA (2026-11-10)

No hay API oficial. Se usan los endpoints públicos que lee la web de Clubes de EA.
- **Base:** `https://proclubs.ea.com/api/fc/`. Peticiones GET sin clave, cuenta ni cookie.
- **Plataforma:** `common-gen5` (PS5, Xbox Series y PC). `common-gen4` devuelve HTTP 400 desde FC 27.
- **⚠️ Límite crítico:** EA devuelve **máximo 10 partidos por tipo**, aunque se pidan más. Un partido que salga de esa ventana sin haberse guardado **se pierde para siempre**.
- **Endpoints útiles:**
  - `allTimeLeaderboard/search?platform&clubName`: buscar el club por nombre.
  - `clubs/matches?platform&clubIds&matchType&maxResultCount`: partidos. `clubIds` acepta **un solo** ID, aunque el nombre esté en plural.
  - `members/stats?platform&clubId`: totales por miembro, útiles para conciliar contra la suma de partidos.
- **Los IDs de club cambian cada año.** Hay que buscar el club por nombre y no guardar un ID fijo de una temporada a otra.
- **Prueba real:** una consulta desde un servidor de Anthropic recibió HTTP 200 con datos de FC 27.
  - La documentación de `proclubs-sdk` reporta 403 y tiempos de espera intermitentes desde servidores, y que `curl` falla mientras `fetch` de Node funciona.
  - **Verificado desde GitHub Actions (2026-11-11, una ejecución):** el workflow `ea-probe.yml` (eliminado el 2026-11-11 por redundante: el colector ya lo comprueba en cada ejecución; runner `ubuntu-latest`, `proclubs-sdk` 0.3.4) buscó el club y descargó sus 10 partidos de liga sin 403.
    - Es una sola muestra. Si EA bloquea de forma intermitente, se verá en `collector_runs` cuando el colector corra cada 30 min.

### Forma de un partido (`clubs/matches`)

- **Nivel partido:** `matchId` (string), `timestamp` (Unix, segundos), `clubs`, `players`, `aggregate`.
- **`clubs[clubId]`:** `goals`, `goalsAgainst`, `wins`, `losses`, `ties`, `result`, `winnerByDnf` (victoria porque el rival abandonó), `details.name`, etc.
- **`players[clubId][playerId]`:**
  - El `playerId` es un **ID numérico de cuenta, estable**. Úsalo como llave, no el nombre.
  - Campos: `playername`, `pos` (`forward` / `midfielder` / `defender` / `goalkeeper`), `archetypeid`, `rating` (string, p. ej. `"7.40"`), `goals`, `assists`, `shots`, `passattempts`, `passesmade`, `tackleattempts`, `tacklesmade`, `mom` (MVP, `"0"`/`"1"`), `redcards`, `saves`, `goalsconceded`, `cleansheetsdef`, `cleansheetsgk`, `secondsPlayed`, `gameTime`.
  - Atajadas detalladas: `parrySaves`, `punchSaves`, `reflexSaves`, `crossSaves`, `ballDiveSaves`, `goodDirectionSaves`.
  - Además: `match_event_aggregate_0..3`, `wins`, `losses`, `realtimegame`, `realtimeidle`, `vproattr`, `vprohackreason`.
- **Casi todos los números llegan como string.** Hay que convertirlos.
- **`match_event_aggregate_*`:** cadenas como `"0:1,1:4,100:2,..."` (código de evento : cantidad), **sin documentar**. Puede partirse en varios campos.
  - **Hipótesis sin confirmar:** podrían contener regates u otras acciones que la API no expone directamente.
  - Guárdalas crudas; descifrarlas queda pendiente.
- **No existen** campos directos de regates, duelos, posesión ni distancia recorrida. La comunidad le pide a EA que los exponga.

### `proclubs-sdk` (Node.js) — lo leído en su documentación

- **Docs:** https://proclubs-sdk.mintlify.app. Repo: https://github.com/alex-jordan547/proclubs-sdk.
- `new ProClubsClient()`: usa un perfil de red tipo Chrome, valida con Zod y hace reintentos acotados (`maxAttempts` de 1 a 5).
- `proclubs.clubs.search({ name, platform })` → `ClubSummary[]` con `clubId`, `clubName`, etc.
- `proclubs.matches.list({ clubId, type, limit, platform })` → `ClubMatch[]`, con la forma de la sección anterior. Los campos crudos se preservan.
- **Errores (extienden `ProClubsError`, con propiedad `code`):** `ProClubsHttpError` (`status`, `endpoint`, `retryAfterMs`), `ProClubsNetworkError`, `ProClubsTimeoutError`, `ProClubsResponseError`, `ProClubsValidationError`, `ProClubsAbortError`.
- Reintenta 429/502/503/504 y fallas de red. **No envuelvas el cliente en un bucle de reintentos ilimitado.**
- **Verificado (2026-11-10, v0.3.4 ejecutada):**
  - La firma de `clubs.search` y `matches.list` coincide con lo de arriba.
  - `clubId` llega como string.
  - La búsqueda por nombre es **parcial**: hay que filtrar por nombre exacto.
  - Desde una PC doméstica, el SDK recibe datos, mientras `Invoke-WebRequest` recibe 403 (el SDK usa `impit`).
  - `clubs[id].result` es un código (1 victoria, 2 derrota, 4 empate, 10 abandono con derrota): el resultado se toma de `wins` / `losses` / `ties`.
  - `secondsPlayed` está en segundos de juego.
  - Detalle completo en `collector/README.md`.

### Proyecto de Supabase real (creado el 2026-11-11)

- **Organización:** "FC Aston Huila", plan **Free**.
- **Proyecto:** `proclubs-stats`, ref `lubikomzgxzuxdaosqxb`, URL `https://lubikomzgxzuxdaosqxb.supabase.co`, región `us-east-1`, cómputo Nano (gratis).
- **Opciones de creación:**
  - *Data API*: activada.
  - *Automatically expose new tables*: **desactivada**, la recomendación de Supabase. Por eso existe la migración 004 de permisos explícitos.
  - *Automatic RLS*: desactivada.
- **Migraciones 001–004:** aplicadas en el SQL Editor el 2026-11-11, en una sola ejecución (una transacción).
- **Verificado con consultas al catálogo:**
  - Las 7 tablas tienen RLS. Hay 1 política de lectura por tabla, salvo `match_raw`, que no tiene ninguna.
  - `anon` no escribe en ninguna tabla. No lee `match_raw`, y de `collector_runs` solo lee algunas columnas.
  - `service_role` escribe en todas las tablas.
  - `anon` no ejecuta `merge_persons`, `purge_club` ni `accounts_assign_person`.
- **Primera ejecución real (2026-11-11, `workflow_dispatch` de `collect.yml`): éxito.**
  - Guardó, del club de prueba, 10 partidos con su JSON crudo, 50 filas de stats y 7 cuentas/personas.
  - Resultados: 5 derrotas, 3 empates y 2 victorias. Coinciden con el fixture.
  - `collector_runs` la registró como `success`, con 10 partidos vistos y 10 nuevos.
  - Desde entonces corre sola cada 30 min (minutos 7 y 37).
- **Secretos del repo:** `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, cargados el 2026-11-11.
- **Variables del repo:** `EA_CLUB_NAMES` (obligatoria desde el 2026-11-15: sin ella el colector falla con un error claro) y `SEASON` (opcional, `FC27` por defecto).
  - **Valor actual (2026-11-15):** `EA_CLUB_NAMES` = `100 D CILANTRO`.
  - **Varios clubes (2026-11-11):** el usuario seguirá un **segundo equipo propio**, con otras personas; el nombre aún no está definido.
    - `EA_CLUB_NAMES` acepta varios nombres exactos separados por **`;`** (un nombre puede tener comas), p. ej. `FC Aston Huila;Otro Club`. `EA_CLUB_NAME` se sigue aceptando.
    - El colector registra una ejecución en `collector_runs` por club. La falla de uno no impide capturar los demás, pero sale con código 1.
    - El dashboard muestra un **selector de club** si hay más de uno. La URL lleva `?club=ID` para compartir; todo se filtra por `p_club_id` o `club_id`.
    - Las **personas son globales**: si alguien juega en los dos clubes, se une igual con `merge_persons`, y sus números se separan por club gracias al filtro.
- **Clave del colector:** en proyectos nuevos, la clave *secret* (`sb_secret_...`) reemplaza a la `service_role` antigua y actúa con ese rol. Va **solo** en los secretos de GitHub y en el `.env` local, nunca en el repo.

### Supabase plan gratis (fuentes de 2026)

- 500 MB de base de datos y 2 proyectos activos.
- **Se pausa tras 7 días sin actividad.** Conserva los datos, pero hay que restaurarlo a mano.
  - **Inferencia:** el colector escribiendo cada 30 min lo mantiene activo.
  - **Riesgo residual:** si EA se cae más de una semana, no hay escrituras y el proyecto se pausa. Considerar un *heartbeat* (registro de cada ejecución en una tabla `collector_runs`, incluso cuando no haya partidos nuevos).

## 5. Clubes seguidos y datos de prueba

**Estado (2026-11-15):**

- **Se sigue "100 D CILANTRO"**, el equipo secundario del usuario con otros amigos, `clubId` 2240695, `common-gen5`.
  - EA lo encontró por nombre exacto.
  - La primera captura (ejecución manual del 2026-11-15, 17:34 UTC) guardó su único partido: liga, 0-5. Jugaron PinedaDS, Andresjimene y ayala14pv.
- **El club de prueba "Aston Huila" (1330384) fue borrado** con `purge_club(1330384)` el 2026-11-15, a pedido del usuario.
  - Verificado después: 0 partidos, 0 JSON crudo y 0 fotos de ese club.
  - Quedaron 3 cuentas y 3 personas, todas de 100 D CILANTRO. El registro `collector_runs` se conservó.
  - Lo de abajo sobre el club de prueba queda como historia.
- **FC Aston Huila se sigue desde el 2026-11-16** (`clubId` **2171706**, `common-gen5`).
  - **Primer partido:** liga, 2026-11-16 20:52 UTC, derrota 3-6 contra Miralys FC. Jugaron PinedaDS y Henoxerwtf.
  - **Confirmado:** la búsqueda de EA solo lista clubes con partidos jugados. Antes del primer partido daba 0 resultados; después, 1 con coincidencia exacta.
  - **`EA_CLUB_NAMES` = `FC Aston Huila;100 D CILANTRO`.** El usuario la cambió el 2026-11-16 desde su Chrome; GitHub pidió confirmar con su passkey.
  - **Verificado en la captura de las 21:02 UTC:**
    - partido, jugadores y foto del club guardados;
    - división API 6 (5ª del juego) y división del rival API 4;
    - **escudo:** el propio (`crestAssetId` 99160313, flor de lis) **no es** el del club, según el usuario. Trae `customKit.dCustomKit` "0", y 100 D CILANTRO trae "3".
      - **Regla:** `dCustomKit` 0 = no usa escudo propio, sino el de `teamId`. **Confirmada por el usuario el 2026-11-16** en los dos clubes: con 0, el de Atlético Nacional (101100) es el correcto; con 3, el propio de 100 D CILANTRO.
      - `crestOf()` en `club.ts` deja `crest_asset_id` en null en ese caso, y el dashboard usa el `teamId`;
    - temporada 2 heredada de 100 D CILANTRO;
    - PinedaDS es la misma persona (`person_id` 9) en los dos clubes.
  - El dashboard muestra el selector de club.


**Club del equipo: "FC Aston Huila"** (creado el 2026-11-10; todavía sin partidos jugados).
- **Verificado (2026-11-10):** `clubs.search("FC Aston Huila")` devuelve `[]`.
  - **Hipótesis sin confirmar:** la búsqueda (`allTimeLeaderboard/search`) solo lista clubes con partidos jugados. Hay que volver a buscarlo después del primer partido.
  - Mientras no aparezca, el colector falla con `ClubNotFoundError` y sale con código 1.
- **Nombre casi igual al del club de prueba.** Buscar "Aston Huila" ya devuelve "Aston Huila" y "Aston Huila FC", y devolverá también "FC Aston Huila". La coincidencia **exacta** del colector es la que evita mezclarlos; no la quites.
- **Mientras tanto:** desarrollar y probar con un club ajeno real de FC 27.
  - "Aston Huila", `clubId` **1330384**, `common-gen5`.
  - **NO es el club del equipo.** Sus jugadores son terceros: no pongas sus gamertags ni sus IDs de cuenta en el repo, que es **público**.
  - Los fixtures de `collector/test/fixtures` se guardan anonimizados con `scripts/anonymize.ts`, que `npm run fetch-fixture` ya aplica.
- **Club e ID por configuración** (variables de entorno, nada fijo en el código).
- Cuando creen su club: cambiar la configuración y borrar los datos de prueba.
- **Activar el colector ANTES de que empiecen a jugar con el club nuevo**, por el límite de 10 partidos.

## 6. Identidad de jugadores

- **Llave:** el `playerId` de EA. El `playername` puede cambiar.
- Se necesita una tabla de **personas** que agrupe varias cuentas. Ejemplo conocido: **Hecodes98 juega con dos cuentas (PS5 y PC) y es una sola persona.** Los rankings se calculan por persona.
- **Jugadores conocidos del equipo** (FC 26; confirmar en FC 27): PinedaDS (el usuario), Henoxerwtf, Andresgj061298, Hecodes98 (dos cuentas), X_The_Unlucky_X, Andresjimene.

## 6b. Plataformas (PC + PS5)

- El equipo mezcla PC y PS5. `common-gen5` agrupa PS5, Xbox Series y PC en un solo grupo de juego cruzado: un club, un solo `platform` en todas las llamadas.
- Cada jugador trae su ID de cuenta sin importar la plataforma. El colector no distingue plataformas.
- Las cuentas múltiples de una misma persona (p. ej. Hecodes98 en PC y PS5) se unen en la tabla de personas.

## 6c. Contingencia y detección de fallas

| Falla | Contingencia |
|---|---|
| EA bloquea las IPs de GitHub (403) | Plan B: el mismo colector en un dispositivo de casa siempre encendido. El *upsert* idempotente permite correr **nube + casa a la vez** como redundancia. Diseñar el colector para ejecutarse igual en ambos sitios (solo variables de entorno). |
| GitHub Actions se retrasa o salta ejecuciones | **⚠ Verificado (2026-11-11): el cron NO es confiable.** Entre las 03:50 y las 16:28 UTC hubo **1 sola ejecución programada** de ~25 esperadas (el workflow estaba activo). El margen de 30 min **no** basta. **Pendiente:** un disparador externo gratuito (ver pendiente 8). |
| La API de EA cae por completo | Los partidos que salgan de la ventana de 10 **se pierden**. Mitigación: conciliar contra `members/stats` (totales por jugador que mantiene EA) para recuperar al menos los totales de la temporada. Último recurso: capturas manuales de la Plantilla del juego. |
| EA cambia campos o el SDK se rompe | JSON crudo en `jsonb`, versión del SDK fijada, error claro (no fallar en silencio). |
| Supabase se pausa | Se restaura desde el panel; los datos se conservan. |
| Cambio de ID del club (nueva temporada) | Buscar el club por nombre desde la configuración. |

**Detección (obligatoria):**
- Tabla `collector_runs` con cada ejecución (inicio, fin, estado, partidos nuevos, error).
- El dashboard muestra "última captura exitosa hace X" con alerta visual si supera un umbral.
- El proceso debe terminar con código de salida distinto de 0 cuando EA o Supabase fallen, para que GitHub marque la ejecución como fallida.
- Opcional: aviso a un *webhook* de Discord tras N fallas consecutivas.

## 7. Pendientes y decisiones abiertas

1. ~~Repo público o privado.~~ **Decidido (2026-11-10): público.**
   - Dashboard en GitHub Pages, y minutos de Actions ilimitados.
   - **Riesgo:** GitHub desactiva los workflows programados de un repo público tras **60 días sin actividad** en el repo. Hay que mitigarlo en el paso 4 (p. ej. un *keepalive*).
2. **Fórmula de "mejor jugador": EXPERIMENTAL desde la v2.10 (2026-11-16, aprobada por el usuario).** Pestaña "Mejor jugador" (`computeBest` en `app.js`). **No cambiar criterios, pesos ni el mínimo sin que el usuario lo pida.**
   - **Pesos fijos, iguales para todos** (decisión del usuario; v2.12, 2026-11-16): calificación frente al rol 30, ataque frente al rol 15, defensa frente al rol 15, pase frente al rol 10, impacto (% de victorias con él − sin él) 10, MVP frente al promedio 10, **juego limpio 5** y regularidad 5. "Ante rivales fuertes" se quitó: lo cubre el ajuste por dificultad.
   - **Ajuste por dificultad (v2.12, aprobado por el usuario, opción B):** en calificación, ataque, defensa y pase, cada partido se multiplica por división × rival.
     - **División:** +5 % por división sobre la 5ª (API 6 = ×1,00; Élite = ×1,25).
     - **Rival:** su nivel / el nivel medio de los rivales del club, recortado a 0,85–1,15.
     - Lo malo (pérdidas, entradas peligrosas) se **divide** por el factor.
   - **Criterios compuestos (v2.12, datos y pesos aprobados por el usuario):** cada dato es un índice frente al rol (por posición y por minutos), con un recorte de ×0,25–×2,5. Ver `SUB` en `app.js`.
     - **Ataque:** G+A/90 35, conversión 15, regates*/90 15, rival superado*/90 10, 2ª asistencias*/90 10, tiros/90 10, tiros a puerta %* 5.
     - **Defensa:** entradas/90 25, % de entradas 15, intercepciones*/90 20, recuperaciones*/90 15, balones quitados*/90 10, aéreos*/90 10, entradas peligrosas*/90 (menos es mejor) 5.
     - **Defensa del portero:** % de atajadas 70, atajadas/90 30.
     - **Pase:** precisión 30, pases/90 15, filtrados*/90 15, pérdidas*/90 (menos es mejor) 15, pase adelante %* 10, pase largo %* 10, decisiones %* 5.
   - **Juego limpio:** sanción/90 = 3·roja + amarilla* + penal* + 0,25·falta*. Índice = (media + ε) / (suya + ε) × 100, con ε = máx(0,05; 10 % de la media).
   - **Cálculo:** índice (100 = promedio) → corrección por pocos partidos `100 + (i − 100) × PJ / (PJ + 5)` → nota `50 + (i − 100)`, recortada a 0–100 → promedio ponderado. Si falta un criterio, su peso se reparte entre los demás, con aviso.
   - **Mínimo para entrar:** 30 % de los partidos del club en el rango filtrado (decisión del usuario).
   - **Efectos observados con 12 partidos (2026-11-16):**
     - A quien jugó todos los partidos le falta "Impacto", porque no hay partidos sin él.
     - El índice relativo al rol de quien más juega tiende a 100, porque él mismo pesa mucho en el promedio de su posición. Revisarlo con más jugadores y partidos.
   - Lo de abajo queda como historia del diseño.
   - **Antes (2026-11-11):** POSPUESTA por decisión del usuario.
   - **Requisito de justicia (usuario, 2026-11-11):** varios jugadores cambian de **posición y arquetipo**. Ninguna métrica ni la fórmula debe penalizar a quien rota, sobre todo hacia **roles defensivos** (p. ej. un defensa no debe quedar abajo por marcar pocos goles). Las comparaciones deben ser **relativas a la posición o arquetipo** de cada partido.
   - Ideas para entonces:
   - Métricas por partido (G+A, calificación media, % MVP).
   - Mínimo de partidos para entrar al ranking.
   - Comparación dentro de cada posición.
   - Hacerla transparente y configurable.
3. ~~Validar el colector desde GitHub Actions contra EA.~~ **Primera prueba OK (2026-11-11), sin 403.** Hay que vigilar fallas intermitentes en `collector_runs`. El plan B (un dispositivo en casa) sigue disponible.
4. **Descifrar `match_event_aggregate`** (opcional, futuro). **Investigado el 2026-11-11:**
   - **No está cifrado.** Son contadores sin documentar con el formato `código:cantidad`. En nuestros datos solo `_0` y `_1` traen valores.
   - **Hay un mapeo de la comunidad para FC 27,** sin respaldo oficial de EA: [Interactive-63/eafc-pro-clubs-api-research](https://github.com/Interactive-63/eafc-pro-clubs-api-research). Según ese mapeo:

     | Dato | Código |
     |---|---|
     | Regates completados | 174 |
     | Intercepciones | 6 |
     | Posesión perdida | 105–107 |
     | Posesión ganada | 108–110 |
     | Duelos aéreos ganados | 265–266 |
     | Faltas cometidas | 2 + 3 |
     | Amarillas | 95 + 213 |

     **No hay código para distancia recorrida.**
   - **Lo contrasté contra los campos oficiales en 96 registros reales (jugador × partido):**

     | Campo oficial | Código | Coincidencia |
     |---|---|---|
     | Goles | 214 | 94/96 |
     | Asistencias | 11 | 94/96 |
     | Tiros | 217+218 | 86/96 |
     | Pases completados | 215 | 65/96 |
     | Entradas | 0 | 80/96 |
     | Atajadas | 202 | 0 de 33 casos con valor (**mapeo incorrecto**) |

   - **Conclusión:** los códigos dan aproximaciones útiles, no valores exactos. Si se muestran, marcarlos como **experimentales**. El JSON crudo ya se guarda, así que se pueden calcular después, también para partidos ya capturados.
5. ~~Conciliación contra `members/stats`.~~ **Hecho (migración 006):**
   - Foto diaria en `member_snapshots`. La vista `v_member_latest` compara los partidos que EA sumó desde la primera foto con los capturados.
   - Además, `matches.opponent_skill_rating` guarda la fuerza del rival, y `person_stats` incluye métricas por 90 min, conversión, presencia, forma, regularidad y otras.
   - CI (`ci.yml`) y Dependabot están activos.
6. **Respaldos: cifrados en la rama `backups`** (decidido el 2026-11-11).
   - `backup.yml` corre los domingos. Exporta (`collector/src/backup.ts`), comprime y cifra con AES-256 (GPG simétrico, `collector/scripts/encrypt-backup.sh`).
   - Conserva los últimos 12, en un solo commit con *force push*.
   - La contraseña es el secreto `BACKUP_PASSPHRASE`. Solo la tiene el usuario: **nunca** escribirla ni pedirla en el chat.
   - **Nunca publicar datos sin cifrar en el repo, que es público.** Un primer intento sin cifrar fue bloqueado por esa razón.
   - La restauración (`npm run restore-sql`) está probada en CI: se restaura en una base vacía y queda idéntica.
   - Contexto, verificado el 2026-11-11: el plan Free de Supabase **no incluye respaldos automáticos accesibles**, según su página de precios y su documentación. Los partidos no se pueden recuperar de EA, así que conviene una exportación periódica gratuita, por ejemplo con un workflow de GitHub Actions.
8. ~~**Confiabilidad del cron (URGENTE antes de que juegue el club real).**~~ **Resuelto con la opción (a); ver abajo.** GitHub ejecutó 1 de ~25 corridas programadas en 12,5 h.
   - Alternativas gratuitas:
     - **(a)** `pg_cron` + `pg_net` en Supabase Free, que dispare `workflow_dispatch` cada 15 min con un token *fine-grained* guardado en Supabase Vault;
     - **(b)** cron-job.org, que llame a la misma API;
     - **(c)** un dispositivo en casa (plan B).
   - Las tres requieren que el usuario cree un token de GitHub con permiso de *Actions* solo sobre este repo. **Nunca** pedírselo por chat.
   - **Elegida la (a) (2026-11-11), migración 010 aplicada:** `pg_net` 0.20.4 y `pg_cron` 1.6.4 activos; la tarea `dispatch-collector` (minutos 2, 17, 32 y 47) llama a `public.dispatch_collector()`, que solo ejecuta `postgres`/`pg_cron`.
     - **✅ Funcionando (verificado el 2026-11-11, 19:09 UTC):** el usuario guardó el token *fine-grained* (solo este repo, *Actions: Read and write*) en Vault como `github_dispatch_token`.
       - Un disparo manual recibió HTTP 204 de GitHub.
       - La ejecución `workflow_dispatch` de `collect.yml` terminó con `success` y `collector_runs` la registró sin fallas.
     - El token **vence** (fecha elegida por el usuario). Al vencer, GitHub responde 401 y el dashboard muestra en rojo "Disparo falló…" (`dispatch_status()`). Para renovarlo: crear otro token igual y reemplazar el valor en Vault con el mismo nombre.
7. **Catálogo de datos de EA:** ver `docs/datos-ea.md`. Recoge los endpoints y campos verificados, los no usados y los que EA no expone.

9. ~~Separar JUEGO y TEMPORADA.~~ **Hecho el 2026-11-16 (migración 020, v2.8).**
   - **Modelo:**
     - `clubs.season` es el **juego** (FC27).
     - `club_seasons` guarda las temporadas dentro del juego: `season_no` **con el número del juego** (migración 021, corrección del usuario: la actual es la 2 de FC 27, desde el 22-oct, según el calendario de PRO11; un club nuevo hereda la temporada en curso de los demás clubes del mismo juego), `started_at`/`ended_at`, `detected_by` y `expected_end_at`.
   - **Investigado:**
     - EA (glosario oficial): los Play-offs son la última semana de cada temporada.
     - PRO11 (guía no oficial): las temporadas van por fecha y son iguales para todos. La temporada 2 de FC 27 va del 22-oct al 3-dic-2026.
     - EA **no** da el número ni las fechas de la temporada en la API.
   - **Detección:** `collector/src/seasons.ts`.
     - Si bajan los partidos de `currentSeason` y no suben los puntos, empezó una temporada nueva. Su inicio es la captura anterior.
     - Si pasa un día del `expected_end_at` sin reinicio, solo se avisa en el log.
     - **Sin verificar con un reinicio real: revisar alrededor del 3-dic-2026** que se haya abierto la temporada 2.
   - **Dashboard:**
     - Selector "Temporada" en "Fechas", que filtra por el rango de fechas con los mismos `p_from`/`p_to`.
     - La cabecera dice "FC 27 · Temporada N".
     - La ficha de temporada siempre es la temporada en curso (la da EA).
   - **También en la 020:**
     - Escudo real: `clubs.crest_asset_id` y `team_id`.
     - Íconos de división de EA: `divisioncrest{n}.png` con n = número de EA. Verificado: el 1 es la Élite (león morado) y el 5 muestra un "4".
     - 35 contadores más en la vista (pases por distancia, tiros por zona, barridas, tipos de atajada…), que se suman en el navegador para "+ Añadir dato".
   - **Escudo confirmado por el usuario (2026-11-16):** el de `crestAssetId` 99020510 (balón con aros de colores) es el de 100 D CILANTRO.
10. ~~Capturar todos los datos de EA.~~ **Hecho el 2026-11-16 (migración 019):**
    - `ea_snapshots` guarda crudos `clubs/info`, play-off, carrera y la foto de cada rival.
    - `matches.opponent_division` guarda la división del rival.
    - La guía del dashboard explica qué se guarda sin mostrarse.
    - Queda opcional: mostrar atajadas por tipo y más contadores.

## 8. Orden sugerido de trabajo

1. Crear el proyecto de Supabase (lo hace el usuario) y el esquema SQL: migraciones, RLS de solo lectura para `anon`, vistas de totales y de stats por persona.
2. Colector:
   - Configuración validada.
   - Cliente de EA.
   - Transformación **pura** de partido crudo a filas, con tests usando un JSON real guardado como *fixture* (dato de prueba fijo).
   - Repositorio de Supabase con *upsert* idempotente.
   - Registro de ejecuciones.
3. Probar localmente contra el club de prueba.
4. Workflow de GitHub Actions:
   - *cron* cada 30 min, más `workflow_dispatch` para ejecutarlo a mano.
   - `concurrency` para evitar ejecuciones solapadas.
   - Secretos `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`; la clave *service role* **solo** en el colector, **nunca** en el dashboard.
5. Dashboard:
   - Filtros por tipo de partido y fechas.
   - Tabla de totales y promedios por persona.
   - Ranking de mejor jugador.
   - Detalle y evolución por jugador.
   - Lista de partidos.
