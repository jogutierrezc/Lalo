import { describe, it, expect } from 'vitest';
import {
  extractPrimaryEmotion,
  normalizeTextForFishAudio,
  AVAILABLE_EMOTIONS,
} from '../src/utils/emotionMapper';

describe('emotionMapper — Mapeo de emociones y expresiones', () => {
  it('detecta emociones en español y asigna emojis y clases de badge', () => {
    const emotion = extractPrimaryEmotion('[feliz] hola a todos');
    expect(emotion).not.toBeNull();
    expect(emotion?.tag).toBe('happy');
    expect(emotion?.label).toBe('Feliz');
    expect(emotion?.emoji).toBe('😄');
    expect(emotion?.badgeClass).toContain('emerald');
  });

  it('detecta emociones en inglés directamente', () => {
    const emotion = extractPrimaryEmotion('[whispering] silencio en el stream');
    expect(emotion).not.toBeNull();
    expect(emotion?.tag).toBe('whispering');
    expect(emotion?.label).toBe('Susurro');
    expect(emotion?.emoji).toBe('🤫');
  });

  it('es insensible a tildes y mayúsculas', () => {
    const emotion1 = extractPrimaryEmotion('[ALEGRÍA] qué gran stream');
    expect(emotion1?.tag).toBe('happy');

    const emotion2 = extractPrimaryEmotion('[sueño] me voy a dormir');
    expect(emotion2?.tag).toBe('yawn');
  });

  it('maneja expresiones personalizadas en corchetes con icono de teatro', () => {
    const emotion = extractPrimaryEmotion('[sarcasmo] sí claro, como digas');
    expect(emotion).not.toBeNull();
    expect(emotion?.emoji).toBe('🎭');
    expect(emotion?.label).toBe('Sarcasmo');
  });

  it('retorna null cuando el mensaje no contiene corchetes', () => {
    const emotion = extractPrimaryEmotion('mensaje normal sin expresiones');
    expect(emotion).toBeNull();
  });

  it('traduce etiquetas en español a etiquetas canónicas para Fish Audio', () => {
    const input = '[feliz] qué buen día [susurro] esto es un secreto [risa] jajaja';
    const output = normalizeTextForFishAudio(input);
    expect(output).toBe('[happy] qué buen día [whispering] esto es un secreto [laughing] jajaja');
  });

  it('contiene la lista de emociones disponibles para el dashboard', () => {
    expect(AVAILABLE_EMOTIONS.length).toBeGreaterThanOrEqual(10);
    expect(AVAILABLE_EMOTIONS.some((e) => e.label === 'Feliz')).toBe(true);
    expect(AVAILABLE_EMOTIONS.some((e) => e.label === 'Susurro')).toBe(true);
    expect(AVAILABLE_EMOTIONS.some((e) => e.label === 'Cantando')).toBe(true);
  });

  it('reconoce múltiples variantes de la habilidad cantada ([canto], [cantar], [canción], [música])', () => {
    expect(extractPrimaryEmotion('[canto] esta es una canción')?.tag).toBe('singing');
    expect(extractPrimaryEmotion('[canta] esta es una canción')?.tag).toBe('singing');
    expect(extractPrimaryEmotion('[cantar] esta es una canción')?.tag).toBe('singing');
    expect(extractPrimaryEmotion('[canción] esta es una canción')?.tag).toBe('singing');
    expect(extractPrimaryEmotion('[música] esta es una canción')?.tag).toBe('singing');
    expect(extractPrimaryEmotion('[singing] this is a song')?.tag).toBe('singing');

    const normalized = normalizeTextForFishAudio('[cantar] Cumpleaños feliz [música] la la la');
    expect(normalized).toBe('[singing] Cumpleaños feliz [singing] la la la');
  });
});
