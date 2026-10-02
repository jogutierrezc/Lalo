/**
 * src/utils/alertsAudio.ts
 *
 * Sintetizador de audio nativo mediante Web Audio API para alertas de stream.
 * No requiere archivos externos, reproduce instantáneamente con latencia cero
 * y sin problemas de CORS ni tiempos de descarga.
 */

import { AlertSoundType } from '../types/alerts';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Reproduce un chime sintetizado de acuerdo al tipo seleccionado.
 */
export function playAlertAudio(soundType: AlertSoundType, volume = 0.8): void {
  if (soundType === 'none' || volume <= 0) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const safeVol = Math.max(0, Math.min(1, volume));

  switch (soundType) {
    case 'synth-bell': {
      // Campana cristalina con armónico y decaimiento suave
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now); // A5
      osc1.frequency.exponentialRampToValueAtTime(440, now + 1.2);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1760, now); // A6 overtone
      osc2.frequency.exponentialRampToValueAtTime(880, now + 0.8);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(safeVol * 0.45, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.4);
      osc2.stop(now + 1.4);
      break;
    }

    case 'retro-fanfare': {
      // Arpegio mayor ascendente triunfal (C5, E5, G5, C6)
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const noteStart = now + idx * 0.08;
        const noteEnd = noteStart + 0.35;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, noteStart);

        gain.gain.setValueAtTime(0.001, noteStart);
        gain.gain.linearRampToValueAtTime(safeVol * 0.4, noteStart + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(noteStart);
        osc.stop(noteEnd);
      });
      break;
    }

    case 'arcade-chime': {
      // Chime retro dinámico con modulación rápida
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.2);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(safeVol * 0.35, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.6);
      break;
    }

    case 'soft-pop': {
      // Pop suave redondeado y cálido
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.15);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(safeVol * 0.5, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.25);
      break;
    }

    default:
      break;
  }
}

/**
 * Reproduce un archivo de audio personalizado (.mp3, .wav, .ogg, data URI o blob URL).
 */
export function playCustomAudio(audioUrl?: string, volume = 0.8): HTMLAudioElement | null {
  if (!audioUrl || volume <= 0 || typeof window === 'undefined') return null;
  try {
    const audio = new Audio(audioUrl);
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.play().catch((err) => {
      console.warn('No se pudo reproducir el audio personalizado:', err);
    });
    return audio;
  } catch (err) {
    console.warn('Error al instanciar audio:', err);
    return null;
  }
}

/**
 * Función unificada: reproduce audio personalizado si existe,
 * o el chime sintetizado Web Audio API si no hay archivo personalizado.
 */
export function playAlertOrCustomSound(
  customUrl?: string,
  soundType: AlertSoundType = 'synth-bell',
  volume = 0.8
): void {
  if (customUrl) {
    playCustomAudio(customUrl, volume);
  } else {
    playAlertAudio(soundType, volume);
  }
}

