/**
 * tests/rewardsLogic.test.ts
 *
 * Recompensas: qué recompensa responde a un cheer (gana la más específica),
 * quién puede activarla, esperas y límite por espectador, cola o solape, cuánto
 * se queda la placa, posición del vídeo (fija y aleatoria), migración de los
 * ajustes antiguos y resolución de las referencias a archivos.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REWARDS_SETTINGS,
  decodeRewardsSettings,
  encodeRewardsSettings,
  normalizeReward,
  normalizeRewardsSettings,
  plateStyleFor,
} from '../src/types/rewards';
import {
  ANON_NAME,
  MAX_REWARD_SECONDS,
  admit,
  bitsCandidates,
  bitsHit,
  canActivate,
  checkGate,
  commitGate,
  emptyGate,
  isLowBits,
  matchBitsReward,
  matchPointsReward,
  readChatTrigger,
  startable,
  staySeconds,
  triggerLabel,
} from '../src/utils/rewardsLogic';
import { FIXED_EDGE, fixedBox, randomBox, videoWidthPercent } from '../src/utils/rewardPosition';
import { findRewardByTwitchId, resolveReward, sourceLabel, triggerReward } from '../src/utils/rewardsEngine';
import { dataUrlToFile, isLocalOnlyMedia, mediaKindOfMime, resolveMediaUrl } from '../src/lib/mediaRef';

const bits = (id: string, mode: 'exact' | 'range', min: number, max: number | null = null, extra: Record<string, unknown> = {}) =>
  normalizeReward({ id, name: id, trigger: 'bits', bitsMode: mode, bitsMin: min, bitsMax: max, ...extra });

/** Azar de mentira: devuelve los valores dados, en orden y en bucle. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('bits: gana la más específica', () => {
  const list = [bits('desde50', 'range', 50), bits('rango', 'range', 50, 499), bits('exacta', 'exact', 100), bits('estrecho', 'range', 90, 110)];

  it('una cantidad exacta gana a cualquier rango', () => {
    expect(matchBitsReward(list, 100)?.id).toBe('exacta');
    expect(bitsCandidates(list, 100).map((r) => r.id)).toEqual(['exacta', 'estrecho', 'rango', 'desde50']);
  });

  it('entre rangos gana el más estrecho y, a igualdad, el mínimo más alto', () => {
    expect(matchBitsReward(list, 105)?.id).toBe('estrecho');
    expect(matchBitsReward(list, 300)?.id).toBe('rango');
    expect(matchBitsReward(list, 5000)?.id).toBe('desde50');
    const tie = [bits('a', 'range', 10, 20), bits('b', 'range', 15, 25)];
    expect(matchBitsReward(tie, 18)?.id).toBe('b');
  });

  it('no coincide por debajo del mínimo, por encima del tope ni si está apagada', () => {
    expect(matchBitsReward(list, 49)).toBeNull();
    expect(bitsHit(bits('x', 'range', 10, 20), 21)).toBe(false);
    expect(bitsHit(bits('x', 'exact', 100, null, { enabled: false }), 100)).toBe(false);
    expect(bitsHit(normalizeReward({ id: 'p', trigger: 'points' }), 100)).toBe(false);
  });

  it('acepta exactamente 1 bit y rangos que empiezan en 1', () => {
    expect(bitsHit(bits('uno', 'exact', 1), 1)).toBe(true);
    expect(bitsHit(bits('uno', 'exact', 1), 2)).toBe(false);
    expect(bitsHit(bits('desde1', 'range', 1, 9), 1)).toBe(true);
    expect(bitsHit(bits('desde1', 'range', 1), 0)).toBe(false);
    expect(bitsHit(bits('desde1', 'range', 1), 1.5)).toBe(false);
    expect(triggerLabel(bits('uno', 'exact', 1))).toBe('1 bit exacto');
    expect(triggerLabel(bits('r', 'range', 1))).toBe('1 bit o más');
    expect(triggerLabel(bits('r', 'range', 50, 499))).toBe('50 a 499 bits');
    expect(isLowBits(bits('uno', 'exact', 1))).toBe(true);
    expect(isLowBits(bits('cien', 'exact', 100))).toBe(false);
  });

  it('un mínimo no entero o menor que 1 se corrige al guardar', () => {
    expect(normalizeReward({ trigger: 'bits', bitsMin: 0.01 }).bitsMin).toBe(1);
    expect(normalizeReward({ trigger: 'bits', bitsMin: 0 }).bitsMin).toBe(1);
    expect(normalizeReward({ trigger: 'bits', bitsMin: 2.6 }).bitsMin).toBe(3);
    expect(normalizeReward({ trigger: 'bits', bitsMode: 'range', bitsMin: 50, bitsMax: 10 }).bitsMax).toBe(50);
  });
});

describe('lo que llega por el chat', () => {
  it('lee un cheer con su cantidad y un cheer anónimo como «Anónimo»', () => {
    expect(readChatTrigger({ username: 'pau_rl', 'display-name': 'Pau_RL', bits: '100' })).toEqual({
      kind: 'bits',
      bits: 100,
      username: 'pau_rl',
      user: 'Pau_RL',
    });
    const anon = readChatTrigger({ username: 'ananonymouscheerer', 'display-name': 'AnAnonymousCheerer', bits: '1' });
    expect(anon).toMatchObject({ kind: 'bits', bits: 1, user: ANON_NAME });
  });

  it('lee un canje con texto por su id y no confunde un mensaje normal', () => {
    expect(readChatTrigger({ username: 'mar', 'custom-reward-id': 'ABC-123' })).toMatchObject({ kind: 'points', rewardId: 'abc-123' });
    expect(readChatTrigger({ username: 'mar' })).toBeNull();
  });

  it('enlaza el id de Twitch con la recompensa de puntos encendida', () => {
    const list = [
      normalizeReward({ id: 'a', trigger: 'points', twitchRewardId: 'ABC-123' }),
      normalizeReward({ id: 'b', trigger: 'points', twitchRewardId: 'zzz', enabled: false }),
    ];
    expect(matchPointsReward(list, 'abc-123')?.id).toBe('a');
    expect(findRewardByTwitchId({ rewards: list }, 'ABC-123')?.id).toBe('a');
    expect(matchPointsReward(list, 'zzz')).toBeNull();
    expect(matchPointsReward(list, '')).toBeNull();
  });
});

describe('entrada común triggerReward', () => {
  const rewards = [normalizeReward({ id: 'p', trigger: 'points', twitchRewardId: 'tw-1' }), bits('b', 'range', 1)];

  it('elige por id propio, por id de Twitch o por bits', () => {
    expect(resolveReward({ rewards }, { rewardId: 'b' })?.id).toBe('b');
    expect(resolveReward({ rewards }, { twitchRewardId: 'TW-1' })?.id).toBe('p');
    expect(resolveReward({ rewards }, { bits: 25 })?.id).toBe('b');
    expect(resolveReward({ rewards }, {})).toBeNull();
  });

  it('etiqueta según el origen y avisa si no hay capa montada', () => {
    expect(sourceLabel({ source: 'bits', bits: 1 })).toBe('Cheer de 1 bit');
    expect(sourceLabel({ source: 'powerup', bits: 50 })).toBe('Power-up de 50 bits');
    expect(sourceLabel({ source: 'points' })).toBe('Canje de puntos');
    expect(sourceLabel({ source: 'powerup', label: 'Mensaje gigante' })).toBe('Mensaje gigante');
    expect(triggerReward({ source: 'points', twitchRewardId: 'tw-1', user: 'mar' })).toEqual({ ok: false, reason: 'no_layer' });
  });
});

describe('quién puede activarla', () => {
  it('todos, suscriptores hacia arriba, o VIP y moderadores', () => {
    expect(canActivate('all', 'viewer')).toBe(true);
    expect(canActivate('sub', 'viewer')).toBe(false);
    expect(canActivate('sub', 'sub')).toBe(true);
    expect(canActivate('sub', 'vip')).toBe(true);
    expect(canActivate('vip', 'sub')).toBe(false);
    expect(canActivate('vip', 'vip')).toBe(true);
    expect(canActivate('vip', 'mod')).toBe(true);
    expect(canActivate('vip', 'broadcaster')).toBe(true);
  });
});

describe('esperas y límite por espectador', () => {
  const reward = { id: 'r', name: 'Bocina', cooldownSeconds: 10 };
  const other = { id: 'o', name: 'Otra', cooldownSeconds: 0 };
  const rules = { globalCooldownSeconds: 5, perViewerPerMinute: 2 };

  it('el primer uso pasa y uno antes de tiempo se descarta sin alargar la espera', () => {
    let state = emptyGate();
    expect(checkGate(state, reward, rules, 'ana', 1000).ok).toBe(true);
    state = commitGate(state, reward, 'ana', 1000);
    const early = checkGate(state, reward, rules, 'luz', 4000);
    expect(early).toMatchObject({ ok: false, reason: 'cooldown', waitSeconds: 7 });
    // El descarte no se anota: a los 10 s vuelve a pasar
    expect(checkGate(state, reward, rules, 'luz', 11000).ok).toBe(true);
  });

  it('la espera general frena a otra recompensa', () => {
    const state = commitGate(emptyGate(), reward, 'ana', 1000);
    expect(checkGate(state, other, rules, 'luz', 3000)).toMatchObject({ ok: false, reason: 'global', waitSeconds: 3 });
    expect(checkGate(state, other, rules, 'luz', 6000).ok).toBe(true);
    expect(checkGate(state, other, { ...rules, globalCooldownSeconds: 0 }, 'luz', 1001).ok).toBe(true);
  });

  it('el límite por espectador cuenta el último minuto y luego caduca', () => {
    const free = { globalCooldownSeconds: 0, perViewerPerMinute: 2 };
    let state = emptyGate();
    state = commitGate(state, other, 'ana', 0);
    state = commitGate(state, other, 'ana', 1000);
    expect(checkGate(state, other, free, 'ana', 2000)).toMatchObject({ ok: false, reason: 'viewer', waitSeconds: 58 });
    expect(checkGate(state, other, free, 'luz', 2000).ok).toBe(true);
    expect(checkGate(state, other, free, 'ana', 60001).ok).toBe(true);
    expect(checkGate(state, other, { ...free, perViewerPerMinute: 0 }, 'ana', 2000).ok).toBe(true);
    // Al anotar otro uso se olvidan los que ya pasaron de un minuto
    expect(commitGate(state, other, 'luz', 120000).byViewer).toEqual({ luz: [120000] });
  });
});

describe('cola o solape', () => {
  const queue = { queueMode: 'queue' as const, overlapLimit: 3, queueMax: 2 };
  const overlap = { queueMode: 'overlap' as const, overlapLimit: 3, queueMax: 2 };

  it('en cola empieza una sola; en solape, hasta el máximo', () => {
    expect(startable(3, 0, queue)).toBe(1);
    expect(startable(3, 1, queue)).toBe(0);
    expect(startable(5, 0, overlap)).toBe(3);
    expect(startable(5, 2, overlap)).toBe(1);
    expect(startable(0, 0, overlap)).toBe(0);
  });

  it('con la cola llena, la siguiente se descarta', () => {
    expect(admit(0, 0, queue)).toBe('start');
    expect(admit(0, 1, queue)).toBe('wait');
    expect(admit(1, 1, queue)).toBe('wait');
    expect(admit(2, 1, queue)).toBe('full');
    expect(admit(0, 2, overlap)).toBe('start');
    expect(admit(0, 3, overlap)).toBe('wait');
  });
});

describe('cuánto se queda la placa', () => {
  const base = { videoSeconds: 0, hasPlate: true, minPlateSeconds: 2.5 };

  it('un clip muy corto mantiene el mínimo de la placa', () => {
    expect(staySeconds({ ...base, clipSeconds: 0.08 })).toBe(2.5);
    expect(staySeconds({ ...base, clipSeconds: 0.3 })).toBe(2.5);
    expect(staySeconds({ ...base, clipSeconds: 0 })).toBe(2.5);
  });

  it('un clip largo la mantiene hasta que acaba, con tope de 30 s', () => {
    expect(staySeconds({ ...base, clipSeconds: 7.2 })).toBe(7.2);
    expect(staySeconds({ ...base, clipSeconds: 95 })).toBe(MAX_REWARD_SECONDS);
  });

  it('sin placa dura lo que el sonido o el vídeo', () => {
    expect(staySeconds({ ...base, hasPlate: false, clipSeconds: 0.3 })).toBe(0.3);
    expect(staySeconds({ ...base, hasPlate: false, clipSeconds: 1, videoSeconds: 6 })).toBe(6);
    expect(staySeconds({ ...base, clipSeconds: Number.NaN })).toBe(2.5);
  });
});

describe('posición del vídeo', () => {
  const inside = (box: { left: number; top: number; width: number; height: number }, margin = 0) => {
    expect(box.left).toBeGreaterThanOrEqual(margin - 1e-9);
    expect(box.top).toBeGreaterThanOrEqual(margin - 1e-9);
    expect(box.left + box.width).toBeLessThanOrEqual(100 - margin + 1e-9);
    expect(box.top + box.height).toBeLessThanOrEqual(100 - margin + 1e-9);
  };

  it('el tamaño 100% ocupa un 30% del ancho y se acota entre 15 y 60', () => {
    expect(videoWidthPercent(1)).toBe(30);
    expect(videoWidthPercent(0.5)).toBe(15);
    expect(videoWidthPercent(2)).toBe(60);
    expect(videoWidthPercent(9)).toBe(60);
  });

  it('los nueve puntos fijos caen en su zona, enteros dentro de la pantalla', () => {
    const corner = fixedBox('top-left', 30);
    expect(corner).toMatchObject({ left: FIXED_EDGE, top: FIXED_EDGE, width: 30, zone: 0 });
    expect(fixedBox('center', 30)).toMatchObject({ left: 35, top: 35, zone: 4 });
    expect(fixedBox('bottom-right', 30)).toMatchObject({ left: 67, top: 67, zone: 8 });
    (['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const).forEach(
      (position, index) => {
        const box = fixedBox(position, 60);
        inside(box);
        expect(box.zone).toBe(index);
      }
    );
  });

  it('los seis valores antiguos siguen en el mismo sitio', () => {
    expect(fixedBox('bottom-left', 30).zone).toBe(6);
    expect(fixedBox('top-right', 30).zone).toBe(2);
    expect(normalizeReward({ position: 'bottom-right' }).position).toBe('bottom-right');
    expect(normalizeReward({ position: 'fullscreen' }).position).toBe('fullscreen');
    expect(normalizeReward({ position: 'sitio-raro' }).position).toBe('center');
  });

  it('la posición aleatoria respeta el margen y nunca se sale', () => {
    for (let i = 0; i < 200; i += 1) {
      const margin = i % 21;
      const box = randomBox({ widthPercent: 15 + (i % 46), margin, vary: i % 2 === 0, noRepeat: false });
      inside(box, margin);
    }
    // Azar en los extremos: 0 y casi 1
    inside(randomBox({ widthPercent: 30, margin: 6, vary: false, noRepeat: false }, seq(0)), 6);
    inside(randomBox({ widthPercent: 30, margin: 6, vary: false, noRepeat: false }, seq(0.999999)), 6);
  });

  it('en una pantalla que no es 16:9 el hueco sigue entero dentro', () => {
    inside(randomBox({ widthPercent: 60, margin: 10, vary: true, noRepeat: false, stageAspect: 21 / 9 }, seq(0.99)), 10);
    inside(fixedBox('bottom-right', 60, 4 / 3));
  });

  it('la variación de tamaño se queda entre el 80% y el 120%', () => {
    expect(randomBox({ widthPercent: 30, margin: 0, vary: true, noRepeat: false }, seq(0)).width).toBeCloseTo(24);
    expect(randomBox({ widthPercent: 30, margin: 0, vary: true, noRepeat: false }, seq(0.999999)).width).toBeCloseTo(36, 3);
    expect(randomBox({ widthPercent: 30, margin: 0, vary: false, noRepeat: false }, seq(0.5)).width).toBe(30);
  });

  it('no repite la zona anterior si hay otra disponible', () => {
    // Sin variar: la primera pareja cae arriba a la izquierda (zona 0); la segunda, abajo a la derecha
    const random = seq(0, 0, 0.99, 0.99);
    const box = randomBox({ widthPercent: 20, margin: 0, vary: false, noRepeat: true, lastZone: 0 }, random);
    expect(box.zone).toBe(8);
    expect(box.repeated).toBeUndefined();
    for (let i = 0; i < 100; i += 1) {
      expect(randomBox({ widthPercent: 20, margin: 5, vary: true, noRepeat: true, lastZone: 4 }).zone).not.toBe(4);
    }
  });

  it('si solo cabe en una zona, cae en ella y lo indica', () => {
    const box = randomBox({ widthPercent: 60, margin: 20, vary: false, noRepeat: true, lastZone: 4 });
    expect(box.zone).toBe(4);
    expect(box.repeated).toBe(true);
    inside(box, 20);
  });
});

describe('migración de los ajustes', () => {
  it('una recompensa antigua queda como estaba: por puntos, para todos y con su placa', () => {
    const old = {
      id: 'reward-boom',
      name: 'K.O.',
      cost: 500,
      description: '',
      enabled: true,
      cooldownSeconds: 30,
      userInputRequired: false,
      blendMode: 'transparent',
      position: 'bottom-right',
      scale: 1.25,
      volume: 0.9,
      showNoticeText: true,
      noticeTemplate: '¡K.O.! {user}',
      duration: 4,
      screenShake: true,
      soundType: 'retro-fanfare',
      customAudioUrl: 'data:audio/wav;base64,AAAA',
      accentColor: '#ff2d46',
    };
    const next = normalizeReward(old);
    expect(next).toMatchObject({
      ...old,
      trigger: 'points',
      twitchRewardId: '',
      audience: 'all',
      showPlate: true,
      plateStyle: 'default',
      randomMargin: 6,
    });
  });

  it('con vídeo y sin texto no tenía aviso: sigue sin placa', () => {
    expect(normalizeReward({ videoUrl: 'https://x/v.webm', showNoticeText: false }).showPlate).toBe(false);
    expect(normalizeReward({ showNoticeText: false }).showPlate).toBe(true);
  });

  it('los ajustes generales antiguos conservan sus valores y ganan los nuevos de partida', () => {
    const next = normalizeRewardsSettings({ channel: 'canal', rewards: [{ id: 'a', name: 'A' }], defaultVolume: 0.5, globalCooldownSeconds: 12, allowOverlappingVideos: true });
    expect(next).toMatchObject({
      channel: 'canal',
      defaultVolume: 0.5,
      globalCooldownSeconds: 12,
      queueMode: 'overlap',
      allowOverlappingVideos: true,
      enabled: true,
      perViewerPerMinute: 3,
      queueMax: 8,
      minPlateSeconds: 2.5,
      defaultPlateStyle: 'cabina',
    });
    expect(next.rewards).toHaveLength(1);
    expect(normalizeRewardsSettings({ allowOverlappingVideos: false }).queueMode).toBe('queue');
    expect(normalizeRewardsSettings(null).rewards.length).toBeGreaterThanOrEqual(4);
  });

  it('valores fuera de rango se acotan y un estilo desconocido vuelve al de partida', () => {
    const next = normalizeRewardsSettings({ overlapLimit: 99, queueMax: 0, minPlateSeconds: 60, defaultPlateStyle: 'raro', perViewerPerMinute: -4 });
    expect(next).toMatchObject({ overlapLimit: 4, queueMax: 1, minPlateSeconds: 5, defaultPlateStyle: 'cabina', perViewerPerMinute: 0 });
    expect(plateStyleFor(normalizeReward({ plateStyle: 'comic' }), next)).toBe('comic');
    expect(plateStyleFor(normalizeReward({ plateStyle: 'raro' }), { defaultPlateStyle: 'cristal' })).toBe('cristal');
  });

  it('la URL sin cuenta lleva los ajustes sin archivos incrustados', () => {
    const big = `data:audio/wav;base64,${'A'.repeat(5000)}`;
    const settings = normalizeRewardsSettings({
      ...DEFAULT_REWARDS_SETTINGS,
      rewards: [{ id: 'a', name: 'Bocina', trigger: 'bits', bitsMin: 1, customAudioUrl: big, videoUrl: 'https://cdn.example/v.webm' }],
    });
    const back = decodeRewardsSettings(encodeRewardsSettings(settings));
    expect(back?.rewards[0]).toMatchObject({ name: 'Bocina', trigger: 'bits', bitsMin: 1, videoUrl: 'https://cdn.example/v.webm' });
    expect(back?.rewards[0].customAudioUrl).toBeUndefined();
    expect(decodeRewardsSettings('no-es-base64-válido')).toBeNull();
    expect(decodeRewardsSettings(null)).toBeNull();
  });
});

describe('referencias a archivos', () => {
  const base = 'https://media.example.com/';

  it('una dirección pública, incrustada o temporal se usa tal cual', () => {
    expect(resolveMediaUrl('https://media.example.com/a/b.mp3', base)).toBe('https://media.example.com/a/b.mp3');
    expect(resolveMediaUrl('data:audio/wav;base64,AAAA', base)).toBe('data:audio/wav;base64,AAAA');
    expect(resolveMediaUrl('blob:https://lalo/1', base)).toBe('blob:https://lalo/1');
    expect(resolveMediaUrl('/media/intro.webm', base)).toBe('/media/intro.webm');
  });

  it('una clave de R2 se monta con la dirección base', () => {
    expect(resolveMediaUrl('r2:carpeta/mi sonido.mp3', base)).toBe('https://media.example.com/carpeta/mi%20sonido.mp3');
    expect(resolveMediaUrl({ objectKey: 'carpeta/x.webm' }, base)).toBe('https://media.example.com/carpeta/x.webm');
    expect(resolveMediaUrl({ objectKey: 'carpeta/x.webm', url: 'https://otra/x.webm' }, '')).toBe('https://otra/x.webm');
    expect(resolveMediaUrl('r2:carpeta/x.webm', '')).toBeNull();
  });

  it('vacío o irreconocible no da nada que abrir', () => {
    expect(resolveMediaUrl('', base)).toBeNull();
    expect(resolveMediaUrl(null, base)).toBeNull();
    expect(resolveMediaUrl(undefined, base)).toBeNull();
    expect(resolveMediaUrl({}, base)).toBeNull();
    expect(resolveMediaUrl('javascript:alert(1)', base)).toBeNull();
  });

  it('distingue lo que solo vive en este navegador', () => {
    expect(isLocalOnlyMedia(`data:audio/wav;base64,${'A'.repeat(3000)}`)).toBe(true);
    expect(isLocalOnlyMedia('blob:https://lalo/1')).toBe(true);
    expect(isLocalOnlyMedia('https://media.example.com/a.mp3')).toBe(false);
    expect(isLocalOnlyMedia(undefined)).toBe(false);
  });

  it('reconoce los tipos que admite la nube y convierte un archivo incrustado', () => {
    expect(mediaKindOfMime('audio/mpeg')).toBe('audio');
    expect(mediaKindOfMime('video/webm')).toBe('video');
    expect(mediaKindOfMime('image/png')).toBe('image');
    expect(mediaKindOfMime('audio/x-m4a')).toBeNull();
    const file = dataUrlToFile('data:audio/wav;base64,UklGRg==', 'clip.wav');
    expect(file?.type).toBe('audio/wav');
    expect(file?.size).toBe(4);
    expect(file?.name).toBe('clip.wav');
    expect(dataUrlToFile('https://x/y.wav', 'y.wav')).toBeNull();
  });
});
