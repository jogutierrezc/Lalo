/**
 * src/utils/pollsAudio.ts
 *
 * Motor de síntesis de audio para Batallas & Encuestas en Vivo (Polls & Versus Studio).
 * Utiliza Web Audio API de baja latencia sin dependencias externas,
 * y soporte para locución sintética con emociones predefinidas.
 */

let sharedAudioCtx: AudioContext | null = null;

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
 * Emite la locución de prueba con el motor del navegador (o anuncia en consola para Fish Audio).
 * Limpia las etiquetas de emoción como [emocionado] para el lector local pero modula velocidad y pitch.
 */
export function speakPollEmotionCue(
  fullText: string,
  emotion: string,
  onStart?: () => void,
  onEnd?: () => void
): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  window.speechSynthesis.cancel();

  // Limpiar etiquetas [emocion] del texto hablado en speechSynthesis estándar
  const cleanText = fullText.replace(/\[[^\]]+\]/g, '').trim();
  const utterance = new SpeechSynthesisUtterance(cleanText);

  // Buscar voz en español
  const voices = window.speechSynthesis.getVoices();
  const esVoice = voices.find((v) => v.lang.toLowerCase().startsWith('es'));
  if (esVoice) utterance.voice = esVoice;

  // Modular parámetros según la emoción predefinida
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
