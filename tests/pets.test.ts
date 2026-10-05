import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PETS_SETTINGS,
  DEFAULT_PET_COMMAND,
  PET_EMOTIONS,
  PET_KINDS,
  PET_LIMITS,
  type PetEmotion,
  decodePetsSettings,
  encodePetsSettings,
  normalizePetCommand,
  normalizePetsSettings,
  type PetsSettings,
} from '../src/types/pets';
import {
  SAMPLE_CUES,
  callsPet,
  cooldownLeft,
  cueFromEvent,
  envelopeAt,
  fillLine,
  petEmotionOf,
  pickLine,
  planCue,
  quietDue,
  speakSeconds,
  volumeEnvelope,
} from '../src/utils/petsLogic';
import { petFaceMarkup, petMarkup } from '../src/components/mascotas/petArt';
import { parseTwitchEvent } from '../src/utils/twitchEvents';
import { CONFIG_MODULES } from '../src/lib/cloudTypes';
import { MODULE_STORAGE_KEYS } from '../src/lib/cloudConfig';
import { buildSuiteWidgetUrl } from '../src/utils/widgetUrl';
import { DEFAULT_SETTINGS } from '../src/types/settings';

const settings = (patch: Partial<PetsSettings> = {}): PetsSettings => ({ ...DEFAULT_PETS_SETTINGS, ...patch });

describe('ajustes de Mascotas', () => {
  it('de nada salen los valores por defecto', () => {
    expect(normalizePetsSettings(null)).toEqual(DEFAULT_PETS_SETTINGS);
    expect(normalizePetsSettings('x')).toEqual(DEFAULT_PETS_SETTINGS);
  });

  it('lo que no vale vuelve a su valor por defecto', () => {
    const clean = normalizePetsSettings({ kind: 'dragon', pos: 'centro', enter: 'explota', color: 'rojo', size: 99, turn: 7 });
    expect(clean.kind).toBe('chispa');
    expect(clean.pos).toBe('bl');
    expect(clean.enter).toBe('asoma');
    expect(clean.color).toBe(DEFAULT_PETS_SETTINGS.color);
    expect(clean.size).toBe(PET_LIMITS.size.max);
    expect(clean.turn).toBe('espera');
  });

  it('sin imagen de reposo no hay personaje propio ni imagen de hablar', () => {
    const clean = normalizePetsSettings({ kind: 'custom', talkImage: { url: 'https://cdn.example/habla.gif', name: 'habla.gif' } });
    expect(clean.kind).toBe('chispa');
    expect(clean.talkImage).toBeNull();
  });

  it('no acepta direcciones de imagen que no sean de imagen', () => {
    expect(normalizePetsSettings({ idleImage: { url: 'javascript:alert(1)' } }).idleImage).toBeNull();
    expect(normalizePetsSettings({ idleImage: { url: 'data:text/html,<b>x</b>' } }).idleImage).toBeNull();
    expect(normalizePetsSettings({ idleImage: { url: 'https://cdn.example/a.png', name: 'a.png' } }).idleImage?.url).toBe('https://cdn.example/a.png');
  });

  it('limpia las frases: sin vacías, sin saltos y con tope', () => {
    const lines = ['  hola  {user} ', '', 'x'.repeat(500), ...Array.from({ length: 30 }, (_, i) => `frase ${i}`)];
    const clean = normalizePetsSettings({ triggers: { points: { on: true, lines } } }).triggers.points;
    expect(clean.lines[0]).toBe('hola {user}');
    expect(clean.lines[1]).toHaveLength(PET_LIMITS.line);
    expect(clean.lines).toHaveLength(PET_LIMITS.lines);
  });

  it('un activador que falta conserva sus frases de serie', () => {
    const clean = normalizePetsSettings({ triggers: { bits: { on: false } } });
    expect(clean.triggers.bits.on).toBe(false);
    expect(clean.triggers.bits.lines).toEqual(DEFAULT_PETS_SETTINGS.triggers.bits.lines);
    expect(clean.triggers.raid).toEqual(DEFAULT_PETS_SETTINGS.triggers.raid);
  });

  it('el comando siempre empieza por ! y va en minúsculas', () => {
    expect(normalizePetCommand('Chispa')).toBe('!chispa');
    expect(normalizePetCommand('!HOLA_1')).toBe('!hola_1');
    expect(normalizePetCommand('! con espacios')).toBe(DEFAULT_PET_COMMAND);
    expect(normalizePetCommand('')).toBe(DEFAULT_PET_COMMAND);
  });

  it('los ajustes no tienen dónde guardar la clave de la IA', () => {
    const clean = normalizePetsSettings({ apiKey: 'sk-secreta', key: 'x', secret: 'y' }) as unknown as Record<string, unknown>;
    expect(JSON.stringify(clean)).not.toContain('sk-secreta');
    expect(Object.keys(clean).some((key) => /key|secret|token/i.test(key))).toBe(false);
  });

  it('viajan por la URL y vuelven iguales; las imágenes locales no viajan', () => {
    const base = settings({ name: 'Ñandú', pos: 'tr', idleImage: { url: 'https://cdn.example/a.png', name: 'a.png', mediaId: 'm1' } });
    expect(decodePetsSettings(encodePetsSettings(base))).toEqual(normalizePetsSettings(base));

    const local = settings({ kind: 'custom', idleImage: { url: 'data:image/png;base64,AAAA', name: 'a.png', mediaId: '' } });
    const back = decodePetsSettings(encodePetsSettings(local));
    expect(back?.idleImage).toBeNull();
    expect(back?.kind).toBe('chispa');
    expect(decodePetsSettings('no-es-base64-válido')).toBeNull();
  });

  it('«pets» viaja a la nube con su clave', () => {
    expect(CONFIG_MODULES).toContain('pets');
    expect(MODULE_STORAGE_KEYS.pets).toBe('lalo_pets_settings');
  });

  it('la fuente de OBS lleva la voz de reserva y no las reglas del chat', () => {
    const url = buildSuiteWidgetUrl('https://lalo.example', 'pets', 'canal', DEFAULT_SETTINGS, { ps: 'abc' });
    expect(url).toContain('app=pets');
    expect(url).toContain('voice=');
    expect(url).toContain('ps=abc');
    expect(url).not.toContain('tpl=');
  });
});

describe('frases', () => {
  it('sustituye las variables y el nombre de la mascota', () => {
    expect(fillLine('¡{user} canjeó {canje}! Soy {nombre}.', { user: 'pau', canje: 'Hidrátate' }, 'Chispa')).toBe('¡pau canjeó Hidrátate! Soy Chispa.');
  });

  it('sin valor no deja huecos ni puntuación suelta', () => {
    expect(fillLine('Hola {user} , ¿qué tal?', {}, 'Chispa')).toBe('Hola, ¿qué tal?');
    expect(fillLine('{desconocida}', {}, 'Chispa')).toBe('');
  });

  it('elige dentro de la lista con cualquier azar', () => {
    expect(pickLine(['a', 'b', 'c'], () => 0)).toBe('a');
    expect(pickLine(['a', 'b', 'c'], () => 0.999)).toBe('c');
    expect(pickLine(['a', 'b', 'c'], () => 1)).toBe('c');
    expect(pickLine([])).toBe('');
  });
});

describe('llamar a la mascota', () => {
  it('con su comando, y devuelve el resto del mensaje', () => {
    expect(callsPet('!mascota ¿quién gana?', 'Chispa', '!mascota')).toBe('¿quién gana?');
    expect(callsPet('!MASCOTA', 'Chispa', '!mascota')).toBe('');
    expect(callsPet('!mascotas hola', 'Chispa', '!mascota')).toBeNull();
  });

  it('con su nombre como palabra suelta, con o sin tilde y con @', () => {
    expect(callsPet('oye chispa, ¿qué tal?', 'Chispa', '!mascota')).toBe('oye chispa, ¿qué tal?');
    expect(callsPet('hola @Chispa', 'Chispa', '!mascota')).not.toBeNull();
    expect(callsPet('hola ñandu', 'Ñandú', '!mascota')).not.toBeNull();
    expect(callsPet('qué chispazo', 'Chispa', '!mascota')).toBeNull();
    expect(callsPet('hola a todos', 'Chispa', '!mascota')).toBeNull();
  });

  it('un nombre muy corto no dispara con cualquier mensaje', () => {
    expect(callsPet('yo no fui', 'Yo', '!mascota')).toBeNull();
  });
});

describe('esperas y silencio', () => {
  it('cuenta los segundos que faltan', () => {
    expect(cooldownLeft(undefined, 1000, 10)).toBe(0);
    expect(cooldownLeft(1000, 4000, 10)).toBe(7);
    expect(cooldownLeft(1000, 11000, 10)).toBe(0);
    expect(cooldownLeft(1000, 2000, 0)).toBe(0);
  });

  it('comenta el silencio una vez y espera a que el chat vuelva', () => {
    const minute = 60_000;
    expect(quietDue(0, 0, 10 * minute, 5)).toBe(false);
    expect(quietDue(minute, 0, 5 * minute, 5)).toBe(false);
    expect(quietDue(minute, 0, 6 * minute, 5)).toBe(true);
    // Ya habló en este silencio
    expect(quietDue(minute, 6 * minute, 30 * minute, 5)).toBe(false);
    // Volvió el chat y se calló otra vez
    expect(quietDue(31 * minute, 6 * minute, 36 * minute, 5)).toBe(true);
  });
});

describe('qué dice ante un activador', () => {
  const random = () => 0;

  it('lee una frase escrita con los datos del evento', () => {
    const plan = planCue({ trigger: 'points', values: { user: 'pau', canje: 'Hidrátate', costo: 300 } }, settings(), { now: 1000, random });
    // La etiqueta de emoción viaja con la frase: es para la voz y para la cara
    expect(plan).toEqual({ ok: true, text: '[feliz] ¡pau canjeó Hidrátate! Así me gusta.' });
  });

  it('calla si está apagada, si el activador está apagado o en espera', () => {
    const cue = { trigger: 'points' as const, values: { user: 'pau' } };
    expect(planCue(cue, settings({ enabled: false }), { now: 1000 })).toEqual({ ok: false, why: 'off' });
    expect(planCue({ trigger: 'quiet', values: {} }, settings(), { now: 1000 })).toEqual({ ok: false, why: 'disabled' });
    expect(planCue(cue, settings(), { now: 5000, lastAt: 1000 })).toEqual({ ok: false, why: 'cooldown' });
    expect(planCue(cue, settings(), { now: 12000, lastAt: 1000, random }).ok).toBe(true);
  });

  it('un cheer pequeño no la despierta', () => {
    expect(planCue({ trigger: 'bits', values: { user: 'mar', bits: 50 } }, settings(), { now: 1 })).toEqual({ ok: false, why: 'small' });
    expect(planCue({ trigger: 'bits', values: { user: 'mar', bits: 100 } }, settings(), { now: 1, random }).ok).toBe(true);
  });

  it('una prueba del panel no mira interruptores ni esperas', () => {
    const off = settings({ enabled: false });
    expect(planCue(SAMPLE_CUES.quiet, off, { now: 2000, lastAt: 1999, random }).ok).toBe(true);
  });

  it('sin frases escritas lo dice', () => {
    const empty = normalizePetsSettings({ triggers: { raid: { on: true, lines: [] } } });
    expect(planCue({ trigger: 'raid', values: { user: 'noa', personas: 5 } }, empty, { now: 1 })).toEqual({ ok: false, why: 'no_lines' });
  });

  it('todas las frases de serie se dicen enteras con los datos de ejemplo', () => {
    (Object.keys(SAMPLE_CUES) as (keyof typeof SAMPLE_CUES)[]).forEach((id) => {
      DEFAULT_PETS_SETTINGS.triggers[id].lines.forEach((line) => {
        const text = fillLine(line, SAMPLE_CUES[id].values, 'Chispa');
        expect(text).not.toMatch(/[{}]/);
        expect(text.length).toBeGreaterThan(5);
      });
    });
  });
});

describe('eventos del canal de Twitch', () => {
  const points = (text: string) => parseTwitchEvent('points', { user: 'Pau', login: 'pau_rl', text, rewardId: 'r1', title: 'Hidrátate', cost: 300 });

  it('un canje sin texto despierta a la mascota', () => {
    const cue = cueFromEvent(points('')!, { skipTextRedemptions: true });
    expect(cue?.trigger).toBe('points');
    expect(cue?.values).toMatchObject({ user: 'Pau', canje: 'Hidrátate', costo: 300 });
    expect(cue?.login).toBe('pau_rl');
  });

  it('un canje con texto ya lo lee la Voz del chat, salvo que el streamer quiera', () => {
    expect(cueFromEvent(points('hola')!, { skipTextRedemptions: true })).toBeNull();
    expect(cueFromEvent(points('hola')!, { skipTextRedemptions: false })?.viewerText).toBe('hola');
  });

  it('los Power-ups de serie y los personalizados; los cheers no (llegan por el chat)', () => {
    const builtin = parseTwitchEvent('bits', { user: 'Dani', type: 'power_up', bits: 30, powerUp: { type: 'celebration' } })!;
    expect(cueFromEvent(builtin, DEFAULT_PETS_SETTINGS)?.values.canje).toBe('Celebración en pantalla');

    const custom = parseTwitchEvent('powerup', { user: 'Dani', id: 'p1', title: 'Baile', bits: 50 })!;
    expect(cueFromEvent(custom, DEFAULT_PETS_SETTINGS)).toMatchObject({ trigger: 'powerup', values: { canje: 'Baile', bits: 50 } });

    const cheer = parseTwitchEvent('bits', { user: 'Mar', type: 'cheer', bits: 500 })!;
    expect(cueFromEvent(cheer, DEFAULT_PETS_SETTINGS)).toBeNull();
    // Un Power-up personalizado llega además como gasto de Bits: ese aviso no cuenta dos veces
    const spend = parseTwitchEvent('bits', { user: 'Dani', type: 'custom_power_up', bits: 50 })!;
    expect(cueFromEvent(spend, DEFAULT_PETS_SETTINGS)).toBeNull();
  });
});

describe('personajes y emociones', () => {
  const kinds = PET_KINDS.map((item) => item.id);
  const emotions: PetEmotion[] = ['neutral', ...PET_EMOTIONS.map((item) => item.id)];

  it('hay cinco personajes de Lalo y los tres primeros conservan su nombre', () => {
    expect(kinds).toEqual(['chispa', 'eco', 'bit', 'miso', 'axo']);
    kinds.forEach((kind) => expect(normalizePetsSettings({ kind }).kind).toBe(kind));
  });

  it('cada personaje tiene ojos y boca en todas las emociones, y nada que se ejecute', () => {
    for (const kind of kinds) {
      const faces = new Set<string>();
      for (const emotion of emotions) {
        const svg = petMarkup(kind, emotion);
        expect(svg).toContain('data-p="face"');
        expect(svg).toContain('class="pt-e"');
        expect(svg).toContain('class="pt-m"');
        expect(svg).not.toMatch(/<script|on\w+=|javascript:|NaN|undefined/i);
        faces.add(petFaceMarkup(kind, emotion));
      }
      // Seis caras distintas
      expect(faces.size).toBe(emotions.length);
    }
  });

  it('la etiqueta de la frase decide la cara, en español o en inglés', () => {
    expect(petEmotionOf('[feliz] ¡Gracias!')).toBe('feliz');
    expect(petEmotionOf('[happy] ¡Gracias!')).toBe('feliz');
    expect(petEmotionOf('[excited] Victoria')).toBe('emocionado');
    expect(petEmotionOf('[triste] Derrota')).toBe('triste');
    expect(petEmotionOf('[enojado] Otra vez')).toBe('enojado');
    expect(petEmotionOf('[sorprendido] ¿Quién llama?')).toBe('sorprendido');
  });

  it('sin etiqueta, o con una sin cara propia, la cara es la neutral', () => {
    expect(petEmotionOf('Hola, chat')).toBe('neutral');
    expect(petEmotionOf('[susurro] no hagáis ruido')).toBe('neutral');
    expect(petEmotionOf('[no existe] hola')).toBe('neutral');
    expect(petEmotionOf('')).toBe('neutral');
  });

  it('todas las frases de serie llevan una emoción que la mascota sabe poner, o ninguna', () => {
    Object.values(DEFAULT_PETS_SETTINGS.triggers).forEach((trigger) => {
      trigger.lines.forEach((line) => {
        if (line.includes('[')) expect(petEmotionOf(line)).not.toBe('neutral');
      });
    });
  });

  it('las imágenes por emoción solo valen con personaje propio y con direcciones de imagen', () => {
    const image = { url: 'https://cdn.example/feliz.png', name: 'feliz.png', mediaId: 'm2' };
    expect(normalizePetsSettings({ emotionImages: { feliz: image } }).emotionImages).toEqual({});
    const own = normalizePetsSettings({
      kind: 'custom',
      idleImage: { url: 'https://cdn.example/a.png', name: 'a.png' },
      emotionImages: { feliz: image, triste: { url: 'javascript:alert(1)' }, aburrido: image },
    });
    expect(own.emotionImages).toEqual({ feliz: image });
  });

  it('las imágenes por emoción guardadas solo en este navegador no viajan por la URL', () => {
    const own = settings({
      kind: 'custom',
      idleImage: { url: 'https://cdn.example/a.png', name: 'a.png', mediaId: 'm1' },
      emotionImages: {
        feliz: { url: 'https://cdn.example/feliz.png', name: 'feliz.png', mediaId: 'm2' },
        triste: { url: 'data:image/png;base64,AAAA', name: 'triste.png', mediaId: '' },
      },
    });
    expect(Object.keys(decodePetsSettings(encodePetsSettings(own))?.emotionImages ?? {})).toEqual(['feliz']);
  });
});

describe('boca al ritmo de la voz', () => {
  it('saca un valor por tramo, normalizado al más fuerte', () => {
    // 4 tramos de 10 muestras: silencio, flojo, fuerte, silencio
    const samples = [...Array(10).fill(0), ...Array(10).fill(0.25), ...Array(10).fill(-0.5), ...Array(10).fill(0)];
    const envelope = volumeEnvelope(samples, 300, 30);
    expect(envelope).toHaveLength(4);
    expect(envelope[0]).toBe(0);
    expect(envelope[1]).toBeCloseTo(0.5);
    expect(envelope[2]).toBe(1);
    expect(envelope[3]).toBe(0);
  });

  it('un audio en silencio o vacío no rompe nada', () => {
    expect(volumeEnvelope(Array(20).fill(0), 300, 30)).toEqual([0, 0]);
    expect(volumeEnvelope([], 300, 30)).toEqual([]);
  });

  it('lee el volumen de un instante y fuera del audio da 0', () => {
    const envelope = [0, 0.5, 1];
    expect(envelopeAt(envelope, 0.04, 30)).toBe(0.5);
    expect(envelopeAt(envelope, 0.09, 30)).toBe(1);
    expect(envelopeAt(envelope, 5, 30)).toBe(0);
    expect(envelopeAt(envelope, -1, 30)).toBe(0);
  });

  it('estima cuánto se tarda en decir una frase, con mínimo y máximo', () => {
    expect(speakSeconds('hola')).toBe(1.8);
    expect(speakSeconds('una frase de diez palabras para ver cuánto tarda hoy')).toBeCloseTo(3.4);
    expect(speakSeconds('palabra '.repeat(200))).toBe(12);
  });
});
