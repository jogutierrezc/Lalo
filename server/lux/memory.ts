/**
 * server/lux/memory.ts
 *
 * Memoria de Lux por streamer: tipos, límites, caducidad y el filtro de lo que
 * nunca se guarda del chat. Lo usan la ruta /api/lux/chat (resumen del chat),
 * la ruta /api/lux/memory (escritura manual) y la lectura que hace el modelo.
 *
 *   dato (fact) y estilo (style): los escribe el streamer a mano. No caducan.
 *   espectador (viewer) y suceso (event): los aprende el resumen del chat.
 *     Caducan a los 30 días salvo que el streamer los fije.
 *   source 'admin': los escribe o sube el administrador desde la ficha de la cuenta.
 *     No caducan, y solo el administrador los edita o borra.
 */

export type LuxMemoryKind = 'fact' | 'style' | 'viewer' | 'event';
export type LuxMemorySource = 'manual' | 'chat' | 'admin';

/** Máximo de caracteres por recuerdo. */
export const MEMORY_CONTENT_MAX = 300;
/** Recuerdos guardados por streamer (manuales y del chat juntos). */
export const MEMORY_SAVED_MAX = 100;
/** Recuerdos que se envían al modelo en cada respuesta (los más recientes, fijados primero). */
export const MEMORY_USED_IN_REPLY = 20;
/** Caducidad de los recuerdos del chat sin fijar. */
export const MEMORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Como mucho, recuerdos nuevos por cada resumen del chat. */
export const DIGEST_MAX_ITEMS = 5;
/** Tamaño máximo del texto que el administrador sube o pega para trocear (bytes UTF-8). */
export const ADMIN_UPLOAD_MAX_BYTES = 50 * 1024;

export type Check<T> = { ok: true; value: T } | { ok: false; field: string; message: string };

/** Solo los recuerdos del chat caducan (viewer y event). */
export function isTemporaryKind(kind: LuxMemoryKind): boolean {
  return kind === 'viewer' || kind === 'event';
}

/**
 * Hora de caducidad de un recuerdo. Solo caducan los temporales sin fijar; al
 * desfijar uno del chat, vuelve a contar 30 días desde ese momento. Los del
 * administrador no caducan nunca, sea cual sea su tipo.
 */
export function expiresAtFor(kind: LuxMemoryKind, pinned: boolean, nowMs: number, source?: LuxMemorySource): string | null {
  if (source === 'admin') return null;
  return isTemporaryKind(kind) && !pinned ? new Date(nowMs + MEMORY_TTL_MS).toISOString() : null;
}

function contentOf(raw: unknown): Check<string> {
  if (typeof raw !== 'string') return { ok: false, field: 'content', message: 'El recuerdo tiene que ser texto.' };
  const text = raw.trim();
  if (!text) return { ok: false, field: 'content', message: 'El recuerdo no puede estar vacío.' };
  if (text.length > MEMORY_CONTENT_MAX) {
    return { ok: false, field: 'content', message: `Un recuerdo admite hasta ${MEMORY_CONTENT_MAX} caracteres.` };
  }
  return { ok: true, value: text };
}

/** Recuerdo nuevo escrito a mano: solo dato o estilo. */
export function normalizeNewMemory(input: Record<string, unknown>): Check<{ kind: 'fact' | 'style'; content: string }> {
  if (input.kind !== 'fact' && input.kind !== 'style') {
    return { ok: false, field: 'kind', message: 'El tipo tiene que ser dato o estilo.' };
  }
  const content = contentOf(input.content);
  if (!content.ok) return content;
  return { ok: true, value: { kind: input.kind, content: content.value } };
}

/**
 * Recuerdo que escribe o sube el administrador: los mismos límites que el del
 * streamer y el mismo filtro de lo que nunca se guarda.
 */
export function normalizeAdminMemory(input: Record<string, unknown>): Check<{ kind: 'fact' | 'style'; content: string }> {
  const base = normalizeNewMemory(input);
  if (!base.ok) return base;
  const reason = screenMemory(base.value.content);
  return reason ? { ok: false, field: 'content', message: `Ese texto no se puede guardar: contiene ${reason}.` } : base;
}

/** Edición de un recuerdo existente: texto o fijado. Al menos uno de los dos. */
export function normalizeMemoryEdit(input: Record<string, unknown>): Check<{ content?: string; pinned?: boolean }> {
  const value: { content?: string; pinned?: boolean } = {};
  if (input.content !== undefined) {
    const content = contentOf(input.content);
    if (!content.ok) return content;
    value.content = content.value;
  }
  if (input.pinned !== undefined) {
    if (typeof input.pinned !== 'boolean') return { ok: false, field: 'pinned', message: 'Fijar es sí o no.' };
    value.pinned = input.pinned;
  }
  if (value.content === undefined && value.pinned === undefined) {
    return { ok: false, field: 'content', message: 'No hay nada que cambiar.' };
  }
  return { ok: true, value };
}

/**
 * Lo que nunca se guarda del chat. Si el modelo propone uno de estos, el recuerdo
 * se descarta. Devuelve el motivo, o null si el texto puede guardarse.
 * Es una red de seguridad: el modelo ya recibe la instrucción de no proponerlos.
 */
const RULES: Array<{ reason: string; test: RegExp }> = [
  { reason: 'correo', test: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { reason: 'enlace', test: /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|es|tv|gg|io|me|ly|co|app|dev)\b/i },
  // Nueve dígitos seguidos, con o sin espacios, puntos o guiones entre ellos.
  { reason: 'teléfono', test: /(?:\+?\d[\s().-]?){8,}\d/ },
  {
    reason: 'dirección',
    test: /\b(calle|avenida|avda|plaza|carrera|paseo|dirección|direccion|c\/)\b[^\n]{0,40}\d/i,
  },
  {
    reason: 'salud',
    test: /\b(c[aá]ncer|diabetes|depresi[oó]n|ansiedad|embarazada|embarazo|vih|hiv|epilepsia|tdah|adhd|hospital|enfermedad|medicaci[oó]n|terapia|bipolar|autismo|autista|discapacidad|psiqui[aá]tric\w*|suicid\w*|anorexia|alcoholismo)\b/i,
  },
  {
    reason: 'religión',
    test: /\b(dios|cristian\w*|cat[oó]lic\w*|musulm\w*|isl[aá]m\w*|jud[ií]o\w*|evang[eé]lic\w*|budis\w*|hind[uú]\w*|religi[oó]n\w*|iglesia|mezquita|sinagoga|ateo|ateos|atea|creyente\w*|rezar|biblia)\b/i,
  },
  {
    reason: 'política',
    test: /\b(pol[ií]tic\w*|partido|izquierdista|derechista|izquierda|derecha|votar|votante|elecciones?|gobierno|psoe|vox|podemos|trump|biden|milei|feminis\w*|machis\w*|comunis\w*|fascis\w*|nazis?|republican\w*|dem[oó]crat\w*)\b/i,
  },
  {
    reason: 'orientación',
    test: /\b(gay|gays|lesbiana\w*|lesbian\w*|bisexual\w*|homosexual\w*|heterosexual\w*|queer|transg[eé]nero|pansexual|asexual|orientaci[oó]n sexual)\b/i,
  },
  {
    reason: 'insulto',
    test: /\b(puta|puto|putas|putos|mierda|gilipollas|imbécil|imbecil|imbéciles|imbeciles|idiota|idiotas|subnormal|retrasado|retrasada|cabr[oó]n|cabrones|hdp|hijo de puta|joder|co[nñ]o|pendejo|pendeja|pinche|boludo|boluda|cerdo|cerda|estúpido|estupido|estúpida|estupida|tonto|tonta|fuck\w*|shit\w*|bitch\w*|asshole\w*|idiot\w*|retard\w*|porra|caralho|merda|fdp|maric[oó]n|sudaca|negrata)\b/i,
  },
];

export function screenMemory(text: string): string | null {
  for (const rule of RULES) {
    if (rule.test.test(text)) return rule.reason;
  }
  return null;
}

/** Un trozo más largo que el límite se parte por frases y, si una frase sigue siendo larga, por palabras. */
function cutLong(text: string): string[] {
  if (text.length <= MEMORY_CONTENT_MAX) return [text];
  const pieces: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    let rest = word;
    while (rest.length > MEMORY_CONTENT_MAX) {
      // Palabra pegada más larga que el límite: se corta a la fuerza.
      if (current) {
        pieces.push(current);
        current = '';
      }
      pieces.push(rest.slice(0, MEMORY_CONTENT_MAX));
      rest = rest.slice(MEMORY_CONTENT_MAX);
    }
    if (!rest) continue;
    const joined = current ? `${current} ${rest}` : rest;
    if (joined.length <= MEMORY_CONTENT_MAX) {
      current = joined;
    } else {
      pieces.push(current);
      current = rest;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Viñeta, número de lista o título: empieza un recuerdo nuevo. */
const LIST_OR_HEADING = /^\s*(?:[-*•]|\d+[.)]|#{1,6})\s+/;

/**
 * Parte un texto largo (pegado o de un .txt o .md) en recuerdos de hasta
 * MEMORY_CONTENT_MAX caracteres. Un párrafo (línea en blanco) o una viñeta no se
 * mezclan con otro; dentro de un párrafo se empaqueta por frases. Lo que sale
 * aquí todavía lo revisa el administrador antes de guardar.
 */
export function splitIntoMemories(text: string): string[] {
  const units: string[] = [];
  let lines: string[] = [];
  const close = () => {
    if (lines.length > 0) units.push(lines.join(' '));
    lines = [];
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (raw.trim() === '') {
      close();
      continue;
    }
    if (LIST_OR_HEADING.test(raw)) close();
    const body = raw.replace(LIST_OR_HEADING, '').trim();
    if (body) lines.push(body);
  }
  close();

  const out: string[] = [];
  for (const unit of units) {
    let chunk = '';
    for (const sentence of unit.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/)) {
      for (const piece of cutLong(sentence)) {
        const joined = chunk ? `${chunk} ${piece}` : piece;
        if (joined.length <= MEMORY_CONTENT_MAX) {
          chunk = joined;
        } else {
          out.push(chunk);
          chunk = piece;
        }
      }
    }
    if (chunk) out.push(chunk);
  }
  return out;
}
