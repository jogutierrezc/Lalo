# Bot de chat en la nube: puesta en marcha

Guía para quien despliega Lalo (no para el streamer). El bot de chat de Twitch deja de ser un script de Python en el
ordenador de cada streamer y pasa a vivir en el servidor, con un **token de aplicación** y **ningún token de usuario guardado**. Cada
canal elige con qué cuenta escribe: **el nombre del propio streamer** (por defecto en perfiles nuevos, ver «Modo streamer») o **una cuenta
de bot global, «Lalo»** (secciones 1 y 2).

Qué hace el servidor, y dónde está:

| Pieza | Archivo |
| --- | --- |
| Recibe `channel.chat.message` de Twitch y lo entrega al bot (el trabajo sigue tras el 200 con `waitUntil`) | `server/twitch/eventsub.ts` |
| Comandos, `!lux`/`!luxon`/`!luxoff` | `server/twitch/chatProcessor.ts` |
| Escribe en el chat (`POST helix/chat/messages`) con límite de envíos | `server/twitch/chatSend.ts`, `chatLimiter.ts` |
| Alta, estado y baja de la escucha del chat de un canal | `server/twitch/botChatPort.ts` (sobre `subscriptions.ts`) |
| Cola del panel («Decir en el chat») y saludos de seguidor y directo | `server/twitch/botBackground.ts` |
| Aprender del chat y comentarios espontáneos | `server/twitch/botBackground.ts`, `botChatLines.ts` |
| API del panel y tarjeta «Bot en la nube» | `server/twitch/botHandlers.ts`, `src/pages/TwitchIOStudio.tsx` |

## 1. Variables de entorno (solo servidor)

Ya existen para el canal de eventos de Twitch (ver `.env.example`):

| Variable | Para qué |
| --- | --- |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | La aplicación de Twitch. Se pide un token de aplicación con ellas. |
| `TWITCH_EVENTSUB_SECRET` | Secreto de las firmas de EventSub: de 10 a 100 caracteres imprimibles. |
| `TWITCH_EVENTSUB_CALLBACK` | Dirección pública `https://…/api/twitch/eventsub` (puerto 443). Si falta, se deduce de `VERCEL_PROJECT_PRODUCTION_URL`. |
| `SUPABASE_URL` (o `VITE_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY` | El bot lee y escribe con la clave de servicio. |

Nueva para el bot en la nube:

| Variable | Para qué |
| --- | --- |
| `TWITCH_BOT_USER_ID` | Solo para el modo «cuenta Lalo». **Id numérico** de Twitch de la cuenta Lalo (no su nombre de usuario). Es el `user_id` de la suscripción y el `sender_id` de los mensajes; también sirve para que el bot no se conteste a sí mismo. Sin ella, el servidor responde **503 `chat_unavailable`** con el mensaje «El bot en la nube todavía no está disponible en este servidor» al pulsar Conectar (el nombre de la variable solo sale en el registro del servidor, nunca al cliente) y no se escribe nada. |

La clave de NVIDIA de Mi AI sigue en el almacén cifrado de siempre (`INTEGRATIONS_ENC_KEY`); el bot en la nube la usa
igual que el panel.

Para sacar el id numérico de la cuenta Lalo: `GET https://api.twitch.tv/helix/users?login=<nombre>` con un token de
aplicación y el `Client-Id` (endpoint «Get Users» de la referencia de Twitch). No lo he ejecutado desde aquí.

## 2. Crear y autorizar la cuenta Lalo (una sola vez)

1. Crea (o usa) la cuenta de Twitch «Lalo», con el correo verificado.
2. En la consola de desarrolladores de Twitch, en la aplicación de Lalo, añade en «OAuth Redirect URLs» una dirección que
   controles. Para esto basta `http://localhost:3000` (Twitch suele admitir `http://localhost` para desarrollo; compruébalo en la consola): no hace falta que
   haya nada escuchando.
3. Con la sesión de la cuenta **Lalo** abierta en el navegador, abre esta dirección (flujo de código de autorización,
   documentado en `https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/`), cambiando `CLIENT_ID` y el redirect por
   el registrado:

   ```
   https://id.twitch.tv/oauth2/authorize?client_id=CLIENT_ID&redirect_uri=http%3A%2F%2Flocalhost%3A3000&response_type=code&scope=user%3Aread%3Achat+user%3Awrite%3Achat+user%3Abot
   ```

4. Pulsa «Autorizar». Twitch te redirige a una dirección con `?code=…`; la página puede no cargar y no importa.

**No hace falta cambiar ese código por un token ni guardarlo.** Lo que necesita EventSub con webhook es que la cuenta ya haya
concedido esos permisos a la aplicación (lo dice la documentación de EventSub: los tipos con permiso de usuario exigen que el
usuario lo haya autorizado para el Client-Id). Eso queda registrado en Twitch al pulsar «Autorizar». Si más adelante revocas
la autorización de la aplicación desde la configuración de conexiones de la cuenta Lalo, el bot deja de funcionar.

Permisos pedidos: `user:read:chat` (recibir el chat), `user:write:chat` (escribir) y `user:bot` (que la cuenta actúe como bot).
Los tres están en la referencia de EventSub (`channel.chat.message`) y de «Send Chat Message».

> **A comprobar al desplegar:** que Twitch acepte la suscripción con token de aplicación y estos permisos concedidos solo por
> el flujo anterior. Está escrito según la documentación; no lo he podido probar contra Twitch.

## 2 bis. Modo streamer (sin cuenta bot)

El bot escribe con la **propia cuenta de cada streamer**: los mensajes de la IA y de los comandos salen con su nombre. No hace
falta `TWITCH_BOT_USER_ID` ni la cuenta Lalo, y sigue sin guardarse ningún token de usuario.

**Qué cambia respecto al modo global**

- La suscripción `channel.chat.message` se crea con `user_id` = el id de Twitch del streamer (= `broadcaster_user_id`), y los envíos
  (`POST helix/chat/messages`) llevan `sender_id` = el streamer. Todo está centralizado en `server/twitch/senderMode.ts`
  (`senderIdFor`).
- Permisos: el propio streamer concede a la aplicación `user:read:chat`, `user:write:chat` y `user:bot` al iniciar sesión
  (están en `TWITCH_SCOPES`, `src/lib/cloud.ts`; `channel:bot` se sigue pidiendo). Si falta alguno, Conectar responde `no_permission`
  con `authorize.scopes` = esos tres y el panel lo lleva a Twitch.
- Límite de envíos: el limitador (0040) ya cuenta por `sender_id`, así que cada streamer tiene su propio cupo (20 mensajes cada
  30 s por cuenta y, por seguridad, 6 por canal en 30 s). No hay cambios de base de datos para esto.
- **Antieco.** El bot escribe como el streamer, así que sus respuestas vuelven por EventSub como mensajes del propio streamer. Antes
  de enviar cada trozo se anota en `twitch_bot_cooldowns` (`viewer = echo`, clave `echo:` + hash del texto, 20 s) y, al llegar un
  mensaje del streamer, si su texto está anotado se descarta. Los comandos que el streamer escribe a mano (`!wwoff`, etc.) se
  atienden con normalidad. Si no se puede anotar (base caída), el mensaje no se envía. Coste conocido: un mensaje a mano idéntico a
  uno que el bot acaba de enviar (en 20 s) se ignora. La purga (0041) limpia estas marcas.

**Pasos para el streamer**

1. Cerrar sesión y volver a entrar con Twitch (para conceder `user:read:chat` y `user:bot`).
2. Estudio del bot → «Bot en la nube» → «El bot escribe» → «Con el nombre del streamer» (valor por defecto en perfiles nuevos).
3. «Conectar el bot». Cambiar de opción apaga el bot y quita la escucha anterior: hay que pulsar Conectar otra vez.

**Perfiles existentes**: no cambian solos. Los que ya tenían ajustes siguen en `global` hasta que elijan otra opción. La migración
`0042_twitch_bot_sender_streamer.sql` solo cambia el valor por defecto de las filas nuevas (`streamer`); el servidor ya lo manda al
crear la fila, así que funciona aunque 0042 no se haya aplicado.

> **A comprobar al desplegar:** la documentación de EventSub dice que con token de aplicación `channel.chat.message` exige
> `user:read:chat` y `user:bot` del usuario que chatea, y `channel:bot` del dueño del canal **o** que sea moderador. No pude
> confirmar en la referencia de Send Chat Message que el dueño del canal quede exento de `channel:bot`; por eso `channel:bot` se
> sigue pidiendo al iniciar sesión. Nada de esto está probado contra Twitch real.

## 3. Migraciones

Aplícalas en Supabase (SQL Editor o `supabase db push`), en orden, después de 0001–0038. Se pueden repetir sin romper nada:

- `0039_twitch_bot.sql`: ajustes y comandos (el streamer solo los **lee** con RLS; escribe el servidor con `service_role`) y la tabla
  `twitch_bot_cooldowns`, que con la misma función atómica `take_twitch_bot_cooldown` sirve para: el cooldown de un espectador
  (`viewer` = su usuario, `key` = `cmd:<comando>` o `lux`), la deduplicación de avisos (`viewer` = `dedupe`, `key` = `m:<Message-Id>`,
  600 s), los candados entre instancias del resumen y del comentario espontáneo (`viewer` = `_`, `key` = `digest` o `spont`) y el
  límite de tasa de la API del panel (`_` + `api_status` o `api_connect`). No hay tabla de estado del comentario espontáneo: esa
  hora ya vive en los ajustes de Mi AI.
- `0040_twitch_bot_limiter.sql`: contador de envíos de la cuenta del bot (el límite sobrevive entre peticiones): 1 por segundo y
  **6 por canal** en 30 s (para que un canal o un espectador no agote el cupo de todos), dentro de los 20 de la cuenta.
- `0042_twitch_bot_sender_streamer.sql`: el valor por defecto de `sender_mode` pasa a `streamer` para filas nuevas (el check de 0039 ya lo admitía). No toca filas existentes.
- `0041_twitch_bot_chat_lines.sql`: búfer rodante de líneas del chat (hasta 200 por streamer, nada de más de 24 h) y la función
  de purga `purge_twitch_bot_data()`. Solo `service_role`.

### Programar la purga (pg_cron)

Los cooldowns, los envíos y las líneas del chat caducadas no se borran solos. `purge_twitch_bot_data()` (en 0041) quita los
cooldowns y candados vencidos, los envíos de más de 60 s y las líneas del chat de más de 24 h, y devuelve cuántas filas quitó
de cada tabla. Prográmala una vez con la extensión `pg_cron` de Supabase (Database → Extensions → `pg_cron`; no se crea ninguna
función nueva en `api/`). En el SQL Editor:

```sql
create extension if not exists pg_cron;
select cron.schedule('purga-bot-twitch', '*/10 * * * *', $$select public.purge_twitch_bot_data()$$);
```

Cada 10 minutos basta. Para ver que corre: `select * from cron.job_run_details order by start_time desc limit 5;`. Para quitarla:
`select cron.unschedule('purga-bot-twitch');`. Si no la programas, nada se rompe, pero las líneas del chat solo se borran
al resumir, al desconectar o al apagar el aprendizaje (y, por streamer, al llegar la siguiente línea: ver 0041), y las tablas de cooldowns y envíos
crecen. No he podido ejecutar `pg_cron` desde aquí.

Si falta alguna, el panel responde «falta aplicar la migración» o el bot se calla en ese punto (el limitador, por seguridad,
**no deja enviar** si la base falla).

## 4. Cada streamer: volver a iniciar sesión

En modo global, la suscripción pide el permiso `channel:bot` **del streamer** (que Lalo entre en su chat). Ya está en `TWITCH_SCOPES`
(`src/lib/cloud.ts`), pero quien inició sesión antes de añadirlo no lo concedió. Hasta que cierre sesión y vuelva a entrar con
Twitch, «Conectar» en la tarjeta «Bot en la nube» responde «falta permiso» (403 de Twitch) y el panel se lo pide de nuevo.

Después, en el panel: «Bot en la nube» → Conectar. Eso da de alta `channel.chat.message` y enciende el bot (`enabled`).

**Apaga el script de Python de ese canal.** Si siguen los dos, cada comando se contesta dos veces y los dos se reparten la
cola de mensajes del panel. Con el bot en la nube encendido el servidor se encarga de la cola, los saludos, el resumen del
chat y los comentarios espontáneos; con él apagado no toca nada y el script sigue como siempre.

## 5. Cómo probarlo con un canal de prueba

1. Variables puestas, migraciones aplicadas, cuenta Lalo autorizada, despliegue hecho (Twitch necesita una dirección https
   pública: en local no llega).
2. Entra con un canal de prueba (tu propia cuenta) en Lalo y vuelve a iniciar sesión si es de antes de `channel:bot`.
3. «Bot en la nube» → Conectar. El estado debe pasar de «pendiente» a «activo» (Twitch verifica la dirección con un
   `webhook_callback_verification`). Si queda en «error», mira `GET /api/twitch/subscriptions` y los registros de Vercel.
4. Crea un comando de prueba y escríbelo en el chat del canal: debe contestar la cuenta Lalo, una vez.
5. Mi AI: `!lux hola` (o tu palabra); `!luxoff` y `!luxon` solo funcionan para el canal y los moderadores.
6. Cola: en Mi AI → «Decir en el chat», envía un texto. Debe salir en segundos y pasar a «enviado» en el panel.
7. Saludos: pasa a «seguir» con otra cuenta (activando el saludo a seguidores en Mi AI). El de inicio de directo sale al
   momento; el de seguidores espera a que el grupo se calme (15 s) y sale con el siguiente mensaje del chat o del panel.
8. Aprendizaje y comentarios: activa «aprender del chat» y/o comentarios espontáneos, escribe 10+ líneas con otra cuenta. El
   resumen no se dispara hasta tener 10 líneas y que pasen 20 min desde el último; el comentario respeta el intervalo y el
   mínimo de mensajes del panel.

## 6. Riesgos y límites

- **Límite de la cuenta de bot: 20 mensajes cada 30 s en total y 1 por segundo por canal** (sin ser moderador/VIP). Si se pasa,
  Twitch ignora al bot **durante una hora** (según la referencia de «Send Chat Message», comprobada el 2026-10-25 y anotada en
  `chatSend.ts`). Es un solo cupo para **todos** los streamers: con muchos canales activos se agota, y el servidor descarta lo
  que sobre en vez de arriesgar el castigo. Además, cada canal tiene su tope de 6 mensajes por 30 s, y cada espectador espera 5 s por comando (y por
  aviso de `!lux`). Un mensaje de la cola del panel que el limitador no deja salir **vuelve a «pendiente»** y se
  reintenta en el siguiente turno (siempre que no haya salido ya ningún trozo, para no duplicarlo); uno que Twitch rechaza queda
  «fallido». Un mensaje «recogido» que no se confirma en ~2 min se recoge de nuevo. La cuenta se puede hacer moderadora en cada canal para subir el tope, pero eso no está
  implementado.
- **Tiempo de la función en Vercel.** El trabajo tras el 200 (respuesta de la IA, resumen del chat, envío) corre con
  `waitUntil` y **cuenta contra la duración máxima de la función** `api/twitch/eventsub.ts`. Una respuesta larga de la IA puede
  pasarse del plazo por defecto y cortarse sin aviso. Mira en el proyecto de Vercel el ajuste de duración máxima de funciones
  (en la configuración del proyecto, o `maxDuration` por función, que en este repo solo se ha puesto para `api/tts.ts`; la ruta
  exacta del panel y los topes de cada plan hay que comprobarlos en la documentación de Vercel) y revisa qué admite tu plan. No he cambiado ninguno: debes decidir el valor. Los envíos desde el panel (`say`) y
  los saludos de EventSub también usan `waitUntil`, en las funciones `api/integraciones.ts` y `api/twitch/eventsub.ts`.
- **Avisos repetidos.** Twitch entrega «al menos una vez». Además del filtro en memoria de cada instancia, cada comando se
  deduplica por `Message-Id` en la base de datos (`dedupe`, 10 min), así que dos instancias no contestan el mismo aviso. El limitador,
  los cooldowns y los candados del resumen y del comentario espontáneo también están en la base.
- **Texto de la IA.** Lo que la IA escribe en el chat pasa por un filtro que quita enlaces, dominios y menciones con @ (se conserva
  la @ inicial del espectador al que responde); no entiende enlaces escritos para esquivarlo. Las líneas del chat que se le pasan
  para resumir o comentar van entre marcas `<chat_datos>` con la instrucción de tratarlas como datos, lo que reduce, pero no
  elimina, el riesgo de inyección de instrucciones.
- **Límite de la API del panel.** `GET /api/twitch/bot`, `status` (2 s por perfil) y `connect`/`disconnect` (5 s) se limitan con la
  base de datos; el estado de la suscripción de Twitch se recuerda 30 s por instancia y no se consulta con el bot apagado.
- **Privacidad del chat.** Mientras «aprender del chat» o los comentarios estén activos, las líneas (sin comandos) se guardan
  en `twitch_bot_chat_lines` con el nombre de usuario. Se borran: al resumir (solo las ya leídas; se conservan las que el comentario
  espontáneo aún no ha usado), al **desconectar** el bot, al guardar `enabled = false` y al apagar a la vez el aprendizaje y los
  comentarios en Mi AI. La red de seguridad es la purga de arriba (24 h).
- **Aviso de seguidor sin charla.** Sin mensajes en el chat ni en el panel, un saludo de seguidores ya agrupado espera. No hay
  bucle que pregunte cada pocos segundos como en el script.
- **El resumen del chat espera a 10 líneas** (el script resumía con una sola); es una decisión para no gastar el turno de 20 min.

## 7. Lo que NO se ha probado

Todo el código tiene pruebas con bases, `fetch` y limitadores falsos (`tests/twitchBot*.test.ts`, `tests/twitchChat*.test.ts`).
**No se ha probado nada contra Twitch ni Supabase reales.** En concreto:

- Las migraciones 0039–0041 (la función `push_twitch_bot_chat_line`, el candado asesor del limitador, las políticas RLS, `purge_twitch_bot_data` y su programación con `pg_cron`). **No están aplicadas en ninguna base.**
- Las consultas de actualización parcial (`upsert` solo con las columnas que cambian) y el filtro `.or(...)` de la cola reclamada contra PostgREST real (solo se comprobó la forma de la consulta con un cliente falso).
- El alta de `channel.chat.message` con token de aplicación y la autorización de la cuenta Lalo por el flujo de la sección 2.
- La verificación del webhook y los reintentos de Twitch con la ruta desplegada; `revocation` solo se registra en el log.
- El envío real con `helix/chat/messages`, incluidos `drop_reason`, 401 con renovación del token y 429.
- El límite de 20 mensajes/30 s y el comportamiento del limitador con varias instancias de Vercel a la vez.
- `waitUntil` en Vercel: que el trabajo sobreviva al 200 y cuánto tarda en cortarse.
- La IA real (NVIDIA): resumen, comentario espontáneo y saludos.
- La tarjeta del panel de extremo a extremo.

## 8. Fuera de alcance (pendiente)

- **Saludos por suscripciones y raids.** Necesitan la suscripción `channel.chat.notification` (ni siquiera está en `WANTED`
  de `subscriptions.ts`). Hoy los sigue saludando solo el script de Python por IRC (`event_raw_usernotice`).
- **El comando `!s` (voz en OBS).** Depende del panel local y de OBS; el bot en la nube no lo atiende.
- Mensaje de bienvenida al entrar en el canal (`welcomeMessage`): depende de IRC y no tiene equivalente en la nube todavía.
- Cuenta de bot moderadora para subir el tope de envíos.
