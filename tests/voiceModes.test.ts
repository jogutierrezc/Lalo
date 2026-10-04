/**
 * tests/voiceModes.test.ts
 *
 * Qué lee la voz: con comando (y comando propio), todo el chat con sus
 * protecciones, solo destacados o nada. También la compatibilidad con ajustes
 * y URL anteriores a estos modos.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BOTS,
  DEFAULT_MODERATION,
  Moderation,
  REASON_RATE,
  allChatSkip,
  classifyTrigger,
  encodeBlockLists,
  evaluateMessage,
  hasLink,
  isEmoteOnly,
  matchVoiceCommand,
  moderationFromParams,
  moderationToQuery,
  needsApproval,
  normalizeModeration,
  normalizeVoiceCommand,
  voiceText,
} from '../src/utils/moderation';
import { buildWidgetUrl } from '../src/utils/widgetUrl';
import { DEFAULT_SETTINGS } from '../src/types/settings';

const mod = (patch: Partial<Moderation> = {}): Moderation => ({ ...DEFAULT_MODERATION, ...patch });
const ctx = (patch: Partial<Parameters<typeof evaluateMessage>[1]> = {}) => ({
  username: 'pepe',
  role: 'viewer' as const,
  text: 'hola chat',
  trigger: 'chat' as const,
  now: 100000,
  lastAccepted: new Map<string, number>(),
  queueLength: 0,
  ...patch,
});
const reward = '0f9d3c2a-1111-2222-3333-444455556666';

describe('voz: compatibilidad con lo guardado antes de los modos', () => {
  it('sin ajustes nuevos se queda en «con comando» y !s', () => {
    const old = normalizeModeration({ minRole: 'subs', cooldownSec: 10 });
    expect(old.voiceMode).toBe('command');
    expect(old.voiceCommand).toBe('!s');
    expect(old.allPerMinute).toBe(6);
    expect(old.ignoredBots).toEqual(DEFAULT_BOTS);
  });

  it('una URL antigua no trae vm, vc ni vpm y no cambia nada', () => {
    const params = new URLSearchParams({ role: 'subs', cd: '10', cmd: '1' });
    expect(moderationFromParams((k) => params.get(k))).toEqual({ minRole: 'subs', cooldownSec: 10, commandEnabled: true });
  });

  it('descarta valores que no existen', () => {
    expect(normalizeModeration({ voiceMode: 'gritos', allPerMinute: 999, ignoredBots: 'x' })).toMatchObject({
      voiceMode: 'command',
      allPerMinute: 30,
      ignoredBots: DEFAULT_BOTS,
    });
  });

  it('los modos viajan en la URL del widget; la lista de bots, solo si cambió', () => {
    const query = moderationToQuery(mod({ voiceMode: 'highlights', voiceCommand: '!di', allPerMinute: 9 }));
    expect(query).toMatchObject({ vm: 'highlights', vc: '!di', vpm: '9' });
    expect(encodeBlockLists(mod())).toBe('');

    const own = mod({ voiceMode: 'all', voiceCommand: '!di', allPerMinute: 9, ignoredBots: ['mi_bot'] });
    const url = buildWidgetUrl('https://lalo.app', { ...DEFAULT_SETTINGS, ...own });
    const read = new URLSearchParams(url.slice(url.indexOf('?')));
    expect(moderationFromParams((k) => read.get(k))).toMatchObject({
      voiceMode: 'all',
      voiceCommand: '!di',
      allPerMinute: 9,
      ignoredBots: ['mi_bot'],
    });
  });
});

describe('voz: comando propio', () => {
  it('acepta un comando propio y rechaza los que no valen', () => {
    expect(normalizeVoiceCommand('!Voz')).toBe('!voz');
    expect(normalizeVoiceCommand('di')).toBe('!di');
    expect(normalizeVoiceCommand('')).toBe('!s');
    expect(normalizeVoiceCommand('!con espacio')).toBe('!s');
    expect(normalizeVoiceCommand('!demasiado_largo_para_valer')).toBe('!s');
  });

  it('reconoce el comando solo como palabra completa y con texto detrás', () => {
    expect(matchVoiceCommand('!di hola a todos', '!di')).toBe('hola a todos');
    expect(matchVoiceCommand('!DI  hola', '!di')).toBe('hola');
    expect(matchVoiceCommand('!dinero hola', '!di')).toBeNull();
    expect(matchVoiceCommand('!di', '!di')).toBeNull();
  });

  it('modo comando: atiende al comando elegido y deja de atender a !s', () => {
    const rules = mod({ voiceCommand: '!di' });
    expect(classifyTrigger(rules, '!di hola', {})).toBe('command');
    expect(classifyTrigger(rules, '!s hola', {})).toBeNull();
    expect(classifyTrigger(rules, 'hola', {})).toBeNull();
    expect(classifyTrigger(mod({ voiceCommand: '!di', commandEnabled: false }), '!di hola', {}, 'mod')).toBe('command');
  });

  it('lee el texto sin el comando ni los cheermotes', () => {
    const rules = mod({ voiceCommand: '!di' });
    expect(voiceText(rules, '!di hola a todos', {})).toBe('hola a todos');
    expect(voiceText(rules, 'Cheer100 vamos', { bits: '100' })).toBe('vamos');
    expect(voiceText(rules, 'sin comando', {})).toBe('sin comando');
  });
});

describe('voz: todo el chat', () => {
  const rules = mod({ voiceMode: 'all' });

  it('lee mensajes normales y mantiene el comando, los bits y la recompensa', () => {
    const paid = mod({ voiceMode: 'all', minBits: 100, rewardId: reward });
    expect(classifyTrigger(paid, 'qué buena partida', { username: 'pepe' })).toBe('chat');
    expect(classifyTrigger(paid, '!s hola', { username: 'pepe' })).toBe('command');
    expect(classifyTrigger(paid, 'Cheer100 hola', { bits: '100' })).toBe('bits');
    expect(classifyTrigger(paid, 'hola', { 'custom-reward-id': reward })).toBe('reward');
  });

  it('salta los mensajes que empiezan por !', () => {
    expect(allChatSkip(rules, '!ruleta', {})).toBe('command');
    expect(classifyTrigger(rules, '!ruleta', {})).toBeNull();
    expect(classifyTrigger(rules, '  !uptime ahora', {})).toBeNull();
  });

  it('salta los mensajes con enlaces', () => {
    expect(hasLink('mira https://ejemplo.com/clip')).toBe(true);
    expect(hasLink('entra en www.ejemplo.org')).toBe(true);
    expect(hasLink('está en ejemplo.tv')).toBe(true);
    expect(hasLink('vale. sigamos')).toBe(false);
    expect(allChatSkip(rules, 'mira https://ejemplo.com/clip', {})).toBe('link');
    expect(classifyTrigger(rules, 'mira ejemplo.gg', {})).toBeNull();
  });

  it('salta los mensajes de solo emotes', () => {
    expect(isEmoteOnly('Kappa LUL', { emotes: { '25': ['0-4'], '425618': ['6-8'] } })).toBe(true);
    expect(isEmoteOnly('jaja LUL', { emotes: { '425618': ['5-7'] } })).toBe(false);
    expect(isEmoteOnly('Kappa', { 'emote-only': true })).toBe(true);
    expect(isEmoteOnly('hola', {})).toBe(false);
    expect(allChatSkip(rules, 'Kappa LUL', { emotes: { '25': ['0-4'], '425618': ['6-8'] } })).toBe('emotes');
    expect(classifyTrigger(rules, 'Kappa', { emotes: { '25': ['0-4'] } })).toBeNull();
  });

  it('cuenta las posiciones de emotes por caracteres, no por bytes', () => {
    const text = '\u{1F600} Kappa';
    expect(isEmoteOnly(text, { emotes: { '25': ['2-6'] } })).toBe(false);
    expect(isEmoteOnly('Kappa', { emotes: { '25': ['0-4'] } })).toBe(true);
  });

  it('salta los bots conocidos y los que añada el streamer', () => {
    expect(allChatSkip(rules, 'Síguenos en redes', { username: 'Nightbot' })).toBe('bot');
    expect(classifyTrigger(rules, 'hola', { username: 'streamelements' })).toBeNull();
    const own = mod({ voiceMode: 'all', ignoredBots: ['mi_bot'] });
    expect(classifyTrigger(own, 'hola', { username: 'mi_bot' })).toBeNull();
    expect(classifyTrigger(own, 'hola', { username: 'nightbot' })).toBe('chat');
  });

  it('respeta el tope por minuto: lo que sobra se descarta', () => {
    const capped = mod({ voiceMode: 'all', allPerMinute: 3 });
    expect(evaluateMessage(capped, ctx({ chatLastMinute: 2 }))).toEqual({ ok: true });
    expect(evaluateMessage(capped, ctx({ chatLastMinute: 3 }))).toEqual({ ok: false, reason: REASON_RATE });
    // El tope no frena al comando ni a los mensajes de pago
    expect(evaluateMessage(capped, ctx({ trigger: 'command', chatLastMinute: 3 }))).toEqual({ ok: true });
    expect(evaluateMessage(capped, ctx({ trigger: 'bits', chatLastMinute: 3 }))).toEqual({ ok: true });
  });

  it('siguen valiendo bloqueos, rol, espera, cola y aprobación manual', () => {
    const last = new Map([['pepe', 100000 - 10000]]);
    const strict = mod({
      voiceMode: 'all',
      minRole: 'subs',
      cooldownSec: 30,
      maxQueueSize: 2,
      blockedWords: ['spoiler'],
      blockedUsers: ['malo'],
    });
    expect(evaluateMessage(strict, ctx())).toEqual({ ok: false, reason: 'Solo subs' });
    expect(evaluateMessage(strict, ctx({ role: 'sub', lastAccepted: last }))).toEqual({ ok: false, reason: 'En espera (20 s)' });
    expect(evaluateMessage(strict, ctx({ role: 'sub', text: 'un spoiler' }))).toEqual({ ok: false, reason: 'Palabra bloqueada: spoiler' });
    expect(evaluateMessage(strict, ctx({ role: 'sub', username: 'malo' }))).toEqual({ ok: false, reason: 'Usuario bloqueado' });
    expect(evaluateMessage(strict, ctx({ role: 'sub', queueLength: 2 }))).toEqual({ ok: false, reason: 'Cola llena' });
    expect(needsApproval({ id: 'a', trigger: 'chat', role: 'viewer' }, { approval: true, approvedIds: [], priorityPaid: false })).toBe(true);
  });
});

describe('voz: solo destacados', () => {
  const rules = mod({ voiceMode: 'highlights' });

  it('lee destacados con puntos, bits y canjes; nada más', () => {
    expect(classifyTrigger(rules, 'hola', { 'msg-id': 'highlighted-message' })).toBe('highlight');
    expect(classifyTrigger(rules, 'Cheer1 hola', { bits: '1' })).toBe('bits');
    expect(classifyTrigger(rules, 'hola', { 'custom-reward-id': reward })).toBe('reward');
    expect(classifyTrigger(rules, 'hola', {})).toBeNull();
    expect(classifyTrigger(rules, 'hola', { subscriber: true })).toBeNull();
  });

  it('no atiende al comando, ni siquiera del streamer', () => {
    expect(classifyTrigger(rules, '!s hola', {})).toBeNull();
    expect(classifyTrigger(rules, '!s hola', {}, 'broadcaster')).toBeNull();
  });

  it('respeta los bits mínimos y la recompensa enlazada', () => {
    const strict = mod({ voiceMode: 'highlights', minBits: 100, rewardId: reward });
    expect(classifyTrigger(strict, 'Cheer50 hola', { bits: '50' })).toBeNull();
    expect(classifyTrigger(strict, 'Cheer100 hola', { bits: '100' })).toBe('bits');
    expect(classifyTrigger(strict, 'hola', { 'custom-reward-id': 'otra' })).toBeNull();
  });

  it('un destacado salta rol y espera, pero no los bloqueos', () => {
    const gate = mod({ voiceMode: 'highlights', minRole: 'mods', blockedUsers: ['malo'] });
    expect(evaluateMessage(gate, ctx({ trigger: 'highlight' }))).toEqual({ ok: true });
    expect(evaluateMessage(gate, ctx({ trigger: 'highlight', username: 'malo' }))).toEqual({ ok: false, reason: 'Usuario bloqueado' });
  });
});

describe('voz: nada', () => {
  it('no lee ningún mensaje del chat, pero las pruebas del panel pasan', () => {
    const rules = mod({ voiceMode: 'off', minBits: 1, rewardId: reward });
    expect(classifyTrigger(rules, '!s hola', {}, 'broadcaster')).toBeNull();
    expect(classifyTrigger(rules, 'Cheer100 hola', { bits: '100' })).toBeNull();
    expect(classifyTrigger(rules, 'hola', { 'custom-reward-id': reward })).toBeNull();
    expect(classifyTrigger(rules, 'hola', { 'msg-id': 'highlighted-message' })).toBeNull();
    expect(evaluateMessage(rules, ctx({ trigger: 'test' }))).toEqual({ ok: true });
  });
});
