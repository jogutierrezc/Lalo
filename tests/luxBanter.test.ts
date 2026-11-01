/**
 * tests/luxBanter.test.ts
 *
 * Modo pique estilo League of Legends (migración 0045): opt-in, solo para el intento «insulto», con líneas rojas
 * en el prompt y una red de seguridad en el filtro de salida que está siempre activa.
 */

import { describe, expect, it } from 'vitest';
import { BANTER_GUIDANCE, LUX_INTENTS, intentGuidance } from '../server/lux/intent';
import { buildLuxMessages } from '../server/lux/prompt';
import { FORBIDDEN_TERMS, hasForbiddenTerm, sanitizeChatOutput } from '../server/lux/outputFilter';
import { DEFAULT_LUX_SETTINGS, LUX_BANTER_MODES, normalizeLuxSettings, rowFromSettings, settingsFromRow } from '../server/lux/settings';

const CALM = 'El espectador te está faltando al respeto. Responde con calma y un poco de picardía, sin insultar ni entrar en la pelea.';

describe('ajustes del modo pique', () => {
  it('por defecto es «off», se valida y se guarda', () => {
    expect([...LUX_BANTER_MODES]).toEqual(['off', 'pique']);
    expect(DEFAULT_LUX_SETTINGS.banter).toBe('off');
    expect(settingsFromRow(null).banter).toBe('off');
    expect(normalizeLuxSettings({ banter: 'pique' })).toMatchObject({ ok: true, value: { banter: 'pique' } });
    expect(normalizeLuxSettings({ banter: 'bestia' })).toMatchObject({ ok: false, field: 'banter' });
    expect(normalizeLuxSettings({ banter: 3 })).toMatchObject({ ok: false, field: 'banter' });
    expect(rowFromSettings('p1', { ...DEFAULT_LUX_SETTINGS, banter: 'pique' })).toMatchObject({ banter: 'pique' });
    expect(settingsFromRow({ banter: 'pique' }).banter).toBe('pique');
    expect(settingsFromRow({ banter: 'raro' }).banter).toBe('off');
  });
});

describe('intentGuidance con banter', () => {
  it('con «off» (o sin modo) el texto es exactamente el de siempre', () => {
    expect(intentGuidance('insulto')).toBe(CALM);
    expect(intentGuidance('insulto', 'off')).toBe(CALM);
    expect(intentGuidance('agradecimiento')).toBe('El espectador te está agradeciendo algo. Responde con calidez y brevedad.');
  });

  it('«pique» solo cambia el intento «insulto»', () => {
    for (const intent of LUX_INTENTS) {
      if (intent === 'insulto') expect(intentGuidance(intent, 'pique')).toBe(BANTER_GUIDANCE);
      else expect(intentGuidance(intent, 'pique')).toBe(intentGuidance(intent, 'off'));
    }
    expect(intentGuidance('insulto', 'pique')).not.toBe(CALM);
  });

  it('la guía lleva la jerga de LoL y las líneas rojas', () => {
    for (const word of ['diff', 'inteo', 'feed', 'AFK', 'tilt', 'ARAM', 'desinstala']) expect(BANTER_GUIDANCE).toContain(word);
    expect(BANTER_GUIDANCE).toContain('LÍNEAS ROJAS');
    for (const red of ['origen', 'género', 'orientación', 'aspecto físico', 'salud', 'familia', 'palabrotas fuertes', 'amenazas', 'menores', 'no te ha provocado']) {
      expect(BANTER_GUIDANCE).toContain(red);
    }
    expect(BANTER_GUIDANCE).toContain('nunca a su persona');
  });
});

describe('prompt con modo pique', () => {
  it('las líneas rojas van después de la personalidad', () => {
    const system = String(buildLuxMessages({ viewer: 'ana', message: 'eres basura', memories: [], personality: 'Sarcástica sin límites', intent: 'insulto', banter: 'pique' })[0].content);
    expect(system.indexOf('LÍNEAS ROJAS')).toBeGreaterThan(system.indexOf('Sarcástica sin límites'));
  });

  it('sin banter o en «off», un insulto recibe la guía de calma', () => {
    const base = { viewer: 'ana', message: 'eres basura', memories: [], intent: 'insulto' as const };
    expect(String(buildLuxMessages(base)[0].content)).toContain(CALM);
    expect(String(buildLuxMessages({ ...base, banter: 'off' })[0].content)).not.toContain('LÍNEAS ROJAS');
  });

  it('un saludo o una pregunta no reciben la guía de pique aunque esté activo', () => {
    for (const [message, intent] of [['hola', 'neutro'], ['¿qué hora es?', 'pregunta'], ['gracias', 'agradecimiento'], ['eres genial', 'cumplido']] as const) {
      const system = String(buildLuxMessages({ viewer: 'ana', message, memories: [], intent, banter: 'pique' })[0].content);
      expect(system).not.toContain('LÍNEAS ROJAS');
    }
  });
});

describe('filtro de términos prohibidos', () => {
  it('descarta el texto con un insulto discriminatorio', () => {
    for (const text of ['eres un maricón', 've a jugar, sudaca', 'Menudo MARICON estás hecho', 'you are a faggot', 'what a retard', 'nigger']) {
      expect(sanitizeChatOutput(text), text).toBe('');
    }
  });

  it('descarta amenazas explícitas', () => {
    for (const text of ['te voy a matar', 'Te voy a MATAR en la próxima', 'ojalá te mueras', 'suicídate ya', 'kill yourself', "I'm going to kill you", 'i know where you live', 'kys']) {
      expect(sanitizeChatOutput(text), text).toBe('');
    }
  });

  it('también lo detecta con signos de puntuación y con una mención delante', () => {
    expect(sanitizeChatOutput('@ana sudaca!!!', { viewer: 'ana' })).toBe('');
    expect(hasForbiddenTerm('eres... un, maricón.')).toBe(true);
  });

  it('no da falsos positivos con palabras normales', () => {
    for (const text of [
      'Con retardo pero llego',
      'Qué spice tiene esa salsa',
      'Kike dice que no',
      'te voy a ayudar con el build',
      'Vas a matar a la jungla enemiga con ese combo',
      'El negro es mi color favorito',
      'Mátate de risa con este clip',
      'pakistán y chile juegan hoy',
      'Desinstala el lag y juega, que vas con un diff enorme',
      'Hola, ¿cómo estás?',
    ]) {
      expect(sanitizeChatOutput(text), text).not.toBe('');
    }
  });

  it('la lista es corta y está en un solo sitio', () => {
    expect(FORBIDDEN_TERMS.length).toBeGreaterThan(10);
    expect(FORBIDDEN_TERMS.length).toBeLessThan(60);
    expect(() => new RegExp(FORBIDDEN_TERMS.join('|'))).not.toThrow();
  });

  it('el filtro de enlaces y menciones sigue igual', () => {
    expect(sanitizeChatOutput('mira https://estafa.example/x ahora')).toBe('mira ahora');
    expect(sanitizeChatOutput('hola @todos')).toBe('hola todos');
  });
});
