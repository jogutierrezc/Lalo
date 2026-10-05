import { describe, it, expect } from 'vitest';
import { sanitizeTwitchMessage } from '../src/utils/twitchSanitizer';

describe('twitchSanitizer — Trigger !s y Reglas de Sanitización', () => {
  it('debe ignorar mensajes que NO comiencen exactamente con !s ', () => {
    expect(sanitizeTwitchMessage('Hola streamer como estás')).toBeNull();
    expect(sanitizeTwitchMessage('!tts lee esto')).toBeNull();
    expect(sanitizeTwitchMessage('!song request')).toBeNull();
    expect(sanitizeTwitchMessage('!s')).toBeNull(); // sin espacio posterior
    expect(sanitizeTwitchMessage('!secret texto')).toBeNull();
    expect(sanitizeTwitchMessage('')).toBeNull();
    expect(sanitizeTwitchMessage(null as unknown as string)).toBeNull();
  });

  it('debe procesar mensajes válidos que comiencen con !s y remover el comando', () => {
    const result = sanitizeTwitchMessage('!s Hola mundo desde Twitch', {
      username: 'pepe',
      displayName: 'PepeGamer',
    });

    expect(result).not.toBeNull();
    expect(result?.cleanText).toBe('Hola mundo desde Twitch');
    expect(result?.username).toBe('pepe');
    expect(result?.displayName).toBe('PepeGamer');
  });

  it('debe aceptar !S o !s de manera insensible a mayúsculas/minúsculas', () => {
    const result = sanitizeTwitchMessage('!S Mensaje con S mayúscula');
    expect(result).not.toBeNull();
    expect(result?.cleanText).toBe('Mensaje con S mayúscula');
  });

  it('debe eliminar URLs del mensaje para proteger la privacidad y evitar spam', () => {
    const result = sanitizeTwitchMessage('!s mira este link https://malicious.site/video y este www.google.com gracias');
    expect(result).not.toBeNull();
    expect(result?.cleanText).toBe('mira este link y este gracias');
    expect(result?.cleanText).not.toContain('https://');
    expect(result?.cleanText).not.toContain('www.');
  });

  it('debe moderar spam de risas largas (ej. Jajajajajajajaja)', () => {
    const result = sanitizeTwitchMessage('!s que gracioso Jajajajajajajajajajaja');
    expect(result).not.toBeNull();
    expect(result?.cleanText).toContain('Jajaja');
    expect(result?.cleanText.length).toBeLessThan(35);
  });

  it('debe moderar spam de caracteres repetidos consecutivamente (ej. siiiiiii -> sii)', () => {
    const result = sanitizeTwitchMessage('!s vamonossssss yaaaaa');
    expect(result).not.toBeNull();
    expect(result?.cleanText).toBe('vamonoss yaa');
  });

  it('debe truncar mensajes que superen los 1000 caracteres de longitud', () => {
    const longText = '!s ' + 'palabra '.repeat(160); // > 1280 caracteres
    const result = sanitizeTwitchMessage(longText);
    expect(result).not.toBeNull();
    expect(result?.cleanText.length).toBeLessThanOrEqual(1005);
    expect(result?.cleanText.endsWith('...')).toBe(true);
  });

  it('debe retornar null si tras limpiar URLs o espacios el texto queda vacío', () => {
    expect(sanitizeTwitchMessage('!s https://twitch.tv')).toBeNull();
    expect(sanitizeTwitchMessage('!s    ')).toBeNull();
  });

  it('debe detectar y adjuntar metadatos de emoción si el usuario escribe etiquetas como [susurro]', () => {
    const result = sanitizeTwitchMessage('!s [susurro] esto es un secreto');
    expect(result).not.toBeNull();
    expect(result?.emotion).toBeDefined();
    expect(result?.emotion?.tag).toBe('whispering');
    expect(result?.emotion?.label).toBe('Susurro');
    expect(result?.emotion?.emoji).toBe('🤫');
  });

  it('no recorta las cifras: «1000 bits» o «152000 puntos» no son spam', () => {
    expect(sanitizeTwitchMessage('!s Gracias por los 1000 bits')?.cleanText).toBe('Gracias por los 1000 bits');
    expect(sanitizeTwitchMessage('!s Maestría con 152000 puntos, 111 a 0')?.cleanText).toBe('Maestría con 152000 puntos, 111 a 0');
    // Las letras y los signos repetidos se siguen recortando
    expect(sanitizeTwitchMessage('!s siiiiiii 1000!!!!!')?.cleanText).toBe('sii 1000!!');
  });

  it('una frase del sistema con etiqueta de emoción conserva la etiqueta al inicio', () => {
    const result = sanitizeTwitchMessage('!s [excited] Victoria con Ahri. 9, 2, 11.');
    expect(result?.cleanText).toBe('[excited] Victoria con Ahri. 9, 2, 11.');
    expect(result?.emotion?.tag).toBe('excited');
  });
});
