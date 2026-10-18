/**
 * server/lux/prompt.ts
 *
 * Cómo se arman los mensajes que recibe el modelo. PROVISIONAL: el cerebro de
 * Lux (personalidad, reglas y uso de la memoria) se define aparte. Mientras
 * tanto, este archivo solo deja el hueco: un sistema mínimo, las memorias del
 * streamer y el mensaje del espectador.
 */

import type { ChatMessage } from './nvidia.js';
import type { LuxMemoryRow } from './luxDb.js';
import { EMOTION_INSTRUCTION } from './emotion.js';
import { intentGuidance, type LuxIntent } from './intent.js';

export const LUX_MAX_INPUT = 500;

export const PLACEHOLDER_SYSTEM = 'Eres Lux, un personaje de un directo de Twitch. Responde en español, en una o dos frases cortas.';

export interface LuxTurn {
  viewer: string | null;
  message: string;
  memories: LuxMemoryRow[];
  /** Ajustes del streamer: personalidad, idioma y longitud máxima de la respuesta. */
  personality?: string;
  language?: 'es' | 'en' | 'pt';
  replyMax?: number;
  /** Intención social del mensaje (insulto, agradecimiento, cumplido...). */
  intent?: LuxIntent;
}

const LANGUAGE_NAMES = { es: 'español', en: 'inglés', pt: 'portugués' } as const;

export function buildLuxMessages(turn: LuxTurn): ChatMessage[] {
  const lines = [PLACEHOLDER_SYSTEM];
  if (turn.personality) lines.push(`Personalidad del personaje: ${turn.personality}`);
  if (turn.language) lines.push(`Responde siempre en ${LANGUAGE_NAMES[turn.language]}.`);
  if (turn.replyMax) lines.push(`No superes ${turn.replyMax} caracteres.`);
  lines.push(EMOTION_INSTRUCTION);
  if (turn.intent) {
    const guidance = intentGuidance(turn.intent);
    if (guidance) lines.push(guidance);
  }
  const messages: ChatMessage[] = [{ role: 'system', content: lines.join('\n') }];
  if (turn.memories.length > 0) {
    const lines = turn.memories.map((memory) => `- (${memory.kind}${memory.subject ? `, ${memory.subject}` : ''}) ${memory.content}`);
    messages.push({ role: 'system', content: `Recuerdos del canal:\n${lines.join('\n')}` });
  }
  const who = turn.viewer ? `${turn.viewer}: ` : '';
  messages.push({ role: 'user', content: `${who}${turn.message}` });
  return messages;
}
