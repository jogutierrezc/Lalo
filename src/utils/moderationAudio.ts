/**
 * src/utils/moderationAudio.ts
 *
 * Motor de retroalimentación sonora y locución para acciones de moderación en Lalo Stream Suite.
 *
 * Principios de Emil Kowalski:
 * - Cero dependencias externas (Web Audio API nativo + SpeechSynthesis).
 * - Tono táctico, profesional y no abrasivo estilo intercomb/radio broadcast (784Hz -> 1046Hz).
 * - Anuncio de voz sintético ágil y breve que confirma la acción y el moderador que la ejecutó.
 */

import { ControlAction } from './moderation';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtxClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtxClass) return null;
  if (!audioCtx) {
    audioCtx = new AudioCtxClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Reproduce un chime táctico de dos tonos (G5 -> C6) tipo "radio chirp / intercomm"
 * que confirma la ejecución instantánea de una orden de moderación en cabina.
 */
export function playModerationChime(volume = 0.8): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const vol = Math.max(0.05, Math.min(1.0, volume * 0.55));

    // Nota 1: G5 (783.99 Hz) durante 45ms
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(783.99, now);

    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(vol, now + 0.008);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.05);

    // Nota 2: C6 (1046.50 Hz) durante 75ms
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1046.5, now + 0.04);

    gain2.gain.setValueAtTime(0.001, now + 0.04);
    gain2.gain.exponentialRampToValueAtTime(vol * 1.15, now + 0.048);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.04);
    osc2.stop(now + 0.13);
  } catch {
    // Silencioso ante restricciones de reproducción del navegador
  }
}

/**
 * Diccionario descriptivo de la acción en español natural.
 */
export const ACTION_DESCRIPTIONS: Record<ControlAction, (sender: string, target?: string, minutes?: number) => string> = {
  skip: (sender) => `Mensaje saltado por ${sender}`,
  pause: (sender) => `TTS pausado por ${sender}`,
  resume: (sender) => `TTS reanudado por ${sender}`,
  clear: (sender) => `Cola de mensajes vaciada por ${sender}`,
  panic: (sender) => `Modo silencio total activado por ${sender}`,
  timeout: (sender, target, min) =>
    target
      ? `${target} silenciado por ${min || 10} minutos por ${sender}`
      : `Usuario silenciado por ${sender}`,
  block: (sender, target) =>
    target ? `${target} bloqueado por ${sender}` : `Usuario bloqueado por ${sender}`,
  unblock: (sender, target) =>
    target ? `${target} desbloqueado por ${sender}` : `Usuario desbloqueado por ${sender}`,
  approve: (sender) => `Mensaje aprobado por ${sender}`,
  reject: (sender) => `Mensaje rechazado por ${sender}`,
  manual: (sender) => `Aprobación manual activada por ${sender}`,
  auto: (sender) => `Aprobación automática activada por ${sender}`,
  mute: (sender) => `Modo solo texto activado por ${sender}`,
  unmute: (sender) => `Voz activada por ${sender}`,
  reload: (sender) => `Overlay recargado por ${sender}`,
  poll_start: (sender, target) => `Votación iniciada por ${sender}: ${target || 'Batalla en vivo'}`,
  poll_stop: (sender) => `Votación cancelada por ${sender}`,
};

/**
 * Anuncia la orden de moderación por voz mediante el sintetizador local
 * del navegador (Web Speech API) con cadencia rápida para no entorpecer el stream.
 */
export function announceModerationAction(
  action: ControlAction,
  sender = 'Moderación',
  target?: string,
  minutes?: number,
  volume = 0.85
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  try {
    const formatter = ACTION_DESCRIPTIONS[action];
    if (!formatter) return;

    const message = formatter(sender, target, minutes);
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = 'es-ES';
    utterance.rate = 1.15; // Ligeramente más rápido para un reporte táctico conciso
    utterance.volume = Math.max(0.1, Math.min(1.0, volume));

    window.speechSynthesis.speak(utterance);
  } catch {
    // Silencioso ante navegadores sin soporte
  }
}
