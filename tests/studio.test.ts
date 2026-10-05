/**
 * tests/studio.test.ts
 *
 * Studio: modelo de escenas validado, operaciones sobre capas y escenas,
 * historial de deshacer, URL de cada escena, temporizador y catálogo de
 * animaciones.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STUDIO_SETTINGS,
  MAX_LAYERS,
  MIN_SIZE,
  STAGE_H,
  STAGE_W,
  SCENE_TEMPLATES,
  buildTemplateScene,
  cleanMediaUrl,
  createLayer,
  decodeScene,
  encodeScene,
  formatClock,
  makeId,
  mediaKindOf,
  normalizeLayer,
  normalizeScene,
  normalizeStudioSettings,
  sceneForWidget,
  timerDisplay,
  DEFAULT_TIMER,
} from '../src/types/studio';
import {
  addLayer,
  addScene,
  buildSceneUrl,
  duplicateLayer,
  duplicateScene,
  moveLayer,
  moveScene,
  pasteLayer,
  pushHistory,
  redoHistory,
  removeLayer,
  removeScene,
  renameScene,
  startHistory,
  undoHistory,
  uniqueName,
  updateLayer,
} from '../src/utils/studioScenes';
import { exitSeconds, layerStates } from '../src/utils/studioMotion';
import { CONFIG_MODULES } from '../src/lib/cloudTypes';
import { MODULE_STORAGE_KEYS } from '../src/lib/cloudConfig';

const live = DEFAULT_STUDIO_SETTINGS.scenes[0];
const ids = (scene: { layers: { id: string }[] }) => scene.layers.map((layer) => layer.id);

describe('studio: modelo', () => {
  it('sin nada guardado devuelve las escenas de partida', () => {
    expect(normalizeStudioSettings(null)).toBe(DEFAULT_STUDIO_SETTINGS);
    expect(normalizeStudioSettings({ scenes: [] })).toBe(DEFAULT_STUDIO_SETTINGS);
    expect(DEFAULT_STUDIO_SETTINGS.scenes.map((scene) => scene.name)).toEqual(['En directo', 'Empezando', 'Pausa', 'Fin']);
    expect(live.id).toBe('directo');
    expect(live.layers.map((layer) => layer.type)).toEqual(['alert', 'goal', 'chat', 'cam']);
  });

  it('lo guardado sobrevive a una vuelta de validación', () => {
    expect(normalizeStudioSettings(JSON.parse(JSON.stringify(DEFAULT_STUDIO_SETTINGS)))).toEqual(DEFAULT_STUDIO_SETTINGS);
  });

  it('las plantillas caben en el lienzo y tienen identificadores distintos', () => {
    SCENE_TEMPLATES.forEach((template) => {
      let n = 0;
      const scene = buildTemplateScene(template.id, 's', () => `l${(n += 1)}`);
      expect(new Set(ids(scene)).size).toBe(scene.layers.length);
      scene.layers.forEach((layer) => {
        expect(layer.x).toBeGreaterThanOrEqual(0);
        expect(layer.y).toBeGreaterThanOrEqual(0);
        expect(layer.x + layer.w).toBeLessThanOrEqual(STAGE_W);
        expect(layer.y + layer.h).toBeLessThanOrEqual(STAGE_H);
      });
    });
    expect(buildTemplateScene('blank', 's', () => 'x').layers).toEqual([]);
  });

  it('corrige valores fuera de rango y rellena lo que falta', () => {
    const layer = normalizeLayer({ type: 'text', w: 3, h: 'x', opacity: 400, delay: -2, enter: 'volar', text: { size: 9999, color: 'rojo' } });
    expect(layer).not.toBeNull();
    expect(layer!.w).toBe(MIN_SIZE);
    expect(layer!.h).toBe(110);
    expect(layer!.opacity).toBe(100);
    expect(layer!.delay).toBe(0);
    expect(layer!.enter).toBe('up');
    expect(layer!.text!.size).toBe(320);
    expect(layer!.text!.color).toBe('#ffffff');
    expect(layer!.name).toBe('Texto');
  });

  it('cada tipo recibe solo sus ajustes propios', () => {
    expect(createLayer('timer', 'a').timer).toEqual(DEFAULT_TIMER);
    expect(createLayer('timer', 'a').text).toBeUndefined();
    expect(createLayer('alert', 'a').random).toEqual({ enabled: false, w: 620, h: 150 });
    expect(createLayer('chat', 'a').random).toBeUndefined();
    const centered = createLayer('shape', 'a');
    expect(centered.x).toBe((STAGE_W - centered.w) / 2);
    expect(centered.y).toBe((STAGE_H - centered.h) / 2);
  });

  it('tolera tipos de capa desconocidos: no los dibuja, pero los conserva', () => {
    const scene = normalizeScene({ id: 'x', name: 'Mixta', layers: [{ type: 'holograma', id: 'h1', foo: 1 }, { type: 'shape', id: 's1' }, 'basura', null] });
    expect(scene.layers.map((layer) => layer.type)).toEqual(['shape']);
    expect(scene.extra).toEqual([{ type: 'holograma', id: 'h1', foo: 1 }]);
    // Al volver a leerla, lo desconocido sigue ahí
    expect(normalizeScene(JSON.parse(JSON.stringify(scene))).extra).toEqual(scene.extra);
  });

  it('no deja identificadores repetidos ni más capas de la cuenta', () => {
    const many = Array.from({ length: MAX_LAYERS + 5 }, () => ({ type: 'shape', id: 'igual' }));
    const scene = normalizeScene({ layers: many });
    expect(scene.layers).toHaveLength(MAX_LAYERS);
    expect(new Set(ids(scene)).size).toBe(MAX_LAYERS);
    const settings = normalizeStudioSettings({ scenes: [{ id: 'a' }, { id: 'a' }] });
    expect(settings.scenes[0].id).not.toBe(settings.scenes[1].id);
  });

  it('migra las claves cortas de la maqueta', () => {
    const scene = normalizeScene({ n: 'Vieja', L: [{ t: 'text', text: 'Hola', color: '#ff0000', op: 60, hid: true, lock: true, anim: 'pop', x: 10, y: 20 }] });
    expect(scene.name).toBe('Vieja');
    const [layer] = scene.layers;
    expect(layer.text!.content).toBe('Hola');
    expect(layer.text!.color).toBe('#ff0000');
    expect([layer.opacity, layer.hidden, layer.locked, layer.enter, layer.x, layer.y]).toEqual([60, true, true, 'pop', 10, 20]);
  });

  it('una capa de imagen o vídeo recuerda el archivo subido solo si tiene dirección', () => {
    const media = { url: 'https://cdn.lalo.test/intro.webm', kind: 'video', name: 'intro.webm', mediaId: 'abc-123', loop: false, muted: false };
    expect(normalizeLayer({ type: 'image', media })?.media).toEqual({ ...media, fit: 'contain' });
    // Sin dirección válida no queda ni el nombre ni el archivo
    const empty = normalizeLayer({ type: 'image', media: { ...media, url: 'data:video/webm;base64,AAAA' } })?.media;
    expect(empty).toMatchObject({ url: '', name: '', mediaId: '' });
    expect(normalizeLayer({ type: 'image', media: { ...media, mediaId: '../otro' } })?.media?.mediaId).toBe('');
  });

  it('solo acepta direcciones http(s) para imagen y vídeo', () => {
    expect(cleanMediaUrl('https://cdn.lalo.test/a b.png')).toBe('');
    expect(cleanMediaUrl('javascript:alert(1)')).toBe('');
    expect(cleanMediaUrl('data:image/png;base64,AAAA')).toBe('');
    expect(cleanMediaUrl(' https://cdn.lalo.test/logo.png ')).toBe('https://cdn.lalo.test/logo.png');
    expect(mediaKindOf('https://cdn.lalo.test/intro.webm?v=2')).toBe('video');
    expect(mediaKindOf('https://cdn.lalo.test/logo.png')).toBe('image');
  });

  it('makeId usa la fuente de azar que se le da', () => {
    expect(makeId('l', () => 0)).toBe('l000000');
    expect(makeId('s', () => 0.5)).toMatch(/^s[a-z0-9]{6}$/);
  });
});

describe('studio: capas', () => {
  it('añade delante y respeta el máximo', () => {
    const layer = createLayer('text', 'nuevo');
    expect(ids(addLayer(live, layer))[0]).toBe('nuevo');
    const full = { ...live, layers: Array.from({ length: MAX_LAYERS }, (_, i) => createLayer('shape', `s${i}`)) };
    expect(addLayer(full, layer)).toBe(full);
  });

  it('cambia una capa sin tocar el original ni su identidad', () => {
    const id = live.layers[1].id;
    const next = updateLayer(live, id, { x: 5, id: 'otro', type: 'text' } as never);
    expect(next.layers[1].x).toBe(5);
    expect(next.layers[1].id).toBe(id);
    expect(next.layers[1].type).toBe('goal');
    expect(live.layers[1].x).toBe(40);
    expect(updateLayer(live, 'no-existe', { x: 1 })).toBe(live);
  });

  it('borra, duplica y pega', () => {
    const id = live.layers[0].id;
    expect(ids(removeLayer(live, id))).not.toContain(id);
    expect(removeLayer(live, 'no-existe')).toBe(live);

    const dup = duplicateLayer(live, id, 'copia');
    expect(ids(dup).slice(0, 2)).toEqual(['copia', id]);
    expect(dup.layers[0].name).toBe('Alerta copia');
    expect([dup.layers[0].x, dup.layers[0].y]).toEqual([live.layers[0].x + 40, live.layers[0].y + 40]);

    // En su misma escena se desplaza; en otra queda donde estaba
    const same = pasteLayer(live, live.layers[2], 'p1');
    expect(same.layers[0].x).toBe(live.layers[2].x + 40);
    expect(same.layers[0].name).toBe('Chat 2');
    const other = pasteLayer(DEFAULT_STUDIO_SETTINGS.scenes[3], live.layers[2], 'p2');
    expect([other.layers[0].x, other.layers[0].name]).toEqual([live.layers[2].x, 'Chat']);
  });

  it('mueve el orden de apilado: adelante, atrás, al frente y al fondo', () => {
    const [a, b, c, d] = ids(live);
    expect(ids(moveLayer(live, c, 'forward'))).toEqual([a, c, b, d]);
    expect(ids(moveLayer(live, b, 'backward'))).toEqual([a, c, b, d]);
    expect(ids(moveLayer(live, d, 'front'))).toEqual([d, a, b, c]);
    expect(ids(moveLayer(live, a, 'back'))).toEqual([b, c, d, a]);
    expect(moveLayer(live, a, 'forward')).toBe(live);
    expect(moveLayer(live, d, 'back')).toBe(live);
  });

  it('busca nombres libres', () => {
    expect(uniqueName('Texto', [])).toBe('Texto');
    expect(uniqueName('Texto', ['Texto', 'Texto 2'])).toBe('Texto 3');
  });
});

describe('studio: escenas', () => {
  const settings = DEFAULT_STUDIO_SETTINGS;

  it('crea, renombra y reordena', () => {
    const added = addScene(settings, buildTemplateScene('pause', 'nueva', () => makeId('l')));
    expect(added.scenes).toHaveLength(5);
    expect(added.scenes[4].name).toBe('Pausa 2');
    expect(renameScene(settings, 'pausa', 'Descanso').scenes[2].name).toBe('Descanso');
    expect(moveScene(settings, 'pausa', -1).scenes.map((scene) => scene.id)).toEqual(['directo', 'pausa', 'empezando', 'fin']);
    expect(moveScene(settings, 'directo', -1)).toBe(settings);
    expect(moveScene(settings, 'fin', 1)).toBe(settings);
  });

  it('duplica con identificadores nuevos, justo después', () => {
    let n = 0;
    const next = duplicateScene(settings, 'directo', 'dup', () => `n${(n += 1)}`);
    expect(next.scenes.map((scene) => scene.id)).toEqual(['directo', 'dup', 'empezando', 'pausa', 'fin']);
    expect(next.scenes[1].name).toBe('En directo copia');
    expect(ids(next.scenes[1])).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(next.scenes[1].layers[0].type).toBe('alert');
  });

  it('borra, pero nunca la última', () => {
    expect(removeScene(settings, 'pausa').scenes.map((scene) => scene.id)).toEqual(['directo', 'empezando', 'fin']);
    const one = { ...settings, scenes: [settings.scenes[0]] };
    expect(removeScene(one, 'directo')).toBe(one);
  });
});

describe('studio: deshacer y rehacer', () => {
  it('cada cambio es un paso; los cambios fusionados cuentan como uno', () => {
    let h = startHistory(0);
    h = pushHistory(h, 1);
    h = pushHistory(h, 2, true);
    h = pushHistory(h, 3, true);
    expect(h.past).toEqual([0]);
    h = undoHistory(h);
    expect(h.present).toBe(0);
    h = redoHistory(h);
    expect(h.present).toBe(3);
    expect(undoHistory(startHistory(0)).present).toBe(0);
    expect(redoHistory(h)).toBe(h);
  });

  it('un cambio nuevo borra lo que se podía rehacer, y un cambio sin efecto no cuenta', () => {
    let h = pushHistory(pushHistory(startHistory('a'), 'b'), 'c');
    h = undoHistory(h);
    expect(h.future).toEqual(['c']);
    expect(pushHistory(h, 'b')).toBe(h);
    h = pushHistory(h, 'd');
    expect(h.future).toEqual([]);
    expect(h.past).toEqual(['a', 'b']);
  });
});

describe('studio: URL para OBS y sincronización', () => {
  it('con cuenta, la URL lleva el identificador de la escena y la clave', () => {
    expect(buildSceneUrl('https://lalo.app', 'laloplay_', live, { key: 'abc' })).toBe(
      'https://lalo.app/#widget?app=scene&channel=laloplay_&scene=directo&k=abc'
    );
  });

  it('sin cuenta, la escena viaja en la URL con los ajustes de chat y raid que hagan falta', () => {
    const url = buildSceneUrl('https://lalo.app', 'laloplay_', live, { chat: 'CHAT', raid: 'RAID' });
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('app')).toBe('scene');
    expect(params.get('cs')).toBe('CHAT');
    expect(params.get('rs')).toBeNull();
    expect(decodeScene(params.get('sc'))).toEqual(live);
  });

  it('la fuente de OBS encuentra su escena', () => {
    expect(sceneForWidget(DEFAULT_STUDIO_SETTINGS, 'pausa', null)?.name).toBe('Pausa');
    expect(sceneForWidget(DEFAULT_STUDIO_SETTINGS, 'borrada', null)).toBeNull();
    expect(sceneForWidget(DEFAULT_STUDIO_SETTINGS, null, null)?.id).toBe('directo');
    const fin = DEFAULT_STUDIO_SETTINGS.scenes[3];
    expect(sceneForWidget(DEFAULT_STUDIO_SETTINGS, 'directo', encodeScene(fin))?.id).toBe('fin');
    expect(decodeScene('%%%')).toBeNull();
  });

  it('el módulo studio se sincroniza con la nube', () => {
    expect(CONFIG_MODULES).toContain('studio');
    expect(MODULE_STORAGE_KEYS.studio).toBe('lalo_studio_settings');
  });
});

describe('studio: temporizador', () => {
  it('da formato a los segundos', () => {
    expect(formatClock(300, 'mmss')).toBe('05:00');
    expect(formatClock(3725, 'mmss')).toBe('62:05');
    expect(formatClock(3725, 'hmmss')).toBe('1:02:05');
    expect(formatClock(-4, 'mmss')).toBe('00:00');
  });

  it('cuenta atrás y decide qué pasa en cero', () => {
    expect(timerDisplay(DEFAULT_TIMER, 0).text).toBe('05:00');
    expect(timerDisplay(DEFAULT_TIMER, 61).text).toBe('03:59');
    expect(timerDisplay(DEFAULT_TIMER, 999)).toEqual({ text: '00:00', done: true, hidden: false });
    expect(timerDisplay({ ...DEFAULT_TIMER, atZero: 'text' }, 300).text).toBe('Empezamos');
    expect(timerDisplay({ ...DEFAULT_TIMER, atZero: 'hide' }, 300).hidden).toBe(true);
    expect(timerDisplay({ ...DEFAULT_TIMER, mode: 'up' }, 75).text).toBe('01:15');
  });
});

describe('studio: animaciones', () => {
  it('cada entrada parte de un estado oculto y acaba en reposo', () => {
    expect(layerStates('none', true, false)).toBeNull();
    expect(layerStates('up', true, false)).toEqual({ hidden: { opacity: 0, y: '1.2em' }, shown: { opacity: 1, y: 0 } });
    expect(layerStates('side', true, false)!.hidden.x).toBe('-2.5em');
    expect(layerStates('side', false, false)!.hidden.x).toBe('2.5em');
    expect(layerStates('wipe', true, false)!.hidden.clipPath).toBe('inset(0 100% 0 0)');
  });

  it('con movimiento reducido solo hay fundido', () => {
    (['fade', 'up', 'side', 'wipe', 'pop'] as const).forEach((anim) => {
      expect(layerStates(anim, true, true)).toEqual({ hidden: { opacity: 0 }, shown: { opacity: 1 } });
    });
  });

  it('la salida dura menos que la entrada', () => {
    expect(exitSeconds(0.5)).toBeLessThan(0.5);
    expect(exitSeconds(0.2)).toBeGreaterThanOrEqual(0.12);
  });
});
