import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MODERATION,
  Moderation,
  classifyTrigger,
  encodeBlockLists,
  evaluateMessage,
  findBlockedWord,
  moderationFromParams,
  moderationToQuery,
  normalizeModeration,
  normalizeUser,
  parseControl,
  parseWordList,
  pickNext,
  needsApproval,
  roleFromTags,
  stripCheermotes,
  truncateText,
} from '../src/utils/moderation';
import { ACTION_DESCRIPTIONS } from '../src/utils/moderationAudio';

const mod = (patch: Partial<Moderation> = {}): Moderation => ({ ...DEFAULT_MODERATION, ...patch });
const ctx = (patch: Partial<Parameters<typeof evaluateMessage>[1]> = {}) => ({
  username: 'pepe',
  role: 'viewer' as const,
  text: 'hola chat',
  trigger: 'command' as const,
  now: 100000,
  lastAccepted: new Map<string, number>(),
  queueLength: 0,
  ...patch,
});

describe('moderation — Reglas del streamer', () => {
  it('normaliza usuarios y listas de palabras', () => {
    expect(normalizeUser(' @PePe_99 ')).toBe('pepe_99');
    expect(normalizeUser('no válido!')).toBe('');
    expect(parseWordList('Tonto, tonto\n  frase fea ,, ')).toEqual(['Tonto', 'frase fea']);
  });

  it('normaliza reglas manipuladas', () => {
    expect(normalizeModeration(null)).toEqual(DEFAULT_MODERATION);
    const result = normalizeModeration({
      minRole: 'dioses',
      cooldownSec: 99999,
      maxLength: 1,
      maxQueueSize: '7',
      blockedWords: ['a', 'A', 3],
      blockedUsers: ['@Juan', 'x y', 'juan'],
      commandEnabled: false,
      rewardId: '<script>',
      minBits: -5,
    });
    expect(result).toEqual({
      minRole: 'everyone',
      cooldownSec: 600,
      maxLength: 20,
      maxQueueSize: 7,
      blockedWords: ['a', '3'],
      blockedUsers: ['juan'],
      commandEnabled: false,
      rewardId: '',
      minBits: 0,
      approvalMode: false,
      priorityPaid: false,
      textOnly: false,
      modNotificationAudio: true,
      modNotificationVoice: true,
    });
  });

  it('deduce el rol a partir de las etiquetas del chat', () => {
    expect(roleFromTags({ username: 'lalo' }, 'Lalo')).toBe('broadcaster');
    expect(roleFromTags({ mod: true, username: 'm' }, 'lalo')).toBe('mod');
    expect(roleFromTags({ mod: '1', username: 'm' }, 'lalo')).toBe('mod');
    expect(roleFromTags({ 'user-type': 'mod', username: 'm' }, 'lalo')).toBe('mod');
    expect(roleFromTags({ badges: { lead_moderator: '1' }, username: 'm' }, 'lalo')).toBe('mod');
    expect(roleFromTags({ badges: { vip: '1' }, username: 'v' }, 'lalo')).toBe('vip');
    expect(roleFromTags({ badges: { founder: '0' }, username: 's' }, 'lalo')).toBe('sub');
    expect(roleFromTags({ username: 'x' }, 'lalo')).toBe('viewer');
  });

  it('clasifica el disparador del mensaje', () => {
    const reward = '0f9d3c2a-1111-2222-3333-444455556666';
    expect(classifyTrigger(mod(), '!s hola', {})).toBe('command');
    expect(classifyTrigger(mod(), 'hola', {})).toBeNull();
    expect(classifyTrigger(mod({ commandEnabled: false }), '!s hola', {})).toBeNull();
    expect(classifyTrigger(mod({ rewardId: reward }), 'hola', { 'custom-reward-id': reward })).toBe('reward');
    expect(classifyTrigger(mod({ rewardId: reward }), 'hola', { 'custom-reward-id': 'otra' })).toBeNull();
    expect(classifyTrigger(mod({ minBits: 100 }), 'Cheer100 hola', { bits: '100' })).toBe('bits');
    expect(classifyTrigger(mod({ minBits: 100 }), 'Cheer50 hola', { bits: '50' })).toBeNull();
    // Moderadores y streamer pueden usar !s aunque commandEnabled esté desactivado
    expect(classifyTrigger(mod({ commandEnabled: false }), '!s mensaje mod', {}, 'mod')).toBe('command');
    expect(classifyTrigger(mod({ commandEnabled: false }), '!s mensaje broadcaster', {}, 'broadcaster')).toBe('command');
    expect(classifyTrigger(mod({ commandEnabled: false }), '!s mensaje viewer', {}, 'viewer')).toBeNull();
  });

  it('limpia cheermotes y recorta textos largos', () => {
    expect(stripCheermotes('Cheer100 hola Kappa50 chat')).toBe('hola chat');
    expect(stripCheermotes('tengo 100 puntos')).toBe('tengo 100 puntos');
    expect(truncateText('hola', 20)).toBe('hola');
    expect(truncateText('uno dos tres cuatro cinco seis', 20)).toBe('uno dos tres cuatro...');
  });

  it('detecta palabras bloqueadas sin importar mayúsculas ni tildes, solo como palabra completa', () => {
    expect(findBlockedWord('Eres un CAMIÓN', ['camion'])).toBe('camion');
    expect(findBlockedWord('una frase fea, sí', ['frase fea'])).toBe('frase fea');
    expect(findBlockedWord('camioneta', ['camion'])).toBeNull();
    expect(findBlockedWord('a.b', ['a.b'])).toBe('a.b');
  });

  it('aplica bloqueos, rol, espera y tope de cola', () => {
    expect(evaluateMessage(mod(), ctx())).toEqual({ ok: true });
    expect(evaluateMessage(mod({ blockedUsers: ['pepe'] }), ctx()).ok).toBe(false);
    expect(evaluateMessage(mod({ blockedWords: ['hola'] }), ctx())).toEqual({ ok: false, reason: 'Palabra bloqueada: hola' });
    expect(evaluateMessage(mod({ minRole: 'subs' }), ctx())).toEqual({ ok: false, reason: 'Solo subs' });
    expect(evaluateMessage(mod({ minRole: 'subs' }), ctx({ role: 'vip' }))).toEqual({ ok: true });
    expect(evaluateMessage(mod({ maxQueueSize: 2 }), ctx({ queueLength: 2 }))).toEqual({ ok: false, reason: 'Cola llena' });

    const last = new Map([['pepe', 100000 - 10000]]);
    expect(evaluateMessage(mod({ cooldownSec: 30 }), ctx({ lastAccepted: last }))).toEqual({ ok: false, reason: 'En espera (20 s)' });
    expect(evaluateMessage(mod({ cooldownSec: 5 }), ctx({ lastAccepted: last }))).toEqual({ ok: true });
    expect(evaluateMessage(mod({ cooldownSec: 30 }), ctx({ lastAccepted: last, role: 'mod' }))).toEqual({ ok: true });
  });

  it('los canjes y los bits saltan rol y espera, pero no los bloqueos', () => {
    const last = new Map([['pepe', 99999]]);
    const strict = mod({ minRole: 'mods', cooldownSec: 300, blockedUsers: ['malo'] });
    expect(evaluateMessage(strict, ctx({ trigger: 'reward', lastAccepted: last }))).toEqual({ ok: true });
    expect(evaluateMessage(strict, ctx({ trigger: 'bits', lastAccepted: last }))).toEqual({ ok: true });
    expect(evaluateMessage(strict, ctx({ trigger: 'bits', username: 'malo' })).ok).toBe(false);
    expect(evaluateMessage(strict, ctx({ trigger: 'test', username: 'malo' }))).toEqual({ ok: true });
  });

  it('interpreta las órdenes de control del chat (con y sin prefijo !s)', () => {
    expect(parseControl('!s skip')).toEqual({ action: 'skip' });
    expect(parseControl('!skip')).toEqual({ action: 'skip' });
    expect(parseControl('!s Pausa.')).toEqual({ action: 'pause' });
    expect(parseControl('!pausa')).toEqual({ action: 'pause' });
    expect(parseControl('!pause')).toEqual({ action: 'pause' });
    expect(parseControl('!s reanudar')).toEqual({ action: 'resume' });
    expect(parseControl('!resume')).toEqual({ action: 'resume' });
    expect(parseControl('!s vaciar')).toEqual({ action: 'clear' });
    expect(parseControl('!clear')).toEqual({ action: 'clear' });
    expect(parseControl('!s reload')).toEqual({ action: 'reload' });
    expect(parseControl('!reload')).toEqual({ action: 'reload' });
    expect(parseControl('!s block @Troll_1')).toEqual({ action: 'block', user: 'troll_1' });
    expect(parseControl('!block @Troll_1')).toEqual({ action: 'block', user: 'troll_1' });
    expect(parseControl('!s unban troll_1')).toEqual({ action: 'unblock', user: 'troll_1' });
    expect(parseControl('!silencio')).toEqual({ action: 'panic' });
    expect(parseControl('!s block')).toBeNull();
    expect(parseControl('!s pausa larga')).toBeNull();
    expect(parseControl('!s hola a todos')).toBeNull();
  });

  it('interpreta silencio, aprobación, solo texto y bloqueo temporal', () => {
    expect(parseControl('!s silencio')).toEqual({ action: 'panic' });
    expect(parseControl('!s ok')).toEqual({ action: 'approve' });
    expect(parseControl('!s no')).toEqual({ action: 'reject' });
    expect(parseControl('!s manual')).toEqual({ action: 'manual' });
    expect(parseControl('!s auto')).toEqual({ action: 'auto' });
    expect(parseControl('!s mudo')).toEqual({ action: 'mute' });
    expect(parseControl('!s voz')).toEqual({ action: 'unmute' });
    expect(parseControl('!s timeout @Troll_1')).toEqual({ action: 'timeout', user: 'troll_1', minutes: 10 });
    expect(parseControl('!s timeout troll_1 30')).toEqual({ action: 'timeout', user: 'troll_1', minutes: 30 });
    expect(parseControl('!s timeout troll_1 9999')).toEqual({ action: 'timeout', user: 'troll_1', minutes: 1440 });
    expect(parseControl('!s timeout')).toBeNull();
    expect(parseControl('!s block troll_1 30')).toBeNull();
  });

  it('elige el siguiente mensaje según aprobación y prioridad', () => {
    const queue = [
      { id: 'a', trigger: 'command', role: 'viewer' },
      { id: 'b', trigger: 'bits', role: 'viewer' },
      { id: 'c', trigger: 'command', role: 'mod' },
      { id: 'd', trigger: 'test' },
    ];
    const base = { approval: false, approvedIds: [], priorityPaid: false };
    expect(pickNext(queue, base)?.id).toBe('a');
    expect(pickNext(queue, { ...base, priorityPaid: true })?.id).toBe('b');
    expect(pickNext(queue, { ...base, approval: true })?.id).toBe('c');
    expect(pickNext(queue, { ...base, approval: true, approvedIds: ['a'] })?.id).toBe('a');
    expect(pickNext(queue, { ...base, approval: true, approvedIds: ['b'], priorityPaid: true })?.id).toBe('b');
    expect(pickNext(queue.slice(0, 2), { ...base, approval: true })).toBeNull();
    expect(pickNext([], base)).toBeNull();
    expect(needsApproval(queue[3], { ...base, approval: true })).toBe(false);
  });

  it('lleva las reglas a la URL y las recupera', () => {
    const rules = mod({
      minRole: 'vips',
      cooldownSec: 45,
      maxLength: 200,
      maxQueueSize: 8,
      commandEnabled: false,
      rewardId: '0f9d3c2a-1111-2222-3333-444455556666',
      minBits: 100,
      approvalMode: true,
      priorityPaid: true,
      textOnly: true,
      blockedWords: ['frase fea', 'ñu'],
      blockedUsers: ['troll_1'],
    });
    const params = new URLSearchParams({ ...moderationToQuery(rules), block: encodeBlockLists(rules) });
    expect(moderationFromParams((k) => params.get(k))).toEqual(rules);
    expect(encodeBlockLists(mod())).toBe('');
    expect(moderationFromParams(() => null)).toEqual({});
    const partial = new URLSearchParams({ cd: '9999', block: '%%%' });
    expect(moderationFromParams((k) => partial.get(k))).toEqual({ cooldownSec: 600 });
  });

  it('genera avisos y locuciones de audio claras para moderadores', () => {
    expect(ACTION_DESCRIPTIONS.skip('ModJuan')).toBe('Mensaje saltado por ModJuan');
    expect(ACTION_DESCRIPTIONS.pause('ModJuan')).toBe('TTS pausado por ModJuan');
    expect(ACTION_DESCRIPTIONS.resume('ModJuan')).toBe('TTS reanudado por ModJuan');
    expect(ACTION_DESCRIPTIONS.clear('ModJuan')).toBe('Cola de mensajes vaciada por ModJuan');
    expect(ACTION_DESCRIPTIONS.panic('ModJuan')).toBe('Modo silencio total activado por ModJuan');
    expect(ACTION_DESCRIPTIONS.timeout('ModJuan', 'troll_99', 15)).toBe('troll_99 silenciado por 15 minutos por ModJuan');
    expect(ACTION_DESCRIPTIONS.block('ModJuan', 'troll_99')).toBe('troll_99 bloqueado por ModJuan');
  });
});
