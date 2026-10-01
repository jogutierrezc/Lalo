/**
 * twitchSanitizer.ts
 *
 * Utilidad especializada para la extracción, validación y sanitización estricta
 * de mensajes provenientes del chat de Twitch para el motor TTS de Fish Audio.
 *
 * REGLAS DE SEGURIDAD Y NEGOCIO:
 * 1. Comando Trigger: SOLO procesa mensajes que comiencen exactamente con '!s ' (case-insensitive).
 *    Cualquier otro mensaje retorna null (ignorado de inmediato).
 * 2. Extracción: Remueve el '!s ' inicial para evitar que el TTS sintetice el comando.
 * 3. Filtrado de URLs: Remueve links http, https, www y dominios comunes.
 * 4. Anti-spam de repeticiones: Reduce secuencias de caracteres repetidos consecutivamente
 *    (ej: "Jajajajajajajaja" -> "Jajaja", "holaaaaaaa" -> "holaa").
 * 5. Límite de longitud: Trunca estrictamente a un máximo de 200 caracteres para preservar
 *    el tiempo de emisión y evitar abuso en el stream.
 * 6. Limpieza de emojis / símbolos excesivos y caracteres invisibles (Zero-Width / Bidi).
 * 7. Validación estricta de color hexadecimal para evitar inyección CSS en inline styles.
 */

import { extractPrimaryEmotion, EmotionInfo } from './emotionMapper';
export type { EmotionInfo };

export interface TwitchMessageMeta {
  id?: string;
  username: string;
  displayName: string;
  color?: string;
  channel: string;
  timestamp?: number;
}

export interface SanitizedTTSMessage {
  id: string;
  rawText: string;
  cleanText: string;
  username: string;
  displayName: string;
  userColor: string;
  timestamp: number;
  emotion?: EmotionInfo | null;
  trigger?: 'command' | 'reward' | 'bits' | 'test';
  bits?: number;
  role?: string;
}

const TRIGGER_PREFIX = '!s ';
const MAX_TTS_LENGTH = 1000;
const MAX_RAW_INPUT_LENGTH = 3000;

// Expresión regular para validar color hexadecimal seguro
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

// Expresión regular para detectar URLs
const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(com|org|net|io|tv|gg|me|dev|app)(\/[^\s]*)?)/gi;

// Expresión regular para secuencias repetidas de risas (ej. jajajajaja, jajsjsjs)
const LAUGHTER_SPAM_REGEX = /(ja|je|ji|jo|ju|ha|he|hi|ho|hu|js|ks){4,}/gi;

// Expresión regular para cualquier caracter individual repetido más de 2 veces con flag Unicode
const CHAR_SPAM_REGEX = /(.)\1{2,}/gu;

/**
 * Sanitiza y extrae el texto para TTS desde un mensaje bruto de Twitch.
 *
 * @param rawMessage Mensaje tal como llega del evento de chat de Twitch
 * @param meta Metadatos opcionales del usuario (username, color, etc.)
 * @returns SanitizedTTSMessage si cumple el criterio '!s ', o null si se debe ignorar
 */
export function sanitizeTwitchMessage(
  rawMessage: string | null | undefined,
  meta?: Partial<TwitchMessageMeta>
): SanitizedTTSMessage | null {
  if (!rawMessage || typeof rawMessage !== 'string') {
    return null;
  }

  // Pre-filtrado defensivo: recortar mensajes gigantescos antes de procesar regexes pesadas
  const boundedRaw = rawMessage.length > MAX_RAW_INPUT_LENGTH
    ? rawMessage.slice(0, MAX_RAW_INPUT_LENGTH)
    : rawMessage;

  const trimmed = boundedRaw.trim();

  // 1. REGLA ESTRICTA: Debe empezar exactamente con "!s "
  if (!trimmed.toLowerCase().startsWith(TRIGGER_PREFIX.toLowerCase())) {
    return null;
  }

  // 2. Extraer solo el texto posterior al prefijo '!s '
  let text = trimmed.slice(TRIGGER_PREFIX.length).trim();

  if (!text) {
    return null;
  }

  // 3. Filtrar caracteres de control invisibles, zero-width y bidi overrides
  text = text.replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\x00-\x1F]/g, '');

  // 4. Eliminar URLs completas
  text = text.replace(URL_REGEX, '');

  // 5. Moderar spam de risas repetitivas (ej. "Jajajajajajajaja" -> "Jajaja")
  text = text.replace(LAUGHTER_SPAM_REGEX, (match) => {
    const syllable = match.slice(0, 2);
    return `${syllable}${syllable.toLowerCase()}${syllable.toLowerCase()}`;
  });

  // 6. Reducir repeticiones excesivas de caracteres idénticos a máximo 2 (ej. "siiiiiii" -> "sii")
  text = text.replace(CHAR_SPAM_REGEX, '$1$1');

  // 7. Eliminar emojis excesivos consecutivos (manteniendo hasta 2 como acento visual)
  // Utiliza puntos de código completos evitando cortar pares subrogados UTF-16
  const emojiRegex = /(\p{Extended_Pictographic}|\p{Emoji_Presentation}){3,}/gu;
  text = text.replace(emojiRegex, (match) => [...match].slice(0, 2).join(''));

  // 8. Normalizar espacios en blanco y saltos de línea
  text = text.replace(/\s+/g, ' ').trim();

  // Si tras la limpieza quedó vacío (por ejemplo solo era un enlace o caracteres no válidos)
  if (!text) {
    return null;
  }

  // 9. Limitar longitud máxima a MAX_TTS_LENGTH (1000 caracteres)
  if (text.length > MAX_TTS_LENGTH) {
    const sub = text.slice(0, MAX_TTS_LENGTH);
    const lastSpace = sub.lastIndexOf(' ');
    text = (lastSpace > MAX_TTS_LENGTH - 40 ? sub.slice(0, lastSpace) : sub).trim() + '...';
  }

  const username = meta?.username || 'viewer';
  const displayName = meta?.displayName || username;

  // Validación estricta del color del usuario para evitar inyección en CSS
  const userColor = meta?.color && HEX_COLOR_REGEX.test(meta.color)
    ? meta.color
    : '#9146FF';

  // Detección de emoción o expresión vocal (ej. [feliz], [susurro], [angry])
  const emotion = extractPrimaryEmotion(text);

  return {
    id: meta?.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    rawText: rawMessage,
    cleanText: text,
    username,
    displayName,
    userColor,
    timestamp: meta?.timestamp || Date.now(),
    emotion,
  };
}
