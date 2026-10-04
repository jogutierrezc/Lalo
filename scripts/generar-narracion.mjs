#!/usr/bin/env node
/**
 * scripts/generar-narracion.mjs
 *
 * Genera una sola vez los audios de «Chispa te explica» de la bienvenida y los
 * deja en public/voz/recorrido/<paso>.mp3. Con esos archivos, el botón
 * «Escuchar» ya no gasta cuota del servicio de voz en cada alta.
 *
 * Usa el mismo servicio de voz que la app (POST /api/tts), así que la app tiene
 * que estar en marcha y con FISH_AUDIO_API_KEY configurada:
 *
 *   npm run dev                              (en otra terminal)
 *   node scripts/generar-narracion.mjs       (usa http://localhost:3000)
 *   node scripts/generar-narracion.mjs https://tu-dominio --forzar
 *
 * Cada paso gasta cuota una vez. Los archivos que ya existen se saltan, salvo
 * con --forzar. Si cambias un texto en src/lib/recorridoNarracion.json, borra
 * su archivo (o usa --forzar) y vuelve a ejecutar.
 *
 * Sin dependencias: Node 18 o posterior.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deben coincidir con src/types/settings.ts (PRESET_VOICES, Chispa) y src/lib/narracion.ts
const NARRADOR_ID = '5669f8e58ecb476a982bc2b67ac6b538';
const MODELO = 's2.1-pro-free';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const forzar = args.includes('--forzar');
const base = (args.find((arg) => /^https?:\/\//.test(arg)) || 'http://localhost:3000').replace(/\/+$/, '');

const textos = JSON.parse(await readFile(join(raiz, 'src', 'lib', 'recorridoNarracion.json'), 'utf8'));
const destino = join(raiz, 'public', 'voz', 'recorrido');
await mkdir(destino, { recursive: true });

const existe = async (ruta) => {
  try {
    return (await stat(ruta)).size > 0;
  } catch {
    return false;
  }
};

let fallos = 0;
for (const [paso, texto] of Object.entries(textos)) {
  const archivo = join(destino, `${paso}.mp3`);
  if (!forzar && (await existe(archivo))) {
    console.log(`${paso}: ya existe, se salta`);
    continue;
  }
  try {
    const res = await fetch(`${base}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texto, reference_id: NARRADOR_ID, model: MODELO }),
    });
    const tipo = res.headers.get('content-type') || '';
    if (!res.ok || !tipo.startsWith('audio/')) {
      throw new Error(`el servicio respondió ${res.status} (${tipo || 'sin tipo'}): ${(await res.text()).slice(0, 200)}`);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    await writeFile(archivo, audio);
    console.log(`${paso}: guardado (${Math.round(audio.length / 1024)} kB)`);
  } catch (err) {
    fallos += 1;
    console.error(`${paso}: no se pudo generar. ${err instanceof Error ? err.message : err}`);
  }
}

if (fallos) {
  console.error(`\n${fallos} ${fallos === 1 ? 'paso falló' : 'pasos fallaron'}. Comprueba que la app está en marcha en ${base} y que el servicio de voz tiene su clave.`);
  process.exit(1);
}
console.log(`\nListo. Audios en ${destino}`);
