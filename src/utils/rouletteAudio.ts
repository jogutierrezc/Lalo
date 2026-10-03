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
// LOCUCIÓN EMOCIONAL DE RULETA CON TTS
// (Usa la voz oficial configurada en el sistema)
// ==========================================

import { loadSettings } from '../types/settings';
import { normalizeTextForFishAudio } from './emotionMapper';
import type { RouletteSegment } from '../types/roulette';

let currentRouletteAudio: HTMLAudioElement | null = null;

export function stopRouletteAudio(): void {
  if (currentRouletteAudio) {
    currentRouletteAudio.pause();
    currentRouletteAudio.src = '';
    currentRouletteAudio = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Sintetiza y reproduce una locución emocional para la ruleta usando
 * la voz de Fish Audio configurada en el sistema (Teemo, Ahri, Jarvis, Diana, Luz, etc.)
 */
export async function speakRouletteTtsCue(
  fullText: string,
  emotion: string,
  onStart?: () => void,
  onEnd?: () => void
): Promise<void> {
  if (typeof window === 'undefined') return;

  stopRouletteAudio();

  const ttsSettings = loadSettings();
  const normalized = normalizeTextForFishAudio(fullText);

  // 1. Intentar endpoint de Fish Audio con la voz configurada
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    const res = await fetch('/api/tts', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: normalized,
        reference_id: ttsSettings.referenceId,
        model: ttsSettings.model || 's2.1-pro-free',
        speed: ttsSettings.speed || 1.0,
      }),
    });

    clearTimeout(timeout);

    if (res.ok) {
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.volume = Math.max(0.1, Math.min(1, ttsSettings.volume ?? 0.85));
      currentRouletteAudio = audio;

      audio.onplay = () => onStart?.();
      audio.onended = () => {
        currentRouletteAudio = null;
        onEnd?.();
      };
      audio.onerror = () => {
        currentRouletteAudio = null;
        fallbackRouletteSpeech(fullText, emotion, onStart, onEnd);
      };

      await audio.play();
      return;
    }
  } catch {
    // Si falla la red o API, pasar a síntesis de respaldo
  }

  // 2. Fallback resiliente a Web Speech API
  fallbackRouletteSpeech(fullText, emotion, onStart, onEnd);
}

function fallbackRouletteSpeech(
  fullText: string,
  emotion: string,
  onStart?: () => void,
  onEnd?: () => void
): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    onEnd?.();
    return;
  }

  window.speechSynthesis.cancel();

  // Limpiar etiquetas de corchetes
  const cleanText = fullText.replace(/\[[^\]]+\]/g, '').trim();
  const utterance = new SpeechSynthesisUtterance(cleanText);

  const voices = window.speechSynthesis.getVoices();
  const esVoice = voices.find((v) => v.lang.toLowerCase().startsWith('es'));
  if (esVoice) utterance.voice = esVoice;

  const emoLower = emotion.toLowerCase();
  if (emoLower.includes('emocionado') || emoLower.includes('hype')) {
    utterance.rate = 1.25;
    utterance.pitch = 1.22;
  } else if (emoLower.includes('susurro') || emoLower.includes('misterio')) {
    utterance.rate = 0.9;
    utterance.pitch = 0.88;
  } else if (emoLower.includes('triunfal') || emoLower.includes('alegria')) {
    utterance.rate = 1.15;
    utterance.pitch = 1.18;
  }

  utterance.onstart = () => onStart?.();
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();

  window.speechSynthesis.speak(utterance);
}

/**
 * Anuncia con voz emocionada que la ruleta va a comenzar a girar.
 */
export async function speakRouletteSpinAnnouncement(
  user?: string,
  title?: string,
  onStart?: () => void,
  onEnd?: () => void
): Promise<void> {
  const cleanUser = user && user !== 'Streamer' && user !== 'Admin' ? user : null;
  const script = cleanUser
    ? `[emocionado] ¡Atención al stream! ¡${cleanUser} ha puesto a girar la ruleta de retos! ¡Hagan sus apuestas, la rueda comienza a girar!`
    : title
    ? `[emocionado] ¡Atención a todos! La ${title} está girando ahora mismo. ¿Qué penitencia tocará?`
    : `[emocionado] ¡Atención al stream! ¡La ruleta de castigos y retos está girando! ¿Qué penitencia tocará hoy?`;

  return speakRouletteTtsCue(script, '[emocionado]', onStart, onEnd);
}

/**
 * Anuncia con voz triunfal / dramática el castigo o reto resultante tras detenerse la ruleta.
 */
export async function speakRouletteWinnerAnnouncement(
  winner: RouletteSegment,
  user?: string,
  onStart?: () => void,
  onEnd?: () => void
): Promise<void> {
  let script = '';
  let emotion = '[triunfal]';

  const targetUser = user && user !== 'Streamer' && user !== 'Admin' ? `@${user}` : null;

  if (winner.category === 'safe') {
    emotion = '[alegria]';
    script = targetUser
      ? `[alegria] ¡Increíble golpe de suerte para ${targetUser}! ¡Ha salido: ${winner.text}! ¡Te salvaste del castigo!`
      : `[alegria] ¡Increíble golpe de suerte! ¡Ha salido: ${winner.text}! ¡Te salvaste de la penitencia por esta ronda!`;
  } else if (winner.durationSec && winner.durationSec > 0) {
    emotion = '[triunfal]';
    script = targetUser
      ? `[triunfal] ¡La ruleta se ha detenido para ${targetUser}! El reto asignado es: ${winner.text}. Tienes ${winner.durationSec} segundos para cumplirlo.`
      : `[triunfal] ¡La ruleta se ha detenido! El reto seleccionado es: ${winner.text}. Tienes ${winner.durationSec} segundos en el reloj para cumplirlo.`;
  } else if (winner.intensity === 'extreme') {
    emotion = '[sorprendido]';
    script = targetUser
      ? `[sorprendido] ¡Madre mía! ¡Castigo extremo para ${targetUser}! El destino ha dictado: ${winner.text}. ¡A cumplirlo sin excusas!`
      : `[sorprendido] ¡Madre mía! ¡Castigo extremo! El destino ha dictado: ${winner.text}. ¡A cumplirlo sin excusas!`;
  } else {
    emotion = '[emocionado]';
    script = targetUser
      ? `[emocionado] ¡La ruleta ha hablado para ${targetUser}! El reto asignado es: ${winner.text}. ¡A cumplir ante el chat!`
      : `[emocionado] ¡La ruleta ha hablado! El reto asignado es: ${winner.text}. ¡A cumplirlo ante el chat!`;
  }

  return speakRouletteTtsCue(script, emotion, onStart, onEnd);
}

