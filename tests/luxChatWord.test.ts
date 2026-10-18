/**
 * tests/luxChatWord.test.ts
 *
 * Comando de activación de Mi AI en el chat: la palabra que elige el creador
 * (validación, reservadas, valor por defecto), el alias !lux con su interruptor,
 * el lector del chat y el script del bot que lleva la palabra y la versión.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { handleLux } from '../server/lux/handlers';
import { LUX_CHAT_WORD_DEFAULT, LUX_CHAT_RESERVED, luxChatWords, parseLuxChat, validateChatWord } from '../server/lux/chatCommands';
import { DEFAULT_LUX_SETTINGS, normalizeLuxSettings, rowFromSettings, settingsFromRow } from '../server/lux/settings';
import { LUX_BOT_VERSION } from '../server/lux/release';
import { buildPythonScript, DEFAULT_LUX_CHAT } from '../src/components/bot/pythonScript';
import { luxChatKey, readLuxBot, rememberLuxBot } from '../src/lib/luxBotRecord';
import type { LuxDb, LuxProfile } from '../server/lux/luxDb';
import type { IntegrationRequest } from '../server/integrations/http';
import type { TwitchIOSettings } from '../src/types/twitchio';

// ---------- Validación ----------

describe('validación de la palabra', () => {
  it('acepta de 2 a 20 letras o números, y la guarda en minúsculas', () => {
    expect(validateChatWord('Mascota')).toEqual({ ok: true, word: 'mascota' });
    expect(validateChatWord('  yo2  ')).toEqual({ ok: true, word: 'yo2' });
    expect(validateChatWord('ab')).toMatchObject({ ok: true });
    expect(validateChatWord('a'.repeat(20))).toMatchObject({ ok: true });
  });

  it('rechaza menos de 2 y más de 20 caracteres', () => {
    expect(validateChatWord('a')).toMatchObject({ ok: false });
    expect(validateChatWord('')).toMatchObject({ ok: false });
    expect(validateChatWord('a'.repeat(21))).toMatchObject({ ok: false });
  });

  it('rechaza espacios, símbolos y acentos', () => {
    for (const bad of ['mi mascota', 'pepe!', 'a-b', 'más', 'ñandu', 'a_b', '!lux']) {
      expect(validateChatWord(bad), bad).toMatchObject({ ok: false });
    }
  });

  it('rechaza los comandos reservados del bot, también en mayúsculas', () => {
    for (const reserved of ['s', 'luxon', 'luxoff', 'LUXON']) {
      const check = validateChatWord(reserved);
      expect(check.ok, reserved).toBe(false);
      if (!check.ok) expect(check.message).toContain('ya es un comando del bot');
    }
    expect(LUX_CHAT_RESERVED).toEqual(['s', 'luxon', 'luxoff']);
  });

  it('rechaza también los comandos del bot de TwitchIO que el cliente conoce', () => {
    expect(validateChatWord('alerta', ['alerta'])).toMatchObject({ ok: false });
    expect(validateChatWord('alerta')).toMatchObject({ ok: true });
  });

  it('«lux» es válida: es la palabra por defecto', () => {
    expect(validateChatWord('lux')).toEqual({ ok: true, word: 'lux' });
    expect(LUX_CHAT_WORD_DEFAULT).toBe('lux');
  });
});

// ---------- Ajustes del servidor ----------

describe('ajustes de la palabra', () => {
  it('por defecto la palabra es lux, con el alias encendido', () => {
    expect(DEFAULT_LUX_SETTINGS.chatWord).toBe('lux');
    expect(DEFAULT_LUX_SETTINGS.chatAlias).toBe(true);
    expect(settingsFromRow(null)).toMatchObject({ chatWord: 'lux', chatAlias: true });
  });

  it('una fila sin la columna nueva o con un valor roto cae a lux', () => {
    expect(settingsFromRow({ personality: 'x' }).chatWord).toBe('lux');
    expect(settingsFromRow({ chat_word: 'luxon' }).chatWord).toBe('lux');
    expect(settingsFromRow({ chat_word: 'a b' }).chatWord).toBe('lux');
    expect(settingsFromRow({ chat_alias: 'raro' }).chatAlias).toBe(true);
  });

  it('valida la palabra al guardar y deja el motivo en chatWord', () => {
    expect(normalizeLuxSettings({ chatWord: 'Mascota' })).toMatchObject({ ok: true, value: { chatWord: 'mascota' } });
    expect(normalizeLuxSettings({ chatWord: 'luxon' })).toMatchObject({ ok: false, field: 'chatWord' });
    expect(normalizeLuxSettings({ chatWord: 'x' })).toMatchObject({ ok: false, field: 'chatWord' });
    expect(normalizeLuxSettings({ chatWord: 12 })).toMatchObject({ ok: false, field: 'chatWord' });
    expect(normalizeLuxSettings({ chatAlias: 'sí' })).toMatchObject({ ok: false, field: 'chatAlias' });
  });

  it('se guarda en chat_word y chat_alias', () => {
    const row = rowFromSettings('p1', { ...DEFAULT_LUX_SETTINGS, chatWord: 'mascota', chatAlias: false });
    expect(row).toMatchObject({ chat_word: 'mascota', chat_alias: false });
    expect(settingsFromRow(row)).toMatchObject({ chatWord: 'mascota', chatAlias: false });
  });
});

// ---------- Lector del chat (servidor) ----------

describe('lector del chat con la palabra del creador', () => {
  it('reconoce la palabra del creador', () => {
    expect(parseLuxChat('!mascota hola', '!', { word: 'mascota', alias: true })).toEqual({ kind: 'ask', message: 'hola' });
    expect(parseLuxChat('!MASCOTA hola', '!', { word: 'mascota' })).toEqual({ kind: 'ask', message: 'hola' });
    expect(parseLuxChat('!mascota', '!', { word: 'mascota' })).toBeNull();
  });

  it('el alias !lux sigue valiendo cuando el alias está activo', () => {
    expect(parseLuxChat('!lux hola', '!', { word: 'mascota', alias: true })).toEqual({ kind: 'ask', message: 'hola' });
    expect(luxChatWords('mascota', true)).toEqual(['mascota', 'lux']);
  });

  it('con el alias apagado, !lux deja de responder y la palabra sigue', () => {
    expect(parseLuxChat('!lux hola', '!', { word: 'mascota', alias: false })).toBeNull();
    expect(parseLuxChat('!mascota hola', '!', { word: 'mascota', alias: false })).toEqual({ kind: 'ask', message: 'hola' });
    expect(luxChatWords('mascota', false)).toEqual(['mascota']);
  });

  it('con la palabra lux, el alias no añade nada y el interruptor no cambia el resultado', () => {
    expect(luxChatWords('lux', true)).toEqual(['lux']);
    expect(parseLuxChat('!lux hola', '!', { word: 'lux', alias: false })).toEqual({ kind: 'ask', message: 'hola' });
  });

  it('nunca confunde la palabra con otro comando: !luxon y !luxoff siguen siendo de encender y apagar', () => {
    expect(parseLuxChat('!luxon', '!', { word: 'mascota' })).toEqual({ kind: 'on' });
    expect(parseLuxChat('!luxoff', '!', { word: 'mascota' })).toEqual({ kind: 'off' });
    expect(parseLuxChat('!luxury', '!', { word: 'lux' })).toBeNull();
  });
});

// ---------- Ruta de configuración ----------

describe('ruta de ajustes guarda la palabra', () => {
  function memoryDb(profile: LuxProfile) {
    const rows = new Map<string, Record<string, unknown>>();
    const db = {
      async profile() {
        return profile;
      },
      async settingsRow(id: string) {
        return rows.get(id) ?? null;
      },
      async saveSettingsRow(row: Record<string, unknown>) {
        rows.set(String(row.profile_id), row);
      },
    } as unknown as LuxDb;
    return { db, rows };
  }
  const request = (method: string, body?: unknown): IntegrationRequest => ({ method, headers: {}, query: {}, body });
  const asStreamer = async () => ({ id: 'p1', role: 'streamer', status: 'active' });

  it('guarda la palabra normalizada y el alias', async () => {
    const { db, rows } = memoryDb({ id: 'p1', role: 'streamer', luxEnabled: true });
    const res = await handleLux('config', request('POST', { chatWord: 'Mascota', chatAlias: false }), {}, { auth: asStreamer, db: () => db });
    expect(res.status).toBe(200);
    expect(rows.get('p1')).toMatchObject({ chat_word: 'mascota', chat_alias: false });
  });

  it('rechaza una palabra reservada sin tocar la fila', async () => {
    const { db, rows } = memoryDb({ id: 'p1', role: 'streamer', luxEnabled: true });
    const res = await handleLux('config', request('POST', { chatWord: 'luxoff' }), {}, { auth: asStreamer, db: () => db });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'bad_settings', field: 'chatWord' });
    expect(rows.size).toBe(0);
  });
});

// ---------- Script del bot ----------

const botSettings = (patch: Partial<TwitchIOSettings> = {}): TwitchIOSettings => ({
  channel: 'mi_canal',
  botUsername: 'MiBot',
  prefix: '!',
  autoConnect: true,
  welcomeMessage: '',
  commands: [],
  eventsub: { follows: true, subs: true, bits: true, raids: true, channelPoints: true },
  ...patch,
});

describe('script del bot con la palabra elegida', () => {
  it('lleva la palabra, el alias y la versión subida', () => {
    const script = buildPythonScript(botSettings(), { word: 'mascota', alias: true });
    expect(script).toContain('LUX_WORD = "mascota"');
    expect(script).toContain('LUX_ALIAS = True');
    expect(script).toContain(`LUX_BOT_VERSION = ${LUX_BOT_VERSION}`);
    expect(LUX_BOT_VERSION).toBe(3);
    expect(script).toContain('words.append("lux")');
  });

  it('con el alias apagado lo escribe como False', () => {
    expect(buildPythonScript(botSettings(), { word: 'mascota', alias: false })).toContain('LUX_ALIAS = False');
  });

  it('sin ajustes de Lux, la palabra por defecto es lux', () => {
    expect(DEFAULT_LUX_CHAT).toEqual({ word: 'lux', alias: true });
    const script = buildPythonScript(botSettings());
    expect(script).toContain('LUX_WORD = "lux"');
    expect(script).toContain('LUX_ALIAS = False'); // con la palabra lux el alias no añade nada
  });

  it('una palabra inválida nunca llega al script: vale lux', () => {
    const script = buildPythonScript(botSettings(), { word: 'luxon" ; import os', alias: true });
    expect(script).toContain('LUX_WORD = "lux"');
    expect(script).not.toContain('import os');
  });
});

// ---------- Recuerdo del bot copiado ----------

describe('recuerdo del bot copiado', () => {
  it('sin navegador no hay recuerdo y no se rompe', () => {
    expect(readLuxBot()).toBeNull();
    expect(() => rememberLuxBot({ word: 'mascota', alias: true })).not.toThrow();
  });

  it('la clave ignora el alias cuando la palabra es lux', () => {
    expect(luxChatKey('lux', true)).toBe(luxChatKey('lux', false));
    expect(luxChatKey('mascota', true)).not.toBe(luxChatKey('mascota', false));
  });
});

// ---------- Migración ----------

describe('migración 0036', () => {
  it('es idempotente y añade las dos columnas', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../supabase/migrations/0036_lux_chat_word.sql', import.meta.url), 'utf8');
    expect(sql).toContain('add column if not exists chat_word');
    expect(sql).toContain('add column if not exists chat_alias');
    expect(sql).toContain('if not exists (select 1 from pg_constraint');
  });
});

// ---------- Panel ----------

const session = vi.hoisted(() => ({ profile: null as Record<string, unknown> | null }));

vi.mock('../src/hooks/useCloudSession', () => ({
  useCloudSession: () => ({ profile: session.profile }),
}));
vi.mock('../src/components/SuiteNav', () => ({ SuiteNav: () => null }));
vi.mock('../src/lib/luxApi', () => ({
  luxGetSettings: () => new Promise(() => {}),
  luxSaveSettings: () => new Promise(() => {}),
  luxAsk: () => new Promise(() => {}),
  luxCharacterView: () => new Promise(() => {}),
}));

import { LuxAI } from '../src/pages/LuxAI';

describe('panel: comando de activación', () => {
  it('muestra la sección, el ejemplo con la palabra por defecto y el botón de copiar', () => {
    session.profile = { id: 'p1', role: 'streamer', lux_enabled: true };
    const html = renderToStaticMarkup(React.createElement(LuxAI));
    expect(html).toContain('Comando de activación');
    expect(html).toContain('<strong>!lux</strong> para hablar con tu personaje');
    expect(html).toContain('Copiar comando');
    // Con la palabra por defecto no hay alias que apagar
    expect(html).not.toContain('Seguir aceptando');
  });
});
