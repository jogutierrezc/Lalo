/**
 * emotionMapper.ts
 *
 * Sistema de detección, normalización y estilizado de emociones y expresiones
 * vocales para Fish Audio (S2 / S2.1) y el Widget de OBS Studio.
 *
 * Permite que los espectadores de Twitch escriban expresiones entre corchetes
 * tanto en ESPAÑOL ([feliz], [susurro], [enojado], [risa]) como en INGLÉS ([happy], [whispering]),
 * traduciéndolas de forma óptima para el motor de audio y generando insignias
 * visuales temáticas (badges) para la tarjeta en pantalla de OBS.
 */

export interface EmotionInfo {
  tag: string;         // Etiqueta canónica en inglés para Fish Audio (ej. "happy")
  rawTag: string;      // Texto original que escribió el espectador (ej. "feliz")
  label: string;       // Nombre legible en español (ej. "Feliz")
  emoji: string;       // Icono visual (ej. "😄")
  badgeClass: string;  // Clases Tailwind para el badge en la tarjeta OBS
}

interface EmotionDefinition {
  canonicalTag: string;
  label: string;
  emoji: string;
  badgeClass: string;
  aliases: string[];
}

const EMOTION_DEFINITIONS: EmotionDefinition[] = [
  {
    canonicalTag: 'happy',
    label: 'Feliz',
    emoji: '😄',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-emerald-500/10',
    aliases: ['feliz', 'alegre', 'contento', 'happy', 'alegria', 'cheerful', 'joy', 'sonrisa'],
  },
  {
    canonicalTag: 'whispering',
    label: 'Susurro',
    emoji: '🤫',
    badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-cyan-500/10',
    aliases: ['susurro', 'susurrando', 'secreto', 'whisper', 'whispering', 'shh', 'silencio', 'bajito'],
  },
  {
    canonicalTag: 'angry',
    label: 'Enojado',
    emoji: '😡',
    badgeClass: 'bg-red-500/20 text-red-300 border-red-500/40 shadow-red-500/10',
    aliases: ['enojado', 'enfadado', 'molesto', 'furioso', 'rabia', 'angry', 'furious', 'mad', 'rage', 'bronca'],
  },
  {
    canonicalTag: 'sad',
    label: 'Triste',
    emoji: '😢',
    badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/40 shadow-blue-500/10',
    aliases: ['triste', 'tristeza', 'depre', 'deprimido', 'sad', 'sorrow', 'unhappy', 'pena', 'bajon'],
  },
  {
    canonicalTag: 'laughing',
    label: 'Riendo',
    emoji: '🤣',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-amber-500/10',
    aliases: ['risa', 'riendo', 'gracioso', 'chiste', 'laugh', 'laughing', 'chuckle', 'giggle', 'lol', 'jaja'],
  },
  {
    canonicalTag: 'shouting',
    label: 'Gritando',
    emoji: '📢',
    badgeClass: 'bg-orange-500/20 text-orange-300 border-orange-500/40 shadow-orange-500/10',
    aliases: ['grito', 'gritando', 'fuerte', 'shout', 'shouting', 'yell', 'yelling', 'scream', 'vocifero'],
  },
  {
    canonicalTag: 'crying',
    label: 'Llorando',
    emoji: '😭',
    badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-indigo-500/10',
    aliases: ['llorando', 'llanto', 'llorar', 'cry', 'crying', 'sob', 'sobbing', 'lagrimas'],
  },
  {
    canonicalTag: 'scared',
    label: 'Con Miedo',
    emoji: '😨',
    badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40 shadow-purple-500/10',
    aliases: ['miedo', 'asustado', 'terror', 'panico', 'scared', 'fear', 'terrified', 'spooked', 'cagado'],
  },
  {
    canonicalTag: 'excited',
    label: 'Emocionado',
    emoji: '🎉',
    badgeClass: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40 shadow-fuchsia-500/10',
    aliases: ['emocionado', 'hype', 'entusiasmado', 'excited', 'hyped', 'fiesta', 'alocado'],
  },
  {
    canonicalTag: 'surprised',
    label: 'Sorprendido',
    emoji: '😲',
    badgeClass: 'bg-violet-500/20 text-violet-300 border-violet-500/40 shadow-violet-500/10',
    aliases: ['sorprendido', 'asombrado', 'impactado', 'surprised', 'shocked', 'amazed', 'gasp', 'woow'],
  },
  {
    canonicalTag: 'singing',
    label: 'Cantando',
    emoji: '🎵',
    badgeClass: 'bg-pink-500/20 text-pink-300 border-pink-500/40 shadow-pink-500/10',
    aliases: [
      'canto',
      'canta',
      'cantar',
      'cantando',
      'cancion',
      'canción',
      'sing',
      'singing',
      'song',
      'tarareo',
      'tararear',
      'musica',
      'música',
      'melodia',
      'melodía',
      'musical',
    ],
  },
  {
    canonicalTag: 'calm',
    label: 'Calmado',
    emoji: '😌',
    badgeClass: 'bg-teal-500/20 text-teal-300 border-teal-500/40 shadow-teal-500/10',
    aliases: ['calmado', 'tranquilo', 'relax', 'paz', 'calm', 'relaxed', 'peaceful', 'zen', 'suave'],
  },
  {
    canonicalTag: 'sigh',
    label: 'Suspiro',
    emoji: '💨',
    badgeClass: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40 shadow-zinc-500/10',
    aliases: ['suspiro', 'suspirando', 'sigh', 'sighing', 'exhalo', 'puff'],
  },
  {
    canonicalTag: 'yawn',
    label: 'Con Sueño',
    emoji: '🥱',
    badgeClass: 'bg-amber-600/20 text-amber-200 border-amber-600/40 shadow-amber-600/10',
    aliases: ['bostezo', 'bostezando', 'sueno', 'sueño', 'cansado', 'dormido', 'yawn', 'yawning', 'tired', 'sleepy'],
  },
  {
    canonicalTag: 'nervous',
    label: 'Nervioso',
    emoji: '😬',
    badgeClass: 'bg-lime-500/20 text-lime-300 border-lime-500/40 shadow-lime-500/10',
    aliases: ['nervioso', 'nerviosa', 'nervios', 'nervous', 'anxious', 'inquieto'],
  },
];

// Mapa rápido de búsqueda por alias normalizado (sin acentos, minúsculas)
const ALIAS_MAP = new Map<string, EmotionDefinition>();
for (const def of EMOTION_DEFINITIONS) {
  for (const alias of def.aliases) {
    const norm = alias.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    ALIAS_MAP.set(norm, def);
  }
}

// Regex para encontrar corchetes con etiquetas de emoción: ej. [feliz], [happy], [whispering in a low voice]
const BRACKET_TAG_REGEX = /\[([a-zA-ZáéíóúÁÉÍÓÚñÑ\s-_]{2,30})\]/g;

/**
 * Busca y retorna la emoción principal encontrada en el texto.
 * Si encuentra un alias conocido, devuelve los datos formateados.
 * Si es una expresión personalizada en corchetes, genera una insignia general 🎭.
 */
export function extractPrimaryEmotion(text: string): EmotionInfo | null {
  if (!text || !text.includes('[') || !text.includes(']')) {
    return null;
  }

  const matches = [...text.matchAll(BRACKET_TAG_REGEX)];
  if (matches.length === 0) {
    return null;
  }

  for (const match of matches) {
    const rawTag = match[1].trim();
    const normalizedKey = rawTag.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const found = ALIAS_MAP.get(normalizedKey);
    if (found) {
      return {
        tag: found.canonicalTag,
        rawTag,
        label: found.label,
        emoji: found.emoji,
        badgeClass: found.badgeClass,
      };
    }
  }

  // Si tiene un corchete de texto personalizado (ej. [sarcasmo] o [robot])
  const firstRaw = matches[0][1].trim();
  const capitalized = firstRaw.charAt(0).toUpperCase() + firstRaw.slice(1).toLowerCase();
  return {
    tag: firstRaw.toLowerCase(),
    rawTag: firstRaw,
    label: capitalized,
    emoji: '🎭',
    badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40 shadow-purple-500/10',
  };
}

/**
 * Transforma las etiquetas entre corchetes del texto en español a sus
 * equivalentes canónicos en inglés para Fish Audio S2 / S2.1.
 *
 * Ejemplo:
 *   "[feliz] Hola a todos [susurro] esto es un secreto"
 *   -> "[happy] Hola a todos [whispering] esto es un secreto"
 */
export function normalizeTextForFishAudio(text: string): string {
  if (!text || !text.includes('[') || !text.includes(']')) {
    return text;
  }

  return text.replace(BRACKET_TAG_REGEX, (fullMatch, rawTag) => {
    const key = rawTag.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const found = ALIAS_MAP.get(key);
    if (found) {
      return `[${found.canonicalTag}]`;
    }
    // Si no es un alias conocido, se conserva tal cual en corchetes para el modelo S2
    return fullMatch;
  });
}

/**
 * Quita las etiquetas entre corchetes: lo que se enseña en pantalla (el bocadillo
 * de la mascota) o se mide para estimar cuánto dura la frase no las lleva.
 *
 * Ejemplo: "[excited] Victoria con Ahri." -> "Victoria con Ahri."
 */
export function stripEmotionTags(text: string): string {
  if (!text || !text.includes('[') || !text.includes(']')) return text;
  return text.replace(BRACKET_TAG_REGEX, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Lista de emociones predeterminadas para mostrar en el Streamer Dashboard
 */
export const AVAILABLE_EMOTIONS = EMOTION_DEFINITIONS.map((e) => ({
  tag: e.canonicalTag,
  label: e.label,
  emoji: e.emoji,
  example: `[${e.aliases[0]}]`,
}));
