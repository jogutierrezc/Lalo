/**
 * tests/twitchBotDb.test.ts
 *
 * Capa de datos del bot de Twitch en la nube: nombres de comando normalizados,
 * duplicados, permisos inválidos, aislamiento entre streamers y cooldown atómico.
 * La base es una memoria que sigue el contrato de BotDb y de la migración 0039;
 * la validación es la real (validateBotCommand).
 */

import { describe, expect, it } from 'vitest';
import {
  BotDbError,
  BOT_POSITION_MAX,
  DEFAULT_BOT_SETTINGS,
  isUuid,
  validateBotCommand,
  validPrefix,
  type BotCommand,
  type BotDb,
  type BotSettings,
} from '../server/twitch/botDb';

function memoryDb(now: () => number = Date.now): BotDb {
  const settings = new Map<string, BotSettings>();
  const commands = new Map<string, Array<BotCommand & { owner: string }>>();
  const cooldowns = new Map<string, number>();
  let seq = 0;

  const list = (owner: string) => commands.get(owner) ?? [];

  return {
    async settings(p) { return settings.get(p) ?? null; },
    async saveSettings(p, patch) {
      if (patch.prefix !== undefined && !validPrefix(patch.prefix)) throw new BotDbError('prefix');
      const next = { ...DEFAULT_BOT_SETTINGS, ...settings.get(p), ...patch };
      settings.set(p, next);
      return { ...next };
    },
    async commands(p) {
      return list(p)
        .map(({ owner: _owner, ...c }) => c)
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    },
    async saveCommand(p, input, prefix) {
      const w = validateBotCommand(input, prefix);
      const rows = list(p);
      if (rows.some((r) => r.name === w.name && r.id !== w.id)) throw new BotDbError('duplicate');
      if (w.id) {
        const row = rows.find((r) => r.id === w.id);
        if (!row) throw new BotDbError('not_found');
        Object.assign(row, { name: w.name, response: w.response, permission: w.permission, enabled: w.enabled, position: w.position });
        const { owner: _owner, ...c } = row;
        return c;
      }
      const row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, owner: p, name: w.name, response: w.response, permission: w.permission, enabled: w.enabled, position: w.position };
      commands.set(p, [...rows, row]);
      const { owner: _owner, ...c } = row;
      return c;
    },
    async deleteCommand(p, id) {
      if (!isUuid(id)) return false;
      const rows = list(p);
      const next = rows.filter((r) => r.id !== id);
      commands.set(p, next);
      return next.length !== rows.length;
    },
    async takeCooldown(p, viewer, key, seconds) {
      const k = `${p}|${viewer.toLowerCase()}|${key}`;
      const until = cooldowns.get(k) ?? 0;
      if (until > now()) return { ok: false, waitSeconds: Math.max(1, Math.ceil((until - now()) / 1000)) };
      cooldowns.set(k, now() + seconds * 1000);
      return { ok: true };
    },
  };
}

describe('nombres de comando', () => {
  it('se normalizan: minúsculas, sin prefijo ni espacios', () => {
    expect(validateBotCommand({ name: '  !Redes Sociales ', response: 'hola' }).name).toBe('redessociales');
    expect(validateBotCommand({ name: '!!Hola', response: 'x' }).name).toBe('hola');
    expect(validateBotCommand({ name: '?Ayuda', response: 'x' }, '?').name).toBe('ayuda');
  });

  it('un nombre vacío tras limpiar se rechaza', () => {
    expect(() => validateBotCommand({ name: ' ! ', response: 'x' })).toThrow(BotDbError);
    expect(() => validateBotCommand({ name: '', response: 'x' })).toThrowError('bot: name');
  });

  it('un nombre demasiado largo se rechaza', () => {
    expect(() => validateBotCommand({ name: 'a'.repeat(51), response: 'x' })).toThrowError('bot: name');
  });

  it('la respuesta no puede estar vacía ni pasar de 500', () => {
    expect(() => validateBotCommand({ name: 'a', response: '   ' })).toThrowError('bot: response');
    expect(() => validateBotCommand({ name: 'a', response: 'x'.repeat(501) })).toThrowError('bot: response');
    expect(validateBotCommand({ name: 'a', response: 'x'.repeat(500) }).response).toHaveLength(500);
  });

  it('el guardado deja el nombre limpio', async () => {
    const db = memoryDb();
    const saved = await db.saveCommand('s1', { name: '!Redes', response: 'mis redes' });
    expect(saved.name).toBe('redes');
    expect((await db.commands('s1')).map((c) => c.name)).toEqual(['redes']);
  });
});

describe('id y posición', () => {
  it('un id que no es UUID se rechaza antes de tocar la base', () => {
    expect(() => validateBotCommand({ id: 'c1', name: 'a', response: 'x' })).toThrowError('bot: id');
    expect(() => validateBotCommand({ id: '1 or 1=1', name: 'a', response: 'x' })).toThrowError('bot: id');
    expect(validateBotCommand({ id: '123e4567-e89b-42d3-a456-426614174000', name: 'a', response: 'x' }).id).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(validateBotCommand({ name: 'a', response: 'x' }).id).toBeUndefined();
  });

  it('isUuid', () => {
    expect(isUuid('123E4567-E89B-42D3-A456-426614174000')).toBe(true);
    expect(isUuid('123e4567e89b42d3a456426614174000')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  it('la posición se acota a ±1e6 (la columna es integer) y lo que no es un número vale 0', () => {
    expect(BOT_POSITION_MAX).toBe(1_000_000);
    expect(validateBotCommand({ name: 'a', response: 'x', position: 5e9 }).position).toBe(1_000_000);
    expect(validateBotCommand({ name: 'a', response: 'x', position: -5e9 }).position).toBe(-1_000_000);
    expect(validateBotCommand({ name: 'a', response: 'x', position: 12.9 }).position).toBe(12);
    expect(validateBotCommand({ name: 'a', response: 'x', position: Infinity }).position).toBe(0);
    expect(validateBotCommand({ name: 'a', response: 'x', position: NaN }).position).toBe(0);
  });
});

describe('permisos', () => {
  it('acepta los cuatro y usa all por defecto', () => {
    for (const permission of ['all', 'sub', 'mod', 'broadcaster']) {
      expect(validateBotCommand({ name: 'a', response: 'x', permission }).permission).toBe(permission);
    }
    expect(validateBotCommand({ name: 'a', response: 'x' }).permission).toBe('all');
  });

  it('rechaza uno inválido en lugar de abrirlo a todos', async () => {
    expect(() => validateBotCommand({ name: 'a', response: 'x', permission: 'vip' })).toThrowError('bot: permission');
    await expect(memoryDb().saveCommand('s1', { name: 'a', response: 'x', permission: 'admin' })).rejects.toMatchObject({ code: 'permission' });
  });
});

describe('duplicados', () => {
  it('dos nombres que limpian igual chocan dentro del mismo streamer', async () => {
    const db = memoryDb();
    await db.saveCommand('s1', { name: 'redes', response: 'a' });
    await expect(db.saveCommand('s1', { name: '!REDES', response: 'b' })).rejects.toMatchObject({ code: 'duplicate' });
    expect(await db.commands('s1')).toHaveLength(1);
  });

  it('cambiar un comando sin renombrarlo no es un duplicado, y renombrarlo a otro existente sí', async () => {
    const db = memoryDb();
    const a = await db.saveCommand('s1', { name: 'a', response: '1' });
    await db.saveCommand('s1', { name: 'b', response: '2' });
    const changed = await db.saveCommand('s1', { id: a.id, name: 'a', response: 'nuevo', enabled: false });
    expect(changed).toMatchObject({ name: 'a', response: 'nuevo', enabled: false });
    await expect(db.saveCommand('s1', { id: a.id, name: 'b', response: '1' })).rejects.toMatchObject({ code: 'duplicate' });
  });

  it('el mismo nombre en dos streamers distintos es válido', async () => {
    const db = memoryDb();
    await db.saveCommand('s1', { name: 'redes', response: 'a' });
    await expect(db.saveCommand('s2', { name: 'redes', response: 'b' })).resolves.toMatchObject({ name: 'redes' });
  });
});

describe('aislamiento entre streamers', () => {
  it('cada uno lee solo sus comandos y ajustes', async () => {
    const db = memoryDb();
    await db.saveCommand('s1', { name: 'uno', response: 'a' });
    await db.saveCommand('s2', { name: 'dos', response: 'b' });
    await db.saveSettings('s1', { ...DEFAULT_BOT_SETTINGS, enabled: true, prefix: '?' });
    expect((await db.commands('s1')).map((c) => c.name)).toEqual(['uno']);
    expect((await db.commands('s2')).map((c) => c.name)).toEqual(['dos']);
    expect(await db.settings('s1')).toMatchObject({ enabled: true, prefix: '?' });
    expect(await db.settings('s2')).toBeNull();
  });

  it('no se puede cambiar ni borrar el comando de otro conociendo su id', async () => {
    const db = memoryDb();
    const mine = await db.saveCommand('s1', { name: 'uno', response: 'a' });
    await expect(db.saveCommand('s2', { id: mine.id, name: 'uno', response: 'robado' })).rejects.toMatchObject({ code: 'not_found' });
    expect(await db.deleteCommand('s2', mine.id)).toBe(false);
    expect((await db.commands('s1'))[0]?.response).toBe('a');
    expect(await db.deleteCommand('s1', mine.id)).toBe(true);
  });

  it('los cooldowns tampoco se mezclan', async () => {
    const db = memoryDb();
    expect(await db.takeCooldown('s1', 'ana', 'redes', 30)).toEqual({ ok: true });
    expect(await db.takeCooldown('s2', 'ana', 'redes', 30)).toEqual({ ok: true });
  });
});

describe('ajustes', () => {
  it('rechaza un prefijo vacío, largo o con espacios', async () => {
    const db = memoryDb();
    for (const prefix of ['', ' ', 'a b', '123456']) {
      await expect(db.saveSettings('s1', { prefix })).rejects.toMatchObject({ code: 'prefix' });
    }
    expect(DEFAULT_BOT_SETTINGS).toMatchObject({ prefix: '!', senderMode: 'streamer', enabled: false });
  });
});

describe('cooldown atómico', () => {
  it('el primero pasa y el segundo recibe los segundos que faltan', async () => {
    let t = 1_000_000;
    const db = memoryDb(() => t);
    expect(await db.takeCooldown('s1', 'ana', 'redes', 30)).toEqual({ ok: true });
    t += 10_000;
    expect(await db.takeCooldown('s1', 'ana', 'redes', 30)).toEqual({ ok: false, waitSeconds: 20 });
    t += 20_000;
    expect(await db.takeCooldown('s1', 'ana', 'redes', 30)).toEqual({ ok: true });
  });

  it('dos avisos a la vez: solo uno pasa', async () => {
    const db = memoryDb();
    const results = await Promise.all([
      db.takeCooldown('s1', 'ana', 'redes', 30),
      db.takeCooldown('s1', 'ana', 'redes', 30),
      db.takeCooldown('s1', 'ANA', 'redes', 30),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('un intento rechazado no alarga la espera', async () => {
    let t = 0;
    const db = memoryDb(() => t);
    await db.takeCooldown('s1', 'ana', 'k', 30);
    t += 5_000;
    await db.takeCooldown('s1', 'ana', 'k', 30);
    t += 5_000;
    expect(await db.takeCooldown('s1', 'ana', 'k', 30)).toEqual({ ok: false, waitSeconds: 20 });
  });

  it('claves y espectadores distintos son independientes', async () => {
    const db = memoryDb();
    await db.takeCooldown('s1', 'ana', 'redes', 30);
    expect(await db.takeCooldown('s1', 'ana', 'discord', 30)).toEqual({ ok: true });
    expect(await db.takeCooldown('s1', 'luis', 'redes', 30)).toEqual({ ok: true });
  });
});
