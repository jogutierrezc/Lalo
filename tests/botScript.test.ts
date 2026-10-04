/**
 * tests/botScript.test.ts
 *
 * El script de Python del bot se genera con los ajustes reales y el texto del
 * streamer nunca puede romper una cadena de Python.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPythonScript,
  CHANNEL_PLACEHOLDER,
  cleanChannel,
  cleanCommandName,
  fillTemplate,
  pyString,
  scriptCommands,
  TOKEN_PLACEHOLDER,
} from '../src/components/bot/pythonScript';
import { toolStatusFrom } from '../src/components/inicio/toolStatus';
import type { TwitchIOCommand, TwitchIOSettings } from '../src/types/twitchio';

const command = (patch: Partial<TwitchIOCommand>): TwitchIOCommand => ({
  id: `cmd-${patch.name ?? 'x'}`,
  name: 'hola',
  response: 'Hola {user}',
  permission: 'all',
  cooldown: 5,
  enabled: true,
  ...patch,
});

const settings = (patch: Partial<TwitchIOSettings> = {}): TwitchIOSettings => ({
  channel: 'mi_canal',
  botUsername: 'MiBot',
  prefix: '?',
  autoConnect: true,
  welcomeMessage: 'Hola, {channel}',
  commands: [command({})],
  eventsub: { follows: true, subs: true, bits: true, raids: true, channelPoints: true },
  ...patch,
});

/** Lee un literal generado por pyString como lo leería Python (mismas reglas de escape que JSON aquí). */
const readBack = (literal: string): string => JSON.parse(literal);

describe('pyString', () => {
  it('escapa comillas, barras y saltos de línea', () => {
    expect(pyString('di "hola"')).toBe('"di \\"hola\\""');
    expect(pyString('C:\\ruta')).toBe('"C:\\\\ruta"');
    expect(pyString('uno\ndos\r\ntres\tfin')).toBe('"uno\\ndos\\r\\ntres\\tfin"');
  });

  it('nunca deja una comilla sin escapar ni una línea partida', () => {
    const nasty = ['"; import os; os.system("x") #', '\\', '\\"', 'a\\', '"""', "'''", 'fin\u2028de\u2029linea', '\u0000\u001b\u007f'];
    for (const text of nasty) {
      const literal = pyString(text);
      expect(literal).not.toMatch(/[\n\r\u2028\u2029\u0000-\u001f\u007f]/);
      // Sin el envoltorio, toda comilla va precedida de un número impar de barras
      const inner = literal.slice(1, -1);
      expect(inner.replace(/\\./g, '')).not.toContain('"');
      expect(readBack(literal)).toBe(text);
    }
  });

  it('respeta acentos y emoji, y neutraliza medias parejas sueltas', () => {
    expect(pyString('¡Olé! ñ 🎉')).toBe('"¡Olé! ñ 🎉"');
    expect(pyString('a\ud83db')).toBe('"a\\ufffdb"');
  });

  it('deja las llaves tal cual: el script no usa f-strings con texto del streamer', () => {
    expect(pyString('{user} y {__import__("os")}')).toBe('"{user} y {__import__(\\"os\\")}"');
  });
});

describe('ayudas de comandos', () => {
  it('limpia el nombre del comando', () => {
    expect(cleanCommandName('  !Redes Sociales ')).toBe('redessociales');
    expect(cleanCommandName('??ayuda', '?')).toBe('ayuda');
    expect(cleanCommandName('alerta', 'a')).toBe('alerta');
  });

  it('limpia el canal', () => {
    expect(cleanChannel(' #Mi_Canal ')).toBe('mi_canal');
  });

  it('sustituye todas las apariciones de {user} y {channel}', () => {
    expect(fillTemplate('{user} saluda a {user} en {channel}', 'ana', 'canal')).toBe('ana saluda a ana en canal');
  });

  it('solo lleva al script los comandos encendidos, completos y sin repetir', () => {
    const list = scriptCommands([
      command({ name: 'uno' }),
      command({ name: 'dos', enabled: false }),
      command({ name: '' }),
      command({ name: 'tres', response: '   ' }),
      command({ name: 'UNO', response: 'repetido' }),
    ]);
    expect(list.map((entry) => entry.name)).toEqual(['uno']);
    expect(list[0].response).toBe('Hola {user}');
  });
});

describe('buildPythonScript', () => {
  it('usa el canal, el prefijo, el nombre y la bienvenida configurados', () => {
    const script = buildPythonScript(settings());
    expect(script).toContain('CHANNEL = "mi_canal"');
    expect(script).toContain('PREFIX = "?"');
    expect(script).toContain('BOT_NAME = "MiBot"');
    expect(script).toContain('WELCOME = "Hola, {channel}"');
    expect(script).toContain(`TOKEN = "${TOKEN_PLACEHOLDER}"`);
  });

  it('no deja expresiones de JavaScript dentro de las f-strings', () => {
    const script = buildPythonScript(settings());
    expect(script).not.toContain('twitchIOSettings');
    expect(script).not.toContain('${');
    expect(script).toContain('print(f"{BOT_NAME} listo en #{CHANNEL}")');
    // Las únicas f-strings son las dos de print, y solo nombran variables de Python
    const fStrings = script.match(/f"[^"\n]*"/g) ?? [];
    expect(fStrings).toHaveLength(2);
    for (const fString of fStrings) {
      for (const [, name] of fString.matchAll(/\{([^}]*)\}/g)) expect(['BOT_NAME', 'CHANNEL', 'error']).toContain(name);
    }
  });

  it('crea un manejador por cada comando encendido, con su permiso', () => {
    const script = buildPythonScript(
      settings({
        commands: [
          command({ name: 'redes', response: 'twitch.tv/{channel}' }),
          command({ name: 'reload', response: 'Hecho', permission: 'mod' }),
          command({ name: 'vip', response: 'Solo subs', permission: 'sub' }),
          command({ name: 'jefe', response: 'Solo yo', permission: 'broadcaster' }),
          command({ name: 'apagado', enabled: false }),
        ],
      })
    );
    expect(script.match(/@commands\.command\(/g)).toHaveLength(4);
    expect(script).toContain('@commands.command(name="redes")');
    expect(script).toContain('await ctx.send(fill("twitch.tv/{channel}", ctx.author.name))');
    expect(script).toContain('if not (ctx.author.is_mod or ctx.author.is_broadcaster):');
    expect(script).toContain('if not (ctx.author.is_subscriber or ctx.author.is_mod or ctx.author.is_broadcaster):');
    expect(script).toContain('if not (ctx.author.is_broadcaster):');
    expect(script).not.toContain('apagado');
    // Cada manejador tiene un nombre de función distinto
    const functions = script.match(/async def comando_\d+/g) ?? [];
    expect(new Set(functions).size).toBe(4);
  });

  it('sin comandos sigue siendo un script completo', () => {
    const script = buildPythonScript(settings({ commands: [] }));
    expect(script).not.toContain('@commands.command(');
    expect(script.trimEnd().endsWith('bot.run()')).toBe(true);
  });

  it('el texto del streamer no puede salirse de su cadena', () => {
    const script = buildPythonScript(
      settings({
        botUsername: 'Bot"\nimport os',
        welcomeMessage: 'hola"\nos.system("rm")\n#',
        commands: [command({ name: 'x', response: 'a"))\nimport os\n\\' })],
      })
    );
    expect(script).toContain('BOT_NAME = "Bot\\"\\nimport os"');
    expect(script).toContain('WELCOME = "hola\\"\\nos.system(\\"rm\\")\\n#"');
    expect(script).toContain('fill("a\\"))\\nimport os\\n\\\\", ctx.author.name)');
    // Ninguna línea del script empieza por lo inyectado
    const lines = script.split('\n').map((line) => line.trim());
    expect(lines).not.toContain('import os');
    expect(lines.some((line) => line.startsWith('os.system'))).toBe(false);
  });

  it('usa valores seguros si faltan el canal o el prefijo', () => {
    const script = buildPythonScript(settings({ channel: '  ', prefix: '' }));
    expect(script).toContain(`CHANNEL = "${CHANNEL_PLACEHOLDER}"`);
    expect(script).toContain('PREFIX = "!"');
  });
});

describe('toolStatusFrom', () => {
  it('cuenta lo que está activo y no inventa estado para lo que no conoce', () => {
    const status = toolStatusFrom({
      alerts: { events: { follow: { enabled: true }, sub: { enabled: true }, bits: { enabled: false }, raid: { enabled: true } } },
      goals: { goals: [{ enabled: true }] },
      roulette: { segments: [{ enabled: true }, { enabled: true }, { enabled: false }] },
      rewards: { rewards: [] },
      bot: { commands: [{ enabled: false }] },
    });
    expect(status.alertas).toEqual({ text: '3 de 4 activas', empty: false });
    expect(status.metas).toEqual({ text: '1 meta activa', empty: false });
    expect(status.ruleta).toEqual({ text: '2 segmentos activos', empty: false });
    expect(status.recompensas).toEqual({ text: 'Ninguna activa', empty: true });
    expect(status.twitchio).toEqual({ text: 'Sin comandos activos', empty: true });
    expect(status.tts).toBeUndefined();
    expect(status.encuestas).toBeUndefined();
  });
});
