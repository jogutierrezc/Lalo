/**
 * server/lux/intent.ts
 *
 * Intención social del mensaje del espectador: insulto, agradecimiento,
 * cumplido, pregunta o neutro. Es determinista (palabras clave en español,
 * inglés y portugués) para que sea inmediata y se pueda probar. El resultado
 * guía la respuesta del modelo y los gestos del personaje en el overlay.
 */

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

/** Instrucción para el modelo según la intención. Va en el mensaje del sistema. */
export function intentGuidance(intent: LuxIntent): string {
  switch (intent) {
    case 'insulto':
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

/** Gesto del personaje para cada intención. Los nombres son los que entiende el overlay. */
export const INTENT_GESTURE: Record<LuxIntent, 'bow' | 'pride' | 'shrug' | 'nod' | 'idle'> = {
  insulto: 'shrug',
  agradecimiento: 'bow',
  cumplido: 'pride',
  pregunta: 'nod',
  neutro: 'idle',
};
