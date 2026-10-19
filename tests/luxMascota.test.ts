/**
 * tests/luxMascota.test.ts
 *
 * Mascota 2 (personaje de Mi AI con modelo GLB de uso privado):
 *   - lógica pura del overlay: clip por emoción y gesto, prioridad de la voz (Taunt),
 *     cruce de 0,3 s, mandíbula y tope de fotogramas;
 *   - el campo avatar admite «glb:<id>» y rechaza valores raros;
 *   - el personaje con dueño solo lo ven, usan y descargan su dueña;
 *   - el modelo sale del bucket privado, nunca como URL, y falla cerrado sin bucket.
 *
 * La renderización real (WebGL, OBS, audio) no se prueba aquí.
 */

import { existsSync, openSync, readFileSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CLIP_SECONDS,
  CROSSFADE_SECONDS,
  EMOTION_CLIP,
  EMOTION_OF,
  FPS_ACTIVE,
  FPS_CAP_60,
  FPS_IDLE,
  GESTURE_CLIP,
  MASCOTA_CLIPS,
  SPEAKING_CLIP,
  activeClip,
  frameIntervalMs,
  jawOpening,
  modelIdOf,
  renderFps,
  resolveClips,
} from '../public/lux/mascota/logic.js';
import { LUX_EMOTIONS } from '../server/lux/emotion';
import { LUX_AVATAR_CHOICES, LUX_MODEL_AVATAR_IDS, isModelAvatar, normalizeCharacterInput, visibleCharacters, characterView, type LuxCharacter } from '../server/lux/characters';
import { handleLux } from '../server/lux/handlers';
import { fetchPrivateModel, isModelKey, readModelsConfig, MODELS_BUCKET_ENV } from '../server/lux/mascotaModel';
import type { LuxDb, LuxProfile } from '../server/lux/luxDb';
import type { IntegrationRequest } from '../server/integrations/http';

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';
const MASCOTA_ID = '00000000-0000-4000-8000-0000000000c1';
const OWNER_KEY = 'clave-obs-dueno-1234567890abcdef';
const OTHER_KEY = 'clave-obs-otra-1234567890abcdef';
const MODEL_KEY = 'lux-models/0123456789abcdef0123456789abcdef.glb';
const BYTES = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 0, 0, 0]);
const GLB_PATH = join(__dirname, '..', 'Warwick', 'warwick.glb');

/** Nombres de los clips de un GLB (cabecera JSON). Solo si el archivo existe en esta copia del repo. */
function glbAnimationNames(path: string): string[] {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(20);
    readSync(fd, head, 0, 20, 0);
    const length = head.readUInt32LE(12);
    const json = Buffer.alloc(length);
    readSync(fd, json, 0, length, 20);
    const doc = JSON.parse(json.toString('utf8')) as { animations?: Array<{ name?: string }> };
    return (doc.animations ?? []).map((animation) => animation.name ?? '');
  } finally {
    closeSync(fd);
  }
}

describe('mapa de emociones y gestos a clips', () => {
  it('cada clip del mapa está en la lista de clips del modelo comprimido', () => {
    for (const { clip } of Object.values(EMOTION_CLIP)) expect(MASCOTA_CLIPS).toContain(clip);
    for (const clip of Object.values(GESTURE_CLIP)) expect(MASCOTA_CLIPS).toContain(clip);
    expect(MASCOTA_CLIPS).toContain(SPEAKING_CLIP);
  });

  it('los clips del modelo comprimido existen en el GLB original (si está en esta copia)', () => {
    if (!existsSync(GLB_PATH)) return;
    const names = glbAnimationNames(GLB_PATH);
    for (const clip of MASCOTA_CLIPS) expect(names).toContain(clip);
  });

  it('cada emoción que manda el servidor tiene una emoción del mapa', () => {
    for (const emotion of LUX_EMOTIONS) {
      expect(Object.keys(EMOTION_CLIP)).toContain(EMOTION_OF[emotion]);
    }
  });

  it('las duraciones de los clips de un solo uso son las de A1', () => {
    expect(CLIP_SECONDS).toEqual({ Laugh: 2.5, Taunt: 2, Dance_Loop: 4, Crit: 1.5 });
    expect(EMOTION_CLIP.alegre.clip).toBe('Laugh');
    expect(EMOTION_CLIP.burlona.clip).toBe('Taunt');
    expect(EMOTION_CLIP.entusiasta.clip).toBe('Dance_Loop');
    expect(EMOTION_CLIP.sorprendida.clip).toBe('Crit');
    expect(EMOTION_CLIP.triste).toEqual({ clip: 'Idle1_Base', timeScale: 0.6 });
    expect(EMOTION_CLIP.neutra.clip).toBe('Idle1_Base');
  });

  it('el cruce entre clips dura 0,3 s', () => {
    expect(CROSSFADE_SECONDS).toBe(0.3);
  });
});

describe('prioridad de la voz (cambio de jagc)', () => {
  it('con voz activa, la animación es Taunt, cualquiera que sea la emoción', () => {
    for (const emotion of ['normal', 'alegre', 'triste', 'sorprendida', 'emocionada', 'molesta']) {
      expect(activeClip({ speaking: true, emotion }).clip).toBe('Taunt');
    }
  });

  it('con voz activa, Taunt gana también a un gesto', () => {
    expect(activeClip({ speaking: true, emotion: 'normal', gesture: 'spin' }).clip).toBe('Taunt');
  });

  it('sin voz, la animación es la de la emoción', () => {
    expect(activeClip({ speaking: false, emotion: 'alegre' })).toEqual({ clip: 'Laugh', timeScale: 1 });
    expect(activeClip({ speaking: false, emotion: 'molesta' }).clip).toBe('Taunt');
    expect(activeClip({ speaking: false, emotion: 'triste' })).toEqual({ clip: 'Idle1_Base', timeScale: 0.6 });
    expect(activeClip({ speaking: false, emotion: 'magica' }).clip).toBe('Dance_Loop');
  });

  it('sin voz, un gesto gana a la emoción; un gesto desconocido no', () => {
    expect(activeClip({ speaking: false, emotion: 'normal', gesture: 'spin' }).clip).toBe('Dance_Loop');
    expect(activeClip({ speaking: false, emotion: 'alegre', gesture: 'no_existe' }).clip).toBe('Laugh');
  });

  it('una emoción desconocida cae a neutra', () => {
    expect(activeClip({ speaking: false, emotion: 'rara' }).clip).toBe('Idle1_Base');
  });

  it('la mandíbula sigue el volumen y nunca se abre más de 0,35 rad', () => {
    expect(jawOpening(0)).toBe(0);
    expect(jawOpening(0.5)).toBeCloseTo(0.175);
    expect(jawOpening(3)).toBeCloseTo(0.35);
    expect(jawOpening(-1)).toBe(0);
    expect(jawOpening('x' as unknown as number)).toBe(0);
  });
});

describe('render bajo demanda y tope de fotogramas (R1)', () => {
  it('en reposo, sin voz ni animación, 5 fps', () => {
    expect(renderFps({ busy: false })).toBe(FPS_IDLE);
    expect(renderFps({ busy: false, fps60: true })).toBe(FPS_IDLE);
  });

  it('con voz o animación, 30 fps como tope', () => {
    expect(renderFps({ busy: true })).toBe(FPS_ACTIVE);
    expect(FPS_ACTIVE).toBe(30);
  });

  it('con el interruptor de 60 fps, 60 fps y ni uno más', () => {
    expect(renderFps({ busy: true, fps60: true })).toBe(60);
    expect(FPS_CAP_60).toBe(60);
  });

  it('el intervalo entre fotogramas respeta los topes', () => {
    expect(frameIntervalMs(120)).toBeCloseTo(1000 / 60); // nunca más de 60
    expect(frameIntervalMs(500)).toBeCloseTo(1000 / 60);
    expect(frameIntervalMs(1)).toBeCloseTo(1000 / 5); // nunca menos de 5
    expect(frameIntervalMs(FPS_ACTIVE)).toBeCloseTo(1000 / 30);
    expect(frameIntervalMs(NaN)).toBeCloseTo(1000 / 5);
  });
});

describe('avatar: «lux» o «glb:<id>»', () => {
  it('acepta un modelo que existe y rechaza valores raros', () => {
    expect(isModelAvatar('glb:warwick')).toBe(true);
    for (const bad of ['glb:', 'glb:unknown', 'glb:../warwick', 'GLB:warwick', 'glb:Warwick', 'glb:warwick/../x', '<script>', 'lux2', '', 'glb:warwick ']) {
      expect(isModelAvatar(bad)).toBe(false);
    }
    expect(isModelAvatar('lux')).toBe(false);
    expect(isModelAvatar(null)).toBe(false);
  });

  it('el overlay no tiene lista fija de modelos: acepta cualquier id con formato válido', () => {
    expect(modelIdOf('glb:warwick')).toBe('warwick');
    expect(modelIdOf('glb:00000000-0000-4000-8000-0000000000a1')).toBe('00000000-0000-4000-8000-0000000000a1');
    expect(modelIdOf('glb:' + 'a'.repeat(64))).toBe('a'.repeat(64));
    for (const bad of ['lux', 'glb:', 'glb:' + 'a'.repeat(65), 'glb:Warwick', 'glb:../x', 'glb:warwick ', 'GLB:warwick', null, undefined, 3]) {
      expect(modelIdOf(bad as string)).toBeNull();
    }
  });

  it('el fichero del overlay y su lógica no contienen la lista fija de modelos', () => {
    const root = join(__dirname, '..', 'public', 'lux');
    const overlay = readFileSync(join(root, 'overlay.html'), 'utf8');
    const logic = readFileSync(join(root, 'mascota', 'logic.js'), 'utf8');
    for (const source of [overlay, logic]) {
      expect(source).not.toContain('MODEL_AVATAR_IDS');
      expect(source).not.toContain("'warwick'");
    }
  });

  it('el administrador puede elegir Lux y el modelo', () => {
    expect(LUX_AVATAR_CHOICES).toEqual(['lux', 'glb:warwick']);
  });

  it('normalizeCharacterInput acepta un modelo con cuenta dueña y exige dueña para el modelo', () => {
    const ok = normalizeCharacterInput({ name: 'Mascota 2', avatar: 'glb:warwick', ownerProfileId: OWNER });
    expect(ok).toMatchObject({ ok: true, value: { avatar: 'glb:warwick', ownerProfileId: OWNER } });

    const sinDueno = normalizeCharacterInput({ name: 'Mascota 2', avatar: 'glb:warwick' });
    expect(sinDueno).toMatchObject({ ok: false, field: 'owner' });

    const dueñaRara = normalizeCharacterInput({ name: 'Mascota 2', avatar: 'glb:warwick', ownerProfileId: 'no-es-uuid' });
    expect(dueñaRara).toMatchObject({ ok: false, field: 'owner' });

    const avatarRaro = normalizeCharacterInput({ name: 'X', avatar: 'glb:../../etc', ownerProfileId: OWNER });
    expect(avatarRaro).toMatchObject({ ok: false, field: 'avatar' });
  });

  it('un personaje Lux de siempre sigue sin dueño', () => {
    expect(normalizeCharacterInput({ name: 'Sombra' })).toMatchObject({ ok: true, value: { avatar: 'lux', ownerProfileId: null } });
  });
});

/** Personaje de Mi AI con modelo propio de OWNER y uno público. */
const mascota: LuxCharacter = {
  id: MASCOTA_ID,
  name: 'Mascota 2',
  avatar: 'glb:warwick',
  color: '#f59e0b',
  gestures: ['wave', 'spin'],
  model: null,
  isDefault: false,
  ownerProfileId: OWNER,
  modelKey: MODEL_KEY,
};
const publico: LuxCharacter = { ...mascota, id: randomUUID(), name: 'Lux público', avatar: 'lux', ownerProfileId: null, modelKey: null, isDefault: true };

describe('el personaje con dueño solo lo ven y usan su dueña', () => {
  it('visibleCharacters oculta el personaje ajeno y deja el público y el propio', () => {
    expect(visibleCharacters([mascota, publico], OWNER).map((c) => c.id)).toEqual([mascota.id, publico.id]);
    expect(visibleCharacters([mascota, publico], OTHER).map((c) => c.id)).toEqual([publico.id]);
  });

  it('la vista del personaje nunca lleva la clave del modelo', () => {
    expect(characterView(mascota)).not.toHaveProperty('modelKey');
    expect(JSON.stringify(characterView(mascota))).not.toContain(MODEL_KEY);
  });

  it('solo la cuenta dueña descarga el modelo; otra cuenta asignada a él recibe 404', async () => {
    const profiles: Record<string, LuxProfile & { widgetKey: string }> = {
      [OWNER_KEY]: { id: OWNER, role: 'streamer', luxEnabled: true, luxCharacterId: mascota.id, widgetKey: OWNER_KEY },
      [OTHER_KEY]: { id: OTHER, role: 'streamer', luxEnabled: true, luxCharacterId: mascota.id, widgetKey: OTHER_KEY },
    };
    const db = {
      profileByWidgetKey: async (key: string) => profiles[key] ?? null,
      characters: async () => [mascota, publico],
    } as unknown as LuxDb;
    const reads: string[] = [];
    const deps = {
      db: () => db,
      auth: async () => ({ id: OWNER, role: 'streamer', status: 'active' }),
      modelBytes: async (_env: unknown, key: string) => {
        reads.push(key);
        return { ok: true as const, bytes: BYTES };
      },
    };
    const req = (k: string): IntegrationRequest => ({ method: 'GET', headers: {}, query: { k }, body: undefined });

    const dueno = await handleLux('mascota-model', req(OWNER_KEY), {}, deps);
    expect(dueno.status).toBe(200);
    expect(dueno.raw?.contentType).toBe('model/gltf-binary');
    expect(dueno.raw?.body).toEqual(BYTES);
    expect(reads).toEqual([MODEL_KEY]);
    expect(JSON.stringify(dueno.body)).not.toContain(MODEL_KEY);

    // La otra cuenta tiene asignado el personaje ajeno: no lo ve, cae a Lux público y no hay modelo.
    const ajena = await handleLux('mascota-model', req(OTHER_KEY), {}, deps);
    expect(ajena.status).toBe(404);
    expect(ajena.raw).toBeUndefined();
    expect(reads).toEqual([MODEL_KEY]);
  });

  it('una clave de OBS que no existe no descarga nada', async () => {
    const db = { profileByWidgetKey: async () => null, characters: async () => [mascota] } as unknown as LuxDb;
    const res = await handleLux('mascota-model', { method: 'GET', headers: {}, query: { k: 'clave-falsa-123456789012' }, body: undefined }, {}, {
      db: () => db,
      auth: async () => ({ id: OWNER, role: 'streamer', status: 'active' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('almacenamiento del modelo: privado y con clave aleatoria', () => {
  it('solo acepta claves con la forma lux-models/<32 hex>.glb', () => {
    expect(isModelKey(MODEL_KEY)).toBe(true);
    for (const bad of ['warwick.glb', 'lux-models/../x.glb', 'lux-models/ABC.glb', 'otra/0123456789abcdef0123456789abcdef.glb', null]) {
      expect(isModelKey(bad)).toBe(false);
    }
  });

  it('sin bucket privado configurado, falla cerrado y no lee nada', async () => {
    const env = { R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'publico', R2_PUBLIC_BASE_URL: 'https://x.example' };
    const config = readModelsConfig(env);
    expect(config.config).toBeNull();
    expect(config.missing).toEqual([MODELS_BUCKET_ENV]);
    const read = await fetchPrivateModel(env, MODEL_KEY);
    expect(read).toEqual({ ok: false, reason: 'not_configured', missing: [MODELS_BUCKET_ENV] });
  });

  it('con bucket privado, usa ese bucket y no el público', () => {
    const env = { R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'publico', R2_PUBLIC_BASE_URL: 'https://x.example', [MODELS_BUCKET_ENV]: 'privado' };
    const config = readModelsConfig(env);
    expect(config.config?.bucket).toBe('privado');
    expect(config.config?.publicBaseUrl).toBe('');
  });
});

describe('Mascota 2: resolución de clips por modelo', () => {
  // Nombres reales de los dos modelos de prueba (Warwick/).
  const WARWICK = ['Attack1', 'Crit', 'Laugh', 'Taunt', 'Dance_Loop', 'Dance_Windup', 'Idle1_Base', 'Idle_Var1', 'Joke'];
  const GUARDIANA = ['Idle_Base', 'Idle_In', 'Joke', 'Dance_Loop', 'Dance_In', 'Damage_Hurt', 'Laugh01', 'Taunt_Intro', 'Taunt_loop', 'Laugh02', 'Finisher01', 'PetChibiLux_StarGuardian_Laugh.anm', 'PetChibiLux_StarGuardian_Dance_loop.anm'];

  it('un modelo con los nombres canónicos los usa tal cual', () => {
    const r = resolveClips(WARWICK);
    expect(r).toEqual({ Idle1_Base: 'Idle1_Base', Idle_Var1: 'Idle_Var1', Laugh: 'Laugh', Taunt: 'Taunt', Dance_Loop: 'Dance_Loop', Crit: 'Crit' });
  });

  it('un modelo con otros nombres encuentra el clip de cada rol por alias', () => {
    const r = resolveClips(GUARDIANA);
    expect(r.Idle1_Base).toBe('Idle_Base');
    expect(r.Laugh).toBe('Laugh01');
    // El clip de la mascota (PetChibi…Laugh.anm) no es la risa del personaje si hay Laugh01.
    expect(r.Laugh).not.toMatch(/Pet/);
    expect(r.Taunt).toBe('Taunt_loop');
    expect(r.Dance_Loop).toBe('Dance_Loop');
    expect(r.Crit).toBe('Finisher01');
  });

  it('un rol sin ningún clip vale null, y la variante de reposo sin distinta vale null', () => {
    const r = resolveClips(['Idle_Base']);
    expect(r.Idle1_Base).toBe('Idle_Base');
    expect(r.Laugh).toBeNull();
    expect(r.Crit).toBeNull();
    expect(r.Idle_Var1).toBeNull();
  });

  it('un modelo sin clips de reposo no resuelve el reposo', () => {
    expect(resolveClips(['Attack1', 'Spell1']).Idle1_Base).toBeNull();
  });
});
