/**
 * src/components/bot/pythonScript.ts
 *
 * Genera el script de Python del bot a partir de los ajustes reales: canal,
 * prefijo, nombre, mensaje de bienvenida y un manejador por cada comando
 * encendido. Es una función pura: no lee almacenamiento ni el navegador.
 *
 * El script usa TwitchIO 2 (https://github.com/TwitchIO/TwitchIO), de
 * PythonistaGuild y EvieePy, con licencia MIT.
 */

import type { CommandPermission, TwitchIOCommand, TwitchIOSettings } from '../../types/twitchio';
import { LUX_BOT_VERSION } from '../../../server/lux/release';
import { LUX_CHAT_WORD_DEFAULT, validateChatWord } from '../../../server/lux/chatCommands';
import { luxDisplayName } from '../../../server/lux/displayName';

/** Comando de Lux en el chat tal como lo guarda el panel de Mi AI. */
export interface LuxChatSettings {
  /** Palabra con la que el público llama a Lux (por defecto «lux»). */
  word: string;
  /** Si !lux sigue valiendo como alias de la palabra. */
  alias: boolean;
  /** Nombre visible de la IA en el chat (chatName). Vacío: la palabra de activación. */
  name?: string;
}

export const DEFAULT_LUX_CHAT: LuxChatSettings = { word: LUX_CHAT_WORD_DEFAULT, alias: true };

export const TOKEN_PLACEHOLDER = 'oauth:TU_TOKEN_AQUI';
export const CHANNEL_PLACEHOLDER = 'TU_CANAL';
export const PIP_COMMAND = 'pip install "twitchio<3" aiohttp';

/**
 * Convierte un texto cualquiera en un literal de Python entre comillas dobles.
 * Escapa barras, comillas, saltos de línea y caracteres de control, para que
 * lo que escriba el streamer nunca pueda cerrar la cadena ni partir la línea.
 */
export function pyString(text: string): string {
  let out = '"';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code >= 0xd800 && code <= 0xdfff) out += '\\ufffd'; // mitad de un par suelto: no se puede enviar al chat
    else if (code < 0x20 || code === 0x7f || code === 0x85 || code === 0x2028 || code === 0x2029) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else out += ch;
  }
  return `${out}"`;
}

/** Nombre de comando tal como lo entiende el bot: minúsculas, sin espacios ni prefijo delante. */
export function cleanCommandName(raw: string, prefix = '!'): string {
  let name = raw.toLowerCase().replace(/\s+/g, '');
  while (name.startsWith('!')) name = name.slice(1);
  // Un prefijo hecho de letras o números podría ser el principio del propio nombre: no se toca
  const symbolPrefix = /^[^a-z0-9]+$/i.test(prefix) ? prefix.toLowerCase() : '';
  while (symbolPrefix && name.startsWith(symbolPrefix)) name = name.slice(symbolPrefix.length);
  return name;
}

/** Canal sin almohadilla, sin espacios y en minúsculas. */
export function cleanChannel(raw: string): string {
  return raw.trim().replace(/^#+/, '').replace(/\s+/g, '').toLowerCase();
}

/** Sustituye {user} y {channel} en todas sus apariciones. */
export function fillTemplate(text: string, user: string, channel: string): string {
  return text.split('{user}').join(user).split('{channel}').join(channel);
}

/**
 * Comandos que entran en el script: encendidos, con nombre y respuesta, y sin
 * repetir nombre (si hay dos iguales, vale el primero).
 */
export function scriptCommands(commands: TwitchIOCommand[], prefix = '!'): TwitchIOCommand[] {
  const seen = new Set<string>();
  const result: TwitchIOCommand[] = [];
  for (const command of commands) {
    if (!command.enabled) continue;
    const name = cleanCommandName(command.name, prefix);
    if (!name || !command.response.trim() || seen.has(name)) continue;
    seen.add(name);
    result.push({ ...command, name });
  }
  return result;
}

const PERMISSION_CHECK: Record<CommandPermission, string | null> = {
  all: null,
  sub: 'ctx.author.is_subscriber or ctx.author.is_mod or ctx.author.is_broadcaster',
  mod: 'ctx.author.is_mod or ctx.author.is_broadcaster',
  broadcaster: 'ctx.author.is_broadcaster',
};

function commandHandler(command: TwitchIOCommand, index: number): string {
  const check = PERMISSION_CHECK[command.permission] ?? null;
  const lines = [
    `    @commands.command(name=${pyString(command.name)})`,
    `    async def comando_${index + 1}(self, ctx: commands.Context):`,
  ];
  if (check) {
    lines.push(`        if not (${check}):`, '            return');
  }
  lines.push(`        await chat_send(ctx.channel, fill(${pyString(command.response.trim())}, ctx.author.name))`);
  return lines.join('\n');
}

export function buildPythonScript(settings: TwitchIOSettings, lux: LuxChatSettings = DEFAULT_LUX_CHAT): string {
  const prefix = settings.prefix.trim() || '!';
  const channel = cleanChannel(settings.channel) || CHANNEL_PLACEHOLDER;
  const botName = settings.botUsername.trim() || 'LaloBot';
  const handlers = scriptCommands(settings.commands, prefix).map(commandHandler);
  // El generador nunca escribe una palabra inválida: si llega una, vale la de por defecto.
  const luxCheck = validateChatWord(lux.word);
  const luxWord = luxCheck.ok ? luxCheck.word : LUX_CHAT_WORD_DEFAULT;
  const luxAlias = lux.alias && luxWord !== LUX_CHAT_WORD_DEFAULT;
  // Con qué nombre habla la IA en el chat: el del creador, la palabra de activación o «MI AI».
  const luxName = luxDisplayName(lux.name, luxWord);

  return `"""
Bot de chat para Lalo Stream Suite.
Hecho con TwitchIO (https://github.com/TwitchIO/TwitchIO),
de PythonistaGuild y EvieePy, con licencia MIT.

Antes de ejecutarlo:
    ${PIP_COMMAND}
"""
import asyncio
import time
import aiohttp
from twitchio.ext import commands

# Pega aquí el token de la cuenta del bot. No lo compartas con nadie.
TOKEN = "${TOKEN_PLACEHOLDER}"

CHANNEL = ${pyString(channel)}
PREFIX = ${pyString(prefix)}
BOT_NAME = ${pyString(botName)}
WELCOME = ${pyString(settings.welcomeMessage.trim())}
LALO_URL = "http://localhost:3001/api/twitchio/event"
# Lux (personaje IA): la clave de OBS de tu panel de Lalo, en Cuenta.
LUX_URL = "http://localhost:3001/api/lux/chat"
LUX_KEY = "TU_CLAVE_OBS"
LUX_BOT_VERSION = ${LUX_BOT_VERSION}
# Palabra con la que el público habla con Lux en el chat (la eliges en Mi AI, con !lux de alias si quieres).
LUX_WORD = ${pyString(luxWord)}
LUX_ALIAS = ${luxAlias ? 'True' : 'False'}
# Nombre con el que la IA habla en el chat (el que eliges en Mi AI; si no, la palabra; si no, MI AI).
LUX_NAME = ${pyString(luxName)}
# Segundos que espera la IA antes de responder a un comando del chat.
LUX_REPLY_DELAY = 5
# La IA aprende del chat (si lo tienes activado en Lalo): cada media hora manda los mensajes juntos para resumirlos.
# Los mensajes se guardan solo en la memoria de este script y se borran al enviarlos.
LUX_DIGEST_EVERY = 1800
LUX_LINES_MAX = 200
lux_lines = []
# Comentarios espontáneos: cada minuto el bot pregunta al servidor si toca comentar (el servidor decide: intervalo y mensajes mínimos
# son los de tu panel). Estos mensajes van aparte de los del resumen, para no mezclar las dos ventanas.
LUX_SPONT_CHECK = 60
LUX_SPONT_LINES_MAX = 40
LUX_SPONT_MIN_SEEN = 3
LUX_IGNORE = ("nightbot", "streamelements", "streamlabs", "moobot", "fossabot", "wizebot")
spont_lines = []
spont_state = {"next": 0.0}
# Eventos del canal: se agrupan en una ventana y se saludan de una vez (seguidores: 60 s; el resto: 20 s).
LUX_EVENT_TICK = 5
LUX_EVENT_WINDOW = 60
LUX_EVENT_WINDOW_FAST = 20
lux_events = []
# Cola de mensajes que escribes desde el panel de Mi AI ("Decir en el chat").
LUX_OUTBOX_EVERY = 4
# Twitch admite 500 caracteres por mensaje.
CHAT_LIMIT = 500
printed_once = set()


def fill(text, user=""):
    return text.replace("{user}", user).replace("{channel}", CHANNEL)


def is_privileged(author):
    return bool(getattr(author, "is_mod", False) or getattr(author, "is_broadcaster", False))


def warn_once(text):
    """Imprime un aviso una sola vez: los bucles repiten cada pocos segundos y no deben llenar la terminal."""
    if text not in printed_once:
        printed_once.add(text)
        print(text)


def to_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


async def lux_post(payload):
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(LUX_URL, json={"k": LUX_KEY, **payload}) as response:
            return await response.json(content_type=None)


def split_message(text, limit=CHAT_LIMIT):
    """Parte un texto en trozos de como mucho \`limit\` caracteres, cortando en frases o en espacios."""
    text = " ".join(str(text).split())
    parts = []
    while len(text) > limit:
        chunk = ""
        rest = ""
        for sep in (". ", "! ", "? ", "; ", ", ", " "):
            at = text.rfind(sep, 0, limit)
            if at > limit // 3:
                chunk = text[:at + len(sep.rstrip())]
                rest = text[at + len(sep):]
                break
        if not chunk:
            chunk = text[:limit]
            rest = text[limit:]
        parts.append(chunk)
        text = rest.strip()
    if text:
        parts.append(text)
    return parts


def send_error(error):
    detail = str(error) or error.__class__.__name__
    low = detail.lower()
    hint = ""
    if any(word in low for word in ("auth", "permission", "scope", "token", "login", "forbidden", "unauthorized", "401", "403", "chat:edit", "user:write")):
        hint = " Parece un problema de permisos: el token del bot necesita el permiso chat:edit (o user:write:chat). Genera un token nuevo con ese permiso."
    print("No se pudo escribir en el chat: " + detail + "." + hint)


async def chat_send(channel, text):
    """Escribe en el chat. Parte lo que pase de 500 caracteres y, si falla, lo dice en la terminal. Devuelve True si salió todo."""
    sent = False
    parts = split_message(text)
    for index, part in enumerate(parts):
        # Un texto que empieza por / o . lo tomaría Twitch por una orden (/ban, .timeout...): nunca se manda así.
        part = part.lstrip("/. ")
        if not part:
            continue
        try:
            await channel.send(part)
            sent = True
        except Exception as error:
            send_error(error)
            return False
        if index < len(parts) - 1:
            await asyncio.sleep(1.2)
    return sent


def lux_text(content):
    """Si el mensaje va dirigido a Lux (!palabra, o !lux si el alias está activo), devuelve lo que escribió el espectador. Si no, None."""
    head = content.lower()
    words = [LUX_WORD]
    if LUX_ALIAS and LUX_WORD != "lux":
        words.append("lux")
    for word in words:
        call = PREFIX + word
        if head == call or head.startswith(call + " "):
            return content[len(call):].strip()
    return None


async def lux_ask(message, text):
    if not text:
        await chat_send(message.channel, "@" + message.author.name + " escribe tu mensaje después de " + PREFIX + LUX_WORD + ".")
        return
    try:
        data = await lux_post({"command": "ask", "viewer": message.author.name, "message": text, "source": "bot"})
    except (aiohttp.ClientError, ValueError, asyncio.TimeoutError) as error:
        print("No se pudo hablar con " + LUX_NAME + ": " + str(error))
        return
    if not isinstance(data, dict):
        print("Respuesta rara del servidor de Lalo: " + str(data)[:200])
        return
    if data.get("reply"):
        await asyncio.sleep(LUX_REPLY_DELAY)
        await chat_send(message.channel, data["reply"])
    elif data.get("skipped") == "cooldown":
        await chat_send(message.channel, "@" + message.author.name + " espera " + str(data.get("waitSeconds", 5)) + " s antes de volver a preguntar a " + LUX_NAME + ".")
    elif data.get("skipped") == "bot_active":
        return
    elif data.get("skipped"):
        # Desactivada con !luxoff, sin Mi AI en tu cuenta...: no se escribe nada, pero queda dicho en la terminal.
        print(LUX_NAME + " no respondió a " + message.author.name + ": " + str(data.get("skipped")))
    else:
        # El servidor devolvió un error (sin clave del proveedor, migración sin aplicar, clave de OBS mala...).
        print(LUX_NAME + " no respondió a " + message.author.name + ": " + str(data.get("error") or data))


async def lux_switch(message, turn_on):
    if not is_privileged(message.author):
        await chat_send(message.channel, "@" + message.author.name + " solo el canal o los moderadores pueden hacerlo.")
        return
    try:
        action = "on" if turn_on else "off"
        await lux_post({"command": action, "privileged": True})
    except (aiohttp.ClientError, ValueError, asyncio.TimeoutError) as error:
        print("No se pudo cambiar " + LUX_NAME + ": " + str(error))
        return
    await chat_send(message.channel, LUX_NAME + " responderá en el chat." if turn_on else LUX_NAME + " dejará de responder en el chat.")


async def check_lux_version():
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(LUX_URL.replace("/chat", "/release")) as response:
                data = await response.json(content_type=None)
    except (aiohttp.ClientError, ValueError):
        return
    if int(data.get("version", 0)) > LUX_BOT_VERSION:
        print("Hay una versión nueva de los comandos de Lux: " + str(data.get("note") or "") + ". Vuelve a generar el script en el estudio de TwitchIO.")


async def lux_digest_loop():
    while True:
        await asyncio.sleep(LUX_DIGEST_EVERY)
        try:
            status = await lux_post({"command": "learn_status"})
            if not status.get("learning"):
                lux_lines.clear()
                continue
            if not status.get("ready") or not lux_lines:
                continue
            batch = list(lux_lines)
            lux_lines.clear()
            await lux_post({"command": "digest", "messages": batch})
        except (aiohttp.ClientError, ValueError, asyncio.TimeoutError) as error:
            print("No se pudo enviar el resumen del chat a " + LUX_NAME + ": " + str(error))


async def lux_spontaneous_loop(bot):
    """Comentarios espontáneos: si hay actividad, el servidor decide si toca comentar. Un comentario como mucho por intervalo."""
    while True:
        await asyncio.sleep(LUX_SPONT_CHECK)
        if time.time() < spont_state["next"] or len(spont_lines) < LUX_SPONT_MIN_SEEN:
            continue
        channel = bot.get_channel(CHANNEL)
        if channel is None:
            continue
        batch = list(spont_lines)
        try:
            data = await lux_post({"command": "spontaneous", "lines": batch})
        except (aiohttp.ClientError, ValueError, asyncio.TimeoutError) as error:
            warn_once("No se pudo pedir un comentario a " + LUX_NAME + ": " + str(error))
            continue
        if not isinstance(data, dict):
            continue
        skipped = data.get("skipped")
        if data.get("reply"):
            # Los mensajes comentados salen de la ventana: el siguiente comentario cuenta desde cero.
            del spont_lines[:len(batch)]
            await chat_send(channel, data["reply"])
        elif skipped == "too_soon":
            spont_state["next"] = time.time() + max(to_int(data.get("waitSeconds")), LUX_SPONT_CHECK)
        elif skipped in ("chat_off", "spontaneous_off", "lux_disabled"):
            spont_state["next"] = time.time() + 300
        elif data.get("error"):
            warn_once(LUX_NAME + " no pudo comentar: " + str(data.get("error")))
            spont_state["next"] = time.time() + 300


def lux_event_push(kind, user="", months=0, viewers=0, gift=False):
    """Apunta un evento del canal que llega por el chat (sub o raid). Se saluda junto con los que lleguen en la misma ventana. Follow y start ya no pasan por aquí: los entrega el servidor por la cola."""
    lux_events.append({"at": time.time(), "type": kind, "user": user, "months": months, "viewers": viewers, "gift": gift})
    if len(lux_events) > 50:
        del lux_events[0]


async def lux_event_loop(bot):
    """Saluda los eventos agrupados. Si la IA no responde o el tipo está desactivado en tu panel, no se escribe nada."""
    while True:
        await asyncio.sleep(LUX_EVENT_TICK)
        if not lux_events:
            continue
        only_follows = all(item["type"] == "follow" for item in lux_events)
        window = LUX_EVENT_WINDOW if only_follows else LUX_EVENT_WINDOW_FAST
        if time.time() - lux_events[0]["at"] < window:
            continue
        batch = [{key: item[key] for key in ("type", "user", "months", "viewers", "gift")} for item in lux_events]
        lux_events.clear()
        channel = bot.get_channel(CHANNEL)
        if channel is None:
            continue
        try:
            data = await lux_post({"command": "event", "events": batch})
        except (aiohttp.ClientError, ValueError, asyncio.TimeoutError) as error:
            print("No se pudo avisar a " + LUX_NAME + " del evento: " + str(error))
            continue
        if isinstance(data, dict) and data.get("reply"):
            await chat_send(channel, data["reply"])


async def lux_outbox_loop(bot):
    """Publica en el chat los mensajes que escribes desde el panel. Confirma al servidor cada envío."""
    while True:
        await asyncio.sleep(LUX_OUTBOX_EVERY)
        channel = bot.get_channel(CHANNEL)
        if channel is None:
            continue
        try:
            data = await lux_post({"command": "outbox"})
        except (aiohttp.ClientError, ValueError, asyncio.TimeoutError) as error:
            warn_once("No se pudo leer la cola de mensajes del panel: " + str(error))
            continue
        if not isinstance(data, dict):
            continue
        if data.get("error"):
            warn_once("La cola de mensajes del panel no responde: " + str(data.get("error")))
            continue
        for item in data.get("items") or []:
            sent = await chat_send(channel, item.get("text", ""))
            try:
                await lux_post({"command": "outbox_done", "id": item.get("id"), "ok": sent})
            except (aiohttp.ClientError, ValueError, asyncio.TimeoutError) as error:
                print("No se pudo confirmar el mensaje del panel: " + str(error))


class LaloBot(commands.Bot):
    def __init__(self):
        super().__init__(token=TOKEN, prefix=PREFIX, initial_channels=[CHANNEL])

    async def event_ready(self):
        print(f"{BOT_NAME} listo en #{CHANNEL}")
        print(LUX_NAME + " responde a " + PREFIX + LUX_WORD + (" y " + PREFIX + "lux" if LUX_ALIAS and LUX_WORD != "lux" else ""))
        await check_lux_version()
        asyncio.ensure_future(lux_digest_loop())
        asyncio.ensure_future(lux_spontaneous_loop(self))
        asyncio.ensure_future(lux_event_loop(self))
        asyncio.ensure_future(lux_outbox_loop(self))

    async def event_raw_data(self, data):
        # Twitch avisa aquí de lo que rechaza (mensaje repetido, demasiado rápido, sin permiso...): se muestra en la terminal.
        if " NOTICE " in data:
            print("Aviso de Twitch: " + data.strip()[:300])

    async def event_raw_usernotice(self, channel, tags):
        # Suscripciones y raids llegan por el chat (IRC). Los seguidores nuevos y el inicio del directo NO: los recibe el servidor
        # de Lalo por EventSub y deja el saludo en la cola de mensajes (lux_outbox_loop), así que el bot no los apunta.
        kind = tags.get("msg-id", "")
        user = tags.get("display-name") or tags.get("login") or ""
        if kind in ("sub", "resub"):
            lux_event_push("sub", user, months=to_int(tags.get("msg-param-cumulative-months")))
        elif kind == "subgift":
            lux_event_push("sub", user, gift=True)
        elif kind == "raid":
            lux_event_push("raid", tags.get("msg-param-displayName") or user, viewers=to_int(tags.get("msg-param-viewerCount")))

    async def event_channel_joined(self, channel):
        if WELCOME and channel.name == CHANNEL:
            await chat_send(channel, fill(WELCOME))

    async def event_message(self, message):
        if message.echo:
            return
        content = message.content or ""
        if content and not content.startswith(PREFIX):
            lux_lines.append({"viewer": message.author.name, "text": content[:300]})
            if len(lux_lines) > LUX_LINES_MAX:
                del lux_lines[0]
            if (message.author.name or "").lower() not in LUX_IGNORE:
                spont_lines.append({"viewer": message.author.name, "text": content[:300]})
                if len(spont_lines) > LUX_SPONT_LINES_MAX:
                    del spont_lines[0]
        if content.startswith(PREFIX + "s "):
            text = content.split(" ", 1)[1]
            try:
                async with aiohttp.ClientSession() as session:
                    await session.post(LALO_URL, json={
                        "type": "TTS", "channel": CHANNEL,
                        "data": {"user": message.author.name, "text": text},
                    })
            except aiohttp.ClientError as error:
                print(f"No se pudo avisar al panel de Lalo: {error}")
        try:
            if content == PREFIX + "luxon" or content == PREFIX + "luxoff":
                await lux_switch(message, content == PREFIX + "luxon")
            else:
                text = lux_text(content)
                if text is not None:
                    await lux_ask(message, text)
        except Exception as error:
            # Un fallo de la IA no debe dejar sin atender el resto de los comandos del chat.
            print("Error atendiendo a " + LUX_NAME + ": " + str(error))
        await self.handle_commands(message)
${handlers.length ? `\n${handlers.join('\n\n')}\n` : ''}

bot = LaloBot()
bot.run()
`;
}
