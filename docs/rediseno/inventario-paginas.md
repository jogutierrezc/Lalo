# Inventario de páginas del creador (fase 1 del rediseño Tally Studio)

Documento para los agentes de la fase 2: cada herramienta pasa de página larga a ventana interna con pestañas, sin perder opciones, textos de ayuda ni funciones. Fuente de verdad del registro: `src/lib/tools.ts`. Cada página ya se muestra completa e intacta dentro de su ventana (`WindowHost`); la fase 2 solo reorganiza su interior en pestañas.

## Reglas para la fase 2

- Cada página sigue montando `<SuiteNav>`: dentro del cascarón dibuja solo una barra pequeña (Guía, Actualizar OBS, Copiar URL de la fuente y estado de guardado). Si la ventana pasa a pestañas, esa barra debe quedar fija encima de las pestañas.
- Las guías (`GuidedTour`) apuntan a módulos con `data-tour`: al migrar, cambia de pestaña antes de cada paso.
- Guardado: las páginas guardan solas salvo Mi AI («Guardar ajustes») y los botones de Torneos. No añadir botón «Guardar» donde no lo había.
- Los enlaces internos a `#chat`, `#raid`, `#musica`, `#kofi`, `#juego`, `#powerups` siguen funcionando (abren la ventana correspondiente).
- Power-ups no tiene fuente OBS propia: hereda la de Recompensas (`app=rewards`).

## Mapa de páginas a destinos

| Página | Alias | Destino | Fuente OBS (`app`) |
|---|---|---|---|
| Catalog | `#catalogo` `#dashboard` `#suite` raíz | Inicio | todas |
| Control | `#control` | En vivo | ninguna |
| Dashboard | `#tts` `#ajustes` | Herramientas / Voz e IA | `tts` |
| LuxAI | `#lux` | Herramientas / Voz e IA | overlay propio `/lux/overlay.html` |
| (nuevo) DoneAssistant | `#done` `#asistente` | Herramientas / Voz e IA (Nuevo) | ninguna |
| TwitchIOStudio | `#twitchio` `#bot` | Herramientas / Voz e IA | ninguna |
| AlertsStudio | `#alertas` `#alerts` | Herramientas / Alertas y premios | `alerts` |
| RewardsStudio | `#recompensas` `#rewards` | Herramientas / Alertas y premios | `rewards` |
| PowerupsStudio | `#powerups` | Herramientas / Alertas y premios | hereda `rewards` |
| PetsStudio | `#mascotas` `#pets` | Herramientas / Alertas y premios | `pets` |
| GoalsStudio | `#metas` `#goals` | Herramientas / Participación | `goals` |
| RouletteStudio | `#ruleta` `#wheel` `#castigos` `#roulette` | Herramientas / Participación | `roulette` |
| PollsStudio | `#encuestas` `#versus` `#batallas` `#polls` | Herramientas / Participación | `polls` |
| TournamentStudio | `#torneos` `#tournament` | Herramientas / Participación | `tournament` |
| ChatStudio | `#chat` | Herramientas / En pantalla | `chat` |
| RaidStudio | `#raid` `#raids` | Herramientas / En pantalla | `raid` |
| MusicStudio | `#musica` `#ahora-suena` | Herramientas / En pantalla y Conexiones | `music` |
| Studio | `#studio` `#estudio` | Herramientas / En pantalla | `scene` |
| KofiStudio | `#kofi` `#ko-fi` | Conexiones (ventana) | `kofi`, `kofigoal`, `kofirecent` |
| GameStudio | `#juego` `#riot` | Conexiones (ventana) | `game` |
| Integraciones | `#integraciones` | Conexiones (contenido de la vista) | ninguna |
| Account | `#cuenta` | Plan y pagos (contenido de la vista) | ninguna |
| CloudSetup | `#nube` | Vista Nube (solo sin nube configurada) | ninguna |

## Catalog (src/pages/Catalog.tsx) → Inicio

- Módulos `cab-mod`: «Herramientas» (`data-tour="inicio-herramientas"`), «Canal» (`inicio-canal`), «Fuentes de OBS» (`inicio-fuentes`). Además `PrimerosPasos` (solo con cuenta activa de streamer).
- Controles: campo «Tu canal de Twitch» (ayuda: «Con este canal se crean las URL de OBS de esta página.»); filas de herramientas con estado real (`toolStatus`), «Probar» (Alertas, Recompensas, Metas, Ruleta, Batallas) y «Abrir»; copiar URL por fuente.
- Textos: «Probar» lanza un aviso de demostración (no cambia nada guardado); «Pega una URL en OBS como fuente de navegador, a 1920 × 1080. Con «Todo en uno» basta…»; errores de canal vacío y de portapapeles.
- Tour `catalogo` (3 pasos: canal, fuentes, herramientas). Guardado: automático (canal).
- Fase 1: ahora usa el registro, muestra «Todo en uno» destacada y «Ver fuentes individuales» plegado, tarjeta «Tu suscripción» con días y «Abrir» abre la ventana.

## Control (src/pages/Control.tsx) → En vivo

- Módulos: «Al aire» (`al-aire`), «Emergencia» (`emergencia`), «En cola» (`cola`), «Sesión» (`sesion`), «Registro» (`registro`), «Desde el chat» (`comandos`). Tour `control`.
- Contenido íntegro dentro de la vista En vivo; sin cambios en fase 1. Aviso «No hay ningún widget abierto…» y botón «Abrir widget» incluidos.

## Account (src/pages/Account.tsx) → Plan y pagos

- Módulos: «Tu espacio» (uso, subir/borrar archivos, avisos de cuota), «Tu cuenta» (Twitch, Plan, Conexión con OBS, Mi AI activo, Voces ElevenLabs, Clave de OBS con ver/copiar/generar, Términos y políticas, Cerrar sesión), `PanelFundador`, `MiPlan` (plan, ventana de pago `CheckoutWindow`, cancelar, código).
- Fase 1: la vista Plan y pagos muestra primero la tarjeta de días y `PaymentHistory`, y debajo la página completa sin pérdida.

## CloudSetup (src/pages/CloudSetup.tsx) → vista Nube

- Módulos: «La nube está apagada», «Qué falta, en orden» (variables de entorno con explicación). Sin cambios.


# Parte A: Alertas y premios, Participación

Convenciones comunes (válidas para las 7 páginas, verificadas en el código):

- Todas montan `<SuiteNav currentApp=… channel=… saved=…>` arriba. SuiteNav pinta el estado de guardado (`.shell-saved`, role=status): «Guardando» / «Guardado» / «Guardado en la nube», y el botón «Fuentes de OBS» (que abre `<ObsSyncNotice>` desde dentro de SuiteNav; ninguna página monta ObsSyncNotice por su cuenta). Solo Alertas, Recompensas, Metas y Ruleta pasan `onOpenTour`/`tourAvailable` (botón de guía en la cabecera).
- GUARDADO: en las 7 páginas es AUTOMÁTICO (cada cambio pasa por el hook `useXSettings`/`useTournament`). Ninguna tiene botón «Guardar» general. Excepciones de acción explícita: Torneos tiene «Crear enlace / Cambiar dirección» (formulario de la dirección de inscripción) y «Borrar el enlace y sus solicitudes».
- La fuente OBS es el parámetro `app` de `buildSuiteWidgetUrl(origin, app, canal, ajustes, extra)`. Mapeo SuiteNav (ruta → tipo de fuente): alertas→`alerts`, recompensas→`rewards`, powerups→`rewards`, mascotas→`pets`, torneos→`tournament`, metas→`goals`, ruleta→`roulette`.
- Todas las páginas tienen un «Monitor» 16:9 (`cab-stage`) sticky a la derecha (en <1100/1200 px sube arriba, `order-first`). En la nueva ventana, el Monitor/Probar se asigna a la pestaña «Probar» (o equivalente), pero debe conservarse el componente de vista previa. Decisión de diseño pendiente (fase 2): mostrar una vista previa mínima también en las pestañas de edición.
- Componentes comunes: `Field` (etiqueta + control + `cab-hint`), `Toggle` (interruptor `cab-tog`), `Range` (rango con salida `<output>`), `UndoNote`/`useUndo` (aviso «Deshacer» 8 s) en `src/components/studio/StudioKit.tsx`; `MediaField` en `src/components/recompensas/MediaField.tsx` (archivo: «Subir archivo»/«Cambiar archivo», «Subir a la nube», «Quitar», «Cancelar subida», barra de progreso, avisos locales/nube); `MediaLibraryModal` (modal «Biblioteca · elegir sonido (máximo 30 s)» / «Biblioteca · elegir vídeo»).
- Las clases `cab-mod` son los «módulos». Un módulo plegable `studio-details` (`<details>`) cuenta aquí como módulo propio.

## Alertas (src/pages/AlertsStudio.tsx)

**Ruta/alias:** `#alertas` o `#alerts` (también path `/alertas`, `/alerts`) → ruta `alertas`. **Fuente OBS:** `app=alerts` (botón «Copiar URL para OBS», con `{k: widget_key}` si hay cuenta activa; incluye voz y apariencia de TTS). Catálogo: «Alertas — Follows, suscripciones, bits y raids».

**Montajes:** `<SuiteNav currentApp="alertas">` con guía; `<GuidedTour id="alertas" appName="Alertas">` (se abre sola la primera vez a los 600 ms; `paddingBottom:220` mientras está abierta); `<MediaLibraryModal>` (audio o vídeo). Sin ObsSyncNotice propio. Guardado automático (`useAlertsSettings`).

**Pasos de la guía (id `alertas`):** 1 Bienvenida «Alertas de stream» (sin target) · 2 `alert-events` «Elige un evento» («Cada evento se activa o desactiva con su interruptor. «Nuevo evento» crea uno propio que se dispara con una palabra del chat.») · 3 `alert-editor` «Mensaje y sonido» («…El vídeo, los niveles y la apariencia están plegados debajo.») · 4 `stage-monitor` «Prueba y copia la URL» (««Probar» reproduce la alerta aquí y en las fuentes de OBS abiertas. «Copiar URL para OBS» te da la fuente de navegador a 1920 × 1080.»). Otros `data-tour` presentes: `alert-audio`, `alert-video`, `alert-tiers`, `alert-appearance`, `test-trigger`, `alert-obs`.

**Estructura (3 columnas ≥1200 px: 230 px | editor | 350 px monitor). Módulos en orden:**

1. **«Eventos»** (`data-tour=alert-events`) — lista de eventos seleccionables. Filas fijas: Follow, Suscripción, Bits, Raid; más los eventos personalizados (nombre + palabra clave en mono). Cada fila: botón de selección + interruptor «Activar {evento}». Botón «Nuevo evento» (crea «Evento nuevo», palabra `!evento`, plantilla «¡{user} activó un evento especial!», sonido Fanfarria, audioMode both). Aviso de deshacer tras eliminar: «Se eliminó «X». Deshacer» (8 s).
2. **Editor del evento** (título `<h2>` dinámico = nombre del evento; `data-tour=alert-editor`). Campos:
   - Solo personalizados: botón «Eliminar» (papelera) en la cabecera; «Nombre» (texto); «Palabra del chat» (texto mono, hint «El evento se dispara cuando alguien la escribe.»).
   - «Mensaje» (texto; hint «Variables: {user}» o por evento: Follow `{user}`; Suscripción `{user}, {detail}`; Bits `{user}, {bits}, {message}`; Raid `{user}, {viewers}`).
   - Solo Bits/Raid: «Bits mínimos» / «Espectadores mínimos» (número, hint «Por debajo de esta cantidad la alerta no aparece.»).
   - «Sonido» (`data-tour=alert-audio`): select (Campana, Fanfarria, Arcade, Pop suave, Sin sonido, Archivo propio) + botón «Escuchar». Con «Archivo propio»: texto «Elige un sonido de hasta 30 segundos.» / «Archivo: nombre · N s», botones «Elegir de la biblioteca» y «Subir archivo» (audio/*), error `cab-error`, rango «Volumen del archivo» (0–100 %).
   - Interruptor «Leer el mensaje con la voz del chat».
   - Interruptor «Sacudir la pantalla».
   - Solo personalizados: «Color del evento» (6 muestras: Morado, Rojo, Verde, Coral, Cian, Ámbar).
3. **«Vídeo o meme»** (`<details class=studio-details>`, `data-tour=alert-video`; título «Vídeo o meme · 1 archivo» si hay). Hint «Sin vídeo. Se reproduce encima de la alerta mientras está en pantalla.»; botones «Elegir de la biblioteca», «Subir archivo» (video/webm,mp4), «Quitar vídeo»; con vídeo: select «Fondo del vídeo» (Vídeo con transparencia (WebM) / Quitar el fondo negro / Quitar el fondo verde) y rango «Tamaño del vídeo» 50–200 %.
4. **«Niveles · N»** (`<details>`, `data-tour=alert-tiers`; solo en Bits y Suscripción, nunca en personalizados). Hint Bits: «Cada nivel se aplica desde su cantidad de bits y cambia mensaje, color y sonido.»; Suscripción: «Cada tipo de suscripción puede tener su propio mensaje, color y sonido.» Cada nivel (fieldset): «Nombre del nivel» (texto), «Desde cuántos bits» (número, solo bits), mensaje (texto), color (input color), sonido (select de 5), interruptor «Sacudir», botón **«Probar»** (por nivel).
5. **«Apariencia de todas las alertas»** (`<details>`, `data-tour=alert-appearance`). «Estilo» (segmentado de 9: Cabina, Bocadillo, Subtítulo, Sticker, Arcade, Aventura, Diálogo, Arcade con diálogo, Aventura con diálogo; `title` = descripción), «Color» (6 muestras + «Otro color»), «Posición» (rejilla de 6: arriba/abajo × izquierda/centro/derecha), interruptor «Posición aleatoria» (hint «Cada alerta sale en un punto distinto de la pantalla, nunca dos veces seguidas en el mismo.» / «Apagada, la alerta sale siempre en el punto elegido arriba.»), si aleatoria: rango «Margen con los bordes» (hint «Espacio que la alerta deja libre contra cada borde de la pantalla.»); rangos «Tiempo en pantalla» (2–15 s) y «Volumen general» (0–100 %).
6. **«Monitor»** (`data-tour=stage-monitor`, sticky). Escenario 16:9 con `AlertCard` (usa estilo/posición/sticker; vídeo superpuesto en prueba; sacudida con gsap), botón **«Probar {evento}»** (`data-tour=test-trigger`; suena aquí y manda `ALERT_TRIGGER` por bus a OBS abiertas), **«Copiar URL para OBS»** (→ «URL copiada»), línea de estado role=status («La prueba suena aquí y aparece en las fuentes de OBS que estén abiertas.» o mensajes `say`).

**Vista previa:** el Monitor (reposo con plantilla del evento seleccionado). **Botón Probar:** «Probar {evento}» + «Probar» por nivel + «Escuchar» (sonido). **Modales:** MediaLibraryModal (audio/vídeo).

**ASIGNACIÓN PROPUESTA** — Grupo: **Alertas y premios**. Ventana «Alertas», pestañas **Diseño | Sonido | Probar**. Riel/barra lateral persistente a la izquierda en las 3 pestañas: módulo 1 «Eventos» (selección + interruptores + «Nuevo evento»); sin él no se puede elegir qué evento se edita.
- **Diseño:** campos del módulo 2 — «Nombre», «Palabra del chat», «Mensaje» (+ variables), «Bits mínimos»/«Espectadores mínimos», «Color del evento», botón «Eliminar»; módulo 3 «Vídeo o meme»; módulo 4 «Niveles» (incluye sus «Probar» y selects de sonido/color por nivel, ya que son parte del nivel); módulo 5 «Apariencia de todas las alertas» (incluye «Volumen general» y «Tiempo en pantalla»; si se quiere, duplicar «Volumen general» como acceso en Sonido, pero conservar un único valor).
- **Sonido:** campos del módulo 2 — «Sonido» (select + «Escuchar» + archivo propio/biblioteca/volumen del archivo), «Leer el mensaje con la voz del chat», «Sacudir la pantalla».
- **Probar:** módulo 6 «Monitor» (vista previa, «Probar {evento}», «Copiar URL para OBS», estado).
- Tour `alertas`: reasignar targets (alert-events→riel, alert-editor→pestañas Diseño/Sonido, stage-monitor→Probar).

**Lista de comprobación:** módulos totales 6 / asignados 6 (1 Eventos→riel; 2 Editor→dividido Diseño+Sonido; 3 Vídeo→Diseño; 4 Niveles→Diseño; 5 Apariencia→Diseño; 6 Monitor→Probar).

## Recompensas (src/pages/RewardsStudio.tsx)

**Ruta/alias:** `#recompensas` o `#rewards` (path `/recompensas`, `/rewards`) → `recompensas`. **Fuente OBS:** `app=rewards` («Recompensas — Sonidos, placas y vídeos por puntos o bits»), con extra `rw` = ajustes codificados (+ `k` widget_key si hay nube activa); variante «URL con placa de muestra» añade `demo=1` y `plate=<estilo de la recompensa>`.

**Montajes:** `<SuiteNav currentApp="recompensas">` con guía; `<GuidedTour id="recompensas" appName="Recompensas">` (auto la primera vez); `<MediaLibraryModal>` (audio o vídeo, título «Biblioteca · elegir sonido (máximo 30 s)» / «Biblioteca · elegir vídeo»). Guardado automático (`useRewardsSettings`). Al montar lanza una muestra silenciosa de la primera recompensa en el monitor. Al salir libera archivos huérfanos del almacén.

**Pasos de la guía:** 1 Bienvenida «Recompensas» · 2 `rewards-list` «Elige una recompensa» («Cada fila es una recompensa, con lo que la activa. Debajo puedes añadir otra, por puntos o por bits.») · 3 `reward-editor` «Qué la activa y qué hace» («…Debajo están las reglas comunes a todas.») · 4 `rewards-monitor` «Prueba y copia la URL» («Las pruebas disparan la capa aquí y en las fuentes de OBS abiertas, sin gastar nada. …1920 × 1080.»).

**Estructura (≥1200 px: 220 | editor | 410 monitor). Módulos en orden:**

1. **«Recompensas»** (`data-tour=rewards-list`) — lista de filas (nombre + «{trigger} · con placa/vídeo/solo sonido · apagada»). Etiqueta «Nueva recompensa» con botones «Puntos» y «Bits». Deshacer tras eliminar (`UndoNote`, 9 s antes de liberar archivos).
2. **Editor de la recompensa** (`<h2>` = nombre; `data-tour=reward-editor`; vacío: «Sin recompensas» + nota «No hay ninguna recompensa. Crea una con «Puntos» o «Bits»…»). Contiene:
   - Botón «Eliminar»; «Nombre» (texto, 60 máx., hint «Es el nombre del sonido que sale en la placa.»); «Color» (6 muestras Morado, Rojo, Verde, Ámbar, Cian, Coral + «Otro color»); interruptor «Encendida».
   - `TriggerFields`: «Se activa con» (segmentado Puntos de canal / Bits); «Quién puede activarla» (Todos / Suscriptores / VIP y mods). Si puntos: «Costo en puntos» (número, hint «Lo cobra Twitch. Aquí es solo para que la reconozcas.»); «Recompensa de Twitch» (hint «Enlazada: xxxx…» / «Aún sin enlazar: en directo no se activará.»; botones «Detectar»/«Detectar otra vez»/«Cancelar», «Desenlazar»; avisos «Escuchando el chat de #canal…»; nota larga «La recompensa de Twitch tiene que tener activado «Requerir que el espectador escriba un texto»…»). Si bits: «Cantidad» (Exacta/Rango), «Bits»/«Mínimo» (hint «Número entero, desde 1.»), «Máximo (opcional)» (hint «Vacío: sin tope.»), hint de prioridad («Si dos recompensas coinciden con el mismo cheer, suena solo una: gana la más específica…»), simulador «Con un cheer de [n] bits suena: …», aviso `rw-warn` si el mínimo es bajo. Siempre: «Espera entre usos» (número s, hint «En segundos. Un uso antes de tiempo se descarta y queda anotado; no se guarda para después. Con 0 no hay espera.»).
3. **«Sonido»** (`<details open>`; título «Sonido · archivo propio»). `SoundFields`: «Sonido de serie» (select: Arcade (0,6 s), Fanfarria (0,6 s), Campana (1,4 s), Pop suave (0,25 s), Sin sonido) + «Escuchar»; «Tu archivo de sonido» (MediaField, botón extra «Elegir de la biblioteca», hint «Sin archivo. MP3, WAV u OGG de hasta 30 segundos; un clip de menos de un segundo también vale y suena entero.»); «Volumen» (0–100 %).
4. **«Placa»** (`<details open>`; título «Placa · apagada, solo sonido» si no). `PlateFields`: interruptor «Mostrar una placa mientras suena (quién y qué sonido)» (hint «Apagado, es solo sonido: no aparece ninguna placa. Si la recompensa tiene vídeo, el vídeo sale igual.»); si hay placa: interruptor «Usar el estilo de todas ({nombre})»; si propio: «Estilo de esta recompensa» (miniaturas de 6 estilos: Cabina, Cinta, Boleto, Cómic, Cristal, Personalizado, con hint por estilo); interruptor «Escribir una frase en lugar del nombre del espectador»; «Frase» (texto 120, variables `{user}, {reward}, {message}`).
5. **«Vídeo»** (`<details>`; «Vídeo · 1 vídeo»). `VideoFields`: «Vídeo» (MediaField + «Elegir de la biblioteca», hint «Sin vídeo. Acepta WebM y MP4; se reproduce al activarse la recompensa.»); «Posición» (rejilla de 9, hint «Fija: …» / «Cada vez cae en un sitio distinto.» / «Ocupa toda la pantalla. En una escena de Studio, toda su caja.»); interruptores «Posición aleatoria» y «Pantalla completa»; si aleatoria: «Zona permitida: margen a los bordes» (hint «La línea discontinua del monitor es la zona permitida. No se ve en OBS.»), «Variar un poco el tamaño (hasta un 20% más o menos)», «No repetir la misma zona dos veces seguidas»; «Tamaño del vídeo» (50–200 %, no en pantalla completa), «Tiempo del vídeo en pantalla» (0 = «Lo que dure»), «Fondo del vídeo» (3 modos), interruptor «Sacudir la pantalla».
6. **«Reglas para todas»** (`GeneralRules`). Interruptores «Reaccionar a los canjes y a los cheers del chat» (hint «Apagado, la capa no hace nada aunque esté en OBS. Las pruebas de esta página siguen funcionando.») y «Mostrar también en «Todo en uno»» (hint «La fuente «Recompensas» las muestra siempre.»); «Si llegan varias a la vez» (En cola, una tras otra / Se solapan; hint por modo); rangos «Máximo sonando a la vez» (solo solapadas), «Cuántas pueden esperar turno» (hint «Con la cola llena, las siguientes se descartan.»), «Espera general» (hint «Tiempo mínimo entre dos recompensas cualesquiera.»), «Límite por espectador» (hint «Usos de una misma persona en un minuto.»), «Tiempo mínimo de la placa» (hint «Aunque el sonido dure menos de un segundo. Un clip largo la mantiene hasta que acaba, con tope de 30 s.»); nota «Un uso que llega antes de tiempo… se descarta y queda anotado en el registro del monitor…»; y «Estilo de placa para todas» (selector de 6 miniaturas, hint + «Cada recompensa puede elegir otro.»).
7. **«Placa «Personalizado»»** (`<details open>` dentro de Reglas; solo si algún estilo `custom` está en uso). `CustomPlateFields`: «Imagen o vídeo de la placa» (MediaField; hint «Sin archivo. PNG, GIF, WebP o SVG; o un vídeo WebM o MP4, que se repite sin sonido…»), «Ancho de la placa» (% del ancho), interruptor «Mostrar los textos sobre la placa» (hint «Apagado, sale solo tu imagen o tu vídeo.»), «Dónde va el nombre del sonido» y «Dónde va el nombre del espectador» (rejillas 9; hint «En la misma celda, van uno debajo del otro.»), «Color del texto» (Blanco, Negro, Amarillo, Cian + «Otro color»).
8. **«Monitor»** (`data-tour=rewards-monitor`). Escenario con `RewardsLayer` (zona segura discontinua si posición aleatoria); botones **«Probar esta»** y **«Vaciar»**; «Qué la dispara»: «Canje de puntos», «Tres seguidos», «Clip corto», «Posición del vídeo»; «Cheer de [n]» + botón «Enviar {bit/bits}»; interruptor «Aplicar esperas y límites en estas pruebas» (hint «Apagado, puedes repetir una prueba sin esperar. En directo se aplican siempre.»); contador «En cola: N. Sonando: N.»; registro `rw-log` (6 líneas) o hint «Las pruebas suenan aquí y en las fuentes de OBS abiertas en este navegador. No gastan puntos ni bits. Si no oyes nada, pulsa una vez en la página…»; botones «Copiar URL para OBS» y «URL con placa de muestra»; nota si no hay nube: «Sin cuenta en la nube, los ajustes viajan dentro de la URL: vuelve a copiarla en OBS cuando cambies algo. Los archivos que subas se quedan en este navegador y no llegan a OBS.»

**Vista previa:** Monitor. **Probar:** sí (varios botones + bus `REWARD_TEST`).

**ASIGNACIÓN PROPUESTA** — Grupo: **Alertas y premios**. Ventana «Recompensas», pestañas **Ajustes | Apariencia | Probar**; riel persistente a la izquierda con módulo 1 «Recompensas» (lista + «Nueva recompensa» Puntos/Bits + deshacer).
- **Ajustes:** módulo 2 «Editor» (nombre, color, encendida, `TriggerFields` completo); módulo 3 «Sonido»; módulo 6 «Reglas para todas» (todo salvo «Estilo de placa para todas»).
- **Apariencia:** módulo 4 «Placa»; módulo 5 «Vídeo»; parte «Estilo de placa para todas» del módulo 6 (mover aquí; mantener su hint); módulo 7 «Placa «Personalizado»» (condicional, mantener su condición `customInUse`).
- **Probar:** módulo 8 «Monitor».
- Tour `recompensas`: reasignar targets.

**Lista de comprobación:** módulos totales 8 / asignados 8 (6 se reparte entre Ajustes y Apariencia: reglas y estilo de placa).

## Power-ups (src/pages/PowerupsStudio.tsx)

**Ruta/alias:** `#powerups` / `#power-ups` (regex `^power-?ups([?/]|$)`) → `powerups`. **Fuente OBS:** esta página NO copia URL propia. SuiteNav la mapea a tipo `rewards`; la nota del monitor dice: «Lo que hace cada Power-up sale en la fuente «Recompensas» o en «Todo en uno». La voz habla en «Voz del chat» o en «Todo en uno».» Las pruebas viajan por bus `TWITCH_EVENT` y, con cuenta, por `pushTestEvent` a las fuentes de OBS.

**Montajes:** `<SuiteNav currentApp="powerups" channel saved>` SIN guía (sin GuidedTour, sin `onOpenTour`), sin modales ni MediaLibrary. Guardado automático (`usePowerupsSettings`). Usa `RewardsLayer` (recompensas) en el monitor y un aviso `ovl-plate` propio. Al montar, con cuenta Twitch, lee permisos/lista (`readFromTwitch`) y consulta suscripciones (`runSubscriptions`).

**Estructura (≥1100 px: columna de ajustes | monitor 1,1fr). Módulos en orden:**

1. **«Permiso de Twitch»** — sin nube: nota «Los Power-ups necesitan una cuenta de Tally Studio conectada con Twitch, y este despliegue no tiene la nube encendida…»; sin Twitch: «Esta cuenta no está conectada a un canal de Twitch.»; con Twitch: «Twitch conectado como {login}» + chip «Permisos concedidos»/«Falta permiso»/«Sin comprobar»; lista: «Tally Studio necesita leer los Bits para saber cuándo alguien usa un Power-up y cuál.», «Solo lee: no puede gastar Bits, ni crear o cambiar tus Power-ups.», «Falta: … Conectaste tu cuenta antes de que Tally Studio lo pidiera.»; botón «Volver a autorizar» / «Reconectar Twitch» / «Abriendo Twitch»; hint si el permiso es antiguo; error `wrongApp` («La entrada con Twitch usa una aplicación de Twitch distinta de la del servidor de Tally Studio… Client ID…»).
2. **«Canal de eventos»** — hint «Twitch no avisa de los Power-ups por el chat. Con el canal encendido, Twitch avisa al servidor de Tally Studio y de ahí llega a tus fuentes de OBS en pocos segundos.»; lista de suscripciones (nombre, estado, chip Encendida/Apagada/Con problema); botones «Encender»/«Reparar lo que falte», «Volver a consultar», «Apagar»; interruptor «Lanzar también los canjes de puntos que no piden texto» (hint «Los canjes con texto ya llegan por el chat. Los que no lo piden solo llegan por este canal, y lanzan la recompensa que tengas enlazada en «Recompensas».»); hint «Los Bits que lleguen por aquí suman a tus metas de bits. Se apaga meta a meta en» + enlace a `#metas`.
3. **«Tus Power-ups y lo que lanzan»** — interruptor «Reaccionar a los Power-ups» (hint «Apagado, Tally Studio no hace nada con ningún Power-up. Las pruebas de esta página siguen funcionando.»); notas de lista vacía según estado; lista (personalizados leídos de Twitch + 3 de serie: Emote gigante, Celebración en pantalla, Efecto de mensaje) con chips «De serie»/«Personalizado»/«Pide texto»/«En pausa en Twitch»/«Apagado en Twitch» y «N bits»; por cada uno: select «Acción para {x}» (No hacer nada, Sonar un audio, Mostrar un vídeo, Aviso en pantalla, La voz lee un mensaje), select «Recompensa de Tally Studio para {x}» (si sonido/vídeo; opción «Elige una recompensa»), campo «Texto para {x}» (si aviso/voz; variables `{user}`, `{powerup}`, `{bits}`, `{message}`), botón **«Probar»** por fila y hints contextuales; pie con hint «Para añadir, quitar o cambiar el precio de un Power-up hay que hacerlo en Twitch. Lista leída el …» y botón «Volver a leer de Twitch».
4. **«Lo que no se puede hacer»** — lista informativa de 3 viñetas (crear/borrar/cambiar precio; devolver Bits o marcar canje; sustituir el efecto de Twitch).
5. **«Monitor»** (sticky) — escenario con `RewardsLayer` + aviso; campo «Otros avisos que llegan por el canal» (hint «Son eventos de ejemplo. Recorren el mismo camino que uno real, pero no suman a las metas.») con botones «Alguien anima con 100 bits» y «Canje de puntos sin texto»; estado (role=status) «Pulsa «Probar» en un Power-up. Lo que haría Tally Studio sale aquí y, si tienes fuentes abiertas, también en ellas.»; nota sobre qué fuente muestra qué.

**Vista previa:** Monitor. **Probar:** «Probar» por fila + dos botones del monitor.

**ASIGNACIÓN PROPUESTA** — Grupo: **Alertas y premios**. Ventana «Power-ups». DESVÍO MOTIVADO de las pestañas sugeridas: esta página no tiene módulos de apariencia (todo es conexión y asignación de acciones), así que «Apariencia» quedaría vacía. Pestañas: **Conexión | Power-ups | Probar**.
- **Conexión:** módulo 1 «Permiso de Twitch»; módulo 2 «Canal de eventos»; módulo 4 «Lo que no se puede hacer».
- **Power-ups:** módulo 3 «Tus Power-ups y lo que lanzan» (con «Probar» por fila).
- **Probar:** módulo 5 «Monitor» (+ los dos botones «Otros avisos…»).
(Si el orquestador prefiere el trío estándar, usar «Ajustes» = Conexión+Power-ups y omitir Apariencia.)

**Lista de comprobación:** módulos totales 5 / asignados 5.

## Mascotas (src/pages/PetsStudio.tsx)

**Ruta/alias:** `#mascota`, `#mascotas`, `#pets` (regex `^(mascotas?|pets)([?/]|$)`) → `mascotas`. **Fuente OBS:** `app=pets` («Mascota — Tu personaje reacciona con voz a canjes, bits y al chat»), extra `ps` = ajustes codificados (+ `k` si hay nube); variante `demo=1`.

**Montajes:** `<SuiteNav currentApp="mascotas">` SIN guía; sin modales; guardado automático (`usePetsSettings`). YA TIENE PESTAÑAS internas (`role=tablist`, clase `pt-tabs`, `aria-label="Secciones de Mascotas"`): **Personaje | Activadores | En pantalla**. Monitor siempre visible a la derecha. Al montar dispara una reacción de ejemplo («Canje de puntos») a los 600 ms.

**Estructura. Módulos en orden:**

*Pestaña Personaje*
1. **«Personaje»** — interruptor «La mascota reacciona en directo» (hint «Apagada no hace nada aunque esté en OBS. Las pruebas de esta página siguen funcionando.»); «Personajes de Tally Studio» (galería de 5: Chispa (llamita), Eco (bocadillo con patas), Bit (robot-monitor), Miso (gato con cascos), Axo (ajolote) + «El tuyo» si hay imagen propia; `title` = descripción; hint con descripción y «Parpadean, mueven la boca con la voz y cambian de cara con la emoción de la frase.»); «Color» (6 muestras, hint «Tiñe al personaje de Tally Studio, las chispas y la etiqueta del rótulo. La sombra y la luz se ajustan solas.»).
2. **«Tu propio personaje»** — hint «PNG, GIF, WebP o SVG con fondo transparente. Con una sola imagen, el personaje se mueve al hablar. Con dos, Tally Studio las alterna al ritmo de la voz; si la de hablar es un GIF, se ve mientras dure la frase.»; «En reposo» (MediaField; «Sin imagen: se usa un personaje de Tally Studio.»); «Hablando (opcional)» (solo con reposo); `<details class=pt-emo>` «Una imagen por emoción (opcional)» con 5 MediaField: Feliz, Emocionado, Triste, Enojado, Sorprendido.
3. **«Nombre y voz»** — «Nombre» (texto, hint «Sale en el texto y sirve para llamarla en el chat.»); «Voz» (select: «La misma que la Voz del chat» + catálogo; hint «Con una voz distinta, el chat distingue quién habla. Usa el mismo motor que la Voz del chat.»).

*Pestaña Activadores*
4. **«Cuándo reacciona»** — 6 filas (interruptor «Activar: …», nombre, hint, botones «Editar» y «Probar»): Canje de puntos, Bits, Power-up, La llaman en el chat, Raid, Chat en silencio. Panel «Editar» desplegable por fila: «Frases» (textarea, una por línea; hint «Una por línea; la mascota elige una al azar. Con [feliz], [triste], [emocionado], [enojado] o [sorprendido] al principio, cambia la voz y la cara. Variables: …»), «Espera entre reacciones (s)»; extra por activador: Bits → «Bits mínimos»; La llaman → «Comando» (hint «En el chat: !x o su nombre, N.»); Chat en silencio → «Minutos sin mensajes»; Canje de puntos → interruptor «No anunciar los canjes que piden texto» (hint «Esos canjes ya los lee la Voz del chat; así no se oyen dos veces.»).
5. **«Turnos con la Voz del chat»** — segmentado «Turno de la mascota»: Espera su turno / Pasa primero / Calla si hay cola, con hint de cada uno.

*Pestaña En pantalla*
6. **«Dónde y cuándo se ve»** — «Posición» (Abajo izq., Abajo der., Arriba izq., Arriba der.), «Presencia» (Siempre en pantalla / Solo cuando habla), «Tamaño» (rango; «N px a 1080p»), interruptor «Mostrar también en «Todo en uno»» (hint «La fuente «Mascota» la muestra siempre. No actives las dos a la vez en OBS o hablará dos veces.»).
7. **«Movimiento»** — «Entrada y salida» (Asoma, Salta, Desliza, Aparece; previsualiza en el monitor), «En reposo» (Respira, Flota, Quieta), «Efecto al activarse» (Chispas, Onda, Sacudida, Ninguno; hint «Con «reducir movimiento» activo en el sistema, todo pasa a fundidos.»).
8. **«Texto en pantalla»** — segmentado «Estilo del texto»: Bocadillo, Rótulo, Solo voz (hint «Las palabras aparecen al ritmo de la voz. Con «Solo voz» no sale texto.»).

*Fuera de pestañas*
9. **«Monitor»** (sticky) — escenario `PetLayer`; «Qué la despierta» (6 botones de prueba, uno por activador); «Cara según la emoción» (Neutral + 5 emociones; hint «Empieza una frase con [feliz], … y la mascota la dice con esa voz y esa cara.»); botones «Copiar URL para OBS» y «Copiar URL con reacciones de muestra»; estado (role=status) («Las pruebas usan datos de ejemplo. En el monitor la voz no suena: se oye en la fuente de OBS.» / «Falta tu canal: escríbelo en Inicio antes de copiar la URL.»); nota «Los canjes de puntos y los Power-ups llegan por el canal de eventos: enciéndelo en «Power-ups». Los bits, las llamadas en el chat y las raids llegan por el chat y no necesitan nada más.»

**Vista previa:** Monitor. **Probar:** sí (por activador en Activadores y en Monitor; emociones). Sin tour.

**ASIGNACIÓN PROPUESTA** — Grupo: **Voz e IA** (el personaje habla con voz; alternativa razonable: «En pantalla», decidir en fase 2; el diseño aprobado sitúa la voz en el primer grupo). Ventana «Mascotas», se mantienen exactamente las pestañas actuales: **Personaje | Activadores | En pantalla** (módulos 1–3 → Personaje; 4–5 → Activadores; 6–8 → En pantalla). El módulo 9 «Monitor» queda como vista previa persistente a la derecha en las tres pestañas (porque aquí el monitor ya es fijo y las pruebas por activador están dentro de Activadores) o, si la ventana no admite panel lateral, como cuarta pestaña «Probar». Atención: los botones «Probar» y «Editar» de cada activador pertenecen a Activadores.

**Lista de comprobación:** módulos totales 9 / asignados 9.

## Torneos (src/pages/TournamentStudio.tsx)

**Ruta/alias:** `#torneo`, `#torneos`, `#tournament` (regex `^(torneos?|tournament)([?/]|$)`) → `torneos`. OJO: `#torneo/<slug>` (con slug) NO es esta página: `parseSignupRoute` lo resuelve antes como ruta pública `inscripcion`. **Fuente OBS:** `app=tournament` («Torneo — La llave, la tabla y el campeón de tu torneo»), extra `ts` = ajustes codificados (+ estado de la llave solo si no vive en la nube) y `k` si hay nube; variante `demo=1`. Fuente transparente a pantalla completa 1920 × 1080.

**Montajes:** `<SuiteNav currentApp="torneos">` SIN guía; SIN modales: la confirmación va inline (`role=alertdialog`, «Confirmar») con texto de aviso, botón de acción («Añadir y reiniciar», «Quitar y reiniciar», «Mover y reiniciar», «Sortear y reiniciar», «Reiniciar la llave», «Aceptar y reiniciar», «Pasar a N equipos»…) y «Dejarlo como está». Guardado: los AJUSTES se guardan solos; el ESTADO de la llave va por `tournamentStore` (nube con cuenta activa; si no, bus a OBS del navegador). YA TIENE PESTAÑAS (`pt-tabs`, `aria-label="Secciones de Torneos"`): **Torneo | En directo | Marca | Narrador y comandos**; la pestaña «Torneo» muestra un chip numérico con las solicitudes de inscripción pendientes (visible desde cualquier pestaña, `aria-label` «N solicitudes pendientes»).

**Estructura. Módulos en orden:**

*Pestaña Torneo*
1. **«Torneo»** — interruptor «El torneo sale en directo» (hint «Apagado no se ve ni atiende comandos, aunque esté en OBS. El monitor de esta página sigue funcionando.»); «Nombre del torneo» (texto); «Juego» (texto; hint «Sale escrito bajo el nombre, en todas las pantallas.»); «Tamaño de la llave» (4/8/16 equipos; hint «Eliminación directa: quien pierde queda fuera.»; pide confirmar si quita equipos o reinicia); «Jugadores por equipo» (1 a 5 «N contra N»); interruptor «Mostrar también en «Todo en uno»» (hint «La fuente «Torneo» lo muestra siempre. No actives las dos a la vez en OBS o el narrador hablará dos veces.»).
2. **«Inscripción por enlace»** (de `SignupPanel`; solo funciona con nube + cuenta) — «Dirección de la inscripción» (prefijo `#torneo/` + slug mono; botón «Crear enlace»/«Cambiar dirección»; hint «Quien abra esa dirección ve tu torneo y puede inscribir a su equipo, sin cuenta.» / «Te proponemos una a partir del nombre. Al crear el enlace se publican el nombre, el juego, el logo y los patrocinadores del torneo.»); con enlace: «Copiar enlace», «Ver la página» (enlace externo), interruptor «Inscripción abierta» (hint con plazas libres / «Cerrada: la página enseña el torneo y sus equipos, pero no el formulario.»), error de publicación, botón «Borrar el enlace y sus solicitudes».
3. **«Presentación de la página»** (solo con enlace) — interruptor «Mostrar la presentación antes del formulario» (hint «Quien abre el enlace ve primero a Axo explicar el torneo en seis pasos…»), textarea «Reglas propias (una por línea)» (hint de límites; «Salen después de las reglas generales…»), nota de migración Supabase 0018 si falta, hint «Para verla tal como queda, abre «Ver la página» aquí arriba.»
4. **«Solicitudes»** (solo con enlace; chip «N pendientes») — botón «Actualizar»; lista de pendientes (capitán, jugadores, fecha «Enviada el …») con «Aceptar», «Rechazar», «Quitar la solicitud de {equipo}»; texto «No hay solicitudes pendientes. Las nuevas aparecen aquí solas en unos segundos…»; `<details>` «Respondidas (N)» con «Aceptar»/«Quitar»; hint «Quitar una solicitud aceptada borra sus datos, pero no saca al equipo de la llave: eso se hace en «Equipos».»
5. **«Equipos»** — hint «N de M en la llave. El orden de la lista es el de la llave: el 1 juega contra el 2, el 3 contra el 4…» (+ aviso de huecos libres con pase directo); lista ordenada con nombre editable («Nombre del equipo N») y botones «Subir a», «Bajar a», «Quitar a»; formulario «Nombre del equipo nuevo» + «Añadir equipo» + «Sortear el orden»; avisos de error; hint «Los equipos que aceptes en «Solicitudes» entran al final de esta lista. También puedes escribirlos a mano.»

*Pestaña En directo*
6. **«Mesa de control»** — bloque «En juego · {partida}» con «Gana {equipo}» ×2, o «Torneo terminado / Campeón: …» con «Celebrar al campeón», o «Sin partida · Faltan equipos» (hint «Añade al menos dos en la pestaña «Torneo»…»); «Deshacer el último resultado», «Reiniciar la llave»; «Pantalla» (segmentado Llave, Sigue, Tabla, Victoria, Campeón, Oculto; hint «Lo que se ve ahora en OBS. «Victoria» repite el último resultado; «Oculto» no enseña nada.»); «Lo que dura la pantalla de victoria» (rango s; hint «Después vuelve sola a la llave, con el ganador entrando en su casilla.»). Fuera del módulo, nota `cab-note` sobre sincronización con nube/sin nube (texto largo, dos variantes).

*Pestaña Marca*
7. **«Estilo»** — segmentado (Grieta, Cabina, Estadio, Cartel) con hint de `about`; interruptor «Color propio» + input color «Color propio» (hint «Sustituye al color de acento del estilo. El texto que va encima se aclara u oscurece solo para leerse bien.»).
8. **«Logo»** — «Logo del canal» (MediaField; hint «Sale arriba a la izquierda en todas las pantallas. PNG, GIF, WebP o SVG; mejor con fondo transparente.»; vacío «Sin logo: en OBS ese hueco no sale.»).
9. **«Patrocinadores»** — hint «Salen abajo, tras «Con el apoyo de». Con imagen se ve el logo; sin ella, el nombre. Hasta N.»; por patrocinador: «Nombre del patrocinador N», «Quitar», MediaField; botón «Añadir patrocinador».

*Pestaña Narrador y comandos*
10. **«Narrador»** — interruptor «Una voz cuenta lo que pasa» (hint «Narra cada cambio de pantalla y cada resultado, con la emoción que toca. Espera su turno en la misma cola que la Voz del chat.»); «Voz» (select; hint «De serie, Brisa. Usa el mismo motor que la Voz del chat.»); «Lo que diría ahora» (chip de emoción + frase; «Con el torneo oculto no dice nada.»); botón «Decirlo en OBS».
11. **«Comandos»** — hint «Solo los atiende si los escribe el streamer o un moderador. Puedes cambiarles el nombre.»; 3 campos mono: «Marcar ganador», «Deshacer», «Pantallas y reinicio»; lista de ayuda de comandos (`cab-cmds`); «Pruébalo aquí, como en el chat» (campo + «Enviar»; respuesta en role=status).

*Fuera de pestañas*
12. **«Monitor»** (sticky; chip con el nombre de la pantalla) — `TournamentLayer`; campo «Pantalla» (segmentado de 6 escenas, duplicado del de la Mesa de control); botones «Copiar URL para OBS» y «Copiar URL con pantallas de muestra»; estado (role=status) («El monitor enseña tu llave tal como saldrá en OBS. La voz del narrador solo se oye en la fuente de OBS.» / «Falta tu canal: escríbelo en Inicio…»); nota «La fuente ocupa la pantalla entera (1920 × 1080) y es transparente: ponla encima de tu partida. Si copiaste la URL sin cuenta en la nube, vuelve a copiarla cuando cambies los equipos.»

**Vista previa:** Monitor. **Probar:** «Decirlo en OBS», prueba de comandos, escenas del segmentado «Pantalla». Sin tour.

**ASIGNACIÓN PROPUESTA** — Grupo: **Participación**. Ventana «Torneos». Las sugeridas (Torneo | En directo | Marca) no cubren Narrador y comandos, que ya es una pestaña real: se conserva como cuarta pestaña (o fusionar «Narrador» y «Comandos» en «En directo» si se quiere exactamente tres). Propuesta: **Torneo | En directo | Marca | Narrador y comandos**.
- **Torneo:** módulos 1, 2, 3, 4, 5 (con el chip de pendientes en la etiqueta de pestaña).
- **En directo:** módulo 6 «Mesa de control» (+ la nota de sincronización); el segmentado «Pantalla» del monitor (módulo 12) debe seguir accesible aquí.
- **Marca:** módulos 7, 8, 9.
- **Narrador y comandos:** módulos 10, 11.
- **Monitor (12):** panel persistente de vista previa o, si no cabe, el contenido «Copiar URL…» + estado + nota pasan a «En directo».
- El diálogo de confirmación inline `alertdialog` debe poder aparecer en cualquier pestaña (ya se renderiza encima del contenido de todas).

**Lista de comprobación:** módulos totales 12 / asignados 12.

## Metas (src/pages/GoalsStudio.tsx)

**Ruta/alias:** `#metas` o `#goals` (path `/metas`, `/goals`) → `metas`. **Fuente OBS:** `app=goals` («Metas — Barras de progreso»), solo `{k: widget_key}` extra con nube activa.

**Montajes:** `<SuiteNav currentApp="metas">` con guía; `<GuidedTour id="metas" appName="Metas">` (auto la primera vez); `<MediaLibraryModal>` (audio o vídeo). Guardado automático (`useGoalsSettings`). Confeti en `<canvas>` sobre el monitor y vídeo de victoria. Al salir, si hay una prueba en curso, restaura OBS (`GOALS_SETTINGS_UPDATE`).

**Pasos de la guía:** 1 Bienvenida «Metas» · 2 `goals-list` «Tus metas» («Elige una meta para editarla. El interruptor decide si se muestra en pantalla.») · 3 `goals-mode` «Cómo se reparten» («A la vez, por turnos o solo una, y en qué punto de la pantalla. En automático, hasta 4 metas se ven a la vez y con 5 o más pasan a carrusel.») · 4 `goals-editor` «Título, progreso y diseño» (««Va en» y «Meta» son el progreso real…») · 5 `goals-monitor` «Prueba y copia la URL» (««Probar» mueve la meta aquí y en OBS sin tocar lo guardado…»).

**Estructura (≥1200 px: columna 250 px con 2 módulos | editor | 380 px monitor). Módulos en orden:**

1. **«Metas»** (`data-tour=goals-list`) — lista (título + «X de Y» en mono) con interruptor «Mostrar {título} en pantalla»; botón «Nueva meta» (crea «Meta nueva», subs, 0/50, barra, morado, confeti y sacudida activos, fanfarria); aviso Deshacer (`UndoNote`).
2. **«En pantalla»** (`data-tour=goals-mode`) — «Reparto» (segmentado Auto / Carrusel / A la vez / Solo una; hints «Hasta 4 metas se ven a la vez; con 5 o más pasan a carrusel.», «Una meta cada vez, por turnos.», «Todas a la vez, con un máximo de 4. Al centro van en fila; en un lateral, apiladas.», «Solo la meta que tengas elegida en la lista.»); «Posición» (rejilla de 6; hint «La Cinta ocupa el borde entero, arriba o abajo.»); si hay carrusel: «Cada meta se queda» (3–30 s).
3. **Editor de la meta** (`<h2>` = título; `data-tour=goals-editor`). Botón «Eliminar» (solo si hay >1 meta). Campos: «Título»; «Qué cuenta» (Suscripciones, Seguidores, Bits, Raids, Puntos; fija la unidad); «Va en» (número); «Meta» (número); «Diseño» (galería de 6: Barra, Anillo, Bloques, Cinta, Columna, Personalizado; hint por diseño, p. ej. «La clásica, ancha y con marcas en los hitos…»; botón «Usar en todas las metas» si difieren); bloque Personalizado (solo con diseño `custom`): «Forma» (Barra, Anillo, Bloques, Columna; hint «La Cinta no se personaliza: ocupa el borde entero.»), «Fondo» y «Texto» (colores), «Tipografía» (Archivo condensada, Onest, Bricolage, JetBrains Mono), «Tamaño» (rango %), «Redondeo» (rango), interruptores «Título» y «Meta y unidad»; «Color de avance» (6 muestras Morado, Cian, Oro, Verde, Rojo, Coral + «Otro color»; hint «El texto que va encima se aclara u oscurece solo para que se lea.»).
4. **«Al completar»** (`<details>`) — interruptores «Confeti» y «Sacudir la pantalla»; «Vídeo» (hint «Sin vídeo. Acepta WebM y MP4; aparece en el centro de la pantalla.»; «Elegir de la biblioteca», «Subir archivo», «Quitar vídeo»); «Sonido» (select Fanfarria, Arcade, Campana, Pop suave, Sin sonido, Archivo propio + «Escuchar»; con archivo propio: «Elegir de la biblioteca», «Subir archivo», «Quitar», error, rango «Volumen del archivo»; texto «Elige un sonido de hasta 30 segundos.»).
5. **«Voz»** (`<details>`) — interruptores «Anunciar cada avance» y «Anunciar al llegar al 25, 50, 75 y 100 %»; hint «Vale para todas las metas. Los anuncios usan la voz del navegador.»
6. **«Bits de Twitch»** (`<details open>`; solo cuando el tipo de la meta es Bits) — interruptor «Sumar a esta meta los Bits de cheers y Power-ups»; hint largo («Cuenta todos los Bits que se gastan en tu canal… Necesita el canal de eventos de Twitch, que se enciende en» + enlace a `#powerups`…).
7. **«Monitor»** (`data-tour=goals-monitor`) — escenario con `GoalsOverlayView` + canvas de confeti + vídeo; campo «Probar» (hint «Las pruebas mueven la meta elegida en este monitor y en las fuentes de OBS abiertas, sin cambiar lo guardado. Los hitos son el 25, 50 y 75 %.») con botones «Aporte +1», «Aporte +5», «Hasta el siguiente hito», «Completar», «Reiniciar», «Probar celebración» (esta suena, lanza confeti/sacudida y envía `GOAL_CELEBRATE` a OBS); botón «Copiar URL para OBS» (→ «URL copiada»); estado (role=status) («El monitor muestra tus metas tal como están guardadas.» / «El monitor y OBS muestran una prueba. Tus metas guardadas no han cambiado.»).

**Vista previa:** Monitor (con el valor de prueba por meta). **Probar:** sí.

**ASIGNACIÓN PROPUESTA** — Grupo: **Participación**. Ventana «Metas», pestañas **Ajustes | Apariencia | Probar**; riel persistente a la izquierda con módulo 1 «Metas» (lista + «Nueva meta» + deshacer).
- **Ajustes:** campos del módulo 3 — «Título», «Qué cuenta», «Va en», «Meta», «Eliminar»; módulo 4 «Al completar»; módulo 5 «Voz»; módulo 6 «Bits de Twitch» (condicional por tipo).
- **Apariencia:** módulo 2 «En pantalla» (Reparto, Posición, «Cada meta se queda»); campos del módulo 3 — «Diseño» (+ «Usar en todas las metas»), bloque Personalizado, «Color de avance».
- **Probar:** módulo 7 «Monitor».
- Tour `metas`: reasignar `goals-mode`→Apariencia, `goals-editor`→Ajustes/Apariencia, `goals-monitor`→Probar.

**Lista de comprobación:** módulos totales 7 / asignados 7 (el 3 se reparte entre Ajustes y Apariencia por campos).

## Ruleta (src/pages/RouletteStudio.tsx)

**Ruta/alias:** `#ruleta`, `#wheel`, `#castigos`, `#roulette` (path `/ruleta`, `/wheel`, `/roulette`) → `ruleta`. **Fuente OBS:** `app=roulette` («Ruleta — Rueda de retos y castigos»), extra `rl` = ajustes codificados (+ `k` si hay nube activa).

**Montajes:** `<SuiteNav currentApp="ruleta">` con guía; `<GuidedTour id="ruleta" appName="Ruleta">` (auto la primera vez); `<MediaLibraryModal allowedTypes=['audio']>` (título «Biblioteca · elegir sonido (máximo 30 s)»). Guardado automático (`useRouletteSettings`). Usa la voz de «Voz del chat» (`useVoiceCatalogue`) para el anuncio; confeti en canvas; sacudida gsap.

**Pasos de la guía:** 1 Bienvenida «Ruleta de castigos» · 2 `roulette-segments` «Lo que puede salir» («Cada fila es un segmento: cambia el texto, el color, la categoría o los segundos del reto. El interruptor lo saca de la rueda sin borrarlo.») · 3 `roulette-trigger` «Cómo se gira» («Abre la ruleta aquí o con tu comando y su nombre. Mientras está abierta la giran los puntos del canal o los bits, lo que elijas.») · 4 `roulette-actions` «Qué pasa cuando se detiene» («Sacudida, confeti, sonido y la voz que anuncia el giro y el resultado.») · 5 `roulette-monitor` «Gira y copia la URL» (««Girar» prueba la rueda aquí. «Simular canje» y «Simular cheer» comprueban lo que pasaría en directo. «Copiar URL para OBS»…»). Otros `data-tour`: `roulette-presets`, `roulette-appearance`, `roulette-obs`.

**Estructura (≥1100 px: columna de ajustes 1,25fr | monitor 1fr). Módulos en orden:**

1. **«Segmentos»** (`data-tour=roulette-segments`; cabecera con «N de M activos») — lista de segmentos; cada fila: input color («Color de {texto}»), «Texto del segmento», select «Categoría de …» (Fitness / Físico, Voz & Show, Gameplay / Juego, Sabor / Picante, Humor & Castigo, Inmunidad / Libre, Personalizado), número «Segundos del reto …» (título «Segundos del reto. Con 0 no hay cuenta atrás.»), interruptor «Incluir {x} en la rueda», botón icono «Quitar {x}». Vacío: «La rueda está vacía. Añade un segmento o carga una plantilla.» Hint «Los segundos son la cuenta atrás del reto; con 0 no hay temporizador.» Deshacer («Se quitó «X».» / «Se cargó la plantilla «X» y reemplazó tus segmentos.»). Barra (`data-tour=roulette-presets`): «Añadir segmento» (crea «Nuevo castigo»), select «Plantilla de segmentos» («Cargar una plantilla» + `ROULETTE_PRESETS`, p. ej. «Castigos Gamer / En Directo») y botón «Reemplazar mis segmentos».
2. **«Cómo se gira»** (`data-tour=roulette-trigger`; cabecera con «Con {regla}») — `RouletteTriggerFields`: aviso opcional `spinNotice` («La ruleta ya no se gira escribiendo un comando en el chat…» con botón «Entendido»); interruptor «Ruleta abierta»/«Ruleta cerrada» (hint «Abierta se ve en OBS y la giran los canjes o los cheers. Cerrada no se ve y nada la gira. Con cuenta en la nube, este interruptor tarda hasta medio minuto en llegar a OBS; el comando del chat es inmediato. Lo que se abra o cierre desde el chat no mueve este interruptor.»); «Nombre de la ruleta», «Comando para abrirla», «Comando para cerrarla» (se guardan al salir del campo; avisos si coinciden); hint «Solo tú y tus moderadores: {abrir} {nombre} la abre y {cerrar} la cierra. Vale el comienzo del nombre, y dan igual las mayúsculas y los acentos. Los espectadores no la giran con comandos.»; «Se gira con» (Puntos de canal / Bits); «Quién puede girarla» (Todos / Suscriptores / VIP y mods); si puntos: «Recompensa de Twitch» (hint «Enlazada: …» / «Aún sin enlazar: en directo ningún canje la girará.»; «Detectar»/«Detectar otra vez»/«Cancelar»/«Desenlazar»; avisos de escucha/error; nota larga sobre «Requerir que el espectador escriba un texto» y el canal de eventos); si bits: «Cantidad» (Exacta/Rango), «Bits»/«Mínimo», «Máximo (opcional)», hint «Los cheers llegan por el chat, sin iniciar sesión en Twitch. Los anónimos cuentan y salen como «Anónimo»…»; siempre «Espera entre giros» (hint «En segundos. Un giro antes de tiempo se descarta y queda anotado. Con 0 no hay espera. Si llegan varios seguidos giran de uno en uno, con N esperando como mucho.»).
3. **«Al caer»** (`data-tour=roulette-actions`) — interruptores: «Mostrar el resultado en pantalla», «Sacudir la pantalla», «Confeti», «Anunciar el giro con voz», «Anunciar el resultado con voz»; hint «La voz es la de «Voz del chat»: {nombre}. Cambiarla» (enlace `#tts`); «Sonido» (select: Arcade, Fanfarria, Campana, Pop suave, Sin sonido, «Archivo de la biblioteca» + «Escuchar»; con archivo: rango «Volumen del archivo» y «Cambiar archivo»).
4. **«Avanzado»** (`<details>`, `data-tour=roulette-appearance`, dentro de «Al caer») — «Título» (hint «Aparece bajo la rueda y es lo que dice la voz al anunciar el giro.»); «Estilo» (Cabina Broadcast, Neón Glow, Cyberpunk, Casino Oro VIP); rangos «Duración del giro» (3–12 s) y «Resultado en pantalla» (3–30 s); interruptor «Sonido de la rueda al girar» y, si está activo, rango «Volumen de la rueda».
5. **«Monitor»** (`data-tour=roulette-monitor`) — escenario con `RouletteOverlayView` + canvas de confeti; botones **«Girar»** (→ «Girando»; desactivado si <2 segmentos activos) y **«Copiar URL para OBS»** (`data-tour=roulette-obs`); «Simular canje» y «Simular cheer» (pasan por `judgeTrigger`; mensajes de por qué no gira); estado (role=status): «Para girar hacen falta al menos dos segmentos activos.» / «La prueba suena aquí. A OBS le llegan los ajustes solos, por la nube.» / «…Sin cuenta en la nube, los ajustes viajan en la URL: cópiala otra vez en OBS cuando cambies algo.»

**Vista previa:** Monitor (rueda real). **Probar:** «Girar», «Simular canje», «Simular cheer», «Escuchar».

**ASIGNACIÓN PROPUESTA** — Grupo: **Participación**. Ventana «Ruleta», pestañas **Ajustes | Apariencia | Probar**.
- **Ajustes:** módulo 1 «Segmentos» (con presets y deshacer); módulo 2 «Cómo se gira».
- **Apariencia:** módulo 3 «Al caer» (efectos, voz y sonido; es lo que se ve/oye al detenerse); módulo 4 «Avanzado».
- **Probar:** módulo 5 «Monitor».
- Tour `ruleta`: reasignar `roulette-segments`/`roulette-trigger`→Ajustes, `roulette-actions`→Apariencia, `roulette-monitor`→Probar.

**Lista de comprobación:** módulos totales 5 / asignados 5.

## Nota sobre Batallas/Versus

La guía menciona «Batallas/Versus = Ajustes | Apariencia | Probar», pero `src/pages/PollsStudio.tsx` (ruta `#encuestas`, `#versus`, `#batallas`, `#polls`; OBS `app=polls`) no estaba en la lista de páginas pedidas y NO se ha inventariado aquí. Tampoco se inventariaron `GameStudio` ni `src/components/estudio/*` ni `src/components/studio/*` salvo `StudioKit.tsx` (kit de controles compartido), porque no definen módulos visibles de estas 7 páginas (`estudio/` es el editor de escenas de Studio).

## Resumen de módulos por página

Alertas 6 · Recompensas 8 · Power-ups 5 · Mascotas 9 · Torneos 12 · Metas 7 · Ruleta 5 (total 52; todos asignados).


# Parte B: Voz e IA, En pantalla, Conexiones

> Notas comunes (válidas para todas las páginas). `SuiteNav` (src/components/SuiteNav.tsx) se monta arriba de cada página y trae: menú lateral/grupos, indicador de guardado (`saved` → «Guardando» / «Guardado» / «Guardado en la nube»), botón «Actualizar OBS» (envía ajustes a las fuentes ya pegadas; al terminar muestra `<ObsSyncNotice>`: aviso que se va solo a los 5 s con la URL copiable; solo existe para las apps de SYNC_TARGET), botón «Fuentes de OBS» (catálogo de URLs) y, si la página lo pide (`onOpenTour` + `tourAvailable`), botón «Guía». `SYNC_TARGET` (fuente OBS = parámetro `app` del widget): ruleta→roulette, alertas→alerts, metas→goals, encuestas→polls, chat→chat, raid→raid, recompensas/powerups→rewards, mascotas→pets, musica→music, kofi→kofi, juego→game, torneos→tournament, tts→tts. Studio usa `app=scene&scene=<id>`; Mi AI usa su propio overlay `/lux/overlay.html`; Bot e Integraciones no tienen fuente OBS. Casi todas las páginas siguen el patrón «columna de ajustes (izquierda) + módulo `Monitor` 16:9 fijo (derecha)»; `Field`, `Range`, `Toggle`, `UndoNote`, `useUndo` vienen de `components/studio/StudioKit`. «Probar» en las páginas con monitor no es una pestaña: son botones bajo el monitor. En la fase 2 hay que conservar el monitor como panel persistente de la ventana (visible en todas las pestañas) o replicarlo, salvo donde el diseño pide una pestaña «Probar». Ninguna de estas páginas monta modales (`role=dialog`); los únicos diálogos son `window.confirm` (quitar modelo 3D de Lux) y los avisos en línea.

## Dashboard — Voz del chat / Tally Voz (src/pages/Dashboard.tsx)

**Ruta y fuente OBS.** `resolveRoute()` → `'tts'` → `<Dashboard />`. Alias: hash `#tts`, `#ajustes` (cualquier hash que empiece así), o path que contenga `/tts` o `/ajustes`; tiene prioridad sobre cualquier query. Etiqueta en SuiteNav: «Voz del chat» (grupo de herramientas, icono Mic); en Catalog.tsx se llama «Voz» («Mensajes leídos en voz alta»). Fuente OBS: `app=tts` (SYNC_TARGET `tts: 'tts'`); la URL la construye `buildSuiteWidgetUrl(origin,'tts',canal,settings,{k})` e incluye canal, voz, sonido, apariencia y reglas. `currentApp="tts"`. (`#control` «En vivo» es otra página, no incluida aquí.)

**Estructura.** `<SuiteNav currentApp="tts" channel saved onOpenTour tourAvailable>`; layout `.vz-layout`; solo hay 2 `cab-mod`: «Editor» (aria-label «Ajustes de la voz del chat», `data-tour="voz-editor"`) y «Monitor» (`data-tour="voz-monitor"`). Guarda **automático** (`useSettings().update` → localStorage + bus a widgets abiertos + nube); no hay botón Guardar. Cabecera del archivo: «Los cambios se guardan solos y se envían a los widgets abiertos». El canal no se escribe aquí: enlace «Inicio» (`#dashboard`).

**Guía (`<GuidedTour>`, id por defecto — `isTourDone()` sin id; se abre sola a los 600 ms la primera vez; botón «Guía» en SuiteNav).** 4 pasos: (1) «Tu chat, leído en voz alta» (sin target; lee mensajes `!s`, tres pasos); (2) target `voz-editor` «Tres pestañas para ajustarla» («En Voz eliges quién habla y a qué volumen. En Apariencia, cómo se ve la alerta. En Reglas, quién puede usarla, cuánto y cómo se activa.»); (3) target `voz-monitor` «Prueba y copia la URL» («Escribe un mensaje y pulsa «Enviar al widget». «Copiar URL para OBS» te da la fuente de navegador; si después cambias algo que viaja en la URL, aquí mismo se te avisa.»); (4) target `nav` «Durante el directo, En vivo» («Ahí pausas la cola, saltas mensajes y apruebas o quitas los que esperan.»). Con la guía abierta la raíz lleva `paddingBottom: 220`. Hay que mantener los `data-tour` (o reubicarlos) y cambiar de pestaña si un paso apunta a algo oculto.

**Pestañas internas (segmentado «Sección de ajustes»):** Voz | Apariencia | Reglas (estado `tab`, por defecto `voz`). El diseño aprobado pide el orden Voz | Reglas | Apariencia.

### Pestaña Voz
- **V1 Invitación a ElevenLabs** (condicional: `cloud.profile.elevenlabs_enabled && !elevenlabs_invite_seen_at`): `cab-note` «Te invitamos a probar un nuevo modelo de voces: ElevenLabs. Más expresivo, con emociones y canto. Elige una voz del grupo «ElevenLabs»… (`!s [feliz] hola` o `!s [canto] la la la`). Tus voces de siempre siguen ahí.» Botón «Entendido» (rpc `dismiss_elevenlabs_invite`).
- **V2 Voz** (select; `useVoiceCatalogue`; grupo `optgroup` «ElevenLabs (nuevo)»; última opción «Usar ID propio»). Hint: descripción de la voz; o «La voz que tenías ya no está en el catálogo. Ahora se usa …». Si «Usar ID propio» → campo texto mono «ID de tu voz» («Pega aquí el ID de una voz tuya de Fish Audio. Hasta entonces se sigue usando …» / «Es el ID de una voz tuya en Fish Audio.»). Cambiar voz fija también `engine` (fish/elevenlabs).
- **V3 Volumen** (rango 0–1 paso 0,05, formato «NN %»).
- **V4 Anunciar quién escribe** (interruptor; hint «Antes del mensaje, la voz dice quién lo escribió.» / «La voz lee solo el mensaje.»).
- **V5 Sonido antes de la voz** (`<PreSoundSection>`, componentes/voz/PreSoundSection.tsx; `<section aria-label="Sonido antes de la voz">`): interruptor «Avisar con un sonido antes de leer» (hint «Suena el aviso y, cuando acaba, empieza la voz. Las alertas que ya traen su sonido, la ruleta y el saludo de raid no lo llevan.» / «La voz empieza a leer sin aviso.»). Si activo: select «Sonido de serie» (Pop suave 0,25 s · Arcade 0,6 s · Fanfarria 0,6 s · Campana 1,4 s); «Tu archivo de sonido» (`MediaField`, subida MP3/WAV/OGG ≤ `PRE_SOUND_MAX_FILE_SECONDS`; hint «Sin archivo. MP3, WAV u OGG de hasta N segundos; mejor uno corto, de uno o dos.»; aviso de archivo solo local «no viaja en la URL de OBS: allí sonará el sonido de serie»); rango «Volumen del sonido»; segmentado «Cuándo suena» (Cada mensaje | De pago o destacados | Tras un silencio, con hint propio cada uno); botón **«Probar»/«Parar»** (suena el aviso y luego frase de muestra vía `/api/tts`, con respaldo de voz del navegador; estado «Suena el aviso y después una frase de muestra con la voz elegida, aquí en el panel.»).
- **V6 Avanzado** (`<details>` «Avanzado»): segmentado «Modelo» (Gratis | Pro; hint «Gratis no consume créditos. Pro gasta créditos de Fish Audio.»); rango «Velocidad» 0,75–1,5 (formato «1,00×»); texto mono «Frase del anuncio» (por defecto `{user} dice: {message}`; hint «Usa {user} para el nombre y {message} para el mensaje.» / «Activa «Anunciar quién escribe» para usarla.»; deshabilitado si no se anuncia).
- **V7 Emociones que puede escribir el chat** (`<details>`): párrafo «Van entre corchetes dentro del comando, por ejemplo `!s [susurro] no hagan ruido`. Cambian el tono de la voz y el gesto con el que entra el texto.» + lista de `AVAILABLE_EMOTIONS` (ejemplo + etiqueta).

### Pestaña Apariencia
- **A1 Estilo de alerta** (rejilla `cab-styles`, 9 botones `ALERT_STYLES`: Cabina, Bocadillo, Subtítulo, Sticker, Arcade, Aventura, Diálogo, Arcade con diálogo, Aventura con diálogo; cada uno con descripción).
- **A2 Sticker del canal (SVG)** (solo si estilo = Sticker): subida de archivo `.svg` («Subir SVG»/«Cambiar SVG»), «Quitar», miniatura, error de validación, hint «Tu logo o mascota en SVG plano, hasta 20 KB. Entra de golpe, se balancea mientras suena la voz y lleva borde de troquel.» / «Sin SVG, el sticker muestra la inicial de quien escribe.»; `UndoNote` (deshacer cambio/quitar).
- **A3 Color** (6 muestras: Morado, Rojo, Verde, Coral, Cian, Ámbar + `input color` «Color personalizado»).
- **A4 Posición en pantalla** (6 botones: arriba/abajo × izquierda/centro/derecha; texto «Ahora: …»).
- **A5 Tamaño** (rango `SCALE_MIN`–`SCALE_MAX` 0,8–1,3 paso 0,05, «NN %»).
- **A6 Energía del movimiento** (segmentado Calma | Normal | Hype).

### Pestaña Reglas (`<RulesPanel>`, componentes/voz/RulesPanel.tsx)
- **R1 Qué lee la voz** (segmentado: Con comando | Todo el chat | Solo destacados | Nada; hint por modo, p. ej. «Solo se leen los mensajes que empiezan por !s. Es lo que menos cuota de voz gasta y lo más fácil de moderar.»; en «Todo el chat» aparece `cab-note`: «Leer todo el chat gasta la cuota de voz muy rápido… Lo que pasa del tope se descarta, no se guarda para después.»).
- **R2 Tope por minuto** (solo modo «Todo el chat»; rango «NN por minuto»; «Mensajes del chat que la voz lee como mucho cada minuto.»).
- **R3 Bots que no se leen** (solo «Todo el chat»; textarea mono; «Nombres de usuario separados por comas. Si la dejas vacía, vuelve la lista habitual.»).
- **R4 Comando de voz** (solo modos Con comando / Todo el chat; texto mono máx. 12; «Cámbialo por el que quieras, por ejemplo !di o !leer. Las órdenes de moderación (!s skip, !s pausa) siguen usando !s.» / error «Solo letras, números y guion bajo, hasta 11 caracteres. Mientras no sea válido se usa !s.»).
- **R5 Quién puede usar / Quién puede ser leído** (segmentado Todos | Subs | VIP | Mods; «Tú y tus mods siempre podéis. Los canjes de puntos y los bits no dependen de este filtro.»).
- **R6 Espera por usuario** (rango `LIMITS.cooldown` 0–600 paso 5; «Sin» si 0; «Tiempo mínimo entre dos mensajes del mismo espectador.»).
- **R7 Límites de longitud y cola** (dos rangos en 2 columnas: «Longitud máxima» paso 10 «Caracteres que se leen de cada mensaje.»; «Cola máxima» «Mensajes que pueden esperar a la vez.»).
- **R8 Prioridad a puntos y bits** (interruptor; «Los mensajes de canjes y cheers pasan delante de los demás.»).
- **R9 Bloqueos** (`<details>`): textarea «Palabras bloqueadas» («Separadas por comas. Un mensaje que contenga alguna se descarta entero. No distingue mayúsculas ni tildes.»); «Usuarios bloqueados» (texto + botón «Bloquear», Enter añade; chips con ✕ «Desbloquear»; «Nadie bloqueado.»).
- **R10 Cómo se activa** (`<details>`): interruptor «Comando !s» («Cualquier mensaje que empiece con !s se lee… No aplica en los modos «Solo destacados» y «Nada».»); «Recompensa de puntos del canal» (botones «Detectar recompensa» [escucha 90 s; requiere canal] / «Dejar de escuchar» / código del ID + «Quitar»; hints «Crea en Twitch una recompensa que pida texto al espectador. Pulsa «Detectar recompensa» y canjéala una vez para enlazarla.»; `UndoNote`; aviso con enlace a Inicio si falta canal); número «Bits mínimos» (paso 50; «Un cheer con al menos estos bits lee su mensaje. Con 0 queda desactivado.»).

### Módulo «Monitor» (columna derecha, fijo)
- **M1 Monitor** (`<h2>Monitor</h2>` + botón de alternar «Fondo claro»; escenario `cab-stage` con `<AlertCard>` real, animación `playDemo`, se repite al cambiar estilo/posición/energía/emoción).
- **M2 Campos de prueba**: texto «Usuario» (por defecto SuperViewer), select «Emoción» (Sin emoción + `AVAILABLE_EMOTIONS`; reescribe el mensaje con `withEmotion`), textarea mono «Mensaje de prueba» (por defecto `!s [feliz] ¡Hola chat! Este es un mensaje con emoción`; hint «Se oirá: «…»» o «Este mensaje no pasa el filtro: no se mostrará ni se leerá.»).
- **M3 Acciones**: **«Enviar al widget»** (único «Probar»; guarda ajustes, `postBus` SETTINGS_UPDATE + ENQUEUE, dispara `__LALO_TTS_TEST_TRIGGER__` y repite la animación; deshabilitado si el mensaje no pasa el filtro) y **«Copiar URL para OBS»** (cambia a «URL copiada»; si falla el portapapeles muestra la URL para copiar a mano: «El navegador no dejó copiar la URL. Selecciónala aquí y cópiala a mano.»).
- **M4 Avisos de URL**: chip «La URL cambió» + «Has cambiado algo que viaja en la URL desde la última vez que la copiaste aquí. Vuelve a copiarla y pégala en la fuente de OBS.» (solo sin cuenta en la nube activa: con nube los cambios llegan solos); hint «“Enviar al widget” repite la animación aquí y la manda al widget que tengas abierto en este navegador.» + enlace «Abrir widget».
- **M5 Estado del canal**: «Canal: twitch.tv/<canal>. Se cambia en Inicio.» o `cab-note` «Todavía no hay canal, así que el widget no sabe qué chat leer. Escríbelo en Inicio.»
- **M6 Cómo añadirlo a OBS** (`<details>`): lista de 6 pasos (fuente Navegador; pegar URL; 1920×1080; «Controlar audio a través de OBS»; la capa queda invisible hasta `!s mensaje`; recargar con «Actualizar OBS» o `!s reload`).

**ASIGNACIÓN PROPUESTA.** Grupo **«Voz e IA»**, ventana **«Voz del chat»**, pestañas **Voz | Reglas | Apariencia**:
- *Voz*: V1–V7.
- *Reglas*: R1–R10.
- *Apariencia*: A1–A6.
- *Panel persistente de la ventana (visible en las tres pestañas, equivale a «Probar»)*: M1–M6 (el monitor con «Enviar al widget» y «Copiar URL para OBS» no debe esconderse al cambiar de pestaña; M6 puede quedar plegado). Conservar `data-tour="voz-editor"`/`voz-monitor` o mapearlos a la ventana y al panel, y el estado «La URL cambió».
- Sin pérdidas: el `Segmented` de pestañas actual se sustituye por las pestañas de la ventana; el `useUndo` del sticker y de la recompensa debe viajar con A2/R10.

**Lista de comprobación: módulos totales 29 (V1–V7 = 7, A1–A6 = 6, R1–R10 = 10, M1–M6 = 6; en términos de `cab-mod` son 2: Editor y Monitor) / asignados 29.**

## LuxAI — Mi AI (src/pages/LuxAI.tsx)

**Ruta y fuente OBS.** `resolveRoute()` → `'lux'` con `/^lux([?/]|$)/` (`#lux`); `<LuxAI />`. Etiqueta SuiteNav «Mi AI» (grupo Integraciones/Más, icono Sparkles). No está en `SYNC_TARGET` ni en Catalog: su fuente de OBS es un overlay aparte, `${origin}/lux/overlay.html?overlay=1&size=<obsSize>&k=<widget_key>&channel=<twitch_login>[&turn=<grados>]` (la vista previa añade `&preview=1`). SuiteNav se monta solo con `currentApp="lux"` (sin `saved`, sin guía).

**Estructura.** Requiere `profile.lux_enabled === true` o rol admin; si no, se muestra sólo un módulo-puerta. Hay 2 pestañas (segmentado «Secciones de Mi AI»): **Ajustes | Memoria**. Los ajustes **NO se guardan solos**: botón manual **«Guardar ajustes»** al final de la columna izquierda de «Ajustes» (`disabled` si `busy`, no hay cambios, la palabra o el nombre no son válidos); junto a él «Hay cambios sin guardar.», nota «Ajustes guardados.» (o, si cambió el comando: «Ajustes guardados. Vuelve a copiar el script del bot en el estudio de TwitchIO: hasta entonces, el bot antiguo sigue con !<palabra> y el nombre anterior.») y error. Se guardan en servidor (`lux_settings`) vía `luxSaveSettings`. Memoria, modelo 3D y «Decir en el chat» actúan al instante por API. No hay `GuidedTour`, ni `ObsSyncNotice` propios, ni modales (sólo `window.confirm` al quitar un modelo).

- **L0 Puerta «Mi AI no está activada para tu cuenta»** (cab-mod, sustituye a todo): «El administrador la activa desde Streamers. Cuando lo haga, aquí podrás configurarla.»
### Pestaña Ajustes — columna izquierda
(errores de carga: `cab-error` «No se pudieron leer tus ajustes: …»)
- **L1 Tu personaje** (`#lux-character`): punto de color + nombre; «Modelo: …»; «Créditos este mes: X de Y del plan.»; avisos `modelNote` (budget: «Has llegado al tope de créditos de tu plan este mes: Mi AI usa el modelo por defecto hasta el mes siguiente.» / disabled: «El modelo de tu personaje ya no está disponible: Mi AI usa el modelo por defecto.»); `licenseNotice`; «El administrador asigna el personaje. Lo que Mi AI recuerda es de ese personaje.»
- **L2 Modelo 3D de tu personaje** (`<LuxModelLibraryPanel>`): hint «Elige el modelo de tu personaje: uno de la biblioteca o uno tuyo. El administrador sigue asignando el personaje y el proveedor de IA.»; búsqueda «Buscar modelo» (placeholder «Nombre del modelo») + segmentado de origen (Todos | Riot Games | Creadores); radios «Modelo de tu personaje» («Por defecto (sin modelo propio)» + modelos, con aviso de licencia de Riot y «Solo tú lo ves hasta que se apruebe.»); subtítulo «Tus modelos» («Usas N de M modelos de tu plan.» / «Tu plan no incluye modelos propios.»), por modelo: estado, «Enviar a revisión», «Quitar» (con `window.confirm`); botón «Subir modelo» (input `.glb`, «Archivos .glb de hasta 50 MB. Un modelo tuyo queda privado hasta que el administrador lo revise y confirme su licencia.»), barra de progreso de subida.
- **L3 Personalidad** (`#lux-personality`): textarea «Cómo habla Lux» (máx. 600, contador «N de 600 caracteres», placeholder «Ejemplo: tranquila, un poco traviesa, habla de juegos y nunca insulta a nadie.»).
- **L4 Comando de activación** (`#lux-command`): texto «Nombre de tu IA en el chat» (opcional, ≤30; «En el chat y en OBS se presentará como …»); texto «Palabra para hablar con tu IA» («De 2 a 20 letras o números, sin espacios. Por defecto: lux.»; valida contra comandos del bot); «Los viewers escriben !palabra para hablar con tu personaje.» + botón «Copiar comando»; interruptor «Seguir aceptando !lux» (si la palabra ≠ lux); hint «Si cambias la palabra, vuelve a copiar el script del bot en el estudio de TwitchIO. El bot antiguo sigue con la palabra anterior hasta entonces.»; `cab-note` si el bot copiado está desactualizado.
- **L5 Comentarios y eventos** (`#lux-proactive`): interruptor «Comentarios espontáneos»; si activo, selects «Cada cuánto como mucho» (10/15/30/60 minutos) y «Mensajes mínimos del chat» (3/5/10); hint «Cada cierto tiempo, … comenta lo que se habló en el chat… Se calla con !luxoff.»; subtítulo «Saludar cuando haya» con 4 interruptores (Seguidores nuevos, Suscripciones, Raids, Inicio del directo); `cab-note` con estado en vivo de `channel.follow` y `stream.online` (conectado / falta encender el «Canal de eventos» en Power-ups / falta el permiso moderator:read:followers / problemas / no se pudo comprobar) y enlace «Ir a Power-ups» (`#powerups`); hint «Varios eventos seguidos se saludan juntos, en un solo mensaje. Si la IA falla, no escribe nada.»
- **L6 Respuestas** (`#lux-replies`): rango «Longitud máxima» 60–500 paso 10; select «Voz» (hint «Las voces del catálogo. La que elijas es la que usa Lux al hablar en el overlay.»; opción por defecto, voz guardada fuera de catálogo, ElevenLabs sólo si `elevenlabs_enabled`/admin); select «Idioma» (Automático, Español, Inglés, Francés, Portugués, Italiano); interruptores «Recordar a los espectadores y a tu canal entre directos», «Recordar la conversación» (hint «Lux recuerda lo último que hablaste con cada espectador (hasta 6 mensajes de los últimos 10 minutos)…»); select «Cuando alguien me provoca» (Responder con calma | Picar al estilo LoL) con aviso largo «Atención: el bot escribe con la cuenta de la plataforma delante de todos los canales… puede traer sanciones de Twitch.»; interruptor «Lux aprende del chat» (hint «Apagado por defecto. Cada media hora Lux resume el chat…»).
- **L7 Personaje en OBS** (`#lux-overlay`): rango «Tamaño en pantalla» 10–100 («N% de la altura»); rango «Volumen de la voz» 0–100; campo solo lectura «Dirección para la fuente de navegador» («Fondo transparente. Pégala en OBS como fuente de navegador.») + botón «Copiar»; rango «Giro del personaje» 0–355° (va en `&turn=`); «Vista previa» (iframe 280 px; «Así se verá en OBS, sin voz. Mueve el giro hasta que el personaje mire a la cámara y luego copia la dirección de arriba.»).
- **L8 Barra de guardado manual**: botón «Guardar ajustes» + estados (ver arriba).
### Pestaña Ajustes — columna derecha
- **L9 Probar a Lux** (`#lux-test`): «Escribe como si fueras un espectador. La respuesta usa los ajustes guardados.»; registro de conversación (`aria-live`); interruptor «Hablar en OBS»; botón «Escuchar la voz» (prueba de voz por el bus `lux_bus`); texto «Nombre del espectador (opcional)»; caja de mensaje (Enter envía, ≤500) + botón «Enviar».
- **L10 Decir en el chat** (`#lux-say`): «El mensaje lo publica tu bot de Twitch, con el nombre … Tiene que estar corriendo con el script de la versión N.»; segmentado «Texto tal cual | Que la IA lo redacte»; textarea («Mensaje» ≤500 / «Idea para el mensaje» ≤300); interruptor «También que se oiga en OBS»; botón «Mandar a la cola» / «Redactar y mandar a la cola»; lista de los 5 últimos con estado (En cola… / El bot no está respondiendo… / Enviado (confirmado por el bot) …); «Ahora mismo el bot no ha dado señales de vida.»
- **L11 ¿Funciona?** (`#lux-checks`): 3 checks (Mi AI activada; Ajustes guardados; Lux ha respondido a una prueba) + hint «Si una prueba falla, el mensaje dice por qué: falta la clave del proveedor de IA, el modelo no responde o tu cuenta no tiene Mi AI.»
### Pestaña Memoria
- **L12 Memoria** (`<LuxMemoryPanel>`, `#lux-memory`): resumen «N de M se usan en cada respuesta · X de Y guardados»; aviso «La memoria está apagada en Ajustes…»; formulario: segmentado «Dato | Estilo» (hints «Juego, horario o temas que no tocas.» / «Muletillas y forma de hablar.»), textarea «Recuerdo nuevo» (≤300) + «Añadir recuerdo»; lista de recuerdos con chips (Dato/Estilo/Espectador/Suceso, «Del chat · fecha», «Del administrador», «Fijado», «Caduca el …»), acciones «Fijar/Quitar fijado», «Editar» (Guardar/Cancelar), «Borrar» (confirmación en línea «¿Borrar este recuerdo?» Sí, borrar / No, conservarlo); los del administrador no se editan.

**ASIGNACIÓN PROPUESTA.** Grupo **«Voz e IA»**, ventana **«Mi AI»**, pestañas **Ajustes | Memoria** (como pide el diseño). 
- *Ajustes*: L1–L11, manteniendo las dos columnas (configuración | probar) o, mejor, secciones plegables en este orden: Personaje (L1, L2), Personalidad (L3), Comando (L4), Comentarios y eventos (L5), Respuestas (L6), Personaje en OBS (L7), con L9 «Probar a Lux», L10 «Decir en el chat» y L11 «¿Funciona?» en un panel lateral/inferior. La barra «Guardar ajustes» (L8) debe quedar **fija y visible** en la ventana mientras se esté en Ajustes (es guardado manual, no automático; no pasarlo a autoguardado sin decisión del principal).
- *Memoria*: L12.
- Puerta L0: la ventana muestra este módulo en lugar de las pestañas si no hay Mi AI.
- Avisos cruzados a conservar: enlaces a «estudio de TwitchIO» (→ Bot > Conexión) y «Ir a Power-ups».

**Lista de comprobación: módulos totales 13 (L0–L12; 12 `cab-mod` entre página y componentes + la barra L8 que no es módulo) / asignados 13.**

## TwitchIOStudio — Bot (src/pages/TwitchIOStudio.tsx)

**Ruta y fuente OBS.** `resolveRoute()` → `'twitchio'`; alias hash `#twitchio`, `#bot` (cualquier hash que empiece así), o path con `/twitchio` o `/bot`; `<TwitchIOStudio />`. SuiteNav «Bot» (grupo «Chat», icono Bot). **Sin fuente OBS** (no está en `SYNC_TARGET`). `currentApp="twitchio"`.

**Estructura.** Grid a 2 columnas (`min-[1100px]`): izquierda 3 módulos, derecha «Probar» (sticky). Guardado **automático**: sin sesión de nube, la lista y ajustes se guardan en localStorage (`TWITCHIO_STORAGE_KEY`, «se guardan solo en este navegador»); con nube activa (`bot.phase==='ready'`) cada fila se guarda en el servidor «cuando tiene nombre y respuesta» (`useBotCloud`) y los ajustes (prefijo, bienvenida) con `patchSettings`. Indicador `saved` en SuiteNav. Sin botón Guardar.

**Guía (`<GuidedTour id="twitchio" appName="Bot">`, se abre sola a los 600 ms la primera vez; botón «Guía»).** 5 pasos: (1) «Bienvenida» «Bot del chat» («Aquí decides qué responde el bot cuando alguien escribe un comando en tu chat.»); (2) target `bot-nube` «Conéctalo en tres pasos» («Das permiso al bot de Tally Studio una sola vez en Twitch y responde en tu chat desde el servidor. No instalas nada.»); (3) target `bot-comandos` «Un comando por fila» («Escribe el nombre, la respuesta y quién puede usarlo. El interruptor lo apaga sin borrarlo.»); (4) target `bot-probar` «Pruébalo aquí» («Escribe un comando como si estuvieras en el chat y mira qué contestaría el bot.»); (5) target `bot-arranque` «Ejecútalo en tu equipo» («Si prefieres tu propia cuenta de bot, copia el script, pega tu token y ejecútalo con Python.»). Raíz con `paddingBottom: 220` mientras está abierta. Los pasos apuntan a módulos de distintas pestañas: al migrar, cambiar de pestaña antes de cada paso.

- **B1 Bot en la nube** (`data-tour="bot-nube"`, `<h2>Bot en la nube</h2>`): intro «El bot de Tally Studio responde en tu chat desde el servidor: sin Python y sin dejar el equipo encendido. Solo das un permiso en Twitch.» Estados: sin nube (`cab-note` «Entra con tu cuenta de Twitch para conectar el bot en la nube. Mientras tanto puedes preparar los comandos aquí; se guardan solo en este navegador.»), «Comprobando tu bot…», error + «Reintentar», o listo con 3 pasos numerados: 1 «Cuenta de Twitch conectada» (canal #…), 2 «Dar permiso al bot» (botón «Conectar el bot» / chip de estado; «Twitch te pide aceptar una vez. No instalas nada.»), 3 «Bot activo en tu chat» («Responde a tus comandos y a Lux.»; botón «Encender el bot» / chip + «Apagar»). Select «El bot escribe» («Con el nombre del streamer» | «Con la cuenta Tally Studio», con `senderModeHint`). Mensajes de paso (`cab-note`) y botón «Volver a consultar». Si Twitch pide permiso, redirige con `signInWithTwitch({returnHere:true})` («Twitch necesita que aceptes el permiso del bot… pulsa «Conectar el bot» otra vez.»).
- **B2 Comandos** (`data-tour="bot-comandos"`): título + «N de M encendidos»; `bot.notice` con «Entendido»; lista (`cab-rows`), cada fila: interruptor (checkbox `cab-tog`) «Encender !cmd», prefijo + texto «Nombre del comando» (≤25), texto «Respuesta de …» (placeholder «Lo que contesta el bot», ≤450), select de permiso (Cualquiera | Suscriptores | Moderadores | Solo el streamer), botón «Quitar»; avisos de nombres repetidos («Hay más de un comando llamado … El bot solo usará el primero.») y errores por fila; `UndoNote` al quitar; botón «Nuevo comando»; hint «En la respuesta, {user} se cambia por quien escribe y {channel} por tu canal. Cada comando se guarda en la nube cuando tiene nombre y respuesta.»; vacío: «Todavía no hay comandos. Pulsa «Nuevo comando», ponle un nombre (por ejemplo, redes) y escribe lo que debe contestar el bot.»
- **B3 Ajustes del bot** (`<details>` dentro de Comandos, sólo si `showList`): texto mono «Prefijo» (≤3; «El símbolo con el que empiezan los comandos. Si lo dejas vacío, vuelve a ser !»); texto «Mensaje de bienvenida (solo script de Python)» («Solo lo usa el script de Python de la opción avanzada. El bot en la nube todavía no envía saludo. Déjalo vacío si no quieres saludo.»); `bot.settingsError`.
- **B4 Opción avanzada: ejecutar el bot en tu PC** (`data-tour="bot-arranque"`, `<details>`): `cab-note` («Si prefieres que el bot hable con tu propia cuenta… Ese bot no avisa de si está conectado. Cuando cambies algo en esta página, copia el script otra vez y vuelve a ejecutarlo.»); texto «Nombre del bot» (usado en la prueba) y texto mono «Canal donde entra el bot» (con botón-enlace «Usar <canal de Inicio>»); lista de 4 pasos (pip, guardar `tally_bot.py`, cambiar el token placeholder, `python tally_bot.py`); bloque `<pre>` con el script de Python; botón «Copiar script» (cambia a «Script copiado»; registra la palabra de Lux con `rememberLuxBot`); «Lleva N de M comandos…»; error de copia; crédito a TwitchIO (MIT).
- **B5 Probar** (`data-tour="bot-probar"`, sticky): registro de conversación `role="log"` («Aún no has probado nada…»); campo «Mensaje de chat» (placeholder `!<cmd>`) + botón **«Enviar»**; hint «Es una prueba dentro del panel: no se envía nada a Twitch y escribes como streamer, así que todos los comandos te dejan pasar.» El comando `alerta` además dispara una alerta de demostración por el bus (`ALERT_TRIGGER`) y sonido. 

**ASIGNACIÓN PROPUESTA.** Grupo **«Voz e IA»**, ventana **«Bot»**, pestañas **Conexión | Comandos**:
- *Conexión*: B1 (Bot en la nube) y B4 (Opción avanzada, plegable al final).
- *Comandos*: B2 (lista), B3 (Ajustes del bot, plegable) y B5 (Probar, a la derecha o debajo, para poder probar mientras se edita).
- Nota: «Nombre del bot» y «Canal donde entra el bot» son de la opción avanzada (van con B4); «Prefijo» influye en Comandos y en Mi AI (L4). Mi AI enlaza al «estudio de TwitchIO» → apuntar a Bot > Conexión/Opción avanzada.

**Lista de comprobación: módulos totales 5 (B1–B5; 4 `cab-mod`: Bot en la nube, Comandos, Opción avanzada, Probar; B3 es un `<details>` interno) / asignados 5.**

## ChatStudio — Chat (src/pages/ChatStudio.tsx)

**Ruta y fuente OBS.** `resolveRoute()` → `'chat'` sólo si `hash === 'chat'` o empieza por `chat?` / `chat/`; `<ChatStudio />`. SuiteNav «Chat» (icono MessagesSquare, grupo de capas). Fuente OBS `app=chat` (SYNC_TARGET `chat`); URL con `cs=<encodeChatSettings>` y, con cuenta, `k=<widget_key>`; variante `demo=1` («Copiar URL con chat de muestra»). `currentApp="chat"`.

**Estructura.** Grid 2 columnas: izquierda 4 módulos de ajustes, derecha «Monitor» (`max-[1099px]:order-first`, sticky). Guardado **automático** (`useChatSettings` → `updateSettings`/`updateCustom`; `saved` en SuiteNav); sin botón Guardar. 

**Guía (`<GuidedTour id="chat" appName="Chat">`, auto la primera vez, botón «Guía»).** 4 pasos: (1) Bienvenida «Chat en vivo» («Aquí decides cómo se ve el chat de tu canal sobre el directo. No hace falta ningún permiso nuevo de Twitch.»); (2) target `chat-template` «Elige el aspecto» («Cinco plantillas listas y una personalizada, en la que cambias tipografía, colores, opacidad y redondeo.»); (3) target `chat-motion` «Cómo entran y salen los mensajes» («Cada plantilla trae su propio movimiento. Puedes dejarlo, elegir uno genérico y subir o bajar la intensidad.»); (4) target `chat-monitor` «Prueba y copia la URL» («Envía cada clase de mensaje al chat de prueba, borra uno como haría un moderador y copia la URL para OBS.»).

- **C1 Plantilla** (`data-tour="chat-template"`): segmentado «Plantilla del chat» (Cabina, Burbuja, Subtítulo, Cristal, Terminal, Personalizada) con hint de la plantilla; si «Personalizada»: select «Tipografía» (Archivo condensada, Onest…), 3 selectores de color («Fondo del mensaje», «Color del texto», «Color de destacados»), rangos «Opacidad del fondo» (0–1, %) y «Redondeo» (`CHAT_LIMITS.radius`), nota «Si un espectador usa un color de nombre que no se lee sobre tu fondo, la capa lo aclara u oscurece sola.»
- **C2 Movimiento** (`data-tour="chat-motion"`): segmentado «Cómo entra, hace sitio y sale cada mensaje» (Propio de la plantilla | Deslizar | Brotar | Aparecer | Escribir; hint con la firma de la plantilla o «Un movimiento genérico, igual en todas las plantillas. Los destacados conservan el trato de la plantilla.»), cada clic lanza un mensaje de muestra; segmentado «Intensidad» (Calma | Normal | Hype; «Cambia cuánto se mueve y cuánto dura. Con «Calma» no hay rebotes.»); nota «Si el sistema pide reducir el movimiento, los mensajes solo aparecen y desaparecen, sin desplazarse.»
- **C3 Colocación**: segmentado «Lado de la pantalla» (Izquierda | Derecha); rangos «Tamaño del texto» (%), «Ancho de la columna», «Mensajes a la vez», «Tiempo en pantalla» (s; «Con 0, cada mensaje se queda hasta que lo empuja otro.», «Sin límite»); hint «En el monitor el texto se ve algo más grande que en OBS, para poder leerlo a este tamaño.»
- **C4 Qué se ve**: 6 interruptores (Insignias (CANAL, MOD, VIP, SUB); Franja en mensajes de suscriptores; Mensajes con bits en color lleno; Mensajes de solo emotes más grandes; Ocultar comandos (empiezan por !); Ocultar bots conocidos); «Marcar los mensajes que lee la voz» (hint «Una etiqueta «VOZ» en la esquina del mensaje. Ahora la voz está en «<modo>». Cambiar qué lee la voz» → `#tts`); «Mostrar también en «Todo en uno»» («Si usas la fuente «Todo en uno» y no quieres el chat en pantalla, apágalo aquí. La fuente «Chat» lo muestra siempre.»); nota «Lo que un moderador borra en Twitch se tacha aquí y sale; un usuario expulsado o silenciado desaparece con todos sus mensajes.»
- **C5 Monitor** (`data-tour="chat-monitor"`): escenario con `<ChatOverlayView isStudio>`.
- **C6 Simular en el chat**: 8 botones (Mensaje normal, Con comando de voz, De un suscriptor, Con bits, Solo emotes, Primer mensaje, Con efecto de mensaje, Con emote gigante) + «Ráfaga de 20» + «Borrar el último (moderación)»; interruptor «Chat automático».
- **C7 URL y estado**: botones «Copiar URL para OBS» / «Copiar URL con chat de muestra» (cambian a «URL copiada»); línea de estado (`role=status`) «El chat de aquí es simulado. La URL con chat de muestra sirve para colocar la capa en OBS; al terminar, cámbiala por la normal.» / «Falta tu canal: escríbelo en Inicio antes de copiar la URL.» / error «No se pudo copiar. Usa «Fuentes de OBS» en la cabecera.»

**ASIGNACIÓN PROPUESTA.** Grupo **«En pantalla»**, ventana **«Chat»**, pestañas **Ajustes | Apariencia**:
- *Apariencia*: C1 Plantilla, C2 Movimiento, C3 Colocación.
- *Ajustes*: C4 Qué se ve (qué mensajes y marcas se muestran).
- *Panel persistente (monitor + «Probar», visible en ambas pestañas)*: C5, C6, C7. (El diseño no prevé pestaña «Probar» para Chat, así que la simulación va en el panel fijo.)
- Guía: `chat-template`/`chat-motion` en Apariencia, `chat-monitor` en el panel fijo.

**Lista de comprobación: módulos totales 7 (C1–C7; 5 `cab-mod`: Plantilla, Movimiento, Colocación, Qué se ve, Monitor) / asignados 7.**

## RaidStudio — Raids (src/pages/RaidStudio.tsx)

**Ruta y fuente OBS.** `resolveRoute()` → `'raid'` si `hash === 'raid'`, `'raids'` o empieza por `raid?` / `raid/`; `<RaidStudio />`. SuiteNav «Raids» (icono Clapperboard); Catalog/SYNC «Saludo de raid». Fuente OBS `app=raid` (SYNC_TARGET `raid`); URL con `rs=<encodeRaidSettings>` y `k` con cuenta; `demo=1` para «Copiar URL con saludo de muestra». `currentApp="raid"`.

**Estructura.** Grid 2 columnas: izquierda 4 módulos, derecha «Monitor». Guardado **automático** (`useRaidSettings.updateSettings/updateCommands`; ajustes normalizados con `normalizeRaidSettings` antes de enviarse a OBS). Al abrir comprueba `/api/twitch/clip?check=1` (si el servidor puede buscar cortos). 

**Guía (`<GuidedTour id="raid" appName="Raids">`).** 4 pasos: Bienvenida «Saludo de raid» («Cuando otro canal te manda una raid, aparece una placa con su nombre y cuántas personas llegan, junto a un corto de ese canal.»); `raid-rules` «Cuándo aparece» («Decide el tamaño mínimo de la raid, cuánto dura el corto como mucho y si tu voz da la bienvenida.»); `raid-commands` «Comandos del chat» («Tú y tus moderadores pueden saludar a un canal, poner un corto concreto o retirarlo. Los nombres se pueden cambiar.»); `raid-monitor` «Prueba y copia la URL» («Cada botón simula una cosa que dispara el saludo. Cuando te guste, copia la URL y pégala en OBS.»).

- **R1 Cuándo aparece** (`data-tour="raid-rules"`): interruptor «Saludar las raids y aceptar los comandos» («Apagado, la capa no hace nada aunque esté en OBS. Las pruebas de esta página siguen funcionando.»); número «Tamaño mínimo de la raid» («Personas que tienen que llegar para que salga el saludo.»); rango «Duración máxima del corto» (s; «Un corto más largo se retira al llegar a este tiempo.»); número «De qué días se elige el corto» («Sale el corto más visto de estos últimos días. Si no hay ninguno, el más visto de siempre.»); interruptor «Mostrar también en «Todo en uno»» («La fuente «Saludo de raid» lo muestra siempre.»); `cab-note` de estado del servidor (comprobando / puede buscar cortos / le falta configuración «Quien administra el servidor la añade en sus variables de entorno» / no se pudo preguntar, «En local hace falta arrancarlo con «npm run dev:all»»).
- **R2 Bienvenida con voz**: interruptor «La voz da la bienvenida en las raids» («Espera su turno en la misma cola que la Voz del chat.»); select «Voz de los avisos» (La misma que la Voz del chat | catálogo | Brisa/personalizada; «La usan la bienvenida de una raid y los avisos por comando (el saludo sin placa y las predicciones). De serie, Brisa.»); texto «Qué dice» (≤`RAID_LIMITS.template`, placeholder plantilla por defecto; «Escribe {canal} y {personas} donde quieras el nombre y el número. Ahora diría: «…»»).
- **R3 Marco**: segmentado «Marco del saludo» (Cabina | Cristal | Cómic + botón deshabilitado «Marco subido»), hint del marco; nota ««Marco subido» (tu propia imagen, GIF, WebP, SVG o vídeo) llegará cuando las capas puedan leer los archivos que subes a tu espacio.» Cambiar de marco relanza un saludo de muestra.
- **R4 Comandos de moderación** (`data-tour="raid-commands"`): intro «Solo los aceptan el streamer y los moderadores… También valen con el comando de la voz delante: «!s so canal».»; 3 textos mono (≤16) «Saludar a un canal» (`!so canal`), «Poner un corto» (`!clip enlace`), «Retirar el saludo» (`!cortar`) que se normalizan al salir del campo; rango «Espera de cada comando» (0–120 paso 5, «Sin espera»; «Retirar el saludo no tiene espera.»); dos `cab-note` («Si llega un saludo mientras otro está en pantalla, espera su turno. Como mucho esperan cinco; los demás se descartan.» y la explicación de `!so` sin capa y `!prediccion`).
- **R5 Monitor** (`data-tour="raid-monitor"`): escenario con `<RaidLayer isStudio>`; al abrir lanza un saludo de ejemplo.
- **R6 Qué lo dispara** (botones «Probar»): «Llega una raid», «Un mod escribe !so canal», «Un mod escribe !clip enlace», «Canal sin cortos», «Un mod escribe !cortar» (cada uno muestra su explicación en la línea de estado; con la raid, la frase que diría la voz).
- **R7 Probar con un canal o un corto real (opcional)**: texto (placeholder «canal o https://clips.twitch.tv/...»), sólo activo si el servidor puede buscar cortos («Escribe un canal y pulsa «Llega una raid» o «!so», o pega el enlace de un corto y pulsa «!clip».»).
- **R8 URL y estado**: «Copiar URL para OBS» / «Copiar URL con saludo de muestra»; estado `role=status` («Las pruebas usan datos de ejemplo. La URL con saludo de muestra sirve para colocar la capa en OBS; al terminar, cámbiala por la normal.» / «Falta tu canal: escríbelo en Inicio antes de copiar la URL.»).

**ASIGNACIÓN PROPUESTA.** Grupo **«En pantalla»**, ventana **«Raids»**, pestañas **Ajustes | Apariencia | Probar**:
- *Ajustes*: R1 Cuándo aparece, R2 Bienvenida con voz, R4 Comandos de moderación.
- *Apariencia*: R3 Marco.
- *Probar*: R6 Qué lo dispara, R7 Probar con canal/corto real, R8 URL y estado.
- *Panel persistente (escenario)*: R5 Monitor (visible en las tres pestañas para ver el efecto de R3 y de R1 al instante).
- Guía: `raid-rules`→Ajustes, `raid-commands`→Ajustes, `raid-monitor`→Probar/escenario.

**Lista de comprobación: módulos totales 8 (R1–R8; 5 `cab-mod`: Cuándo aparece, Bienvenida con voz, Marco, Comandos de moderación, Monitor) / asignados 8.**

## PollsStudio — Batallas / Versus (src/pages/PollsStudio.tsx)

**Ruta y fuente OBS.** `resolveRoute()` → `'encuestas'`; alias hash `#encuestas`, `#versus`, `#batallas`, `#polls` (o path `/encuestas`, `/versus`, `/polls`); confirmado: la ruta «encuestas» es la página de Batallas (SuiteNav: `{ app:'encuestas', label:'Batallas', href:'#encuestas' }`, icono Swords). Fuente OBS `app=polls` (SYNC_TARGET `encuestas:'polls'`; Widget también acepta `app=encuestas`/`versus`); URL con `theme=<tema>` y `k` con cuenta. `currentApp="encuestas"`, `tourAvailable={false}`.

**Estructura.** Grid 2 columnas (derecha 560 px): izquierda 3 módulos, derecha «Monitor». Guardado **automático** (`usePollsSettings.updateSettings`, `saved` en SuiteNav). Sin guía, sin pestañas internas. Deshacer con `UndoNote` al cargar plantilla o reiniciar votos.

- **P1 Batalla**: texto «Pregunta» (placeholder «¿A qué jugamos en el próximo bloque?»); dos campos «Opción 1» / «Opción 2» (hint «El chat la vota escribiendo 1.»/«…2.») cada uno con 5 muestras de color + `input color` «Otro color»; segmentado «Duración» (15, 30, 45, 60, 90, 120 s; hint «Ahora dura N segundos.» si es otro valor); «Plantillas» (botones Juegos, Castigos, Comida, Juicio final; «Una plantilla reemplaza la pregunta, las opciones y los votos.») con `UndoNote` «Se cargó la plantilla «…» y reemplazó tu batalla.»
- **P2 Aspecto**: segmentado «Tema de la batalla» (Cabina | Neón; hint «Cambia colores, radio y tipografía de la placa.»; el `title` de cada botón lleva la descripción).
- **P3 Probar sin chat** (`<details>` dentro de «Más»): botones «Voto a 1», «Voto a 2» (con punto del color), «Ráfaga» (votos aleatorios); «Suman votos a la batalla actual, igual que si llegaran del chat. «Reiniciar» los pone a cero.»
- **P4 Reglas y sonido** (`<details>`): interruptores «Permitir cambiar de voto» y «Sonidos al votar, al cambiar el líder y al terminar»; si hay sonidos, rango «Volumen de los sonidos» (0–1, %).
- **P5 Comandos para moderadores** (`<details>`): lista `!poll "Pregunta" "Opción 1" "Opción 2" 45`; `!poll Valorant | Minecraft | 60` (también `!poll Gatos vs Perros 30`); `!poll preset gamer 60` (gamer, castigos, comida, juicio); `!poll 45`; `!poll stop`; nota «El chat vota escribiendo 1 o 2. También valen !1, !2 y !voto 1.»
- **P6 Locutor** (`<details>`): interruptor «Anunciar la batalla con voz»; «La voz es la de «Voz del chat»: <nombre>. Cambiarla» (→ `#tts`); 4 frases con botón «Escuchar»/«Sonando»: «Cuando cambia quien va ganando», «Cuando quedan 10 segundos», «Al terminar», «Si termina en empate» (con `{ganador}`, `{porcentaje}`; se muestran sin etiquetas de emoción).
- **P7 Monitor**: escenario con `<BattleBarView>` (título, opciones, tema, tiempo, ganador).
- **P8 Controles de la batalla**: botón «Iniciar batalla» / «Pausar»; «Reiniciar» (con `UndoNote` «Se reiniciaron los votos.»); texto de reloj («Quedan m:ss» / «Batalla terminada» / «En pausa con m:ss. Al iniciar, el reloj empieza de nuevo.» / «Dura m:ss»).
- **P9 URL y estado**: «Copiar URL para OBS» / «URL copiada»; estado «La batalla se ve aquí y en las fuentes de OBS que estén abiertas.» / «No se pudo copiar. Usa «Fuentes de OBS» en la cabecera.» (Toda la sección «Más» es un `cab-mod` titulado «Más» con P3–P6 plegables.)

**ASIGNACIÓN PROPUESTA.** Grupo **«Participación»**, ventana **«Batallas»**, pestañas **Ajustes | Apariencia | Probar**:
- *Ajustes*: P1 Batalla (pregunta, opciones y sus colores, duración, plantillas), P4 Reglas y sonido, P5 Comandos para moderadores, P6 Locutor.
- *Apariencia*: P2 Aspecto (tema). Los colores de cada opción pueden duplicarse como acceso rápido aquí, pero su fuente de verdad sigue en P1.
- *Probar*: P3 Probar sin chat, P8 Controles de la batalla, P9 URL y estado.
- *Panel persistente*: P7 Monitor.

**Lista de comprobación: módulos totales 9 (P1–P9; 4 `cab-mod`: Batalla, Aspecto, Más, Monitor) / asignados 9.**

## MusicStudio — Ahora suena (src/pages/MusicStudio.tsx)

**Ruta y fuente OBS.** `resolveRoute()` → `'musica'` con `/^(musica|ahora-suena)([?/]|$)/` (`#musica`, `#ahora-suena`); `<MusicStudio />`. SuiteNav «Ahora suena» (icono Music, grupo Integraciones). Fuente OBS `app=music` (SYNC_TARGET `musica:'music'`); URL con `ms=<encodeMusicSettings>`, `k` con cuenta, `demo=1` para «Copiar URL con canción de muestra». `currentApp="musica"`.

**Estructura.** Grid 2 columnas (derecha 1,1fr): izquierda 6 módulos, derecha «Monitor». Guardado **automático** (`useMusicSettings.update`). Sin guía, sin pestañas internas. Al abrir carga una canción de ejemplo; consulta `spotifyStatus` sólo para describir el estado. El botón «Mostrar/Ocultar ahora» además viaja en los ajustes (`live: {action, at}`) para llegar a OBS en otro equipo.

- **M1 Diseño**: rejilla `itg-dz` de 6 diseños con nota (Ficha — «Compacta, para una esquina»; Franja — «Barra ancha de tercio inferior»; Columna — «Vertical, para una barra lateral»; Disco — «Un disco gira junto a la portada»; Línea — «Solo texto, una línea»; Portada — «Grande, para inicio o pausa») + hint del diseño elegido.
- **M2 Mostrar**: segmentado «Cuándo se muestra» (Al cambiar de canción | Siempre que suene | Oculta; hint por opción); si «Al cambiar…»: rango «Segundos en pantalla»; segmentado «Si pones pausa» (Se queda atenuada | Se oculta).
- **M3 Posición y tamaño**: 6 botones de posición (`SIX_POSITIONS`), rango «Tamaño» (%, paso 5).
- **M4 Qué se ve**: interruptores «Portada», «Barra de progreso y tiempo», «Artista», «Álbum»; segmentado «Color de acento» (El de la portada | Fijo) + `input color` «Color fijo» (activo sólo con «Fijo»); hint «El título y el artista de la canción son lo mínimo: sin ellos la capa no tendría sentido. En «Línea» no hay portada. Un archivo local de tu equipo sale sin portada, y si la portada no deja leer su color se usa el fijo.»
- **M5 Comandos del chat**: «Solo los aceptan el streamer y los moderadores. Escríbelos en el chat de tu canal.»; textos mono «Mostrar la canción» (por defecto `!cancion`/`DEFAULT_MUSIC_COMMANDS.show`) y «Ocultarla» (≤25, normalizados al salir); «Los comandos los lee la fuente de OBS que muestra la capa, por el chat de tu canal. No responden en el chat.»
- **M6 Fuente de OBS**: interruptor «Mostrar también en «Todo en uno»» («La fuente «Ahora suena» la muestra siempre.»); `cab-note` de conexión con Spotify (conectado como…, caducó, no conectado, falta configuración, o sin nube) + enlace «Integraciones».
- **M7 Monitor**: escenario `itg-stage` con `<MusicOverlay>` (data-bg según «Fondo de la escena») y línea de estado `role=status` (frases de cada acción).
- **M8 Pruebas** (botones «Probar»): «Cambia la canción», «Pausa», «Reanuda», «Canción con título largo», «Deja de sonar».
- **M9 En directo**: «Mostrar ahora» / «Ocultar ahora» (botón del creador, actúa en directo) y dos botones que simulan al moderador (`!cancion`, `!ocultar` según la configuración); hint «El primer botón es el tuyo: actúa sobre la capa en directo. Los otros dos simulan a un moderador escribiendo el comando en el chat.»
- **M10 Fondo de la escena**: segmentado Oscuro | Claro | Muy cargado.
- **M11 URLs**: «Copiar URL para OBS» / «Copiar URL con canción de muestra» + nota «Las canciones, los artistas y las portadas de esta página son inventados. El recuadro punteado «Spotify» es el sitio del logotipo oficial…»

**ASIGNACIÓN PROPUESTA.** Grupo **«En pantalla»**, ventana **«Ahora suena»**, pestañas **Ajustes | Apariencia** (el diseño no pide «Probar»):
- *Apariencia*: M1 Diseño, M3 Posición y tamaño, M4 Qué se ve.
- *Ajustes*: M2 Mostrar, M5 Comandos del chat, M6 Fuente de OBS (su enlace «Integraciones» pasa a ir a Conexiones › Spotify).
- *Panel persistente (monitor y pruebas, todas las pestañas)*: M7, M8, M9, M10, M11.

**Lista de comprobación: módulos totales 11 (M1–M11; 7 `cab-mod`: Diseño, Mostrar, Posición y tamaño, Qué se ve, Comandos del chat, Fuente de OBS, Monitor) / asignados 11.**

## KofiStudio — Ko-fi (src/pages/KofiStudio.tsx)

**Ruta y fuente OBS.** `resolveRoute()` → `'kofi'` con `/^ko-?fi([?/]|$)/` (`#kofi`, `#ko-fi`); `<KofiStudio />`. SuiteNav «Ko-fi» (icono Coffee, grupo Integraciones). Tres fuentes OBS: `app=kofi` (alertas; SYNC_TARGET `kofi:'kofi'`), `app=kofigoal` (meta) y `app=kofirecent` (últimos apoyos); URL con `kf=<encodeKofiSettings>`, `k` con cuenta y `demo=1` («De muestra»). `currentApp="kofi"`.

**Estructura.** Grid 2 columnas: izquierda 6 módulos, derecha «Monitor». Guardado **automático** (`useKofiSettings.update`, acepta función). Sin guía, sin modales. Monitor con dos vistas (Alertas | Meta y últimos apoyos). Las pruebas pasan por las mismas reglas que un aviso real, y con cuenta se envían también a OBS (`pushTestEvent`); nunca suman a la meta guardada.

- **K1 Diseño de la alerta**: rejilla `itg-dz` (Recibo — tique de papel que se imprime; Rótulo — barra ancha con el tipo a la izquierda) + hint; al elegir, el monitor cambia a la vista «Alertas».
- **K2 Personalización**: 6 posiciones; color de acento (`input color`; «También lo usan la meta y los últimos apoyos.»); rangos «Tamaño» (%) y «Tiempo en pantalla» (s); interruptores «Mostrar la cantidad» y «Mostrar el mensaje»; «Son ajustes comunes a todos los tipos de aviso. El texto y el sonido van por tipo.»
- **K3 Por tipo de aviso**: segmentado de tipo (Donación | Nueva membresía | Renovación | Tienda | Comisión) y, para el tipo elegido (`<KofiEventFields>`): interruptor «Alerta activada»; texto «Texto» (variables `{nombre} {cantidad} {moneda} {mensaje} {nivel}`); select «Sonido» (Ninguno, Campana, Monedas, Fanfarria, Mi archivo); número «Cantidad mínima»; «Alerta grande desde» (sólo Donación); «Solo este nivel» (sólo membresía/renovación, placeholder «vacío: todos»); si sonido = Mi archivo, «Tu archivo de sonido» (`MediaField`, «Sin archivo: la alerta sale sin sonido. MP3, WAV u OGG.»); interruptores «La voz lee el mensaje» y «Sumar a la meta»; nota «Si el apoyo es privado, la alerta dice «Alguien», no enseña el mensaje y la voz no lo lee. El correo y la dirección de envío no se guardan ni se muestran nunca. El mensaje pasa por las mismas palabras bloqueadas que la voz del chat antes de verse o leerse. La voz es la de «Voz del chat»…»
- **K4 Meta**: interruptor «Mostrar la meta»; segmentado «Disposición de la meta» (Barra | Depósito); textos «Nombre de la meta», «Objetivo (EUR)» (número), «Moneda» (3 letras, «Tres letras: EUR, USD, MXN...»); botón «Reiniciar meta» (con nube también en OBS); hint «Solo suman los tipos de aviso con «Sumar a la meta» activado, y solo los apoyos en la moneda de la meta; los demás se anotan sin sumar. Lo recaudado lo lleva el servidor de Tally Studio, una vez por aviso.»
- **K5 Últimos apoyos**: interruptor «Mostrar los últimos apoyos»; segmentado «Disposición de los últimos apoyos» (Lista | Cinta); «Los apoyos privados salen como «Alguien». Usa el mismo color de acento que las alertas.»
- **K6 Fuentes de OBS**: interruptor «Mostrar también en «Todo en uno»» (hint sobre alertas, meta y últimos apoyos); lista de 3 fuentes (Alertas, Meta, Últimos apoyos) con botones «De muestra» y «Copiar URL»; `cab-note` de conexión (conectado / a la espera del primer aviso / no conectado… / sin nube) con enlace «Integraciones».
- **K7 Monitor**: segmentado «Qué enseña el monitor» (Alertas | Meta y últimos apoyos); escenario `<KofiStage>`; línea de estado `role=status` («Pulsa una prueba.» y los resultados detallados de cada aviso).
- **K8 Avisos de prueba** (botones «Probar»): Donación de 3, Donación de 25 (grande), Mensaje largo, Donación privada, Mensaje con palabra bloqueada, Nueva membresía, Renovación, Pedido de tienda, Comisión, «Quitar»; hint «Nombres, cantidades y mensajes inventados. Las alertas van en cola, una cada vez. Los recuadros punteados «Ko-fi» son el sitio de su marca: aquí no se dibuja su logotipo.»

**ASIGNACIÓN PROPUESTA (vista «Conexiones»; no es herramienta).** En «Conexiones» aparece la ficha **Ko-fi** (la de `KofiCard` de Integraciones: estado, «Conectar», dirección personal, clave de verificación, «Volver a comprobar», «Cambiar la clave», «Generar otra dirección», «Desconectar»). Su botón «Ajustar las alertas» abre una **ventana interna de Ko-fi** con pestañas **Conexión | Alertas | Meta y apoyos | Fuentes**:
- *Conexión*: la ficha `KofiCard` completa (integrada desde Integraciones) + la nota de estado de K6.
- *Alertas*: K1 Diseño de la alerta, K2 Personalización, K3 Por tipo de aviso.
- *Meta y apoyos*: K4 Meta, K5 Últimos apoyos.
- *Fuentes*: K6 Fuentes de OBS.
- *Panel persistente (monitor, pruebas)*: K7, K8 (visibles siempre; el monitor ya cambia de vista según el módulo tocado: Alertas vs. fijas).
- Enlaces «Integraciones» de K6 desaparecen (la conexión está en la pestaña Conexión). Hash `#kofi` debe seguir abriendo esa ventana.

**Lista de comprobación: módulos totales 8 (K1–K8; 7 `cab-mod`: Diseño de la alerta, Personalización, Por tipo de aviso, Meta, Últimos apoyos, Fuentes de OBS, Monitor; K8 es un bloque dentro del Monitor) / asignados 8.**

## GameStudio — Alertas de juego (src/pages/GameStudio.tsx)

**Ruta y fuente OBS.** `resolveRoute()` → `'juego'` con `/^(juego|riot)([?/]|$)/` (`#juego`, `#riot`); `<GameStudio />`. SuiteNav «Alertas de juego» (icono Trophy, grupo Integraciones). Fuente OBS `app=game` (SYNC_TARGET `juego:'game'`); URL con `gs=<encodeGameSettings>`, `k` con cuenta y `demo=1` («Copiar URL con alertas de muestra»). `currentApp="juego"`.

**Estructura.** Grid 2 columnas: izquierda con **pestañas ARIA** (`role=tablist` «Secciones de Alertas de juego»: **Alertas | En pantalla | Voz y sonido**, estado `tab`), derecha «Monitor». Guardado **automático** (`useGameSettings`). Sin guía ni modales. La cuenta de Riot se vincula en Integraciones (`RiotCard`).

- **G1 Qué alertas salen** (pestaña Alertas): interruptor «Las alertas de juego salen en directo» («Apagadas no sale ninguna aunque la fuente esté en OBS. Las pruebas de esta página siguen funcionando. Solo League of Legends, con la cuenta de Riot que vincules en Integraciones.»); 3 grupos («Resultado de la partida», «Rango», «Destacados y sesión») con 10 alertas: Victoria, Derrota; Sube de división, Nueva liga, Baja de división; Pentakill, Partida perfecta, Maestría de campeón, Racha de victorias, Empieza la partida. Cada fila: interruptor «Mostrar en directo: …», nombre + hint, botón «Editar» (despliega) y **«Probar»**. Editor de fila: texto «Título» (vacío vuelve al de serie; «Variables: …»; con título propio la voz lee ese título), select «Emoción de la voz» (Sin emoción, Emocionada, Alegre, Sorprendida, Gritando, Riendo, Tranquila, Triste, Llorando, Nerviosa, Suspiro), en «Racha de victorias» número «Victorias seguidas para avisar», y «La voz diría: «…»».
- **G2 Dónde y cuánto se ve** (pestaña En pantalla): segmentado «Posición» (6: Arriba izq., Arriba, Arriba der., Abajo izq., Abajo, Abajo der.), rangos «Tamaño» (%) y «Duración» (s), interruptor «Mostrar también en «Todo en uno»» («La fuente «Alertas de juego» las muestra siempre. No actives las dos a la vez en OBS o cada alerta saldrá y sonará dos veces.»).
- **G3 Placa**: «Color» (segmentado Según la alerta | Uno fijo + `input color`; hint ««Según la alerta» usa verde para victorias, rojo para derrotas, dorado para el rango, morado para las jugadas y azul para los avisos.»), segmentado «Energía del movimiento» (Suave | Normal | Intensa; hint «Con «reducir movimiento» activo en el sistema, todo pasa a fundidos.»), interruptores «Mostrar estadísticas» y «Mostrar el nombre del juego».
- **G4 Quién la anuncia** (pestaña Voz y sonido): segmentado (Nadie | La voz | La mascota, con hint de cada uno); si no es «Nadie»: segmentado «Con qué voz» (La de la Voz del chat | La de la mascota | Una del catálogo) con hint; texto sobre la voz de la mascota con enlace a `#mascotas`; select «Voz del catálogo».
- **G5 Sonido**: select «Al salir la placa» (Sin sonido, Toque suave, Fanfarria corta, Campana, Arcade; suena una vez al elegirlo; «Suena en la fuente de OBS, antes de la voz.»); rango «Volumen».
- **G6 Monitor**: escenario `<GameAlertLayer isStudio>`.
- **G7 Probar una alerta**: un botón por alerta (10) con `aria-pressed`.
- **G8 URL y estados**: «Copiar URL para OBS» / «Copiar URL con alertas de muestra»; estado (`role=status`) «Las pruebas usan datos de ejemplo. En el monitor no suena nada: el sonido y la voz salen por la fuente de OBS.» / «Falta tu canal: escríbelo en Inicio antes de copiar la URL.»; `cab-note` sobre alertas reales («Las alertas reales salen de tu cuenta de Riot: vincúlala en «Integraciones». Llegan al terminar la partida o al consultarla, no al instante.» / requiere nube y Riot ID) con enlace «Integraciones».

**ASIGNACIÓN PROPUESTA (vista «Conexiones»).** Ficha **Riot Games** en Conexiones (la de `RiotCard`: Riot ID `nombre#etiqueta`, select «Servidor», lista SÍ/NO de permisos, casilla de aceptación de la política, «Vincular»/«Desvincular», «Aceptar la versión N», avisos legales en inglés y español). Su «Ajustar las alertas» abre una **ventana interna de Alertas de juego** con pestañas **Conexión | Alertas | En pantalla | Voz y sonido** (las tres existentes se mantienen tal cual y se añade «Conexión» al inicio):
- *Conexión*: `RiotCard` completa + nota de G8 sobre alertas reales.
- *Alertas*: G1. *En pantalla*: G2, G3. *Voz y sonido*: G4, G5.
- *Panel persistente*: G6, G7, G8 (monitor, pruebas, URL).
- Los enlaces «Integraciones» pasan a apuntar a esa pestaña Conexión. `#juego`/`#riot` abren esta ventana.

**Lista de comprobación: módulos totales 8 (G1–G8; 6 `cab-mod`: Qué alertas salen, Dónde y cuánto se ve, Placa, Quién la anuncia, Sonido, Monitor) / asignados 8.**

## Studio — Studio, editor de escenas (src/pages/Studio.tsx)

**Ruta y fuente OBS.** `resolveRoute()` → `'studio'` con `/^(studio|estudio)([?/]|$)/` (`#studio`, `#estudio`); admite `#studio?scene=<id>&sel=<n>&probar=1` (abre la escena, elige la capa n y lanza su prueba). SuiteNav «Studio» (icono Layers, grupo En vivo/Estudio). No está en `SYNC_TARGET`: cada escena tiene su propia URL OBS (`#widget?app=scene&scene=<id>`, construida con `buildSceneUrl(origin, canal, escena, {key} | {chat, raid})`); sin cuenta, la escena viaja dentro de la URL. `currentApp="studio"`; ancho máx. 1760 px. Máx. 12 escenas (`MAX_SCENES`), 40 capas por escena (`MAX_LAYERS`).

**Estructura.** No usa `cab-mod` (0): es un editor en 3 columnas `st-body`: `aside.st-left` (SidePanel), `st-mid` (lienzo + herramientas + URL), `aside.st-right` (Inspector). Guardado **automático** con historial: Deshacer/Rehacer (Ctrl+Z, Ctrl+Mayús+Z, Ctrl+Y). Preferencias del editor en localStorage (`editorPrefs`). Sin guía ni modales.

- **S1 Barra de escenas** (`st-bar`, fila 1): segmentado «Escenas» (una por escena) + select «Añadir una escena desde una plantilla» («+ Escena nueva»: En blanco, En directo, Empezando, Pausa, Fin; deshabilitado al llegar al máximo).
- **S2 Barra de acciones** (fila 2): «Deshacer», «Rehacer», «Reproducir entradas», enlace «Abrir» (la escena en otra pestaña), «Copiar URL para OBS» (→ «URL copiada»).
- **S3 Escena** (SidePanel): texto «Escena» (nombre, renombrar), botones «Antes», «Después», «Duplicar», «Borrar» (con `UndoNote` «Escena «…» borrada.»).
- **S4 Añadir**: paleta de 19 tipos «+ Alerta», Meta, Chat, Saludo de raid, Mascota, Alerta de juego, Ahora suena, Alerta de Ko-fi, Meta de Ko-fi, Últimos apoyos de Ko-fi, Recompensa, Aviso de Power-up, Ruleta, Batalla, Torneo, Marco de cámara, Texto, Forma, Imagen o vídeo, Temporizador; botón «Pegar «…»» si hay portapapeles; aviso de máximo de capas.
- **S5 Capas (arriba = delante)**: lista con nombre (selecciona) y botones adelante/atrás, mostrar/ocultar, bloquear/desbloquear; «Sin capas. Añade una arriba.»
- **S6 Lienzo y estado**: `<EditorCanvas>` 1920 × 1080 (arrastrar, estirar, atajos), barra de estado (nombre · x y · w × h, o «N capas en «…»»), `1920 × 1080`.
- **S7 Herramientas del lienzo**: «Fondo» (opciones `BG_OPTIONS` + botón «Elegir imagen», subida de imagen local), «Zoom» (`ZOOM_OPTIONS`), botones «Zona segura», «Cuadrícula» + select «Tamaño de la cuadrícula» (px), «Imán»: «A otras capas», «A la cuadrícula».
- **S8 Atajos y notas**: «Flechas: mover 1 px (con Mayús, 10). Supr: borrar. Ctrl+D: duplicar. Ctrl+C y Ctrl+V: copiar y pegar, también entre escenas. Ctrl+Z: deshacer. Ctrl+Mayús+Z: rehacer. Mayús al estirar mantiene la proporción y Alt apaga el imán. El lienzo siempre se pega a sus bordes y a su centro.»; mensajes `note`.
- **S9 URL de «escena» para OBS**: `code` con la URL + «En OBS, añade una fuente de navegador de 1920 × 1080 con esta URL. Los cambios llegan solos a OBS en menos de un minuto.» (con cuenta) / «Sin cuenta en la nube, la escena viaja dentro de la URL: si la cambias, vuelve a copiarla en OBS.»
- **Inspector** (`<Inspector>`; vacío: «Elige una capa en el lienzo o en la lista para ver sus ajustes.»):
  - **I1 Nombre**.
  - **I2 Posición y tamaño**: X, Y, Ancho, Alto (numéricos); «Mantener proporción», «Todo el lienzo»; 6 botones de alineación (izquierda, centro horizontal, derecha, arriba, centro vertical, abajo).
  - **I3 Orden**: «Al frente», «Adelante», «Atrás», «Al fondo».
  - **I4 Opacidad** (rango %).
  - **I5 Campos propios del tipo** (`TypeFields`): *Imagen o vídeo* (subida con nube / pegar URL; selects «Qué es», «Cómo encaja»; interruptores «Repetir sin parar», «Sin sonido»); *Texto* (contenido, «Tipografía», «Grosor», «Tamaño», «Color», «Alineación», «Para que se lea», «Todo en mayúsculas»); *Forma* («Con relleno», «Relleno», «Borde», «Grosor del borde», «Redondeo»); *Marco de cámara* («Color», «Grosor», «Redondeo», «Con etiqueta»; «El marco solo dibuja el borde: la cámara es otra fuente de OBS, colocada debajo.»); *Temporizador* («Qué cuenta», «Minutos», «Color», «Formato», «Al llegar a cero», «Con placa de fondo»; «El reloj arranca cuando OBS carga la escena. Aquí se ve parado en su valor inicial.»); *Posición aleatoria* (sólo alerta/raid: «Cada aviso sale en un sitio distinto», «Ancho/Alto del aviso»); *Prueba* (capas de Tally Studio: botón que repite la muestra; «Lo que dice o hace la capa en directo se ajusta en su página.»).
  - **I6 Enlace a la página de la capa** (capas de Tally Studio): «Los ajustes propios de esta capa (textos, diseño, sonidos) siguen en su página. Aquí solo se coloca. Abrir <página>» (enlaces `#alertas`, `#metas`, `#chat`, `#raid`, `#mascotas`, `#juego`, `#musica`, `#kofi`, `#recompensas`, `#powerups`, `#ruleta`, `#encuestas`, `#torneos`; estos hrefs deben actualizarse a las nuevas ventanas/vistas).
  - **I7 Movimiento**: selects «Entrada» y «Salida» (Ninguna, Aparecer, Subir, Entrar de lado, Cortina, Crecer), rangos «Retraso» y «Duración» (s), botones «Ver entrada» / «Ver salida»; «La entrada se ve al cargar la escena en OBS; la salida, al ocultar la capa.»
  - **I8 Acciones de capa**: «Duplicar», «Copiar», «Borrar».

**ASIGNACIÓN PROPUESTA.** Grupo **«En pantalla»**, ventana **«Studio»**, pestañas **Escenas | Fuentes**:
- *Escenas*: el editor completo: S1, S2, S3, S4, S5, S6, S7, S8 + Inspector I1–I8 (las 3 columnas se mantienen dentro de la pestaña; la ventana debe poder maximizarse porque el lienzo ocupa 1760 px).
- *Fuentes*: S9 «URL de la escena para OBS» (con «Abrir» y «Copiar URL») ampliado a una lista de las URLs de todas las escenas más el recordatorio de uso en OBS; las acciones «Abrir» y «Copiar URL para OBS» de S2 deben seguir también en la barra del editor. Los parámetros `?scene=&sel=&probar=1` siguen abriendo Escenas.
- Los enlaces I6 deben apuntar a las nuevas ubicaciones: Chat, Raids, Ahora suena, Batallas → sus ventanas; Ko-fi y Alertas de juego → Conexiones.

**Lista de comprobación: módulos totales 17 (S1–S9 = 9 + I1–I8 = 8; 0 `cab-mod`) / asignados 17.**

## Integraciones (src/pages/Integraciones.tsx)

**Ruta y fuente OBS.** `resolveRoute()` → `'integraciones'` con `/^integraciones([?/]|$)/` (`#integraciones`); `<Integraciones />`. SuiteNav «Integraciones» (icono Plug). **Sin fuente OBS.** `currentApp="integraciones"`, sin guardado ni guía.

**Estructura.** Texto introductorio `ig-lede` («Conecta cuentas de otros servicios. Cada ficha dice con qué cuenta está conectada, qué puede leer Tally Studio y cómo desconectarla. Las capas que usan estos servicios se ajustan en «Ahora suena», «Ko-fi» y «Alertas de juego».»), rejilla `.ig` con 7 fichas (`ServiceCard` = `cab-mod ic` con sigla, nombre y estado) y un módulo final. Las acciones son inmediatas contra la API (no hay guardado). Sin modales (el paso «pidiendo permiso» de Spotify es en línea).

- **I0 Introducción** (`ig-lede`).
- **N1 Spotify (SP)** (`SpotifyCard`): estados «Sin la nube» / «Comprobando» / «Sin conectar» / «Pidiendo permiso» / «Conectado» / «Caducado». «Conecta tu cuenta para que la capa «Ahora suena» muestre en pantalla la canción que estás escuchando.»; «Conectar con Spotify» → pantalla de permiso (SÍ: ver qué suena; NO: pausar/saltar, listas/biblioteca, correo/pago) con «Continuar en Spotify» / «Cancelar»; ya conectada: «Conectado como …», «Probar» (muestra qué dice Spotify), «Desconectar», enlace «Ajustar la capa» (`#musica`); aviso de caducidad a los 6 meses; plazas «N de M»; «Mientras la app de Spotify de Tally Studio esté en modo desarrollo, solo pueden conectarse cinco cuentas…»; «Volver a comprobar» en problemas.
- **N2 Ko-fi (KF)** (`KofiCard`): estados Sin conectar / dirección / a la espera / conectado; «Conectar»; pasos 1–3 (copiar dirección personal «Es privada…», pegarla en Ko-fi › Más › API y webhooks, pegar «clave de verificación» en campo password) con «Guardar»/«Cancelar»; «Copiar dirección»; conectado: «Último aviso recibido: …», «Volver a comprobar», «Cambiar la clave» (+ «Guardar la clave»), «Generar otra dirección», «Desconectar», enlace «Ajustar las alertas» (`#kofi`); aviso de clave que no coincide; «Sin límite de cuentas: cada streamer conecta su propio Ko-fi…».
- **N3 Riot Games (RG)** (`RiotCard`): formulario «Riot ID» (`nombre#etiqueta`), select «Servidor», lista SÍ/NO, casilla «He leído y acepto la política de uso…», botón «Vincular»; vinculada: «Vinculada con …», «Desvincular», «Aceptar la versión N» si la política cambió, enlace «Ajustar las alertas» (`#juego`); avisos «No hay inicio de sesión de Riot…» y descargo de no afiliación en inglés y español.
- **N4 Twitch (TW)** (`TwitchCard`): «Conectado como …», lista de permisos (SÍ/NO/? por scope de `EVENT_SCOPES`), «Volver a autorizar», enlace «Canal de eventos» (`#powerups`), mensaje de permisos comprobados.
- **N5 Last.fm (LF)** — «Próximamente».
- **N6 Apple Music (AM)** — «No disponible» («Pendiente de verificar…»).
- **N7 YouTube Music (YT)** — «No disponible».
- **N8 Cómo funciona y qué se guarda** (`cab-mod ic`, lista `ic-facts`): Spotify (permiso `user-read-currently-playing`), por qué se guarda algo en el servidor, retraso (5 s), Ko-fi, privacidad en Ko-fi, Riot Games, retraso en Riot (medio minuto).

**ASIGNACIÓN PROPUESTA (vista «Conexiones»).** Integraciones pasa a ser el contenido de la vista **«Conexiones»** (no es herramienta, no tiene ventana de pestañas): una cuadrícula de fichas de servicio con estado a la vista.
- Fichas de la vista: N4 Twitch, N1 Spotify, N2 Ko-fi, N3 Riot Games y el bot de Twitch (estado resumido, enlazando a Voz e IA › Bot › Conexión; no está en la página actual pero es la otra «conexión» del producto), más N5–N7 «Próximamente/No disponible».
- I0 y N8 se conservan como cabecera y como bloque plegable «Cómo funciona y qué se guarda» al final de la vista.
- Los enlaces «Ajustar la capa» / «Ajustar las alertas» pasan a abrir: Ahora suena (En pantalla), la ventana interna de Ko-fi y la de Alertas de juego (ver sus secciones). Ko-fi y Riot reúnen en su ventana interna una pestaña «Conexión» con la ficha completa; la ficha en la vista Conexiones muestra el mismo componente (misma lógica, mismo estado) para no duplicar errores.
- Spotify no tiene herramienta propia: su ajuste de capa es «Ahora suena» (En pantalla); la ficha Spotify queda sólo en Conexiones (con enlace a esa ventana).

**Lista de comprobación: módulos totales 9 (I0, N1–N8; 8 `cab-mod`: 7 fichas + «Cómo funciona y qué se guarda») / asignados 9.**

## Resumen de recuentos (módulos totales por página)

Dashboard 29 · LuxAI 13 · TwitchIOStudio 5 · ChatStudio 7 · RaidStudio 8 · PollsStudio 9 · MusicStudio 11 · KofiStudio 8 · GameStudio 8 · Studio 17 · Integraciones 9. Pendiente de decisión (nuevo, sin código existente): «Done · Asistente del canal» (Voz e IA, pestaña Resumen) no existe en el repositorio y no tiene contenido que migrar.
