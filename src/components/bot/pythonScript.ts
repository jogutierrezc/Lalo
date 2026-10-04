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
  lines.push(`        await ctx.send(fill(${pyString(command.response.trim())}, ctx.author.name))`);
  return lines.join('\n');
}

export function buildPythonScript(settings: TwitchIOSettings): string {
  const prefix = settings.prefix.trim() || '!';
  const channel = cleanChannel(settings.channel) || CHANNEL_PLACEHOLDER;
  const botName = settings.botUsername.trim() || 'LaloBot';
  const handlers = scriptCommands(settings.commands, prefix).map(commandHandler);

  return `"""
Bot de chat para Lalo Stream Suite.
Hecho con TwitchIO (https://github.com/TwitchIO/TwitchIO),
de PythonistaGuild y EvieePy, con licencia MIT.

Antes de ejecutarlo:
    ${PIP_COMMAND}
"""
import aiohttp
from twitchio.ext import commands

# Pega aquí el token de la cuenta del bot. No lo compartas con nadie.
TOKEN = "${TOKEN_PLACEHOLDER}"

CHANNEL = ${pyString(channel)}
PREFIX = ${pyString(prefix)}
BOT_NAME = ${pyString(botName)}
WELCOME = ${pyString(settings.welcomeMessage.trim())}
LALO_URL = "http://localhost:3001/api/twitchio/event"


def fill(text, user=""):
    return text.replace("{user}", user).replace("{channel}", CHANNEL)


class LaloBot(commands.Bot):
    def __init__(self):
        super().__init__(token=TOKEN, prefix=PREFIX, initial_channels=[CHANNEL])

    async def event_ready(self):
        print(f"{BOT_NAME} listo en #{CHANNEL}")

    async def event_channel_joined(self, channel):
        if WELCOME and channel.name == CHANNEL:
            await channel.send(fill(WELCOME))

    async def event_message(self, message):
        if message.echo:
            return
        content = message.content or ""
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
        await self.handle_commands(message)
${handlers.length ? `\n${handlers.join('\n\n')}\n` : ''}

bot = LaloBot()
bot.run()
`;
}
