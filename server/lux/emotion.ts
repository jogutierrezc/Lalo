/**
 * server/lux/emotion.ts
 *
 * Contrato de emociones entre el modelo y el personaje. El modelo marca su respuesta con una
 * etiqueta [emocion] de esta lista. Los ids son los de las expresiones de public/lux/overlay.html:
 * si se cambian allí, se cambian aquí.
 *
 * Los modelos no siempre escriben la etiqueta exacta: ponen [molesto] en vez de [molesta], [Feliz],
 * [sorprendido], [canta], la ponen al principio o a mitad de frase, o más de una. Aquí se entienden
 * todas esas variantes y las etiquetas nunca llegan al chat ni a la voz.
 */

export const LUX_EMOTIONS = [
  'normal',
  'habla',
  'emocionada',
  'grita',
  'feliz',
  'alegre',
  'triste',
  'molesta',
  'sorprendida',
  'magica',
] as const;

export type LuxEmotion = (typeof LUX_EMOTIONS)[number];

/** Cuándo usar cada expresión: el modelo elige mejor con una pista que con un nombre suelto. */
const EMOTION_HINTS: Record<LuxEmotion, string> = {
  normal: 'tranquila, informativa',
  habla: 'explicando con calma',
  emocionada: 'ilusión, hype, algo genial',
  grita: 'gritando, mucha energía o enfado fuerte',
  feliz: 'contenta, cariñosa, agradecida',
  alegre: 'divertida, bromeando, risas',
  triste: 'pena, decepción, nostalgia',
  molesta: 'enfadada, fastidiada, sarcástica',
  sorprendida: 'asombro, sorpresa, algo inesperado',
  magica: 'misterio, hechizo, tono mágico',
};

export const EMOTION_INSTRUCTION = `Al final de tu respuesta añade exactamente una etiqueta de emoción entre corchetes, con una de estas palabras exactas (en femenino, sin acentos): ${LUX_EMOTIONS.map((id) => `${id} (${EMOTION_HINTS[id]})`).join('; ')}. Elige la que mejor encaje con lo que dices, no pongas siempre la misma. Ejemplo: [feliz]`;

/** Quita tildes y mayúsculas: «Sorprendída», «MÁGICA» y «magica» son lo mismo. */
const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Palabras que los modelos escriben a cambio de una emoción de la lista (ya sin tildes). */
const ALIASES: Record<string, LuxEmotion> = {
  // enfado
  molesto: 'molesta', molestia: 'molesta', enojada: 'molesta', enojado: 'molesta', enfadada: 'molesta', enfadado: 'molesta',
  furiosa: 'molesta', furioso: 'molesta', irritada: 'molesta', irritado: 'molesta', fastidiada: 'molesta', fastidiado: 'molesta',
  sarcastica: 'molesta', sarcastico: 'molesta', sarcasmo: 'molesta', angry: 'molesta', annoyed: 'molesta', mad: 'molesta',
  // alegría
  contenta: 'feliz', contento: 'feliz', happy: 'feliz', felicidad: 'feliz', agradecida: 'feliz', agradecido: 'feliz', carinosa: 'feliz', amor: 'feliz',
  alegria: 'alegre', divertida: 'alegre', divertido: 'alegre', risa: 'alegre', riendo: 'alegre', rie: 'alegre', jaja: 'alegre', lol: 'alegre', burla: 'alegre', broma: 'alegre', cheerful: 'alegre', playful: 'alegre',
  // canto y tono: no hay expresión de canto, la cara más cercana es la alegre
  canta: 'alegre', cantando: 'alegre', cantar: 'alegre', cancion: 'alegre', tarareando: 'alegre', singing: 'alegre', sing: 'alegre',
  // energía
  emocionado: 'emocionada', emocion: 'emocionada', ilusionada: 'emocionada', ilusionado: 'emocionada', hype: 'emocionada', excited: 'emocionada', animada: 'emocionada', animado: 'emocionada',
  gritando: 'grita', grito: 'grita', gritar: 'grita', shouting: 'grita', yelling: 'grita',
  // pena
  triste: 'triste', tristeza: 'triste', sad: 'triste', llorando: 'triste', llora: 'triste', decepcionada: 'triste', decepcionado: 'triste', melancolica: 'triste', melancolico: 'triste', nostalgica: 'triste',
  // sorpresa
  sorprendido: 'sorprendida', sorpresa: 'sorprendida', asombrada: 'sorprendida', asombrado: 'sorprendida', shocked: 'sorprendida', surprised: 'sorprendida', wow: 'sorprendida', confundida: 'sorprendida', confundido: 'sorprendida',
  // magia
  magico: 'magica', magia: 'magica', misteriosa: 'magica', misterioso: 'magica', hechizo: 'magica', magic: 'magica',
  // calma
  neutral: 'normal', neutra: 'normal', tranquila: 'normal', tranquilo: 'normal', calma: 'normal', serio: 'normal', seria: 'normal',
  hablando: 'habla', explicando: 'habla', pensativa: 'habla', pensativo: 'habla',
};

/** Emoción de una palabra de etiqueta, o null si no se parece a ninguna. */
export function emotionFromWord(word: string): LuxEmotion | null {
  const id = fold(word);
  if ((LUX_EMOTIONS as readonly string[]).includes(id)) return id as LuxEmotion;
  return ALIASES[id] ?? null;
}

/** Cualquier [palabra] corta, en cualquier lugar: lo que parece una etiqueta de emoción. */
const ANY_TAG = /\s*\[\s*([A-Za-zÀ-ÿ_ -]{2,24}?)\s*\]/g;

/**
 * Pistas del propio texto para cuando el modelo no etiqueta nada. Solo señales claras:
 * emojis y risas. Sin señal, la emoción es 'normal'.
 */
function inferEmotion(text: string): LuxEmotion {
  if (/😂|🤣|😆|\b(?:ja){2,}|\b(?:je){2,}|\bjiji/i.test(text)) return 'alegre';
  if (/😢|😭|😞|🥺/.test(text)) return 'triste';
  if (/😡|😠|🤬/.test(text)) return 'molesta';
  if (/😮|😲|🤯|😱/.test(text)) return 'sorprendida';
  if (/[😊😄😁🥰😍❤💖💜]/u.test(text)) return 'feliz';
  if (/✨|🔮|🪄/.test(text)) return 'magica';
  if (/!{3,}/.test(text)) return 'emocionada';
  return 'normal';
}

/**
 * Separa las etiquetas del texto y devuelve la emoción. Se entienden las etiquetas en cualquier
 * posición, en masculino, con tildes o en inglés, y se quitan todas; si hay varias manda la última
 * reconocida. Una etiqueta que no es de emoción ([aburrida]) se quita igual: el texto nunca lleva
 * corchetes de control. Sin ninguna etiqueta válida, se intuye por el texto (risas, emojis).
 */
export function parseEmotion(text: string): { text: string; emotion: LuxEmotion } {
  let emotion: LuxEmotion | null = null;
  const stripped = text.replace(ANY_TAG, (_match, word: string) => {
    const found = emotionFromWord(word);
    if (found) emotion = found;
    return ' ';
  });
  const clean = stripped.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();
  return { text: clean, emotion: emotion ?? inferEmotion(clean) };
}
