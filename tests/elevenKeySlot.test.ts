/**
 * tests/elevenKeySlot.test.ts
 *
 * Las dos claves de ElevenLabs (ELEVENLABS_API_KEY y ELEVENLABS_API_KEY_2) y el
 * slot activo que elige el administrador en el panel. La nube de estas pruebas
 * es un app_settings de mentira que solo sabe leer un valor.
 */

import { describe, expect, it } from 'vitest';
import {
  elevenActiveKey,
  elevenActiveSlot,
  elevenAnyKey,
  elevenKeySlot,
  elevenSynthesize,
  isElevenVoiceId,
  type ElevenKeySlot,
} from '../server/elevenlabs';

type Env = Record<string, string | undefined>;

const ENV_BOTH: Env = { ELEVENLABS_API_KEY: 'k1', ELEVENLABS_API_KEY_2: 'k2' };

/** app_settings de mentira: devuelve `value` para la clave del slot activo. */
function slotDb(value: string | null, fail = false) {
  return {
    from: (table: string) => {
      if (table !== 'app_settings') throw new Error(`tabla inesperada: ${table}`);
      return {
        select: (cols: string) => {
          if (cols !== 'value') throw new Error(`columnas inesperadas: ${cols}`);
          return {
            eq: (col: string, val: string) => {
              if (col !== 'key' || val !== 'elevenlabs_active_key') throw new Error('consulta inesperada');
              return {
                maybeSingle: async () => {
                  if (fail) throw new Error('nube caída');
                  return { data: value === null ? null : { value } };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe('elevenKeySlot', () => {
  it('lee cada variable y limpia comillas y espacios', () => {
    expect(elevenKeySlot({ ELEVENLABS_API_KEY: ' "k1" ' } as Env, 1)).toBe('k1');
    expect(elevenKeySlot({ ELEVENLABS_API_KEY_2: " 'k2' " } as Env, 2)).toBe('k2');
  });

  it('un slot sin variable da cadena vacía, nunca undefined', () => {
    expect(elevenKeySlot({}, 1)).toBe('');
    expect(elevenKeySlot({}, 2)).toBe('');
  });

  it('elevenAnyKey solo es verdadera si hay alguna clave', () => {
    expect(elevenAnyKey(ENV_BOTH)).toBe(true);
    expect(elevenAnyKey({ ELEVENLABS_API_KEY_2: 'k2' } as Env)).toBe(true);
    expect(elevenAnyKey({} as Env)).toBe(false);
  });
});

describe('elevenActiveSlot', () => {
  it('sin Supabase configurado se queda en el slot 1', async () => {
    expect(await elevenActiveSlot({} as Env)).toBe(1);
  });

  it('lee el ajuste del panel desde app_settings', async () => {
    expect(await elevenActiveSlot(ENV_BOTH, slotDb('2'))).toBe(2);
    expect(await elevenActiveSlot(ENV_BOTH, slotDb('1'))).toBe(1);
  });

  it('cualquier valor raro o fila ausente cae en el slot 1', async () => {
    expect(await elevenActiveSlot(ENV_BOTH, slotDb(null))).toBe(1);
    expect(await elevenActiveSlot(ENV_BOTH, slotDb('3'))).toBe(1);
    expect(await elevenActiveSlot(ENV_BOTH, slotDb('', true))).toBe(1);
  });
});

describe('elevenActiveKey', () => {
  it('usa la clave del slot activo', async () => {
    expect(await elevenActiveKey(ENV_BOTH, slotDb('2'))).toEqual({ key: 'k2', slot: 2 });
    expect(await elevenActiveKey(ENV_BOTH, slotDb('1'))).toEqual({ key: 'k1', slot: 1 });
  });

  it('si la clave activa falta en el entorno, usa la otra que exista', async () => {
    const env: Env = { ELEVENLABS_API_KEY: 'k1' };
    const chosen = await elevenActiveKey(env, slotDb('2'));
    expect(chosen).toEqual({ key: 'k1', slot: 1 });
  });

  it('sin ninguna clave devuelve cadena vacía y el slot queda como estaba', async () => {
    const chosen = await elevenActiveKey({} as Env, slotDb('2'));
    expect(chosen).toEqual({ key: '', slot: 2 });
  });
});

describe('elevenSynthesize con slot activo', () => {
  it('envía la cabecera xi-api-key de la clave activa', async () => {
    const seen: { key: string; body: unknown }[] = [];
    const buffer = await elevenSynthesize('hola [happy]', 'AbCdEfGhIjKl', ENV_BOTH, (async (url: unknown, init: unknown) => {
      const request = init as { headers: Record<string, string>; body: string };
      seen.push({ key: request.headers['xi-api-key'], body: JSON.parse(request.body) });
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) } as unknown as Response;
    }) as typeof fetch);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(seen).toHaveLength(1);
    // Sin Supabase en el entorno de prueba, el slot activo es el 1
    expect(seen[0]?.key).toBe('k1');
    expect(seen[0]?.body).toEqual({ text: 'hola [happy]', model_id: 'eleven_v3' });
  });

  it('sin ninguna clave configurada el error nombra las dos variables', async () => {
    await expect(elevenSynthesize('hola', 'AbCdEfGhIjKl', {} as Env)).rejects.toThrow(/ELEVENLABS_API_KEY_2/);
  });

  it('sigue rechazando ids de voz que no tienen la forma esperada', () => {
    expect(isElevenVoiceId('AbCdEfGhIjKl')).toBe(true);
    expect(isElevenVoiceId('no-válido')).toBe(false);
  });
});
