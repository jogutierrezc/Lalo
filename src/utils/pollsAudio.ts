/**
 * src/utils/pollsAudio.ts
 *
 * Motor de síntesis de audio para Batallas & Encuestas en Vivo (Polls & Versus Studio).
 * Utiliza Web Audio API de baja latencia sin dependencias externas para efectos táctiles,
 * y se conecta directamente al motor TTS de Fish Audio con la voz configurada por el streamer
 * (Chispa, Seda, Atlas, Vera, Brisa o ID propio) con modulación emocional.
 */

import { loadSettings } from '../types/settings';
import { normalizeTextForFishAudio } from './emotionMapper';

let sharedAudioCtx: AudioContext | null = null;
let currentPollAudio: HTMLAudioElement | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtxClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtxClass) return null;

  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioCtxClass();
  }

  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }

  return sharedAudioCtx;
}

/**
 * Ticks auditivos diferenciados por opción de voto para retroalimentación táctil inmediata.
 * Opción 0 (Azul/Cyan): Frecuencia alta y cristalina (660Hz -> 880Hz).
 * Opción 1 (Rojo/Magenta): Tono cálido y percutivo (440Hz -> 554Hz).
 */
export function playVoteTick(volume = 0.8, optionIndex = 0): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const baseFreq = optionIndex === 0 ? 660 : 440;
    const targetFreq = optionIndex === 0 ? 880 : 554;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(targetFreq, now + 0.04);

    const safeVol = Math.max(0.01, Math.min(1, volume)) * 0.45;
    gain.gain.setValueAtTime(safeVol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.08);
  } catch {
    // Silencio seguro ante restricciones de autoplay
  }
}

/**
 * Choque metálico con sub-bajo al cambiar el líder de la batalla (Impact Clash).
 */
export function playLeadClash(volume = 0.85): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const safeVol = Math.max(0.01, Math.min(1, volume));

    // 1. Sub-punch (130Hz -> 45Hz)
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(130, now);
    subOsc.frequency.exponentialRampToValueAtTime(45, now + 0.18);

    subGain.gain.setValueAtTime(safeVol * 0.7, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.23);

    // 2. Chispazo metálico agudo (1600Hz -> 900Hz)
    const metalOsc = ctx.createOscillator();
    const metalGain = ctx.createGain();
    metalOsc.type = 'sawtooth';
    metalOsc.frequency.setValueAtTime(1600, now);
    metalOsc.frequency.exponentialRampToValueAtTime(900, now + 0.12);

    metalGain.gain.setValueAtTime(safeVol * 0.35, now);
    metalGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    metalOsc.connect(metalGain);
    metalGain.connect(ctx.destination);
    metalOsc.start(now);
    metalOsc.stop(now + 0.15);
  } catch {
    // Silencio seguro
  }
}

/**
 * Beep de cuenta regresiva (Últimos segundos).
 */
export function playCountdownBeep(volume = 0.8, isUrgent = false): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const freq = isUrgent ? 1100 : 750;
    const duration = isUrgent ? 0.08 : 0.05;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isUrgent ? 'square' : 'sine';
    osc.frequency.setValueAtTime(freq, now);

    const safeVol = Math.max(0.01, Math.min(1, volume)) * (isUrgent ? 0.4 : 0.25);
    gain.gain.setValueAtTime(safeVol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  } catch {
    // Silencio seguro
  }
}

/**
 * Fanfarria de coronación / victoria al finalizar la votación.
 */
export function playPollVictoryFanfare(volume = 0.85): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Arpegio triunfal: C5 (523Hz), E5 (659Hz), G5 (784Hz), C6 (1046Hz)
    const notes = [
      { freq: 523.25, time: 0.00, dur: 0.12 },
      { freq: 659.25, time: 0.10, dur: 0.12 },
      { freq: 783.99, time: 0.20, dur: 0.14 },
      { freq: 1046.5, time: 0.32, dur: 0.45 },
    ];

    const safeVol = Math.max(0.01, Math.min(1, volume)) * 0.4;
    const now = ctx.currentTime;

    notes.forEach(({ freq, time, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + time);

      gain.gain.setValueAtTime(0.001, now + time);
      gain.gain.exponentialRampToValueAtTime(safeVol, now + time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + time + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + time);
      osc.stop(now + time + dur + 0.02);
    });
  } catch {
    // Silencio seguro
  }
}

/**
 * Emite la locución usando la voz configurada en el módulo TTS (Fish Audio reference_id)
 * con traducción de emociones predefinidas ([emocionado], [susurro], [triunfal]).
 * Si la API remota no está disponible o falla, activa una degradación elegante a SpeechSynthesis.
 */
export async function speakPollEmotionCue(
  fullText: string,
  emotion: string,
  onStart?: () => void,
  onEnd?: () => void
): Promise<void> {
  if (typeof window === 'undefined') return;

  // Detener locución previa si estaba activa
  if (currentPollAudio) {
    currentPollAudio.pause();
    currentPollAudio.src = '';
    currentPollAudio = null;
  }

  const ttsSettings = loadSettings();
  const normalized = normalizeTextForFishAudio(fullText);

  // 1. Intentar reproducir con la voz oficial configurada en TTS mediante /api/tts
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

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
      currentPollAudio = audio;

      audio.onplay = () => onStart?.();
      audio.onended = () => {
        currentPollAudio = null;
        onEnd?.();
      };
      audio.onerror = () => {
        currentPollAudio = null;
        fallbackSpeechSynthesis(fullText, emotion, onStart, onEnd);
      };

      await audio.play();
      return;
    }
  } catch {
    // Fallback silencioso a síntesis nativa si no hay conexión o no hay API key
  }

  // 2. Degradación suave a síntesis de navegador
  fallbackSpeechSynthesis(fullText, emotion, onStart, onEnd);
}

function fallbackSpeechSynthesis(
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

  // Limpiar corchetes de emoción para síntesis nativa
  const cleanText = fullText.replace(/\[[^\]]+\]/g, '').trim();
  const utterance = new SpeechSynthesisUtterance(cleanText);

  const voices = window.speechSynthesis.getVoices();
  const esVoice = voices.find((v) => v.lang.toLowerCase().startsWith('es'));
  if (esVoice) utterance.voice = esVoice;

  const emoLower = emotion.toLowerCase();
  if (emoLower.includes('emocionado') || emoLower.includes('hype')) {
    utterance.rate = 1.25;
    utterance.pitch = 1.25;
  } else if (emoLower.includes('susurro') || emoLower.includes('misterio')) {
    utterance.rate = 0.88;
    utterance.pitch = 0.85;
    utterance.volume = 0.6;
  } else if (emoLower.includes('triunfal') || emoLower.includes('epico')) {
    utterance.rate = 1.08;
    utterance.pitch = 1.35;
    utterance.volume = 1.0;
  } else if (emoLower.includes('tenso') || emoLower.includes('drama')) {
    utterance.rate = 0.95;
    utterance.pitch = 0.9;
  } else {
    utterance.rate = 1.1;
    utterance.pitch = 1.05;
  }

  utterance.onstart = () => onStart?.();
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();

  window.speechSynthesis.speak(utterance);
}

/**
 * Chime broadcast brillante de triple armónico (E5 -> A5 -> C#6)
 * para capturar la atención del chat cuando un moderador lanza una votación en vivo.
 */
export function playPollModNoticeSound(volume = 0.85): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const safeVol = Math.max(0.01, Math.min(1, volume)) * 0.45;

    const notes = [
      { freq: 659.25, time: 0.0, dur: 0.09 }, // E5
      { freq: 880.0, time: 0.07, dur: 0.1 },  // A5
      { freq: 1108.73, time: 0.15, dur: 0.35 }, // C#6
    ];

    notes.forEach(({ freq, time, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + time);

      gain.gain.setValueAtTime(0.001, now + time);
      gain.gain.exponentialRampToValueAtTime(safeVol, now + time + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + time + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + time);
      osc.stop(now + time + dur + 0.02);
    });
  } catch {
    // Silencioso ante restricciones de autoplay
  }
}

export interface ModPollAnnouncementOptions {
  modName: string;
  modRole?: string;
  title: string;
  optionALabel: string;
  optionBLabel: string;
  durationSec: number;
  volume?: number;
}

/**
 * Construye el guion con modulación emocional para anunciar que un moderador inició la encuesta.
 * Incluye instrucciones claras y simples de cómo votar (escribir 1 o 2 en el chat) y el tiempo disponible.
 */
export function buildModPollAnnouncementText(opts: ModPollAnnouncementOptions): string {
  const isBroadcaster = opts.modRole === 'broadcaster' || opts.modName.toLowerCase() === 'streamer';
  const caller = isBroadcaster ? 'El streamer' : `El moderador ${opts.modName}`;
  return `[emocionado] ¡Atención chat! ${caller} ha iniciado una votación: ${opts.title}. Para votar por ${opts.optionALabel}, escribe 1 en el chat. Para votar por ${opts.optionBLabel}, escribe 2. ¡Tienen ${opts.durationSec} segundos para votar!`;
}

/**
 * Anuncia por voz (con la voz del sistema Fish Audio configurada) el inicio de la encuesta del moderador.
 */
export async function announceModPollStarted(
  opts: ModPollAnnouncementOptions,
  onStart?: () => void,
  onEnd?: () => void
): Promise<void> {
  playPollModNoticeSound(opts.volume);
  const text = buildModPollAnnouncementText(opts);
  return speakPollEmotionCue(text, '[emocionado]', onStart, onEnd);
}

/**
 * Anuncia por voz si un moderador cancela la votación activa.
 */
export async function announceModPollStopped(
  modName: string,
  onStart?: () => void,
  onEnd?: () => void
): Promise<void> {
  const text = `[tenso] Atención chat, el moderador ${modName} ha cancelado la votación en curso.`;
  return speakPollEmotionCue(text, '[tenso]', onStart, onEnd);
}

