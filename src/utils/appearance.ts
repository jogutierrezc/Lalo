/**
 * appearance.ts
 *
 * Apariencia del widget de OBS: estilo de alerta, color de acento, posición,
 * tamaño, energía del movimiento y sticker SVG de identidad del canal.
 *
 * El navegador de OBS no comparte localStorage con el navegador donde se abre
 * el panel, así que estos valores también viajan en la URL del widget. Todo lo
 * que llega por URL o BroadcastChannel se normaliza aquí antes de usarse.
 */

export type AlertStyle = 'cabina' | 'bocadillo' | 'subtitulo' | 'sticker';
export type AlertPosition = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br';
export type AlertEnergy = 'calma' | 'normal' | 'hype';

export interface Appearance {
  alertStyle: AlertStyle;
  accent: string; // #rrggbb
  position: AlertPosition;
  scale: number; // 0.8 a 1.3
  energy: AlertEnergy;
  stickerSvg: string; // SVG validado o cadena vacía
}

export const ALERT_STYLES: { id: AlertStyle; name: string; description: string }[] = [
  { id: 'cabina', name: 'Cabina', description: 'Rótulo de emisión con vúmetro.' },
  { id: 'bocadillo', name: 'Bocadillo', description: 'Globo de cómic que sale del avatar.' },
  { id: 'subtitulo', name: 'Subtítulo', description: 'Solo texto, tipo karaoke.' },
  { id: 'sticker', name: 'Sticker', description: 'El SVG de tu canal, animado.' },
];

export const ALERT_POSITIONS: { id: AlertPosition; name: string }[] = [
  { id: 'tl', name: 'Arriba a la izquierda' },
  { id: 'tc', name: 'Arriba al centro' },
  { id: 'tr', name: 'Arriba a la derecha' },
  { id: 'bl', name: 'Abajo a la izquierda' },
  { id: 'bc', name: 'Abajo al centro' },
  { id: 'br', name: 'Abajo a la derecha' },
];

export const ALERT_ENERGIES: { id: AlertEnergy; name: string }[] = [
  { id: 'calma', name: 'Calma' },
  { id: 'normal', name: 'Normal' },
  { id: 'hype', name: 'Hype' },
];

export const SCALE_MIN = 0.8;
export const SCALE_MAX = 1.3;

// Límite del sticker: viaja en el fragmento de la URL del widget
export const MAX_STICKER_BYTES = 20000;

export const DEFAULT_APPEARANCE: Appearance = {
  alertStyle: 'cabina',
  accent: '#9146ff',
  position: 'bl',
  scale: 1,
  energy: 'normal',
  stickerSvg: '',
};

const isOneOf = <T extends string>(list: { id: T }[], value: unknown): value is T =>
  typeof value === 'string' && list.some((item) => item.id === value);

/** Devuelve el color como #rrggbb en minúsculas, o null si no es un hex válido. */
export function normalizeAccent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${hex.replace(/./g, (c) => c + c)}`;
  return null;
}

/** Color de texto legible (oscuro o blanco) sobre un fondo dado. */
export function inkFor(hex: string): string {
  const color = normalizeAccent(hex) || DEFAULT_APPEARANCE.accent;
  const n = parseInt(color.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.19 ? '#16141d' : '#ffffff';
}

export function clampScale(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return DEFAULT_APPEARANCE.scale;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, n));
}

export type StickerResult = { ok: true; svg: string } | { ok: false; error: string };

/**
 * Valida el SVG de identidad del canal. El widget lo pinta siempre dentro de un
 * <img>, donde el navegador no ejecuta scripts ni carga recursos externos; aun
 * así se rechazan los SVG con código activo.
 */
export function validateStickerSvg(text: string): StickerResult {
  const svg = (text || '').trim();
  if (!svg) return { ok: false, error: 'El archivo está vacío.' };
  if (new TextEncoder().encode(svg).length > MAX_STICKER_BYTES) {
    return {
      ok: false,
      error: `El SVG pesa más de ${MAX_STICKER_BYTES / 1000} KB. Simplifícalo o expórtalo sin imágenes incrustadas.`,
    };
  }
  if (!/<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) {
    return { ok: false, error: 'El archivo no es un SVG válido.' };
  }
  if (/<script[\s>]/i.test(svg) || /\son\w+\s*=/i.test(svg) || /javascript:/i.test(svg)) {
    return { ok: false, error: 'El SVG contiene scripts. Expórtalo como SVG plano.' };
  }
  return { ok: true, svg };
}

export function stickerDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Codifica el SVG en base64url para llevarlo en el fragmento de la URL. */
export function encodeSticker(svg: string): string {
  let binary = '';
  new TextEncoder().encode(svg).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodifica y valida un sticker recibido por URL. Devuelve null si no es usable. */
export function decodeSticker(param: string | null | undefined): string | null {
  if (!param) return null;
  try {
    const base64 = param.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const result = validateStickerSvg(new TextDecoder().decode(bytes));
    return result.ok ? result.svg : null;
  } catch {
    return null;
  }
}

/** Normaliza una apariencia de origen no confiable (localStorage, BroadcastChannel). */
export function normalizeAppearance(raw: Partial<Record<keyof Appearance, unknown>> | null | undefined): Appearance {
  const source = raw || {};
  const sticker = typeof source.stickerSvg === 'string' && source.stickerSvg ? validateStickerSvg(source.stickerSvg) : null;
  return {
    alertStyle: isOneOf(ALERT_STYLES, source.alertStyle) ? source.alertStyle : DEFAULT_APPEARANCE.alertStyle,
    accent: normalizeAccent(source.accent) || DEFAULT_APPEARANCE.accent,
    position: isOneOf(ALERT_POSITIONS, source.position) ? source.position : DEFAULT_APPEARANCE.position,
    scale: clampScale(source.scale),
    energy: isOneOf(ALERT_ENERGIES, source.energy) ? source.energy : DEFAULT_APPEARANCE.energy,
    stickerSvg: sticker && sticker.ok ? sticker.svg : '',
  };
}

/** Lee solo los parámetros de apariencia presentes en la URL del widget. */
export function appearanceFromParams(get: (key: string) => string | null): Partial<Appearance> {
  const result: Partial<Appearance> = {};
  const style = get('style');
  if (isOneOf(ALERT_STYLES, style)) result.alertStyle = style;
  const accent = normalizeAccent(get('accent'));
  if (accent) result.accent = accent;
  const position = get('pos');
  if (isOneOf(ALERT_POSITIONS, position)) result.position = position;
  const scale = get('scale');
  if (scale !== null) result.scale = clampScale(scale);
  const energy = get('energy');
  if (isOneOf(ALERT_ENERGIES, energy)) result.energy = energy;
  const sticker = decodeSticker(get('sticker'));
  if (sticker) result.stickerSvg = sticker;
  return result;
}
