/**
 * server/lux/digest.ts
 *
 * Resumen del chat (C2): el bot de Python junta los mensajes de media hora y los
 * manda a /api/lux/chat con command 'digest'. Aquí se arma la petición al modelo,
 * se lee su respuesta y se filtra. Los mensajes crudos no se guardan en ningún sitio:
 * solo sale de aquí lo que el modelo resume.
 */

import type { ChatMessage } from './nvidia.js';
import { DIGEST_MAX_ITEMS, MEMORY_CONTENT_MAX, screenMemory } from './memory.js';

/** Como mucho un resumen cada 20 minutos por streamer (el bot manda cada 30). */
export const DIGEST_MIN_GAP_MS = 20 * 60_000;
/** Mensajes que caben en un resumen. Se quedan los más recientes. */
export const DIGEST_MAX_LINES = 200;
const LINE_MAX = 300;
const VIEWER_MAX = 40;

export interface ChatLine {
  viewer: string;
  text: string;
}

export interface DigestItem {
  kind: 'viewer' | 'event';
  subject: string | null;
  content: string;
}

/** Mensajes que llegan del bot. Un valor malo se descarta; los comandos (!) no entran. */
export function normalizeDigestLines(input: unknown): ChatLine[] {
  if (!Array.isArray(input)) return [];
  const lines: ChatLine[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.text !== 'string') continue;
    const text = row.text.trim().slice(0, LINE_MAX);
    if (!text || text.startsWith('!')) continue;
    const viewer = typeof row.viewer === 'string' && row.viewer.trim() ? row.viewer.trim().slice(0, VIEWER_MAX) : 'Espectador';
    lines.push({ viewer, text });
  }
  return lines.slice(-DIGEST_MAX_LINES);
}

export function buildDigestMessages(lines: ChatLine[], existing: string[]): ChatMessage[] {
  const system = [
    'Eres el archivista de Lux, un personaje de un directo de Twitch. Lees mensajes recientes del chat y decides qué merece recordarse.',
    `Devuelve como mucho ${DIGEST_MAX_ITEMS} recuerdos nuevos, y solo JSON: un array de objetos {"kind": "viewer" o "event", "subject": nombre o null, "content": frase corta en español de como mucho ${MEMORY_CONTENT_MAX} caracteres}.`,
    '"viewer": un espectador habitual o una broma interna del chat. "event": una fecha o un evento del canal.',
    'Reglas: no copies mensajes; resume con tus palabras. No incluyas enlaces, correos, teléfonos, direcciones, datos de salud, religión, política ni orientación sexual de nadie.',
    'Si aparece un insulto, no lo copies: conviértelo en una expresión divertida y sin ofensa.',
    'Si no hay nada que merezca recordarse, devuelve [].',
  ];
  if (existing.length > 0) {
    system.push(`Ya se recuerda esto; no lo repitas:\n${existing.map((text) => `- ${text}`).join('\n')}`);
  }
  const user = lines.map((line) => `${line.viewer}: ${line.text}`).join('\n');
  return [
    { role: 'system', content: system.join('\n') },
    { role: 'user', content: user },
  ];
}

/**
 * Lee la respuesta del modelo. Acepta el array aunque venga con texto alrededor o
 * entre comillas de bloque. Lo que no encaja se ignora; como mucho DIGEST_MAX_ITEMS.
 */
export function parseDigest(text: string): DigestItem[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) return [];
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const items: DigestItem[] = [];
  for (const item of data) {
    if (items.length >= DIGEST_MAX_ITEMS) break;
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.kind !== 'viewer' && row.kind !== 'event') continue;
    if (typeof row.content !== 'string') continue;
    const content = row.content.trim().slice(0, MEMORY_CONTENT_MAX);
    if (!content) continue;
    const subject = typeof row.subject === 'string' && row.subject.trim() ? row.subject.trim().slice(0, 60) : null;
    items.push({ kind: row.kind, subject, content });
  }
  return items;
}

/** Quita los recuerdos que tocan algo que nunca se guarda (enlaces, datos personales, insultos...). */
export function keepDigestItems(items: DigestItem[]): DigestItem[] {
  return items.filter((item) => screenMemory(item.content) === null && (item.subject === null || screenMemory(item.subject) === null));
}
