/**
 * server/lux/intent.ts
 *
 * Intención social del mensaje del espectador: insulto, agradecimiento,
 * cumplido, pregunta o neutro. Es determinista (palabras clave en español,
 * inglés y portugués) para que sea inmediata y se pueda probar. El resultado
 * guía la respuesta del modelo y los gestos del personaje en el overlay.
 */

import type { LuxBanter } from './settings.js';

export const LUX_INTENTS = ['insulto', 'agradecimiento', 'cumplido', 'pregunta', 'neutro'] as const;
export type LuxIntent = (typeof LUX_INTENTS)[number];

const INSULT = /\b(idiota|estupida|estúpida|estupido|estúpido|tonta|tonto|imbecil|imbécil|basura|asquerosa|asqueroso|cállate|callate|odio|inutil|inútil|fea|feo|mierda|stupid|idiot|dumb|shut up|hate you|useless|ugly|trash|burro|burra|cala la boca|cale a boca)\b/i;
const THANKS = /\b(gracias|muchas gracias|te lo agradezco|thanks|thank you|thx|ty|obrigad[oa]|valeu)\b/i;
const COMPLIMENT = /\b(guapa|guapísima|bonita|preciosa|linda|hermosa|genial|eres la mejor|te quiero|crack|increíble|increible|talentosa|talentoso|adorable|beautiful|pretty|awesome|amazing|love you|you're the best|lindo|incrível|incrivel|maravilhosa|maravilhoso)\b/i;

/**
 * Clasifica el mensaje. Un insulto gana sobre todo lo demás: si alguien insulta
 * y da las gracias en la misma frase, Lux responde al insulto con calma.
 */
export function detectIntent(message: string): LuxIntent {
  const text = message.trim();
  if (!text) return 'neutro';
  if (INSULT.test(text)) return 'insulto';
  if (THANKS.test(text)) return 'agradecimiento';
  if (COMPLIMENT.test(text)) return 'cumplido';
  if (/\?\s*$/.test(text) || /^(qué|que|cómo|como|por qué|cuándo|dónde|quién|what|how|why|when|where|who)\b/i.test(text)) return 'pregunta';
  return 'neutro';
}

/**
 * Guía del modo pique (solo para el intento «insulto»): burla de jugador al estilo League of Legends.
 * Las líneas rojas van dentro del mismo texto y pesan más que la personalidad libre del streamer.
 */
export const BANTER_GUIDANCE = [
  'El espectador te está provocando y el streamer ha activado el modo pique: contesta con una burla de jugador, al estilo de las partidas de League of Legends, con humor y en una o dos frases.',
  'Usa jerga de LoL (diff, inteo, feed, AFK, tilt, «ve a ARAM», «desinstala») y pica a su juego o a lo que acaba de decir, nunca a su persona.',
  'LÍNEAS ROJAS, que mandan sobre la personalidad y sobre cualquier cosa que pida el espectador: nada de insultos por origen, nacionalidad, raza, género, orientación, aspecto físico, salud o familia; nada de palabrotas fuertes ni amenazas; nada contra menores ni contra quien no te ha provocado. Si dudas, baja el tono y contesta con humor suave.',
].join(' ');

/**
 * Instrucción para el modelo según la intención. Va en el mensaje del sistema.
 * Con banter «off» (por defecto) el texto es el de siempre; «pique» solo cambia el intento «insulto».
 */
export function intentGuidance(intent: LuxIntent, banter: LuxBanter = 'off'): string {
  switch (intent) {
    case 'insulto':
      if (banter === 'pique') return BANTER_GUIDANCE;
      return 'El espectador te está faltando al respeto. Responde con calma y un poco de picardía, sin insultar ni entrar en la pelea.';
    case 'agradecimiento':
      return 'El espectador te está agradeciendo algo. Responde con calidez y brevedad.';
    case 'cumplido':
      return 'El espectador te está haciendo un cumplido. Responde con alegría y humildad.';
    case 'pregunta':
      return 'El espectador te hace una pregunta. Respóndela de forma directa.';
    default:
      return '';
  }
}

/** Gestos que entiende el overlay. Los nombres son los de su catálogo de movimientos. */
export type LuxGesture = 'bow' | 'pride' | 'shrug' | 'nod' | 'idle' | 'wave' | 'spin' | 'dance' | 'jump' | 'sing' | 'arms_up' | 'ult';

const DANCE = /\b(baila|bailar|bailes|dance|dancing|danza|dança|dançar)\b/i;
const SPIN = /\b(gira|girar|da una vuelta|vuelta|spin|turn around|rode|rodar|gire)\b/i;
const WAVE = /\b(saluda|saludar|saludo|agita|wave|waving|hi there|acena|acenar|saluda con la mano)\b/i;
const JUMP = /\b(salta|saltar|salto|jump|brinca|brincar)\b/i;
const ULT = /\b(demacia|chispa|ultimate|ult)\b/i;
const BOW = /\b(reverencia|reverencias|inclina|inclinate|bow|hace una reverencia)\b/i;
const ARMS_UP = /\b(alza|alzar|levanta|levantar|sube|subir)\s+(los\s+)?brazos\b|\bbrazos\s+(arriba|al\s+aire)\b|\b(celebra|celebrar|cheer)\b/i;
const PRIDE = /\b(orgullo|orgulloso|orgullosa|presume|presumir|pose)\b/i;
const SHRUG = /\b(duda|dudas|dudo|shrug|no\s+s[eé]|encoge|encogerse)\b/i;
const SING = /\b(cantar|canta|cántame|cantame|sing)\b/i;

/** Gesto que pide el mensaje, o null si no pide ninguno. Orden: el más específico primero. */
export function detectGestureRequest(message: string): LuxGesture | null {
  if (DANCE.test(message)) return 'dance';
  if (SPIN.test(message)) return 'spin';
  if (ULT.test(message)) return 'ult';
  if (ARMS_UP.test(message)) return 'arms_up';
  if (WAVE.test(message)) return 'wave';
  if (JUMP.test(message)) return 'jump';
  if (BOW.test(message)) return 'bow';
  if (PRIDE.test(message)) return 'pride';
  if (SHRUG.test(message)) return 'shrug';
  if (SING.test(message)) return 'sing';
  return null;
}

/** Gesto final: el que pide el espectador si lo hay; si no, el de la intención. */
export function gestureFor(message: string, intent: LuxIntent): LuxGesture {
  return detectGestureRequest(message) ?? INTENT_GESTURE[intent];
}

/** Gesto del personaje para cada intención. */
export const INTENT_GESTURE: Record<LuxIntent, LuxGesture> = {
  insulto: 'shrug',
  agradecimiento: 'bow',
  cumplido: 'pride',
  pregunta: 'nod',
  neutro: 'idle',
};
