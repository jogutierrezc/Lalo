import { describe, expect, it } from 'vitest';
import { mergeKeepingLocalMedia, stripDataUrls } from '../src/lib/cloudConfig';
import { buildSuiteWidgetUrl } from '../src/utils/widgetUrl';
import { DEFAULT_SETTINGS } from '../src/types/settings';

const DATA_URL = `data:audio/mpeg;base64,${'A'.repeat(4000)}`;

describe('stripDataUrls', () => {
  it('quita los archivos incrustados y los cuenta, sin tocar lo demás', () => {
    const input = {
      accent: '#9146ff',
      events: { follow: { customAudioUrl: DATA_URL, template: '¡{user} te sigue!' } },
      customEvents: [{ id: 'a', videoUrl: DATA_URL }, { id: 'b', videoUrl: 'https://cdn.example/clip.webm' }],
    };
    const { value, stripped } = stripDataUrls(input);
    expect(stripped).toBe(2);
    expect(value.events.follow.customAudioUrl).toBe('');
    expect(value.events.follow.template).toBe('¡{user} te sigue!');
    expect(value.customEvents[1].videoUrl).toBe('https://cdn.example/clip.webm');
    // No modifica el original
    expect(input.events.follow.customAudioUrl).toBe(DATA_URL);
  });

  it('deja pasar los data: pequeños, como un SVG de sticker corto', () => {
    const small = 'data:image/svg+xml;base64,AAAA';
    expect(stripDataUrls({ sticker: small })).toEqual({ value: { sticker: small }, stripped: 0 });
  });
});

describe('mergeKeepingLocalMedia', () => {
  it('la nube manda en los valores normales', () => {
    expect(mergeKeepingLocalMedia({ volume: 0.4, title: 'Nube' }, { volume: 0.9, title: 'Local' })).toEqual({
      volume: 0.4,
      title: 'Nube',
    });
  });

  it('conserva el archivo local cuando la nube lo trae vacío', () => {
    const merged = mergeKeepingLocalMedia(
      { events: { sub: { customAudioUrl: '', soundType: 'retro-fanfare' } } },
      { events: { sub: { customAudioUrl: DATA_URL, soundType: 'synth-bell' } } }
    );
    expect(merged).toEqual({ events: { sub: { customAudioUrl: DATA_URL, soundType: 'retro-fanfare' } } });
  });

  it('empareja los elementos de una lista por id, no por posición', () => {
    const merged = mergeKeepingLocalMedia(
      [{ id: 'b', videoUrl: '' }, { id: 'a', videoUrl: '' }],
      [{ id: 'a', videoUrl: DATA_URL }, { id: 'b', videoUrl: 'https://x/y.webm' }]
    );
    expect(merged).toEqual([{ id: 'b', videoUrl: '' }, { id: 'a', videoUrl: DATA_URL }]);
  });

  it('mantiene un archivo local cuyo campo ya no viene de la nube', () => {
    expect(mergeKeepingLocalMedia({ name: 'Susto' }, { name: 'Viejo', videoUrl: DATA_URL })).toEqual({
      name: 'Susto',
      videoUrl: DATA_URL,
    });
  });
});

describe('buildSuiteWidgetUrl con clave de widget', () => {
  it('añade la clave en las capas y también en la URL de voz', () => {
    const origin = 'https://lalo.example';
    expect(buildSuiteWidgetUrl(origin, 'alerts', 'canal', DEFAULT_SETTINGS, { k: 'wk_123' })).toContain('k=wk_123');
    const tts = buildSuiteWidgetUrl(origin, 'tts', 'canal', DEFAULT_SETTINGS, { k: 'wk_123' });
    expect(tts).toContain('channel=canal');
    expect(tts).toContain('&k=wk_123');
  });

  it('sin clave, la URL de voz queda igual que antes', () => {
    const tts = buildSuiteWidgetUrl('https://lalo.example', 'tts', 'canal', DEFAULT_SETTINGS);
    expect(tts).not.toContain('k=');
  });
});
