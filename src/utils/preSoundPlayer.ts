/**
 * src/utils/preSoundPlayer.ts
 *
 * Hace sonar el «sonido antes de la voz». Lo usan la fuente de OBS y el botón
 * «Probar» del panel.
 *
 * - El archivo propio se carga por adelantado (`preload`) para que no haya hueco.
 * - `play` devuelve una promesa que se cumple cuando la voz ya puede empezar:
 *   al acabar el sonido o, si dura más del tope, al llegar al tope (y entonces
 *   el sonido se va apagando debajo de la voz). Nunca falla: si el archivo no
 *   carga o el navegador no deja sonar, suena el de serie o nada, y la voz sigue.
 */

import { resolveMediaUrl } from '../lib/mediaRef';
import { playAlertAudio } from './alertsAudio';
import { PRE_SOUND_FADE_MS, PreSoundSettings, planPreSound, synthDurationMs } from './preSound';

export interface PreSoundPlayer {
  /** Deja listo el archivo propio de estos ajustes. Llamarlo con cada cambio. */
  preload: (settings: PreSoundSettings) => void;
  /** Suena y avisa cuando la voz puede empezar. */
  play: (settings: PreSoundSettings) => Promise<void>;
  /** Corta el sonido ya (mensaje saltado, silencio total). */
  stop: () => void;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createPreSoundPlayer(): PreSoundPlayer {
  let loadedUrl: string | null = null;
  let element: HTMLAudioElement | null = null;
  let broken = false;
  let fadeTimer: ReturnType<typeof setInterval> | null = null;
  let turn = 0;

  const stopFade = () => {
    if (fadeTimer) clearInterval(fadeTimer);
    fadeTimer = null;
  };

  const preload = (settings: PreSoundSettings) => {
    const url = settings.enabled ? resolveMediaUrl(settings.customUrl) : null;
    if (url === loadedUrl) return;
    stopFade();
    element?.pause();
    loadedUrl = url;
    element = null;
    broken = false;
    if (!url || typeof Audio === 'undefined') return;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.onerror = () => {
      if (element === audio) broken = true;
    };
    audio.src = url;
    audio.load();
    element = audio;
  };

  const stop = () => {
    turn += 1;
    stopFade();
    element?.pause();
  };

  /** Baja el volumen poco a poco con un temporizador: OBS detiene las animaciones de las fuentes ocultas. */
  const fadeOut = (audio: HTMLAudioElement, from: number) => {
    stopFade();
    const steps = 12;
    let step = 0;
    fadeTimer = setInterval(() => {
      step += 1;
      audio.volume = Math.max(0, from * (1 - step / steps));
      if (step >= steps) {
        stopFade();
        audio.pause();
      }
    }, PRE_SOUND_FADE_MS / steps);
  };

  const playSynth = async (settings: PreSoundSettings) => {
    playAlertAudio(settings.soundType, settings.volume);
    await wait(synthDurationMs(settings.soundType));
  };

  const play = async (settings: PreSoundSettings): Promise<void> => {
    preload(settings);
    stopFade();
    turn += 1;
    const mine = turn;
    const audio = element;
    if (!audio || broken) return playSynth(settings);

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = settings.volume;
      await audio.play();
    } catch {
      // El archivo no carga o el navegador no deja sonar: queda el sonido de serie
      return playSynth(settings);
    }

    const plan = planPreSound(Number.isFinite(audio.duration) ? audio.duration * 1000 : null);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, plan.waitMs);
      const early = () => {
        clearTimeout(timer);
        resolve();
      };
      audio.addEventListener('ended', early, { once: true });
      audio.addEventListener('error', early, { once: true });
    });
    // Sigue sonando al llegar al tope: se apaga debajo de la voz, salvo que ya haya entrado otro
    if (mine === turn && !audio.paused && !audio.ended) fadeOut(audio, settings.volume);
  };

  return { preload, play, stop };
}
