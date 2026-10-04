/**
 * src/lib/supabase.ts
 *
 * Cliente de Supabase para la nube de Lalo Stream Suite (configuración y medios
 * por streamer). Si faltan las variables de entorno, `supabase` es null y la
 * app sigue funcionando solo con localStorage, como hasta ahora.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/** true cuando hay URL y clave pública: la nube está disponible. */
export const isCloudEnabled: boolean = url.length > 0 && anonKey.length > 0;

/** Qué variables tienen valor (solo sí o no, nunca el valor). Lo usa la página «Nube». */
export const cloudEnvStatus = { url: url.length > 0, anonKey: anonKey.length > 0 } as const;

/** Nombre del bucket de medios (ver supabase/migrations/0001_lalo_init.sql). */
export const MEDIA_BUCKET = 'media';

export const supabase: SupabaseClient | null = isCloudEnabled
  ? createClient(url, anonKey, {
      auth: {
        // PKCE devuelve ?code= en la query. El flujo implícito usaría el
        // fragmento (#), que esta app ya ocupa para sus rutas (#widget, ...).
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
