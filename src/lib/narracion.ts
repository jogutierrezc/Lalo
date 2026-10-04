/**
 * src/lib/narracion.ts
 *
 * Audio de las explicaciones de Teemo en la bienvenida.
 *
 * De dónde sale el audio, en este orden:
 *   1. Un archivo ya generado en public/voz/recorrido/<paso>.mp3 (no gasta nada).
 *   2. Si no existe, el servicio de voz de la app (/api/tts) con la voz de Teemo.
 * Lo que se consigue se guarda en memoria hasta cerrar la pestaña, así repetir
 * una explicación no vuelve a gastar cuota. Nunca suena solo: lo pide un botón.
 */

import { PRESET_VOICES } from '../types/settings';

export const TEEMO_ID = PRESET_VOICES.find((voice) => voice.name === 'Teemo')?.id ?? PRESET_VOICES[0].id;

const MODELO = 's2.1-pro-free';
const ESPERA_MS = 20000;

/** clave → dirección del audio ya conseguido */
const guardados = new Map<string, string>();

async function archivoGenerado(paso: string): Promise<string | null> {
  const url = `/voz/recorrido/${encodeURIComponent(paso)}.mp3`;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    // Si el archivo no existe, el servidor puede responder con la página de la app: se mira el tipo
    const tipo = res.headers.get('content-type') || '';
    return res.ok && tipo.startsWith('audio/') ? url : null;
  } catch {
    return null;
  }
}

async function sintetizar(texto: string, voz: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ESPERA_MS);
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texto, reference_id: voz, model: MODELO }),
    });
    const tipo = res.headers.get('content-type') || '';
    if (!res.ok || !tipo.startsWith('audio/')) throw new Error(`El servicio de voz respondió ${res.status}`);
    return URL.createObjectURL(await res.blob());
  } finally {
    clearTimeout(timer);
  }
}

export interface PedidoDeVoz {
  /** Nombre del archivo generado que se busca primero. Sin él, se va directo al servicio de voz. */
  paso?: string;
  texto: string;
  /** Voz con la que se sintetiza si no hay archivo. Por defecto, Teemo. */
  voz?: string;
}

/** Dirección de un audio listo para sonar. Lanza un Error si no se pudo conseguir. */
export async function audioDeVoz({ paso, texto, voz = TEEMO_ID }: PedidoDeVoz): Promise<string> {
  const clave = `${paso ?? ''}|${voz}|${texto}`;
  const previo = guardados.get(clave);
  if (previo) return previo;
  const url = (paso ? await archivoGenerado(paso) : null) ?? (await sintetizar(texto, voz));
  guardados.set(clave, url);
  return url;
}
