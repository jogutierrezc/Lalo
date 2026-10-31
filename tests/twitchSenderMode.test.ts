/**
 * tests/twitchSenderMode.test.ts
 *
 * Quién escribe en el chat de un canal (cuenta Lalo o el propio streamer) y el antieco del modo streamer.
 * Piezas puras y una base de cooldowns falsa; nada probado contra Twitch ni Supabase reales.
 */

import { describe, expect, it } from 'vitest';
import {
  ECHO_SECONDS,
  STREAMER_SCOPES,
  echoKey,
  echoMarkerFor,
  globalBotId,
  isBotEcho,
  isFromSender,
  markBotText,
  senderIdFor,
} from '../server/twitch/senderMode';
import type { BotDb } from '../server/twitch/botDb';

const env = { TWITCH_BOT_USER_ID: '999' };

/** Cooldowns en memoria con el mismo contrato que take_twitch_bot_cooldown. */
function cooldowns() {
  let clock = 0;
  const until = new Map<string, number>();
  const db = {
    async takeCooldown(profile: string, viewer: string, key: string, seconds: number) {
      const k = `${profile}|${viewer}|${key}`;
      const at = until.get(k) ?? 0;
      if (at > clock) return { ok: false as const, waitSeconds: at - clock };
      until.set(k, clock + seconds);
      return { ok: true as const };
    },
  } as unknown as BotDb;
  return { db, tick: (s: number) => (clock += s) };
}

describe('senderIdFor', () => {
  it('modo streamer: el id del propio canal, aunque no haya cuenta Lalo', () => {
    expect(senderIdFor({ senderMode: 'streamer' }, '100', env)).toBe('100');
    expect(senderIdFor({ senderMode: 'streamer' }, '100', {})).toBe('100');
  });

  it('modo global: TWITCH_BOT_USER_ID; sin ella o mal escrita, vacío', () => {
    expect(senderIdFor({ senderMode: 'global' }, '100', env)).toBe('999');
    expect(senderIdFor({ senderMode: 'global' }, '100', { TWITCH_BOT_USER_ID: ' 999 ' })).toBe('999');
    expect(senderIdFor({ senderMode: 'global' }, '100', {})).toBe('');
    expect(senderIdFor({ senderMode: 'global' }, '100', { TWITCH_BOT_USER_ID: 'lalo_bot' })).toBe('');
  });

  it('un canal que no es un id de Twitch no tiene emisor en modo streamer', () => {
    expect(senderIdFor({ senderMode: 'streamer' }, '', env)).toBe('');
    expect(senderIdFor({ senderMode: 'streamer' }, 'canal', env)).toBe('');
  });

  it('sin ajustes cae en el modo global (el de siempre)', () => {
    expect(senderIdFor(null, '100', env)).toBe('999');
  });

  it('globalBotId e isFromSender', () => {
    expect(globalBotId(env)).toBe('999');
    expect(isFromSender({ chatterId: '100' }, '100')).toBe(true);
    expect(isFromSender({ chatterId: '100' }, '')).toBe(false);
    expect(isFromSender({ chatterId: '101' }, '100')).toBe(false);
  });

  it('los tres permisos del modo streamer', () => {
    expect([...STREAMER_SCOPES]).toEqual(['user:read:chat', 'user:write:chat', 'user:bot']);
  });
});

describe('antieco del modo streamer', () => {
  it('la clave no depende de mayúsculas ni de espacios repetidos', () => {
    expect(echoKey('Hola   mundo')).toBe(echoKey(' hola mundo '));
    expect(echoKey('hola')).not.toBe(echoKey('adiós'));
    expect(echoKey('x'.repeat(500)).length).toBeLessThanOrEqual(60);
  });

  it('un texto anotado se reconoce como eco, las veces que llegue, durante ECHO_SECONDS', async () => {
    const { db, tick } = cooldowns();
    await markBotText(db, 'p1', '!redes aquí');
    expect(await isBotEcho(db, 'p1', { text: '!redes   AQUÍ' })).toBe(true);
    expect(await isBotEcho(db, 'p1', { text: '!redes aquí' })).toBe(true);
    tick(ECHO_SECONDS + 1);
    expect(await isBotEcho(db, 'p1', { text: '!redes aquí' })).toBe(false);
  });

  it('un mensaje que el bot no envió no es eco, y mirarlo no lo marca', async () => {
    const { db } = cooldowns();
    expect(await isBotEcho(db, 'p1', { text: 'hola' })).toBe(false);
    expect(await isBotEcho(db, 'p1', { text: 'hola' })).toBe(false);
  });

  it('las marcas son por perfil', async () => {
    const { db } = cooldowns();
    await markBotText(db, 'p1', 'hola');
    expect(await isBotEcho(db, 'p2', { text: 'hola' })).toBe(false);
  });

  it('echoMarkerFor: solo en modo streamer; sin base lanza (el envío no sale)', async () => {
    const { db } = cooldowns();
    expect(echoMarkerFor('global', db, 'p1')).toBeUndefined();
    const marker = echoMarkerFor('streamer', db, 'p1');
    await marker!('hola');
    expect(await isBotEcho(db, 'p1', { text: 'hola' })).toBe(true);
    await expect(echoMarkerFor('streamer', null, 'p1')!('hola')).rejects.toThrow();
  });
});
