/**
 * tests/luxLanguages.test.ts
 *
 * Idiomas de Mi AI: español, inglés, francés, portugués e italiano, más «auto»,
 * que contesta en el idioma de quien escribe para que un canal hable varios.
 */

import { describe, expect, it } from 'vitest';
import { LUX_LANGUAGES, normalizeLuxSettings, settingsFromRow } from '../server/lux/settings';
import { buildLuxMessages, buildSongMessages, languageRule, systemFor } from '../server/lux/prompt';
import { buildSpontaneousMessages } from '../server/lux/proactive';

const turn = { viewer: 'ana', message: 'hola', memories: [] };
const systemText = (messages: { role: string; content: string }[]) => messages[0].content;

describe('ajustes de idioma', () => {
  it('admite los cinco idiomas y el modo automático', () => {
    expect([...LUX_LANGUAGES].sort()).toEqual(['auto', 'en', 'es', 'fr', 'it', 'pt']);
    for (const language of LUX_LANGUAGES) {
      expect(normalizeLuxSettings({ language })).toMatchObject({ ok: true, value: { language } });
    }
  });

  it('rechaza un idioma que no está en la lista', () => {
    expect(normalizeLuxSettings({ language: 'de' })).toMatchObject({ ok: false, field: 'language' });
  });

  it('una fila con francés o italiano se lee tal cual', () => {
    expect(settingsFromRow({ language: 'fr' }).language).toBe('fr');
    expect(settingsFromRow({ language: 'it' }).language).toBe('it');
    expect(settingsFromRow({ language: 'auto' }).language).toBe('auto');
  });
});

describe('regla de idioma del prompt', () => {
  it('con idioma fijo, siempre ese', () => {
    expect(languageRule('fr')).toBe('Responde siempre en francés.');
    expect(languageRule('it')).toBe('Responde siempre en italiano.');
  });

  it('en automático, el idioma de quien escribe, con español de respaldo', () => {
    const rule = languageRule('auto');
    expect(rule).toContain('mismo idioma en que te escribe el espectador');
    expect(rule).toContain('francés');
    expect(rule).toContain('italiano');
    expect(rule).toContain('responde en español');
  });

  it('en comentarios sin espectador, el idioma que predomine en el chat', () => {
    expect(languageRule('auto', true)).toContain('predomine en el chat');
  });

  it('el sistema base ya no fija el español', () => {
    expect(systemFor('Lux')).not.toContain('Responde en español');
  });

  it('el mensaje al modelo lleva la regla del idioma del canal', () => {
    expect(systemText(buildLuxMessages({ ...turn, language: 'it' }))).toContain('Responde siempre en italiano.');
    expect(systemText(buildLuxMessages({ ...turn, language: 'auto' }))).toContain('mismo idioma en que te escribe el espectador');
    expect(systemText(buildLuxMessages(turn))).toContain('Responde siempre en español.');
  });

  it('la canción se pide en el idioma del espectador en automático', () => {
    expect(systemText(buildSongMessages({ ...turn, language: 'auto' }, 'el mar'))).toContain('el idioma del espectador');
    expect(systemText(buildSongMessages({ ...turn, language: 'fr' }, 'el mar'))).toContain('francés');
  });

  it('un comentario espontáneo en automático sigue el idioma del chat', () => {
    const messages = buildSpontaneousMessages({ name: 'Lux', language: 'auto', memories: [], lines: [{ viewer: 'ana', text: 'bonjour' }] });
    expect(systemText(messages)).toContain('predomine en el chat');
  });
});
