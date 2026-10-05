/**
 * src/utils/staffVoice.ts
 *
 * Comandos de moderación que la voz puede atender por su cuenta, sin DOM ni red
 * para poder probarlos:
 *
 * - El prefijo de la voz delante de un comando de otra capa: «!s so canal» vale
 *   lo mismo que «!so canal».
 * - El saludo a un canal (!so) cuando la fuente no tiene la capa del saludo de
 *   raid: no hay placa, pero la voz lo anuncia.
 * - El aviso de una predicción (!prediccion ...): la voz invita al chat a
 *   participar. Lalo no crea ni lee la predicción de Twitch: solo la anuncia.
 *
 * Solo llegan aquí mensajes del streamer y de sus moderadores.
 */

import type { RaidCommands } from '../types/raid';
import { parseRaidCommand } from './raidLogic';

export const PREDICTION_COMMANDS = ['!prediccion', '!prediction', '!pred'] as const;
export const PREDICTION_TEXT_MAX = 160;

/**
 * «!s so canal» → «!so canal». Devuelve null si el mensaje no empieza por el
 * comando de la voz o si lo que sigue ya lleva su propia exclamación.
 */
export function unprefixed(message: string, voiceCommand: string): string | null {
  const text = message.trim();
  const prefix = voiceCommand.trim().toLowerCase();
  if (!prefix || text.length <= prefix.length + 1) return null;
  if (text.slice(0, prefix.length).toLowerCase() !== prefix || !/\s/.test(text[prefix.length])) return null;
  const rest = text.slice(prefix.length).trim();
  return rest && !rest.startsWith('!') ? `!${rest}` : null;
}

export type StaffVoiceCommand = { kind: 'so'; login: string } | { kind: 'prediction'; text: string };

/** Comando que la voz atiende sola, o null. `raid` trae el nombre que el streamer le dio a !so. */
export function parseStaffVoice(message: string, raid: RaidCommands): StaffVoiceCommand | null {
  const text = message.trim();
  const name = (text.split(/\s+/)[0] || '').toLowerCase();
  if ((PREDICTION_COMMANDS as readonly string[]).includes(name)) {
    const detail = text
      .slice(name.length)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, PREDICTION_TEXT_MAX);
    return { kind: 'prediction', text: detail };
  }
  const command = parseRaidCommand(text, raid);
  return command?.kind === 'so' ? { kind: 'so', login: command.login } : null;
}

/** Lo que dice la voz. La etiqueta del principio le da el tono. */
export function staffVoiceText(command: StaffVoiceCommand): string {
  if (command.kind === 'so') {
    // Los guiones bajos se leen mal: en voz, el nombre va con espacios
    const spoken = command.login.replace(/_+/g, ' ').trim();
    return `[feliz] Un saludo para ${spoken}. Pasen por su canal y denle follow.`;
  }
  const closing = 'Participa con tus puntos del canal.';
  if (!command.text) return `[emocionado] ¡Hay una predicción abierta! ${closing}`;
  const detail = /[.!?…]$/.test(command.text) ? command.text : `${command.text}.`;
  return `[emocionado] ¡Predicción abierta! ${detail} ${closing}`;
}
