import { describe, expect, it } from 'vitest';
import { ANNOUNCER_VOICE_ID, DEFAULT_RAID_COMMANDS, DEFAULT_RAID_SETTINGS, normalizeRaidSettings } from '../src/types/raid';
import { PRESET_VOICES } from '../src/types/settings';
import { extractPrimaryEmotion, stripEmotionTags } from '../src/utils/emotionMapper';
import { parseRaidCommand } from '../src/utils/raidLogic';
import { PREDICTION_TEXT_MAX, parseStaffVoice, staffVoiceText, unprefixed } from '../src/utils/staffVoice';

describe('comando de otra capa con el prefijo de la voz', () => {
  it('«!s so canal» vale lo mismo que «!so canal»', () => {
    expect(unprefixed('!s so pau_rl', '!s')).toBe('!so pau_rl');
    expect(unprefixed('!S  cortar', '!s')).toBe('!cortar');
    expect(unprefixed('!voz clip https://clips.twitch.tv/Abc', '!voz')).toBe('!clip https://clips.twitch.tv/Abc');
    expect(parseRaidCommand(unprefixed('!s so pau_rl', '!s') as string, DEFAULT_RAID_COMMANDS)).toEqual({ kind: 'so', login: 'pau_rl' });
  });

  it('no toca lo que no empieza por el comando de la voz, ni lo que ya lleva su exclamación', () => {
    expect(unprefixed('!so pau_rl', '!s')).toBeNull();
    expect(unprefixed('!saltar', '!s')).toBeNull();
    expect(unprefixed('!s', '!s')).toBeNull();
    expect(unprefixed('!s !so pau_rl', '!s')).toBeNull();
    expect(unprefixed('hola !s so pau', '!s')).toBeNull();
    expect(unprefixed('!s so pau', '')).toBeNull();
  });

  it('un mensaje normal para la voz no se convierte en comando de ninguna capa', () => {
    const variant = unprefixed('!s hola a todos', '!s') as string;
    expect(variant).toBe('!hola a todos');
    expect(parseRaidCommand(variant, DEFAULT_RAID_COMMANDS)).toBeNull();
    expect(parseStaffVoice(variant, DEFAULT_RAID_COMMANDS)).toBeNull();
  });
});

describe('comandos que la voz atiende sola', () => {
  it('el saludo a un canal, con el nombre que el streamer le dio al comando', () => {
    expect(parseStaffVoice('!so pau_rl', DEFAULT_RAID_COMMANDS)).toEqual({ kind: 'so', login: 'pau_rl' });
    expect(parseStaffVoice('!saludo @Pau_RL', { ...DEFAULT_RAID_COMMANDS, so: '!saludo' })).toEqual({ kind: 'so', login: 'pau_rl' });
    expect(parseStaffVoice('!so', DEFAULT_RAID_COMMANDS)).toBeNull();
    expect(parseStaffVoice('!so uno dos', DEFAULT_RAID_COMMANDS)).toBeNull();
  });

  it('el corto y la retirada del saludo no son cosa de la voz', () => {
    expect(parseStaffVoice('!cortar', DEFAULT_RAID_COMMANDS)).toBeNull();
    expect(parseStaffVoice('!clip https://clips.twitch.tv/Abc', DEFAULT_RAID_COMMANDS)).toBeNull();
  });

  it('el aviso de predicción, con o sin texto y con sus alias', () => {
    expect(parseStaffVoice('!prediccion ¿Gano esta partida?', DEFAULT_RAID_COMMANDS)).toEqual({ kind: 'prediction', text: '¿Gano esta partida?' });
    expect(parseStaffVoice('!PRED   sí   o   no', DEFAULT_RAID_COMMANDS)).toEqual({ kind: 'prediction', text: 'sí o no' });
    expect(parseStaffVoice('!prediction', DEFAULT_RAID_COMMANDS)).toEqual({ kind: 'prediction', text: '' });
    expect(parseStaffVoice('!predicciones hoy', DEFAULT_RAID_COMMANDS)).toBeNull();
    const long = parseStaffVoice(`!pred ${'a'.repeat(400)}`, DEFAULT_RAID_COMMANDS);
    expect(long?.kind === 'prediction' && long.text.length).toBe(PREDICTION_TEXT_MAX);
  });
});

describe('lo que dice la voz', () => {
  it('saluda al canal sin leer los guiones bajos y con tono alegre', () => {
    const text = staffVoiceText({ kind: 'so', login: 'pau_rl' });
    expect(stripEmotionTags(text)).toBe('Un saludo para pau rl. Pasen por su canal y denle follow.');
    expect(extractPrimaryEmotion(text)?.tag).toBe('happy');
  });

  it('anuncia la predicción con su texto, cerrando la frase si hace falta', () => {
    expect(stripEmotionTags(staffVoiceText({ kind: 'prediction', text: '¿Gano esta partida?' }))).toBe(
      '¡Predicción abierta! ¿Gano esta partida? Participa con tus puntos del canal.'
    );
    expect(stripEmotionTags(staffVoiceText({ kind: 'prediction', text: 'Jefe final' }))).toBe(
      '¡Predicción abierta! Jefe final. Participa con tus puntos del canal.'
    );
    expect(stripEmotionTags(staffVoiceText({ kind: 'prediction', text: '' }))).toBe('¡Hay una predicción abierta! Participa con tus puntos del canal.');
    expect(extractPrimaryEmotion(staffVoiceText({ kind: 'prediction', text: '' }))?.tag).toBe('excited');
  });
});

describe('voz de los avisos', () => {
  it('de serie es Brisa, que está en el catálogo fijo', () => {
    expect(DEFAULT_RAID_SETTINGS.voiceId).toBe(ANNOUNCER_VOICE_ID);
    expect(PRESET_VOICES.find((voice) => voice.id === ANNOUNCER_VOICE_ID)?.name).toBe('Brisa');
  });

  it('quien ya tenía ajustes guardados pasa a Brisa; quien elige la del chat la conserva', () => {
    expect(normalizeRaidSettings({ enabled: true }).voiceId).toBe(ANNOUNCER_VOICE_ID);
    expect(normalizeRaidSettings({ voiceId: '' }).voiceId).toBe('');
    expect(normalizeRaidSettings({ voiceId: 'no vale' }).voiceId).toBe('');
    expect(normalizeRaidSettings({ voiceId: 'abcdef123456' }).voiceId).toBe('abcdef123456');
  });
});
