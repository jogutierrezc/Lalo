/**
 * src/utils/petsLogic.ts
 *
 * Lógica pura de «Mascotas», sin DOM ni red para poder probarla: qué evento
 * despierta a la mascota, qué frase dice, las esperas, el silencio del chat y
 * la curva de volumen con la que mueve la boca.
 */

import { BUILTIN_POWERUPS } from '../types/powerups';
import type { PetTriggerId, PetsSettings } from '../types/pets';
import type { TwitchEvent } from './twitchEvents';

export type CueValues = Partial<Record<'user' | 'canje' | 'costo' | 'bits' | 'mensaje' | 'personas', string | number>>;

/** Algo que despierta a la mascota, ya reducido a lo que necesita para hablar. */
export interface PetCue {
  trigger: PetTriggerId;
  values: CueValues;
  /** Usuario de Twitch en minúsculas, para los bloqueos. Vacío si no se sabe. */
  login?: string;
  /** Lo que escribió el espectador: pasa por las palabras bloqueadas. */
  viewerText?: string;
  /** Prueba del panel: no mira interruptores ni esperas. */
  test?: boolean;
}

/** Datos de ejemplo de cada activador, para las pruebas del panel. */
export const SAMPLE_CUES: Record<PetTriggerId, PetCue> = {
  points: { trigger: 'points', values: { user: 'pau_rl', canje: 'Hidrátate', costo: 300 }, test: true },
  bits: { trigger: 'bits', values: { user: 'mar_ia', bits: 500 }, test: true },
  powerup: { trigger: 'powerup', values: { user: 'dani_gg', canje: 'Mensaje gigante', bits: 30 }, test: true },
  mention: { trigger: 'mention', values: { user: 'caro_tv', mensaje: '¿quién gana hoy?' }, test: true },
  raid: { trigger: 'raid', values: { user: 'noa_live', personas: 48 }, test: true },
  quiet: { trigger: 'quiet', values: {}, test: true },
};

/** Sustituye las variables de una frase; sin valor no deja huecos ni puntuación suelta. */
export function fillLine(template: string, values: CueValues, petName: string): string {
  const all: Record<string, string | number | undefined> = { ...values, nombre: petName };
  return template
    .replace(/\{(\w+)\}/g, (_match, key: string) => (all[key] === undefined ? '' : String(all[key])))
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

/** Una frase al azar. `random` devuelve un número en [0, 1). */
export function pickLine(lines: readonly string[], random: () => number = Math.random): string {
  if (lines.length === 0) return '';
  return lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))];
}

/** Segundos que faltan para que el activador pueda volver a reaccionar. */
export function cooldownLeft(lastAt: number | undefined, now: number, cooldownSec: number): number {
  if (!lastAt || cooldownSec <= 0) return 0;
  return Math.max(0, Math.ceil((lastAt + cooldownSec * 1000 - now) / 1000));
}

const fold = (value: string): string =>
  value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * ¿Llama este mensaje a la mascota? Sí si empieza por su comando o si su nombre
 * aparece como palabra suelta. Devuelve lo que queda del mensaje, o null.
 */
export function callsPet(message: string, petName: string, command: string): string | null {
  const text = message.trim();
  const lower = text.toLowerCase();
  if (command && (lower === command || lower.startsWith(`${command} `))) return text.slice(command.length).trim();
  const name = fold(petName.trim());
  if (name.length < 3) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_])@?${escaped}($|[^a-z0-9_])`).test(fold(text)) ? text : null;
}

/**
 * ¿Toca comentar el silencio? Sí cuando pasó el tiempo desde el último mensaje
 * y la mascota aún no habló en este silencio: así no le habla a un chat vacío
 * una y otra vez.
 */
export function quietDue(lastChatAt: number, lastQuietAt: number, now: number, minutes: number): boolean {
  if (!lastChatAt) return false;
  return now - lastChatAt >= minutes * 60_000 && lastQuietAt < lastChatAt;
}

/** Evento del canal de Twitch → activador de la mascota, o null si no le toca. */
export function cueFromEvent(event: TwitchEvent, settings: Pick<PetsSettings, 'skipTextRedemptions'>): PetCue | null {
  const base = { login: event.login, viewerText: event.text, test: event.test };
  if (event.kind === 'points') {
    if (settings.skipTextRedemptions && event.text !== '') return null;
    return { ...base, trigger: 'points', values: { user: event.user, canje: event.title, costo: event.cost, mensaje: event.text } };
  }
  if (event.kind === 'powerup') {
    return { ...base, trigger: 'powerup', values: { user: event.user, canje: event.title, bits: event.bits, mensaje: event.text } };
  }
  // Los cheers llegan por el chat; un Power-up personalizado, además, como canje (arriba)
  if (event.use === 'power_up' && event.builtin) {
    const title = BUILTIN_POWERUPS.find((item) => item.id === event.builtin)?.name ?? 'Power-up';
    return { ...base, trigger: 'powerup', values: { user: event.user, canje: title, bits: event.bits, mensaje: event.text } };
  }
  return null;
}

export type CueOutcome =
  | { ok: true; text: string }
  | { ok: false; why: 'off' | 'disabled' | 'cooldown' | 'small' | 'no_lines' };

/** Qué dice la mascota ante un activador, o por qué calla. No mira bloqueos ni la cola. */
export function planCue(
  cue: PetCue,
  settings: PetsSettings,
  ctx: { now: number; lastAt?: number; random?: () => number }
): CueOutcome {
  const trigger = settings.triggers[cue.trigger];
  if (!cue.test) {
    if (!settings.enabled) return { ok: false, why: 'off' };
    if (!trigger.on) return { ok: false, why: 'disabled' };
    if (cue.trigger === 'bits' && Number(cue.values.bits ?? 0) < settings.minBits) return { ok: false, why: 'small' };
    if (cooldownLeft(ctx.lastAt, ctx.now, trigger.cooldownSec) > 0) return { ok: false, why: 'cooldown' };
  }
  const text = fillLine(pickLine(trigger.lines, ctx.random), cue.values, settings.name);
  return text ? { ok: true, text } : { ok: false, why: 'no_lines' };
}

/** Segundos que se tarda en decir un texto, cuando no hay audio que lo diga. */
export function speakSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(12, Math.max(1.8, words * 0.34));
}

// ---------- Boca al ritmo de la voz ----------

export const ENVELOPE_FPS = 30;

/**
 * Curva de volumen de un audio: un valor de 0 a 1 por cada 1/fps de segundo
 * (raíz de la media de los cuadrados, normalizada al tramo más fuerte).
 */
export function volumeEnvelope(samples: ArrayLike<number>, sampleRate: number, fps = ENVELOPE_FPS): number[] {
  const size = Math.max(1, Math.floor(sampleRate / fps));
  const levels: number[] = [];
  for (let start = 0; start < samples.length; start += size) {
    const end = Math.min(samples.length, start + size);
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += samples[i] * samples[i];
    levels.push(Math.sqrt(sum / (end - start)));
  }
  const peak = Math.max(0, ...levels);
  return peak > 0 ? levels.map((level) => level / peak) : levels.map(() => 0);
}

/** Volumen en un instante del audio (segundos). Fuera de la curva, 0. */
export function envelopeAt(envelope: readonly number[], seconds: number, fps = ENVELOPE_FPS): number {
  const index = Math.floor(seconds * fps);
  return index >= 0 && index < envelope.length ? envelope[index] : 0;
}
