/**
 * src/utils/rouletteAudio.ts
 *
 * Sintetizador de audio mecánico para la Ruleta de Castigos de Lalo Stream Suite.
 *
 * Implementado bajo los principios de artesanía de Emil Kowalski:
 * - Cero dependencias externas (Web Audio API nativo).
 * - Sonidos orgánicos, sutiles y no abrasivos.
 * - Ticks mecánicos con pitch sutilmente modulado para evitar fatiga auditiva.
 * - Tríada armónica de resolución al detenerse la ruleta.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
 * Reproduce un «tick» mecánico nítido simulando el impacto del puntero flexible
 * contra los postes perimetrales de la ruleta.
 *
 * @param volume Volumen relativo (0 a 1).
 * @param pitchScale Variación de tono para evitar que los clicks suenen monótonos.
 */
export function playWheelTick(volume = 0.7, pitchScale = 1.0): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    // Filtro pasa-altos para limpiar frecuencias graves que puedan saturar
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(600, now);

    // Oscilador de onda triangular para un click percusivo pero cálido
    osc.type = 'triangle';
    // Frecuencia base con ligera aleatoriedad
    const baseFreq = (950 + Math.random() * 80) * Math.max(0.5, Math.min(1.5, pitchScale));
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.022);

    // Envolvente rápida y percusiva (ataque instantáneo y decaimiento en 20ms)
    const targetGain = Math.max(0.01, Math.min(1.0, volume * 0.45));
    gain.gain.setValueAtTime(targetGain, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.03);
  } catch {
    // Silencioso ante restricciones de audio
  }
}

/**
 * Reproduce un sonido de impacto dramático y fanfarria cuando la aguja
 * se detiene en el castigo ganador.
 */
export function playWheelFanfare(volume = 0.85): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;

    // Tríada mayor ascendente brillante (Do5 - Mi5 - Sol5 - Do6)
    const notes = [
      { f: 523.25, t: 0.0 },  // C5
      { f: 659.25, t: 0.1 },  // E5
      { f: 783.99, t: 0.2 },  // G5
      { f: 1046.5, t: 0.32 }, // C6
    ];

    notes.forEach(({ f, t }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + t);

      const baseGain = volume * 0.22;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(baseGain, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + t);
      osc.stop(now + t + 0.5);
    });
  } catch {
    // Silencioso ante restricciones de audio
  }
}

/**
 * Sonido cinemático de viento / aceleración al iniciar el giro de la ruleta.
 */
export function playWheelWhoosh(volume = 0.75): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(220, now);
    filter.frequency.exponentialRampToValueAtTime(1400, now + 0.25);
    filter.frequency.exponentialRampToValueAtTime(300, now + 0.6);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(65, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.28);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.65);

    const safeVol = Math.max(0.01, Math.min(1.0, volume * 0.35));
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(safeVol, now + 0.22);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.75);
  } catch {
    // Silencio seguro
  }
}

// ==========================================
// VOZ DE PRUEBA EN EL ESTUDIO
// ==========================================
//
// En la emisión la ruleta no habla por aquí: sus frases entran en la cola de voz
// del sistema (la misma de «Voz del chat»), una detrás de otra, con la voz que
// eligió el streamer. Ver RouletteLayer.tsx y createAnnouncer en rouletteLogic.ts.
//
// Esto es solo para oír la prueba en el panel, donde no hay cola: pide la frase
// con la voz configurada y nunca recurre a la voz del navegador. Una frase nueva
// corta la anterior, así que no pueden sonar dos a la vez.

import { loadSettings } from '../types/settings';
import { normalizeTextForFishAudio } from './emotionMapper';
import { ROULETTE_LOCK } from './rouletteLogic';

let previewAudio: HTMLAudioElement | null = null;
let previewUrl: string | null = null;
let previewTurn = 0;

/** Corta la voz de prueba que esté sonando o en camino. */
export function stopRoulettePreview(): void {
  previewTurn += 1;
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.src = '';
    previewAudio = null;
  }
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
}

/** ¿Hay una fuente de la ruleta abierta en este mismo navegador? Entonces la voz la pone ella. */
export async function rouletteSourceOpen(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.locks?.query) return false;
    const state = await navigator.locks.query();
    return (state.held || []).some((lock) => lock.name === ROULETTE_LOCK);
  } catch {
    return false;
  }
}

/**
 * Dice una frase de la ruleta en el panel con la voz de «Voz del chat».
 * Devuelve quién habla: 'panel', 'source' (lo dirá la fuente abierta en este
 * navegador) o 'none' si el servicio de voz no respondió.
 */
export async function speakRoulettePreview(text: string): Promise<'panel' | 'source' | 'none'> {
  if (typeof window === 'undefined') return 'none';
  stopRoulettePreview();
  const turn = previewTurn;
  if (await rouletteSourceOpen()) return 'source';

  const tts = loadSettings();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const res = await fetch('/api/tts', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: normalizeTextForFishAudio(text),
        reference_id: tts.referenceId || undefined,
        model: tts.model || 's2.1-pro-free',
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) return 'none';
    const blob = await res.blob();
    // Mientras llegaba el audio se pidió otra frase o se cortó: esta ya no suena
    if (turn !== previewTurn) return 'none';
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, tts.volume ?? 0.85));
    audio.playbackRate = tts.speed || 1;
    previewAudio = audio;
    previewUrl = url;
    await audio.play();
    return 'panel';
  } catch {
    return 'none';
  }
}
