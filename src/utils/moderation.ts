/**
 * moderation.ts
 *
 * Reglas del streamer sobre qué mensajes se leen: quién puede usar el TTS, la
 * espera por usuario, la longitud y la cola máximas, palabras y usuarios
 * bloqueados, y los disparadores (comando !s, puntos del canal y bits).
 *
 * Todo es lógica pura para poder probarla; el hook de chat y el widget la usan.
 * Igual que la apariencia, las reglas viajan en la URL del widget porque el
 * navegador de OBS no comparte almacenamiento con el panel.
 */

import { decodeBase64Url, encodeBase64Url } from './appearance';

export type MinRole = 'everyone' | 'subs' | 'vips' | 'mods';
export type UserRole = 'viewer' | 'sub' | 'vip' | 'mod' | 'broadcaster';
export type TriggerKind = 'command' | 'reward' | 'bits' | 'test';

export interface Moderation {
  minRole: MinRole; // quién puede usar el comando !s
  cooldownSec: number; // espera por usuario entre mensajes
  maxLength: number; // caracteres leídos por mensaje
  maxQueueSize: number; // mensajes en espera
  blockedWords: string[];
  blockedUsers: string[];
  commandEnabled: boolean; // disparador por comando !s
  rewardId: string; // recompensa de puntos del canal ('' = desactivado)
  minBits: number; // bits mínimos para leer el mensaje (0 = desactivado)
  approvalMode: boolean; // cada mensaje espera el visto bueno del streamer o un mod
  priorityPaid: boolean; // canjes y bits pasan al frente de la cola
  textOnly: boolean; // mostrar la alerta sin voz
  modNotificationAudio?: boolean; // reproduce aviso sonoro cuando un moderador ejecuta una acción
  modNotificationVoice?: boolean; // anuncia por voz la acción ejecutada por el moderador
}

export const DEFAULT_MODERATION: Moderation = {
  minRole: 'everyone',
  cooldownSec: 0,
  maxLength: 1000,
  maxQueueSize: 20,
  blockedWords: [],
  blockedUsers: [],
  commandEnabled: true,
  rewardId: '',
  minBits: 0,
  approvalMode: false,
  priorityPaid: false,
  textOnly: false,
  modNotificationAudio: true,
  modNotificationVoice: true,
};

export const MIN_ROLES: { id: MinRole; name: string }[] = [
  { id: 'everyone', name: 'Todos' },
  { id: 'subs', name: 'Subs' },
  { id: 'vips', name: 'VIP' },
  { id: 'mods', name: 'Mods' },
];

export const LIMITS = {
  cooldown: { min: 0, max: 600 },
  length: { min: 20, max: 1000 },
  queue: { min: 1, max: 50 },
  bits: { min: 0, max: 100000 },
  words: 100,
  users: 200,
} as const;

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, sub: 1, vip: 2, mod: 3, broadcaster: 4 };
const MIN_RANK: Record<MinRole, number> = { everyone: 0, subs: 1, vips: 2, mods: 3 };
const ROLE_LABEL: Record<MinRole, string> = { everyone: 'todos', subs: 'subs', vips: 'VIP', mods: 'mods' };

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/** Nombre de usuario de Twitch en minúsculas y sin @, o '' si no es válido. */
export function normalizeUser(value: unknown): string {
  const user = String(value ?? '').trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_]{1,25}$/.test(user) ? user : '';
}

const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Convierte texto libre (comas o saltos de línea) en lista de palabras o frases. */
export function parseWordList(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[,\n]/)
    .map((word) => word.trim().slice(0, 40))
    .filter((word) => {
      const key = fold(word);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, LIMITS.words);
}

/** Normaliza reglas de origen no confiable (localStorage, URL, BroadcastChannel). */
export function normalizeModeration(raw: Partial<Record<keyof Moderation, unknown>> | null | undefined): Moderation {
  const source = raw || {};
  const words = Array.isArray(source.blockedWords) ? parseWordList(source.blockedWords.map(String).join('\n')) : [];
  const users = Array.isArray(source.blockedUsers)
    ? Array.from(new Set(source.blockedUsers.map(normalizeUser).filter(Boolean))).slice(0, LIMITS.users)
    : [];
  const reward = typeof source.rewardId === 'string' ? source.rewardId.trim() : '';
  return {
    minRole: MIN_ROLES.some((role) => role.id === source.minRole) ? (source.minRole as MinRole) : DEFAULT_MODERATION.minRole,
    cooldownSec: clampInt(source.cooldownSec, LIMITS.cooldown.min, LIMITS.cooldown.max, DEFAULT_MODERATION.cooldownSec),
    maxLength: clampInt(source.maxLength, LIMITS.length.min, LIMITS.length.max, DEFAULT_MODERATION.maxLength),
    maxQueueSize: clampInt(source.maxQueueSize, LIMITS.queue.min, LIMITS.queue.max, DEFAULT_MODERATION.maxQueueSize),
    blockedWords: words,
    blockedUsers: users,
    commandEnabled: source.commandEnabled !== false,
    rewardId: /^[0-9a-f-]{8,64}$/i.test(reward) ? reward.toLowerCase() : '',
    minBits: clampInt(source.minBits, LIMITS.bits.min, LIMITS.bits.max, DEFAULT_MODERATION.minBits),
    approvalMode: source.approvalMode === true,
    priorityPaid: source.priorityPaid === true,
    textOnly: source.textOnly === true,
    modNotificationAudio: source.modNotificationAudio !== false,
    modNotificationVoice: source.modNotificationVoice !== false,
  };
}

export interface ChatTags {
  badges?: Record<string, string | undefined> | null;
  mod?: boolean | string | number;
  subscriber?: boolean | string | number;
  username?: string;
  bits?: string | number;
  'custom-reward-id'?: string;
  'user-type'?: string;
  isMod?: boolean;
}

export function roleFromTags(tags: ChatTags, channel: string): UserRole {
  const badges = (tags.badges || {}) as Record<string, string | undefined>;
  const isBroadcaster =
    badges.broadcaster === '1' ||
    (tags.username || '').toLowerCase() === channel.toLowerCase();
  if (isBroadcaster) return 'broadcaster';

  // Detección exhaustiva de moderadores en Twitch IRC / tmi.js / EventSub
  const isMod =
    tags.mod === true ||
    tags.mod === '1' ||
    (tags as Record<string, unknown>).mod === 1 ||
    tags.isMod === true ||
    badges.moderator !== undefined ||
    badges.lead_moderator !== undefined ||
    badges['lead-moderator'] !== undefined ||
    tags['user-type'] === 'mod' ||
    tags['user-type'] === 'global_mod' ||
    tags['user-type'] === 'admin' ||
    tags['user-type'] === 'staff';
  if (isMod) return 'mod';

  if (badges.vip !== undefined) return 'vip';
  if (
    tags.subscriber === true ||
    tags.subscriber === '1' ||
    badges.subscriber !== undefined ||
    badges.founder !== undefined
  ) return 'sub';

  return 'viewer';
}

/** Decide con qué disparador entra un mensaje, o null si no debe leerse. */
export function classifyTrigger(
  mod: Moderation,
  message: string,
  tags: ChatTags,
  role?: UserRole
): Exclude<TriggerKind, 'test'> | null {
  const bits = Number(tags.bits) || 0;
  if (mod.minBits > 0 && bits >= mod.minBits) return 'bits';
  if (mod.rewardId && (tags['custom-reward-id'] || '').toLowerCase() === mod.rewardId) return 'reward';

  // El streamer y los moderadores siempre pueden usar !s incluso si los comandos públicos están pausados
  const isPrivileged = role === 'broadcaster' || role === 'mod';
  if ((mod.commandEnabled || isPrivileged) && /^!s\s/i.test(message.trim())) return 'command';
  return null;
}

const CHEERMOTE =
  /\b(cheer|biblethump|cheerwhal|corgo|uni|showlove|party|seemsgood|pride|kappa|frankerz|heyguys|dansgame|elegiggle|trihard|kreygasm|4head|swiftrage|notlikethis|failfish|vohiyo|pjsalt|mrdestructoid|bday|ripcheer|shamrock|streamlabs|muxy|holidaycheer|goal|anon|charity)\d+\b/gi;

/** Quita los cheermotes (Cheer100, Kappa50...) para que la voz no los lea. */
export function stripCheermotes(text: string): string {
  return text.replace(CHEERMOTE, ' ').replace(/\s+/g, ' ').trim();
}

export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '...';
}

/** Devuelve la palabra o frase bloqueada que aparece en el texto, o null. */
export function findBlockedWord(text: string, words: string[]): string | null {
  const haystack = fold(text);
  for (const word of words) {
    const needle = fold(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (needle && new RegExp(`(^|[^\\p{L}\\p{N}])${needle}($|[^\\p{L}\\p{N}])`, 'u').test(haystack)) return word;
  }
  return null;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

export interface MessageContext {
  username: string;
  role: UserRole;
  text: string;
  trigger: TriggerKind;
  now: number;
  lastAccepted: Map<string, number>;
  queueLength: number;
}

/**
 * Aplica las reglas a un mensaje ya sanitizado. Los canjes de puntos y los bits
 * saltan el filtro de rol y la espera (ya pagaron por el mensaje), pero no los
 * bloqueos ni el tope de cola. Las pruebas del streamer lo saltan todo.
 */
export function evaluateMessage(mod: Moderation, ctx: MessageContext): Verdict {
  if (ctx.trigger === 'test') return { ok: true };
  const username = normalizeUser(ctx.username);
  if (username && mod.blockedUsers.includes(username)) return { ok: false, reason: 'Usuario bloqueado' };
  const word = findBlockedWord(ctx.text, mod.blockedWords);
  if (word) return { ok: false, reason: `Palabra bloqueada: ${word}` };

  if (ctx.trigger === 'command') {
    if (ROLE_RANK[ctx.role] < MIN_RANK[mod.minRole]) return { ok: false, reason: `Solo ${ROLE_LABEL[mod.minRole]}` };
    if (mod.cooldownSec > 0 && ROLE_RANK[ctx.role] < ROLE_RANK.mod) {
      const last = ctx.lastAccepted.get(username);
      const remaining = last === undefined ? 0 : mod.cooldownSec - (ctx.now - last) / 1000;
      if (remaining > 0) return { ok: false, reason: `En espera (${Math.ceil(remaining)} s)` };
    }
  }
  if (ctx.queueLength >= mod.maxQueueSize) return { ok: false, reason: 'Cola llena' };
  return { ok: true };
}

export type ControlAction =
  | 'reload'
  | 'skip'
  | 'pause'
  | 'resume'
  | 'clear'
  | 'block'
  | 'unblock'
  | 'timeout' // bloqueo temporal
  | 'panic' // silencio: corta la voz, vacía la cola y pausa
  | 'approve'
  | 'reject'
  | 'manual' // activar aprobación manual
  | 'auto'
  | 'mute' // solo texto
  | 'unmute'
  | 'poll_start' // inicio/personalización de encuesta por moderador
  | 'poll_stop'; // finalización de encuesta por moderador

export interface ControlCommand {
  action: ControlAction;
  user?: string;
  minutes?: number;
  sender?: string;
  senderRole?: UserRole;
}

export const DEFAULT_TIMEOUT_MINUTES = 10;
export const MAX_TIMEOUT_MINUTES = 1440;

export interface QueueCandidate {
  id: string;
  trigger?: string;
  role?: string;
}

export interface PickOptions {
  approval: boolean;
  approvedIds: string[];
  priorityPaid: boolean;
}

/** En modo manual, un mensaje espera aprobación salvo que sea una prueba o lo escriba el streamer o un mod. */
export function needsApproval(message: QueueCandidate, o: PickOptions): boolean {
  if (!o.approval || message.trigger === 'test') return false;
  if (message.role === 'broadcaster' || message.role === 'mod') return false;
  return !o.approvedIds.includes(message.id);
}

/** Siguiente mensaje a leer: el primero ya aprobado; con prioridad, antes los canjes y los bits. */
export function pickNext<T extends QueueCandidate>(queue: T[], o: PickOptions): T | null {
  const ready = queue.filter((message) => !needsApproval(message, o));
  if (!ready.length) return null;
  if (o.priorityPaid) {
    const paid = ready.find((message) => message.trigger === 'reward' || message.trigger === 'bits');
    if (paid) return paid;
  }
  return ready[0];
}

const CONTROL_WORDS: Record<string, ControlAction> = {
  reload: 'reload', update: 'reload', actualizar: 'reload', reiniciar: 'reload',
  skip: 'skip', saltar: 'skip', siguiente: 'skip', next: 'skip',
  pause: 'pause', pausa: 'pause', pausar: 'pause',
  resume: 'resume', continuar: 'resume', reanudar: 'resume',
  clear: 'clear', limpiar: 'clear', vaciar: 'clear',
  block: 'block', ban: 'block', bloquear: 'block',
  unblock: 'unblock', unban: 'unblock', desbloquear: 'unblock',
  timeout: 'timeout', silenciar: 'timeout',
  silencio: 'panic', panic: 'panic', panico: 'panic',
  ok: 'approve', aprobar: 'approve', approve: 'approve',
  no: 'reject', rechazar: 'reject', reject: 'reject',
  manual: 'manual',
  auto: 'auto', automatico: 'auto',
  mudo: 'mute', mute: 'mute',
  voz: 'unmute', unmute: 'unmute',
};

/** Órdenes de control que el streamer y los mods escriben en el chat (!s skip, !skip, !s pausa, !pausa...). */
export function parseControl(message: string): ControlCommand | null {
  // Acepta tanto el prefijo !s <comando> como el comando directo !<comando>
  const match = /^!(?:s\s+)?([a-z]+)(?:\s+@?([a-z0-9_]{1,25}))?(?:\s+(\d{1,4}))?[.,!?;]*$/i.exec(message.trim());
  if (!match) return null;
  const action = CONTROL_WORDS[match[1].toLowerCase()];
  if (!action) return null;
  const user = normalizeUser(match[2]);
  if (action === 'timeout') {
    if (!user) return null;
    const minutes = Math.min(MAX_TIMEOUT_MINUTES, Math.max(1, parseInt(match[3] || '', 10) || DEFAULT_TIMEOUT_MINUTES));
    return { action, user, minutes };
  }
  if (match[3]) return null;
  if (action === 'block' || action === 'unblock') return user ? { action, user } : null;
  return user ? null : { action };
}

/** Reglas escalares para la query de la URL del widget. */
export function moderationToQuery(mod: Moderation): Record<string, string> {
  const query: Record<string, string> = {
    role: mod.minRole,
    cd: String(mod.cooldownSec),
    len: String(mod.maxLength),
    q: String(mod.maxQueueSize),
    cmd: mod.commandEnabled ? '1' : '0',
    bits: String(mod.minBits),
    appr: mod.approvalMode ? '1' : '0',
    prio: mod.priorityPaid ? '1' : '0',
    mute: mod.textOnly ? '1' : '0',
    mod_audio: mod.modNotificationAudio !== false ? '1' : '0',
    mod_voice: mod.modNotificationVoice !== false ? '1' : '0',
  };
  if (mod.rewardId) query.reward = mod.rewardId;
  return query;
}

/** Listas de bloqueo codificadas para el fragmento de la URL ('' si están vacías). */
export function encodeBlockLists(mod: Moderation): string {
  if (!mod.blockedWords.length && !mod.blockedUsers.length) return '';
  return encodeBase64Url(JSON.stringify({ w: mod.blockedWords, u: mod.blockedUsers }));
}

/** Lee de la URL solo las reglas presentes y válidas. */
export function moderationFromParams(get: (key: string) => string | null): Partial<Moderation> {
  const raw: Partial<Record<keyof Moderation, unknown>> = {};
  const map: [string, keyof Moderation][] = [
    ['role', 'minRole'],
    ['cd', 'cooldownSec'],
    ['len', 'maxLength'],
    ['q', 'maxQueueSize'],
    ['reward', 'rewardId'],
    ['bits', 'minBits'],
  ];
  map.forEach(([param, key]) => {
    const value = get(param);
    if (value !== null) raw[key] = value;
  });
  const cmd = get('cmd');
  if (cmd !== null) raw.commandEnabled = cmd !== '0';
  const flags: [string, keyof Moderation][] = [
    ['appr', 'approvalMode'],
    ['prio', 'priorityPaid'],
    ['mute', 'textOnly'],
    ['mod_audio', 'modNotificationAudio'],
    ['mod_voice', 'modNotificationVoice'],
  ];
  flags.forEach(([param, key]) => {
    const value = get(param);
    if (value !== null) raw[key] = value === '1';
  });
  const lists = decodeBase64Url(get('block'));
  if (lists) {
    try {
      const parsed = JSON.parse(lists);
      raw.blockedWords = parsed?.w;
      raw.blockedUsers = parsed?.u;
    } catch {
      // Lista ilegible: se ignora
    }
  }
  const normalized = normalizeModeration(raw);
  const result: Partial<Moderation> = {};
  (Object.keys(raw) as (keyof Moderation)[]).forEach((key) => {
    (result as Record<string, unknown>)[key] = normalized[key];
  });
  return result;
}
