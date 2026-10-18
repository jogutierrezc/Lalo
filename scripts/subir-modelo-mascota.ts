/**
 * scripts/subir-modelo-mascota.ts
 *
 * Sube un GLB al bucket PRIVADO de modelos de R2 y lo asocia a un personaje de Mi AI.
 * Lo ejecuta jagc a mano, con sus variables de entorno. No pasa por la web.
 *
 *   npx tsx scripts/subir-modelo-mascota.ts --file Warwick/warwick.glb --character <id-personaje> --owner <id-perfil>
 *
 * Variables (de .env o del entorno): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 * R2_MODELS_BUCKET, SUPABASE_URL (o VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
 * No imprime ninguna clave.
 */

import 'dotenv/config';
import { readFileSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { presignPut } from '../server/storage/r2.js';
import { readModelsConfig } from '../server/lux/mascotaModel.js';

const MAX_BYTES = 50 * 1024 * 1024;

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Falta --${name}`);
  return value;
}

async function main(): Promise<void> {
  const file = arg('file');
  const characterId = arg('character');
  const ownerId = arg('owner');

  const size = statSync(file).size;
  if (size === 0 || size > MAX_BYTES) throw new Error(`El archivo debe pesar entre 1 byte y 50 MB (pesa ${size}).`);
  const body = readFileSync(file);

  const { config, missing } = readModelsConfig(process.env as Record<string, string | undefined>);
  if (!config) throw new Error(`Faltan variables de R2: ${missing.join(', ')}`);

  const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!supabaseUrl || !serviceKey) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');

  const key = `lux-models/${randomBytes(16).toString('hex')}.glb`;
  const url = presignPut(config, { key, mime: 'model/gltf-binary', size, now: new Date(), expiresSeconds: 900 });
  const put = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'model/gltf-binary', 'content-length': String(size) },
    body,
  });
  if (!put.ok) throw new Error(`R2 rechazó la subida (HTTP ${put.status}). Revisa el bucket y las credenciales.`);
  console.log(`Subido a R2 privado: ${key} (${size} bytes)`);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db
    .from('lux_characters')
    .update({ model_key: key, owner_profile_id: ownerId })
    .eq('id', characterId)
    .select('id, name, avatar, owner_profile_id, model_key')
    .maybeSingle();
  if (error) throw new Error(`Supabase: ${error.code ?? 'error'} ${error.message}`);
  if (!data) throw new Error('No existe ningún personaje con ese --character.');

  console.log('Personaje actualizado:', JSON.stringify(data));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
