/**
 * src/components/done/doneDemo.ts
 *
 * Respuestas de ejemplo de Done para la vista previa (chat simulado, eventos) y para el modo demo
 * del overlay. No llaman a ninguna IA: son frases fijas que siguen la voz del diseño aprobado.
 */

import type { DoneEmotion, DoneGesture, DoneKind, DoneSpeech } from '../../lib/doneTypes';

export interface Segment {
  t: string;
  e: DoneEmotion;
  g?: DoneGesture;
}

export type DemoEvent = 'follow' | 'sub' | 'raid' | 'start' | 'free';

export const DEMO_EVENT_LABEL: Record<DemoEvent, string> = {
  follow: 'Nuevo seguidor',
  sub: 'Suscripción',
  raid: 'Raid',
  start: 'Inicio de directo',
  free: 'Comentario espontáneo',
};

export const DEMO_VIEWERS = ['nova_sky', 'tito99', 'LunaPlay'];
export const QUICK_MESSAGES = ['hola', '¿qué juego sigue?', 'cuéntame un chiste', 'baila', 'canta', '¿qué me recomiendas?', 'eres tonto'];

/** Corta las frases para no pasar del largo máximo de la respuesta. */
export function fitToLimit(segments: Segment[], limit: number): Segment[] {
  let left = limit;
  const out: Segment[] = [];
  for (const s of segments) {
    if (left <= 0) break;
    const text = s.t.length > left ? `${s.t.slice(0, Math.max(0, left - 1)).trimEnd()}…` : s.t;
    left -= s.t.length;
    out.push({ ...s, t: text });
  }
  return out;
}

export interface ReplyContext {
  banter: boolean;
  channel: string;
  memory: string[];
  replyMax: number;
}

/** La respuesta de ejemplo a un mensaje de espectador. */
export function simulateReply(message: string, viewer: string, ctx: ReplyContext): Segment[] {
  const m = message.toLowerCase();
  let r: Segment[];
  if (/tonto|feo|malo|inutil|inútil/.test(m)) {
    r = ctx.banter
      ? [
          { t: `Uy, ${viewer}, con esa puntería no ganas ni en modo fácil.`, e: 'molesta', g: 'shrug' },
          { t: 'Es broma, te quiero igual.', e: 'alegre' },
        ]
      : [{ t: 'Prefiero que charlemos sin insultos, ¿sí?', e: 'sorprendida' }];
  } else if (/hola|buenas|saludos|hey/.test(m)) r = [{ t: `¡Hola, ${viewer}! Qué gusto verte por aquí.`, e: 'feliz', g: 'wave' }];
  else if (/quien eres|quién eres|que eres|qué eres/.test(m))
    r = [
      { t: `Soy Done, el asistente del canal de ${ctx.channel}.`, e: 'normal', g: 'bow' },
      { t: 'Respondo al chat y cuido que todo vaya fluido.', e: 'alegre' },
    ];
  else if (/juego|jugar|siguiente|partida/.test(m))
    r = [
      { t: 'Yo votaría por algo cooperativo.', e: 'normal', g: 'nod' },
      { t: '¡Así todo el chat juega contigo!', e: 'emocionada', g: 'jump' },
    ];
  else if (/chiste/.test(m))
    r = [
      { t: '¿Por qué el streamer llevó una escalera? Para subir a los cien espectadores.', e: 'alegre' },
      { t: 'Okay, mejoraré mi material.', e: 'feliz', g: 'shrug' },
    ];
  else if (/triste|mal dia|mal día|cansad|estres|estrés/.test(m))
    r = [
      { t: `Qué pena, ${viewer}. Aquí tienes al chat para acompañarte.`, e: 'triste', g: 'nod' },
      { t: 'Mañana será mejor, lo prometo.', e: 'feliz' },
    ];
  else if (/baila|bailar/.test(m)) r = [{ t: '¡Pista libre!', e: 'emocionada', g: 'dance' }];
  else if (/canta|cantar/.test(m)) r = [{ t: 'Lalalá, que el chat me acompañe.', e: 'magica', g: 'sing' }];
  else if (/cafe|café|recomiend/.test(m))
    r = [
      { t: ctx.memory.length ? `Recuerdo que ${ctx.memory[0].toLowerCase().replace(/^le gusta/, 'a ti te gusta')}.` : 'Un café siempre ayuda.', e: 'alegre', g: 'nod' },
      { t: 'Entonces, un cortado.', e: 'feliz' },
    ];
  else
    r = [
      { t: `Buena pregunta, ${viewer}. Déjame pensarlo con calma.`, e: 'normal', g: 'nod' },
      { t: 'Creo que la respuesta está en seguir transmitiendo.', e: 'magica' },
    ];
  return fitToLimit(r, ctx.replyMax);
}

/** La frase de ejemplo de cada evento. */
export function simulateEvent(kind: DemoEvent, who: string): Segment & { tag: string } {
  switch (kind) {
    case 'follow':
      return { tag: 'Follow', t: `¡Gracias por el follow, ${who}!`, e: 'feliz', g: 'wave' };
    case 'sub':
      return { tag: 'Suscripción', t: `¡${who} se suscribió! Esto se pone serio.`, e: 'emocionada', g: 'ult' };
    case 'raid':
      return { tag: 'Raid', t: `¡Raid de ${who} con 42 espectadores! Bienvenidos todos.`, e: 'sorprendida', g: 'arms_up' };
    case 'start':
      return { tag: 'Directo', t: '¡Estamos al aire! Que empiece el show.', e: 'alegre', g: 'bow' };
    default:
      return { tag: 'Comentario', t: '¿Alguien más tiene hambre o solo yo?', e: 'alegre', g: 'shrug' };
  }
}

let seq = 0;

/** Convierte segmentos en frases de Done con ids nuevos (la vista previa las encola una a una). */
export function toSpeeches(segments: Segment[], viewer: string | null, kind: DoneKind): DoneSpeech[] {
  return segments.map((s, i) => ({
    id: `demo-${Date.now().toString(36)}-${seq++}`,
    text: s.t,
    emotion: s.e,
    gesture: s.g ?? null,
    // Solo la primera frase de una respuesta lleva la tarjeta del espectador
    viewer: i === 0 ? viewer : null,
    kind: i === 0 ? kind : 'say',
    createdAt: new Date().toISOString(),
  }));
}

/** Guion del modo demo del overlay: una pregunta, un evento y un comentario, en rueda. */
export function demoScript(step: number, ctx: ReplyContext): { speeches: DoneSpeech[]; ask?: string } {
  const slot = step % 4;
  if (slot === 0) {
    const ask = 'hola';
    return { speeches: toSpeeches(simulateReply(ask, 'LunaPlay', ctx), 'LunaPlay', 'chat'), ask };
  }
  if (slot === 1) return { speeches: toSpeeches([simulateEvent('follow', 'nova_sky')], 'nova_sky', 'event') };
  if (slot === 2) {
    const ask = 'cuéntame un chiste';
    return { speeches: toSpeeches(simulateReply(ask, 'tito99', ctx), 'tito99', 'chat'), ask };
  }
  return { speeches: toSpeeches([simulateEvent('free', ctx.channel)], null, 'spontaneous') };
}
