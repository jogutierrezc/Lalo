/**
 * tests/twitchBotSupabase.test.ts
 *
 * Las consultas que arman supabaseBotDb y supabaseChatLines, con un cliente de Supabase FALSO que
 * solo anota qué se le pide. Comprueba la forma de las consultas (columnas del upsert parcial,
 * filtros de borrado); NO prueba nada contra una base real ni contra PostgREST.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
  table: string;
  steps: Array<[string, unknown[]]>;
}

const calls: Call[] = [];
const rpcs: Array<{ fn: string; args: unknown }> = [];
let nextData: unknown = null;

/** Constructor encadenable: cada método anota el paso y devuelve el mismo objeto; al esperarlo, resuelve. */
function builder(table: string) {
  const call: Call = { table, steps: [] };
  calls.push(call);
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (value: unknown) => void) => resolve({ data: nextData, error: null });
        }
        return (...args: unknown[]) => {
          call.steps.push([prop, args]);
          return proxy;
        };
      },
    }
  );
  return proxy;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: unknown) => {
      rpcs.push({ fn, args });
      return { data: 0, error: null };
    },
  }),
}));

import { supabaseBotDb } from '../server/twitch/botDb';
import { supabaseChatLines } from '../server/twitch/botChatLines';

const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const PROFILE = '11111111-1111-1111-1111-111111111111';

const stepsOf = (index: number) => calls[index].steps.map(([name]) => name);

beforeEach(() => {
  calls.length = 0;
  rpcs.length = 0;
  nextData = null;
});

describe('supabaseBotDb: actualizaciones parciales', () => {
  it('saveSettings solo manda las columnas del cambio (más profile_id y updated_at)', async () => {
    nextData = { enabled: false, prefix: '!', welcome_message: '', sender_mode: 'global' };
    const db = supabaseBotDb(env)!;
    await db.saveSettings(PROFILE, { enabled: false });
    const upsert = calls[0].steps.find(([name]) => name === 'upsert')!;
    const row = upsert[1][0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['enabled', 'profile_id', 'updated_at']);
    expect(upsert[1][1]).toEqual({ onConflict: 'profile_id' });
  });

  it('un cambio de prefijo y saludo no toca enabled', async () => {
    nextData = { enabled: true, prefix: '?', welcome_message: 'hola', sender_mode: 'global' };
    const db = supabaseBotDb(env)!;
    const saved = await db.saveSettings(PROFILE, { prefix: '?', welcomeMessage: 'hola' });
    const row = calls[0].steps.find(([name]) => name === 'upsert')![1][0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['prefix', 'profile_id', 'updated_at', 'welcome_message']);
    // Devuelve los ajustes completos, leídos de la base
    expect(saved).toEqual({ enabled: true, prefix: '?', welcomeMessage: 'hola', senderMode: 'global' });
  });

  it('un prefijo inválido no llega a la base', async () => {
    const db = supabaseBotDb(env)!;
    await expect(db.saveSettings(PROFILE, { prefix: 'a b' })).rejects.toMatchObject({ code: 'prefix' });
    expect(calls).toHaveLength(0);
  });

  it('deleteCommand con un id que no es UUID no pregunta a la base', async () => {
    const db = supabaseBotDb(env)!;
    expect(await db.deleteCommand(PROFILE, 'no-uuid')).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('takeCooldown llama a la función SQL atómica', async () => {
    const db = supabaseBotDb(env)!;
    expect(await db.takeCooldown(PROFILE, 'Ana', 'cmd:redes', 5)).toEqual({ ok: true });
    expect(rpcs[0]).toEqual({ fn: 'take_twitch_bot_cooldown', args: { p_profile_id: PROFILE, p_viewer: 'ana', p_key: 'cmd:redes', p_seconds: 5 } });
  });
});

describe('supabaseChatLines.clear', () => {
  it('sin maxId borra todo lo del perfil', async () => {
    await supabaseChatLines(env)!.clear(PROFILE);
    expect(stepsOf(0)).toEqual(['delete', 'eq']);
  });

  it('con maxId borra solo hasta ese id', async () => {
    await supabaseChatLines(env)!.clear(PROFILE, 42);
    expect(calls[0].steps).toEqual([
      ['delete', []],
      ['eq', ['profile_id', PROFILE]],
      ['lte', ['id', 42]],
    ]);
  });

  it('con keepPendingComments conserva spont=true y spont_used=false', async () => {
    await supabaseChatLines(env)!.clear(PROFILE, 42, { keepPendingComments: true });
    expect(calls[0].steps.at(-1)).toEqual(['or', ['spont.eq.false,spont_used.eq.true']]);
    expect(stepsOf(0)).toContain('lte');
  });

  it('keepPendingComments sin maxId se ignora: desconectar borra todo', async () => {
    await supabaseChatLines(env)!.clear(PROFILE, undefined, { keepPendingComments: true });
    expect(stepsOf(0)).toEqual(['delete', 'eq']);
  });
});
