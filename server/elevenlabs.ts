/**
 * server/elevenlabs.ts
 *
 * ElevenLabs como segundo motor de voz. Lo usan api/tts.ts (síntesis) y
 * server/voices/handlers.ts (importar o clonar voces). Convive con Fish Audio:
 * solo se llega aquí si el streamer tiene elevenlabs_enabled (migración 0018),
 * y esa comprobación la hace el servidor, no el navegador.
 *
 * Modelo: ELEVENLABS_MODEL_ID, por defecto «eleven_v3» (el que admite etiquetas
 * de emoción entre corchetes). Si ElevenLabs publica otro, se cambia la variable
 * en Vercel sin tocar el código.
 *
 * Claves: ELEVENLABS_API_KEY (1) y ELEVENLABS_API_KEY_2 (2). Cuál se usa la
 * elige el administrador en el panel (app_settings, migración 0020); si esa
 * clave falta en el entorno, se usa la otra que exista.
 *
 * SIN PROBAR contra ElevenLabs ni Supabase reales.
 */

import { createClient } from '@supabase/supabase-js';

export type Env = Record<string, string | undefined>;
type FetchLike = typeof fetch;

const API = 'https://api.elevenlabs.io';
export const DEFAULT_ELEVEN_MODEL = 'eleven_v3';
const VOICE_ID_SHAPE = /^[A-Za-z0-9]{12,40}$/;

export const isElevenVoiceId = (value: string): boolean => VOICE_ID_SHAPE.test(value.trim());

export type ElevenKeySlot = 1 | 2;
const SETTING_ELEVEN_ACTIVE_KEY = 'elevenlabs_active_key';

const cleanSecret = (value: string | undefined): string => (value ?? '').trim().replace(/^["']|["']$/g, '').trim();

export function elevenKeySlot(env: Env, slot: ElevenKeySlot): string {
  return slot === 2 ? cleanSecret(env.ELEVENLABS_API_KEY_2) : cleanSecret(env.ELEVENLABS_API_KEY);
}

/** ¿Hay alguna clave de ElevenLabs configurada? Guardia de las rutas de voces. */
export function elevenAnyKey(env: Env): boolean {
  return Boolean(elevenKeySlot(env, 1) || elevenKeySlot(env, 2));
}

/** Cliente mínimo de app_settings que necesitan las pruebas. */
interface SettingsReader {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: unknown }>;
      };
    };
  };
}

/**
 * Slot activo de ElevenLabs (1 o 2), elegido por el administrador en el panel y
 * guardado en app_settings (migración 0020). Si no hay Supabase o falta la
 * migración, se queda en el 1: es el valor por defecto y un problema de la nube
 * no debe romper la síntesis.
 */
export async function elevenActiveSlot(env: Env, db?: SettingsReader): Promise<ElevenKeySlot> {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const service = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!db && (!url || !service)) return 1;
  try {
    const client =
      db ?? (createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as SettingsReader);
    const { data } = await client.from('app_settings').select('value').eq('key', SETTING_ELEVEN_ACTIVE_KEY).maybeSingle();
    const value = (data as { value?: string } | null)?.value;
    return value === '2' ? 2 : 1;
  } catch {
    return 1;
  }
}

/**
 * La clave de ElevenLabs que deben usar todas las llamadas (síntesis, importar,
 * clonar, borrar): la del slot activo. Si esa no está configurada, se usa la
 * otra para que la petición no caiga por un despiste del panel.
 */
export async function elevenActiveKey(env: Env, db?: SettingsReader): Promise<{ key: string; slot: ElevenKeySlot }> {
  const slot = await elevenActiveSlot(env, db);
  const own = elevenKeySlot(env, slot);
  if (own) return { key: own, slot };
  // La clave elegida falta en el entorno: se usa la otra y se reporta su slot.
  const other: ElevenKeySlot = slot === 1 ? 2 : 1;
  const fallback = elevenKeySlot(env, other);
  return fallback ? { key: fallback, slot: other } : { key: '', slot };
}

export function elevenModel(env: Env): string {
  return (env.ELEVENLABS_MODEL_ID ?? '').trim() || DEFAULT_ELEVEN_MODEL;
}

// Etiquetas canónicas de Lalo (las de Fish) → etiquetas de ElevenLabs v3
const TAGS: Record<string, string> = {
  happy: 'happy',
  whispering: 'whispers',
  angry: 'angry',
  sad: 'sad',
  laughing: 'laughs',
  shouting: 'shouts',
  crying: 'crying',
  scared: 'scared',
  excited: 'excited',
  surprised: 'surprised',
  singing: 'singing',
  calm: 'calm',
  sigh: 'sighs',
  yawn: 'yawns',
  nervous: 'nervous',
};

/** [happy] → [happy], [whispering] → [whispers]... Lo que no se conoce se deja tal cual. */
export function toElevenTags(text: string): string {
  return text.replace(/\[([a-z_-]{2,30})\]/gi, (match, raw: string) => {
    const mapped = TAGS[raw.toLowerCase()];
    return mapped ? `[${mapped}]` : match;
  });
}

// ---------- Quién puede usarlo y control de cuota diaria ----------

export interface ElevenQuotaCheckResult {
  allowed: boolean;
  reason: 'ok' | 'not_enabled' | 'quota_exceeded';
  charsUsed?: number;
  charsLimit?: number;
}

/**
 * ¿Puede esta petición usar ElevenLabs? Vale la clave `k` de la capa de OBS o la
 * sesión (Bearer) del panel. Sin Supabase configurado o ante cualquier duda: no.
 */
export async function elevenAllowed(
  headers: Record<string, string | string[] | undefined>,
  widgetKey: string,
  env: Env
): Promise<boolean> {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const service = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !service) return false;
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const rawAuth = headers.authorization ?? headers.Authorization;
    const token = (Array.isArray(rawAuth) ? rawAuth[0] : rawAuth ?? '').replace(/^Bearer\s+/i, '').trim();
    if (token) {
      const { data } = await db.auth.getUser(token);
      if (!data.user) return false;
      const profile = await db
        .from('profiles')
        .select('role, status, elevenlabs_enabled')
        .eq('id', data.user.id)
        .maybeSingle();
      const row = profile.data as { role: string; status: string; elevenlabs_enabled: boolean } | null;
      return Boolean(row && row.status === 'active' && (row.role === 'admin' || row.elevenlabs_enabled));
    }
    if (widgetKey && widgetKey.length <= 128) {
      const { data } = await db.rpc('eleven_allowed_for_widget', { p_key: widgetKey });
      return data === true;
    }
  } catch {
    // Ante un error se niega: ElevenLabs gasta créditos
  }
  return false;
}

/**
 * Comprueba permiso y tope diario de caracteres en ElevenLabs y anota el uso del día
 * en tts_usage_daily (migración 0019). Si la migración 0019 aún no está aplicada,
 * cae de forma transparente en `elevenAllowed`.
 */
export async function elevenQuotaCheckAndRecord(
  headers: Record<string, string | string[] | undefined>,
  widgetKey: string,
  chars: number,
  env: Env
): Promise<ElevenQuotaCheckResult> {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const service = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !service) return { allowed: false, reason: 'not_enabled' };

  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    let profileId: string | null = null;
    const rawAuth = headers.authorization ?? headers.Authorization;
    const token = (Array.isArray(rawAuth) ? rawAuth[0] : rawAuth ?? '').replace(/^Bearer\s+/i, '').trim();
    if (token) {
      const { data } = await db.auth.getUser(token);
      profileId = data.user?.id ?? null;
    }

    const cleanKey = widgetKey && widgetKey.length <= 128 ? widgetKey.trim() : '';
    if (!profileId && !cleanKey) {
      return { allowed: false, reason: 'not_enabled' };
    }

    const { data, error } = await db.rpc('check_and_record_tts_usage', {
      p_profile_id: profileId,
      p_widget_key: cleanKey || null,
      p_provider: 'elevenlabs',
      p_chars: Math.max(0, Math.floor(chars || 0)),
    });

    if (!error && data && typeof data === 'object') {
      const res = data as {
        allowed?: boolean;
        reason?: string;
        chars_used?: number;
        chars_limit?: number;
      };
      if (res.allowed) {
        return {
          allowed: true,
          reason: 'ok',
          charsUsed: res.chars_used,
          charsLimit: res.chars_limit,
        };
      }
      if (res.reason === 'quota_exceeded') {
        return {
          allowed: false,
          reason: 'quota_exceeded',
          charsUsed: res.chars_used,
          charsLimit: res.chars_limit,
        };
      }
      return { allowed: false, reason: 'not_enabled' };
    }

    // Fallback si la migración 0019 aún no se ejecutó en Supabase
    const fallbackAllowed = await elevenAllowed(headers, widgetKey, env);
    return { allowed: fallbackAllowed, reason: fallbackAllowed ? 'ok' : 'not_enabled' };
  } catch {
    return { allowed: false, reason: 'not_enabled' };
  }
}

/**
 * Registra el uso diario de Fish Audio en segundo plano para la analítica del administrador.
 * Nunca bloquea ni lanza errores si la nube no está configurada o falta la migración 0019.
 */
export async function recordFishTtsUsage(
  headers: Record<string, string | string[] | undefined>,
  widgetKey: string,
  chars: number,
  env: Env
): Promise<void> {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').trim();
  const service = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !service || chars <= 0) return;

  try {
    const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    let profileId: string | null = null;
    const rawAuth = headers.authorization ?? headers.Authorization;
    const token = (Array.isArray(rawAuth) ? rawAuth[0] : rawAuth ?? '').replace(/^Bearer\s+/i, '').trim();
    if (token) {
      const { data } = await db.auth.getUser(token);
      profileId = data.user?.id ?? null;
    }
    const cleanKey = widgetKey && widgetKey.length <= 128 ? widgetKey.trim() : '';
    if (!profileId && !cleanKey) return;

    await db.rpc('check_and_record_tts_usage', {
      p_profile_id: profileId,
      p_widget_key: cleanKey || null,
      p_provider: 'fish',
      p_chars: Math.max(0, Math.floor(chars || 0)),
    });
  } catch {
    // Silencioso: la síntesis de Fish Audio nunca depende de la telemetría
  }
}

// ---------- Síntesis ----------

export async function elevenSynthesize(
  text: string,
  voiceId: string,
  env: Env,
  doFetch: FetchLike = fetch
): Promise<Buffer> {
  const { key: apiKey } = await elevenActiveKey(env);
  if (!apiKey) throw new Error('Ninguna clave de ElevenLabs está configurada (ELEVENLABS_API_KEY o ELEVENLABS_API_KEY_2)');
  if (!isElevenVoiceId(voiceId)) throw new Error('El id de voz de ElevenLabs no es válido');

  const response = await doFetch(
    `${API}/v1/text-to-speech/${encodeURIComponent(voiceId.trim())}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: toElevenTags(text), model_id: elevenModel(env) }),
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`ElevenLabs HTTP ${response.status}: ${detail.slice(0, 300) || 'Error en síntesis'}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// ---------- Voces ----------

/** Una voz que ya existe en la cuenta de ElevenLabs. null si no existe o la clave no la ve. */
export async function elevenGetVoice(
  voiceId: string,
  env: Env,
  doFetch: FetchLike = fetch
): Promise<{ voice_id: string; name: string } | null> {
  const { key: apiKey } = await elevenActiveKey(env);
  const response = await doFetch(`${API}/v1/voices/${encodeURIComponent(voiceId.trim())}`, {
    headers: { 'xi-api-key': apiKey },
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as { voice_id?: string; name?: string } | null;
  return body?.voice_id ? { voice_id: body.voice_id, name: body.name ?? '' } : null;
}

/** Clona una voz (Instant Voice Clone) con las muestras de audio. Devuelve su voice_id. */
export async function elevenCloneVoice(
  name: string,
  description: string,
  files: { name: string; type: string; bytes: Uint8Array }[],
  env: Env,
  doFetch: FetchLike = fetch
): Promise<string> {
  const form = new FormData();
  form.append('name', name);
  if (description) form.append('description', description);
  form.append('remove_background_noise', 'false');
  files.forEach((file, index) => {
    form.append('files', new Blob([file.bytes as unknown as BlobPart], { type: file.type }), file.name || `audio-${index + 1}`);
  });
  const { key: apiKey } = await elevenActiveKey(env);
  const response = await doFetch(`${API}/v1/voices/add`, { method: 'POST', headers: { 'xi-api-key': apiKey }, body: form });
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`ElevenLabs HTTP ${response.status}: ${text.slice(0, 300)}`);
  let parsed: { voice_id?: string } = {};
  try {
    parsed = JSON.parse(text || '{}') as { voice_id?: string };
  } catch {
    throw new Error('ElevenLabs devolvió una respuesta inválida al crear la voz.');
  }
  const id = parsed.voice_id;
  if (!id) throw new Error('ElevenLabs aceptó el audio pero no devolvió el id de la voz.');
  return id;
}

export async function elevenDeleteVoice(voiceId: string, env: Env, doFetch: FetchLike = fetch): Promise<boolean> {
  const { key: apiKey } = await elevenActiveKey(env);
  try {
    const response = await doFetch(`${API}/v1/voices/${encodeURIComponent(voiceId.trim())}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': apiKey },
    });
    return response.ok;
  } catch {
    return false;
  }
}
