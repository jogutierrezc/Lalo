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

export const LUX_MAX_INPUT = 500;

export const PLACEHOLDER_SYSTEM = 'Eres Lux, un personaje de un directo de Twitch. Responde en español, en una o dos frases cortas.';

export interface LuxTurn {
  viewer: string | null;
  message: string;
  memories: LuxMemoryRow[];
}

export function buildLuxMessages(turn: LuxTurn): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: PLACEHOLDER_SYSTEM }];
  if (turn.memories.length > 0) {
    const lines = turn.memories.map((memory) => `- (${memory.kind}${memory.subject ? `, ${memory.subject}` : ''}) ${memory.content}`);
    messages.push({ role: 'system', content: `Recuerdos del canal:\n${lines.join('\n')}` });
  }
  const who = turn.viewer ? `${turn.viewer}: ` : '';
  messages.push({ role: 'user', content: `${who}${turn.message}` });
  return messages;
}
