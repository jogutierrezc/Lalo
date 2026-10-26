/**
 * tests/botCloud.test.ts
 *
 * Lógica pura de la tarjeta «Bot en la nube»: estados de los tres pasos e
 * importación única de los comandos que el streamer tenía en el navegador.
 */

import { describe, expect, it } from 'vitest';
import { botErrorMessage, botSteps, importClaim, importFinished, importNotice, IMPORT_MAX, isImportFailure, isUuid, planCommandImport, reinsertRow, serverId } from '../src/utils/botCloud';
import type { BotConnectionView } from '../src/lib/botApi';
import type { TwitchIOCommand } from '../src/types/twitchio';

const cmd = (patch: Partial<TwitchIOCommand>): TwitchIOCommand => ({
  id: 'x',
  name: 'redes',
  response: 'Sígueme',
  permission: 'all',
  cooldown: 5,
  enabled: true,
  category: 'stream',
  ...patch,
});

const conn = (patch: Partial<BotConnectionView> = {}): BotConnectionView => ({ hasChannel: true, twitchLogin: 'ana', chat: 'missing', enabled: false, ...patch });

describe('botSteps', () => {
  it('sin leer la conexión todo está en espera', () => {
    expect(Object.values(botSteps(null)).map((s) => s.state)).toEqual(['waiting', 'waiting', 'waiting']);
  });

  it('cuenta sin canal: el paso 1 falta y los demás esperan', () => {
    const steps = botSteps(conn({ hasChannel: false }));
    expect(steps.account.state).toBe('todo');
    expect(steps.permission).toEqual({ state: 'waiting', label: 'Pendiente del paso 1' });
    expect(steps.active.state).toBe('waiting');
  });

  it('canal sin permiso: toca conectar y el paso 3 espera al 2', () => {
    const steps = botSteps(conn());
    expect(steps.account.state).toBe('done');
    expect(steps.permission).toEqual({ state: 'todo', label: 'Conectar el bot' });
    expect(steps.active).toEqual({ state: 'waiting', label: 'Pendiente del paso 2' });
  });

  it('un fallo al consultar el chat deja el paso 2 por hacer', () => {
    expect(botSteps(conn({ chat: 'error' })).permission.state).toBe('todo');
  });

  it('sin la escucha del chat conectada en el servidor, el paso 2 no está disponible', () => {
    const steps = botSteps(conn({ chat: 'unavailable', enabled: true }));
    expect(steps.permission.state).toBe('unavailable');
    expect(steps.active.state).toBe('waiting');
  });

  it('permiso dado pero bot apagado: el paso 3 se puede encender', () => {
    const steps = botSteps(conn({ chat: 'enabled' }));
    expect(steps.permission.state).toBe('done');
    expect(steps.active).toEqual({ state: 'todo', label: 'Apagado' });
  });

  it('encendido con Twitch verificando: en espera; con la suscripción viva: activo', () => {
    expect(botSteps(conn({ chat: 'pending', enabled: true })).active).toEqual({ state: 'waiting', label: 'Twitch lo está comprobando' });
    expect(botSteps(conn({ chat: 'enabled', enabled: true })).active).toEqual({ state: 'done', label: 'Activo' });
  });
});

describe('planCommandImport', () => {
  it('lleva nombre limpio, respuesta, permiso, interruptor y orden', () => {
    const plan = planCommandImport([cmd({ name: '!Redes', response: '  Hola  ', permission: 'mod', enabled: false }), cmd({ name: 'lux', response: 'IA' })], '!');
    expect(plan.skipped).toBe(0);
    expect(plan.commands).toEqual([
      { name: 'redes', response: 'Hola', permission: 'mod', enabled: false, position: 0 },
      { name: 'lux', response: 'IA', permission: 'all', enabled: true, position: 1 },
    ]);
  });

  it('descarta los vacíos, los repetidos y los que ya están en el servidor, y los cuenta', () => {
    const plan = planCommandImport(
      [cmd({ name: '' }), cmd({ response: '   ' }), cmd({ name: 'a' }), cmd({ name: 'A' }), cmd({ name: 'b' }), cmd({ name: 'x'.repeat(60) })],
      '!',
      ['B']
    );
    expect(plan.commands.map((c) => c.name)).toEqual(['a']);
    expect(plan.skipped).toBe(5);
  });

  it('un permiso desconocido pasa a «all» y una respuesta demasiado larga se descarta', () => {
    const plan = planCommandImport([cmd({ name: 'a', permission: 'vip' as never }), cmd({ name: 'b', response: 'x'.repeat(501) })], '!');
    expect(plan.commands).toEqual([{ name: 'a', response: 'Sígueme', permission: 'all', enabled: true, position: 0 }]);
    expect(plan.skipped).toBe(1);
  });

  it('no pasa del tope del servidor', () => {
    const many = Array.from({ length: IMPORT_MAX + 5 }, (_, i) => cmd({ name: `c${i}` }));
    const plan = planCommandImport(many, '!');
    expect(plan.commands).toHaveLength(IMPORT_MAX);
    expect(plan.skipped).toBe(5);
  });

  it('con otro prefijo, limpia el nombre con él', () => {
    expect(planCommandImport([cmd({ name: '?hola' })], '?').commands[0].name).toBe('hola');
  });
});

describe('importNotice', () => {
  it('no dice nada si no se importó nada', () => {
    expect(importNotice(0, 3)).toBe('');
  });
  it('singular, plural y los que quedaron fuera', () => {
    expect(importNotice(1, 0)).toContain('el comando');
    expect(importNotice(4, 0)).toContain('los 4 comandos');
    expect(importNotice(4, 1)).toContain('Uno quedó fuera');
    expect(importNotice(4, 2)).toContain('2 quedaron fuera');
  });
});

describe('ids del servidor', () => {
  it('solo un UUID cuenta como id del servidor; uno local debe crear', () => {
    expect(isUuid('3f2b8c1e-5d4a-4e6b-9a7c-1b2d3e4f5a6b')).toBe(true);
    expect(isUuid('new-1700000000-1')).toBe(false);
    expect(isUuid('cmd-123')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(serverId('cmd-123')).toBeNull();
    expect(serverId('3f2b8c1e-5d4a-4e6b-9a7c-1b2d3e4f5a6b')).toBe('3f2b8c1e-5d4a-4e6b-9a7c-1b2d3e4f5a6b');
  });
});

describe('bandera de importación', () => {
  it('sin bandera se puede importar; la propia, la de otra cuenta y la antigua «1» no', () => {
    expect(importClaim(null, 'a')).toBe('none');
    expect(importClaim('a', 'a')).toBe('mine');
    expect(importClaim('a', 'b')).toBe('other');
    expect(importClaim('1', 'b')).toBe('other');
  });

  it('un fallo total (red o 5xx) no da la importación por hecha; si algo pasó o todo estaba fuera, sí', () => {
    expect(importFinished(0, 3)).toBe(false);
    expect(importFinished(2, 1)).toBe(true);
    expect(importFinished(0, 0)).toBe(true);
    expect(isImportFailure('duplicate')).toBe(false);
    expect(isImportFailure('server')).toBe(true);
  });
});

describe('reinsertRow', () => {
  const row = (key: string, name: string, position: number) => ({ key, name, position });
  it('devuelve la fila en su sitio por posición', () => {
    expect(reinsertRow([row('a', 'a', 0), row('c', 'c', 2)], row('b', 'b', 1)).map((r) => r.key)).toEqual(['a', 'b', 'c']);
  });
  it('no repite la clave ni el nombre', () => {
    expect(reinsertRow([row('a', 'redes', 0)], row('a', 'redes', 0))).toHaveLength(1);
    expect(reinsertRow([row('n', 'Redes', 0)], row('a', 'redes', 0)).map((r) => r.key)).toEqual(['n']);
  });
});

describe('botErrorMessage', () => {
  it('da mensajes estables para los 503 conocidos y deja pasar el resto', () => {
    expect(botErrorMessage('chat_unavailable', 'x')).toContain('todavía no está disponible');
    expect(botErrorMessage('migration_missing', 'x')).toContain('actualización');
    expect(botErrorMessage('otro', 'tal cual')).toBe('tal cual');
  });
});
