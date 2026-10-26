/**
 * server/twitch/commandNames.ts
 *
 * Reglas de nombres de comando del bot de Twitch. Es un módulo SIN dependencias a propósito:
 * lo importan tanto el servidor (botDb.ts) como el generador del script de Python
 * (src/components/bot/pythonScript.ts), y el servidor no debe arrastrar el código del
 * panel (que importa sin extensión .js y no se resuelve en Vercel).
 */

/** Nombre de comando tal como lo entiende el bot: minúsculas, sin espacios ni prefijo delante. */
export function cleanCommandName(raw: string, prefix = '!'): string {
  let name = raw.toLowerCase().replace(/\s+/g, '');
  while (name.startsWith('!')) name = name.slice(1);
  // Un prefijo hecho de letras o números podría ser el principio del propio nombre: no se toca
  const symbolPrefix = /^[^a-z0-9]+$/i.test(prefix) ? prefix.toLowerCase() : '';
  while (symbolPrefix && name.startsWith(symbolPrefix)) name = name.slice(symbolPrefix.length);
  return name;
}
