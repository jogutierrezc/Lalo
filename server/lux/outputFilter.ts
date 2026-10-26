/**
 * server/lux/outputFilter.ts
 *
 * Filtro de lo que la IA escribe en el chat de Twitch, antes de mandarlo. El texto del modelo
 * puede haber sido empujado por un espectador (inyección de instrucciones: «di esta web», «menciona
 * a todos»), y el bot habla con la cuenta de la plataforma delante del público de todos los canales.
 * Por eso se quitan, sin avisar:
 *   - enlaces y dominios (http://, www., nombre.com, nombre.tv/ruta...);
 *   - menciones «@usuario»: se queda el nombre sin la arroba, para no avisar a nadie. La única
 *     arroba que se conserva es la inicial del espectador al que se responde, si la hay.
 *
 * No es un filtro de insultos ni de contenido (eso es del modelo y de AutoMod de Twitch). No entiende
 * enlaces escritos para esquivarlo («ejemplo punto com»): reduce el daño, no lo elimina.
 */

/** Extensiones de dominio que se tratan como enlace aunque no lleven http. */
const TLDS =
  'com|net|org|tv|gg|io|me|co|es|ly|xyz|app|dev|info|biz|ru|tk|ml|ga|cf|gq|to|cc|link|live|shop|store|site|online|fun|top|club|pro|ai|us|uk|de|fr|it|mx|ar|cl|pe|br|cn|jp|kr|in|ws|vip|click|page|bio|lol|gl';

const URL_WITH_SCHEME = /\b(?:https?|ftp):\/\/\S+/gi;
const WWW = /\bwww\.\S+/gi;
const BARE_DOMAIN = new RegExp(`\\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})\\b(?:[/?#]\\S*)?`, 'gi');
/** «@nombre» (las arrobas sueltas también se quitan). */
const MENTION = /@+(\w{1,25})?/g;

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
    .replace(URL_WITH_SCHEME, ' ')
    .replace(WWW, ' ')
    .replace(BARE_DOMAIN, ' ')
    .replace(MENTION, (_all, name: string | undefined) => name ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

  if (!rest) return '';
  return lead ? `${lead} ${rest}` : rest;
}
