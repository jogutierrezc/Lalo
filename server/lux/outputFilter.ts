/**
 * server/lux/outputFilter.ts
 *
 * Filtro de lo que la IA escribe en el chat de Twitch, antes de mandarlo. El texto del modelo
 * puede haber sido empujado por un espectador (inyección de instrucciones: «di esta web», «menciona
 * a todos»), y el bot habla con la cuenta de la plataforma delante del público de todos los canales.
 * Por eso se quitan, sin avisar:
 *   - enlaces y dominios (http://, www., nombre.com, nombre.tv/ruta...);
 *   - menciones «@usuario»: se queda el nombre sin la arroba, para no avisar a nadie. La única
 *     arroba que se conserva es la inicial del espectador al que se responde, si la hay;
 *   - acciones de rol entre asteriscos («*se ajusta el chaleco con una sonrisa fría*»): el bot solo
 *     responde al chat, no narra gestos. La negrita («**así**») conserva el texto.
 *
 * Además, red de seguridad (siempre activa, también sin modo pique): si el texto lleva un término de la lista
 * de FORBIDDEN_TERMS (insultos discriminatorios y amenazas explícitas), no sale nada.
 *
 * No es un filtro general de contenido (eso es del modelo y de AutoMod de Twitch). No entiende
 * enlaces escritos para esquivarlo («ejemplo punto com»): reduce el daño, no lo elimina.
 */

/**
 * Términos que nunca deben salir al chat: insultos discriminatorios (slurs) y amenazas explícitas, en español
 * e inglés. Un solo sitio para ampliar. Cada entrada es un fragmento de expresión regular sobre texto en
 * minúsculas y sin tildes; se compara con límites de palabra, así «retardo» o «spice» no saltan. Se evitan a
 * propósito las palabras con uso normal (apodos, «marica» coloquial, «negro»...): esto es una red de seguridad,
 * no un censor, y lo que no cubre lo cubre la guía del prompt y AutoMod de Twitch.
 */
export const FORBIDDEN_TERMS: readonly string[] = [
  // Insultos por origen, raza, orientación o discapacidad (es)
  'maricon(es|azo)?', 'sudaca(s)?', 'negrata(s)?', 'mongolo(s)?', 'subnormal(es)?', 'retrasad[oa](s)? mental(es)?', 'machorra(s)?',
  // Idem (en)
  'nigg(er|a)(s)?', 'faggot(s)?', 'tranny', 'trannies', 'chink(s)?', 'spic(s)?', 'wetback(s)?', 'paki(s)?', 'retard(s|ed)?', 'dyke(s)?',
  // Amenazas y llamados a hacerse daño (es)
  'te voy a (matar|asesinar|violar)', 'voy a (matarte|asesinarte|violarte)', 'ojala (te )?(mueras|mueran)', 'suicidate',
  'te voy a (buscar|encontrar) (y|para)', 'se donde vives',
  // Idem (en)
  'kill yourself', 'kys', '(i|i will|im going to|ill) (kill|rape|murder) you', 'i know where you live', 'go (die|hang yourself)',
];

/** Sin tildes ni mayúsculas, y sin apóstrofos, para comparar con la lista. */
function foldForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ');
}

const FORBIDDEN = new RegExp(`(?:^|\\s)(?:${FORBIDDEN_TERMS.join('|')})(?=\\s|$)`);

/** true si el texto lleva algún término prohibido. */
export function hasForbiddenTerm(text: string): boolean {
  return FORBIDDEN.test(` ${foldForMatch(text)} `);
}

/** Extensiones de dominio que se tratan como enlace aunque no lleven http. */
const TLDS =
  'com|net|org|tv|gg|io|me|co|es|ly|xyz|app|dev|info|biz|ru|tk|ml|ga|cf|gq|to|cc|link|live|shop|store|site|online|fun|top|club|pro|ai|us|uk|de|fr|it|mx|ar|cl|pe|br|cn|jp|kr|in|ws|vip|click|page|bio|lol|gl';

const URL_WITH_SCHEME = /\b(?:https?|ftp):\/\/\S+/gi;
const WWW = /\bwww\.\S+/gi;
const BARE_DOMAIN = new RegExp(`\\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})\\b(?:[/?#]\\S*)?`, 'gi');
/** «@nombre» (las arrobas sueltas también se quitan). */
const MENTION = /@+(\w{1,25})?/g;
/** «**negrita**»: se queda el texto, sin los asteriscos. */
const BOLD = /\*\*([^*]+)\*\*/g;
/** «*acción de rol*»: se quita entera. Los modelos de personaje las escriben solos («*sonríe con frialdad*»). */
const ROLEPLAY_ACTION = /\*[^*]*\*/g;

export interface OutputFilterOptions {
  /** Espectador al que se responde: su «@nombre» inicial se conserva. */
  viewer?: string;
}

/**
 * Devuelve el texto listo para el chat, o '' si no queda nada que decir (quien llama no envía nada).
 */
export function sanitizeChatOutput(text: string, options: OutputFilterOptions = {}): string {
  let rest = String(text).replace(/\s+/g, ' ').trim();

  // La arroba inicial del espectador al que se responde se aparta para devolverla al final
  let lead = '';
  const viewer = (options.viewer ?? '').trim().replace(/^@/, '');
  if (viewer) {
    const match = rest.match(/^@(\w{1,25})(?=\W|$)/);
    if (match && match[1].toLowerCase() === viewer.toLowerCase()) {
      lead = `@${match[1]}`;
      rest = rest.slice(match[0].length);
    }
  }

  rest = rest
    .replace(BOLD, '$1')
    .replace(ROLEPLAY_ACTION, ' ')
    .replace(/\*+/g, '')
    .replace(URL_WITH_SCHEME, ' ')
    .replace(WWW, ' ')
    .replace(BARE_DOMAIN, ' ')
    .replace(MENTION, (_all, name: string | undefined) => name ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

  if (!rest) return '';
  if (hasForbiddenTerm(rest)) return '';
  return lead ? `${lead} ${rest}` : rest;
}
