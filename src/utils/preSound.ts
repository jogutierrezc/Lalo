/**
 * src/utils/preSound.ts
 *
 * «Sonido antes de la voz»: un aviso corto que suena justo antes de que la voz
 * lea un mensaje. Aquí solo hay lógica pura, para poder probarla: los ajustes y
 * su normalización, cuándo toca que suene, cuánto espera la voz y cómo viaja en
 * la URL de OBS. Lo que hace ruido está en preSoundPlayer.ts.
 */

import type { AlertSoundType } from '../types/alerts';

export type PreSoundType = Exclude<AlertSoundType, 'none'>;

/** Cuándo suena: en cada mensaje, solo en los de pago o destacados, o al romper un silencio. */
export type PreSoundWhen = 'all' | 'paid' | 'quiet';

export interface PreSoundSettings {
  enabled: boolean;
  /** Sonido de serie. Suena también de reserva si el archivo propio no carga. */
  soundType: PreSoundType;
  /** Archivo propio: dirección pública, `r2:clave` o incrustado (data:). Vacío = sonido de serie. */
  customUrl: string;
  customName: string;
  customMediaId: string;
  volume: number; // 0 a 1
  when: PreSoundWhen;
}

/** La voz nunca espera más de esto por el sonido; si es más largo, se va apagando debajo de ella. */
export const PRE_SOUND_CAP_MS = 3000;
/** Lo que tarda en apagarse un sonido largo cuando la voz empieza encima. */
export const PRE_SOUND_FADE_MS = 1200;
/** «Tras un rato de silencio»: sin voz durante este tiempo, el siguiente mensaje lleva sonido. */
export const PRE_SOUND_QUIET_MS = 60000;
/** Duración máxima de un archivo propio, en segundos. */
export const PRE_SOUND_MAX_FILE_SECONDS = 10;

export const PRE_SOUNDS: { id: PreSoundType; name: string; ms: number }[] = [
  { id: 'soft-pop', name: 'Pop suave (0,25 s)', ms: 250 },
  { id: 'arcade-chime', name: 'Arcade (0,6 s)', ms: 600 },
  { id: 'retro-fanfare', name: 'Fanfarria (0,6 s)', ms: 600 },
  { id: 'synth-bell', name: 'Campana (1,4 s)', ms: 1400 },
];

export const PRE_SOUND_WHEN: { id: PreSoundWhen; name: string; hint: string }[] = [
  { id: 'all', name: 'Cada mensaje', hint: 'Suena antes de cada mensaje que lee la voz.' },
  { id: 'paid', name: 'De pago o destacados', hint: 'Solo antes de los mensajes con puntos del canal, con bits o destacados.' },
  { id: 'quiet', name: 'Tras un silencio', hint: 'Solo si la voz llevaba un minuto callada: avisa de que vuelve a hablar.' },
];

export const DEFAULT_PRE_SOUND: PreSoundSettings = {
  enabled: false,
  soundType: 'soft-pop',
  customUrl: '',
  customName: '',
  customMediaId: '',
  volume: 0.6,
  when: 'all',
};

const isType = (value: unknown): value is PreSoundType => PRE_SOUNDS.some((sound) => sound.id === value);
const isWhen = (value: unknown): value is PreSoundWhen => PRE_SOUND_WHEN.some((item) => item.id === value);
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function clampVolume(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

/** ¿Es una referencia que un navegador puede abrir? Lo demás se descarta. */
function cleanUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  return /^(https?:|data:audio\/|blob:|r2:|\/)/i.test(url) ? url : '';
}

/** Normaliza lo guardado, lo que llega de la nube o de la URL. Lo que no vale queda en su valor por defecto. */
export function normalizePreSound(raw: unknown): PreSoundSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const customUrl = cleanUrl(source.customUrl);
  return {
    enabled: source.enabled === true,
    soundType: isType(source.soundType) ? source.soundType : DEFAULT_PRE_SOUND.soundType,
    customUrl,
    customName: customUrl ? text(source.customName, 120) : '',
    customMediaId: customUrl ? text(source.customMediaId, 80) : '',
    volume: clampVolume(source.volume, DEFAULT_PRE_SOUND.volume),
    when: isWhen(source.when) ? source.when : DEFAULT_PRE_SOUND.when,
  };
}

// ---------- Cuándo suena ----------

export interface PreSoundContext {
  /** Cómo llegó el mensaje a la cola de voz. */
  trigger?: string;
  /** Frase de otra capa (ruleta, saludo de raid, Power-ups), no de un espectador. */
  system?: boolean;
  /** El mensaje ya viene con su propio sonido (una alerta con sonido): no se pone otro encima. */
  hasOwnSound?: boolean;
  /** Modo «solo texto»: la voz no suena, así que el aviso tampoco. */
  textOnly?: boolean;
  /** Cuándo terminó de hablar la voz por última vez (0 = todavía no ha hablado). */
  lastSpokenAt: number;
  now: number;
}

const PAID_TRIGGERS = ['reward', 'bits', 'highlight'];

/**
 * ¿Suena el aviso antes de este mensaje?
 *
 * - Nunca en «solo texto», ni si el mensaje trae su propio sonido, ni en las
 *   frases de otras capas (la ruleta y el saludo de raid ya tienen su sonido).
 * - Las pruebas del panel y las alertas solo de voz cuentan como un mensaje más.
 */
export function shouldPlayPreSound(settings: PreSoundSettings, ctx: PreSoundContext): boolean {
  if (!settings.enabled || settings.volume <= 0) return false;
  if (ctx.textOnly || ctx.hasOwnSound || ctx.system) return false;
  if (settings.when === 'paid') return PAID_TRIGGERS.includes(ctx.trigger || '');
  if (settings.when === 'quiet') return ctx.lastSpokenAt <= 0 || ctx.now - ctx.lastSpokenAt >= PRE_SOUND_QUIET_MS;
  return true;
}

/** Duración conocida del sonido de serie, en milisegundos. */
export function synthDurationMs(type: PreSoundType): number {
  return PRE_SOUNDS.find((sound) => sound.id === type)?.ms ?? 600;
}

/**
 * Cuánto espera la voz y si el sonido sigue sonando debajo de ella.
 * Con duración desconocida (el archivo aún no ha cargado) se espera el tope.
 */
export function planPreSound(durationMs: number | null | undefined, capMs = PRE_SOUND_CAP_MS): { waitMs: number; fadeUnder: boolean } {
  const known = typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0;
  if (!known) return { waitMs: capMs, fadeUnder: true };
  return durationMs <= capMs ? { waitMs: Math.round(durationMs), fadeUnder: false } : { waitMs: capMs, fadeUnder: true };
}

// ---------- URL de OBS ----------

/** Un archivo incrustado o temporal no cabe en una URL: solo viaja una dirección pública o `r2:`. */
export function preSoundUrlTravels(url: string): boolean {
  return /^(https?:|r2:|\/)/i.test(url.trim());
}

/** Parámetros del sonido para la URL del widget. Apagado va como `ps=0`, para que la URL lo diga claro. */
export function preSoundToQuery(settings: PreSoundSettings | undefined): Record<string, string> {
  const ps = normalizePreSound(settings);
  if (!ps.enabled) return { ps: '0' };
  const query: Record<string, string> = { ps: '1', pst: ps.soundType, psv: String(ps.volume), psw: ps.when };
  if (ps.customUrl && preSoundUrlTravels(ps.customUrl)) query.psu = ps.customUrl;
  return query;
}

/** Lee el sonido de la URL. Sin `ps` devuelve null: la URL no dice nada sobre él. */
export function preSoundFromParams(get: (key: string) => string | null): PreSoundSettings | null {
  const flag = get('ps');
  if (flag === null) return null;
  const url = get('psu') || '';
  return normalizePreSound({
    enabled: flag === '1',
    soundType: get('pst'),
    volume: get('psv') ?? undefined,
    when: get('psw'),
    customUrl: preSoundUrlTravels(url) ? url : '',
  });
}
