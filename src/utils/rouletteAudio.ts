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
