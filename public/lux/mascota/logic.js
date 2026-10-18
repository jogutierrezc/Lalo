/**
 * public/lux/mascota/logic.js
 *
 * Lógica pura de Mascota 2 (personaje de Mi AI con modelo GLB). Sin Three.js ni
 * DOM: el overlay (public/lux/mascota/mascota.js) la usa para elegir clip,
 * cruce y frecuencia de render, y las pruebas (tests/luxMascota.test.ts) la
 * comprueban aquí.
 *
 * El archivo del modelo no está en public/: se sirve solo a su dueño desde
 * /api/lux/model (server/lux/mascotaModel.ts). Los clips de abajo son los que
 * sobreviven a la compresión; si cambian, cambian también las pruebas.
 */

/** Clips que sobreviven a la compresión del GLB (de los 66 originales). */
export const MASCOTA_CLIPS = ['Idle1_Base', 'Idle_Var1', 'Laugh', 'Taunt', 'Dance_Loop', 'Crit'];

/** Duración en segundos de cada clip cuando es una reacción de un solo uso (los que no son bucle de idle). */
export const CLIP_SECONDS = { Laugh: 2.5, Taunt: 2, Dance_Loop: 4, Crit: 1.5 };

/** Cruce entre clips (A2). */
export const CROSSFADE_SECONDS = 0.3;

/** Clip que se usa mientras la voz suena, por encima de la emoción (cambio de jagc). */
export const SPEAKING_CLIP = 'Taunt';

/**
 * Emociones que manda el servidor (server/lux/emotion.ts) → emoción del mapa.
 * Neutra = Idle1_Base; Alegre = Laugh; Burlona = Taunt; Entusiasta = Dance_Loop;
 * Sorprendida = Crit; Triste = Idle1_Base a menor velocidad.
 */
export const EMOTION_OF = {
  normal: 'neutra',
  habla: 'neutra',
  emocionada: 'entusiasta',
  magica: 'entusiasta',
  grita: 'sorprendida',
  sorprendida: 'sorprendida',
  feliz: 'alegre',
  alegre: 'alegre',
  triste: 'triste',
  molesta: 'burlona',
};

/** Emoción del mapa → clip y velocidad. */
export const EMOTION_CLIP = {
  neutra: { clip: 'Idle1_Base', timeScale: 1 },
  alegre: { clip: 'Laugh', timeScale: 1 },
  burlona: { clip: 'Taunt', timeScale: 1 },
  entusiasta: { clip: 'Dance_Loop', timeScale: 1 },
  sorprendida: { clip: 'Crit', timeScale: 1 },
  triste: { clip: 'Idle1_Base', timeScale: 0.6 },
};

/** Gestos del personaje (LUX_GESTURES) → clip del mismo mapa. */
export const GESTURE_CLIP = {
  wave: 'Idle_Var1',
  spin: 'Dance_Loop',
  dance: 'Dance_Loop',
  jump: 'Crit',
  sing: 'Laugh',
  bow: 'Idle1_Base',
  ult: 'Crit',
  pride: 'Taunt',
  nod: 'Idle_Var1',
  shrug: 'Taunt',
  arms_up: 'Laugh',
};

/**
 * Avatar «glb:<id>»: el id lo decide el servidor (modelo elegido o propio del personaje).
 * El overlay no tiene lista de modelos: solo comprueba el formato.
 */
const MODEL_AVATAR = /^glb:([a-z0-9-]{1,64})$/;

/** Id del modelo de un avatar glb:<id>, o null si no es un avatar de modelo con formato válido. */
export function modelIdOf(avatar) {
  if (typeof avatar !== 'string') return null;
  const match = MODEL_AVATAR.exec(avatar);
  return match ? match[1] : null;
}

/** Emoción del mapa para lo que manda el servidor. Desconocida = neutra. */
export function emotionOf(emotion) {
  return EMOTION_OF[emotion] ?? 'neutra';
}

/**
 * Clip que suena ahora. Prioridad: voz activa (Taunt, también si la emoción es
 * triste) > gesto de un solo uso > emoción. Devuelve { clip, timeScale }.
 *
 * @param {{ speaking: boolean, emotion: string, gesture?: string | null }} state
 */
export function activeClip({ speaking, emotion, gesture = null }) {
  if (speaking) return { clip: SPEAKING_CLIP, timeScale: 1 };
  if (gesture && GESTURE_CLIP[gesture]) return { clip: GESTURE_CLIP[gesture], timeScale: 1 };
  return EMOTION_CLIP[emotionOf(emotion)];
}

/** Velocidad de la mandíbula según el volumen de la voz (0..1). La mandíbula se abre como mucho 0,35 rad. */
export function jawOpening(level) {
  const clamped = Math.min(1, Math.max(0, Number(level) || 0));
  return clamped * 0.35;
}

export const FPS_IDLE = 5;
export const FPS_ACTIVE = 30;
export const FPS_CAP_60 = 60;

/**
 * Frecuencia de render (R1). En reposo, sin voz ni animación, 5 fps. Con
 * animación o voz, 30 fps; con el interruptor de 60 fps, 60 fps. Nunca más.
 *
 * @param {{ busy: boolean, fps60?: boolean }} state
 */
export function renderFps({ busy, fps60 = false }) {
  if (!busy) return FPS_IDLE;
  return fps60 ? FPS_CAP_60 : FPS_ACTIVE;
}

/** Intervalo entre fotogramas en milisegundos para una frecuencia. */
export function frameIntervalMs(fps) {
  return 1000 / Math.min(FPS_CAP_60, Math.max(FPS_IDLE, Number(fps) || FPS_IDLE));
}
