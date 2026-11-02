/**
 * tests/done/doneLogic.test.ts
 *
 * Lógica pura de Done: comando, catálogo y filtros, selección, cola de frases, medidas del
 * escenario, límites de ajustes y volumen de la boca.
 */

import { describe, expect, it } from 'vitest';
import {
  SpeechQueue,
  buildCatalog,
  cardKindOf,
  clampSettings,
  diffSettings,
  doneCommandWords,
  filterCatalog,
  gestureAllowed,
  matchDoneCommand,
  normalizeTextStyle,
  quotaLabel,
  resolveEntry,
  rmsOf,
  selectionFor,
  stageLayout,
  validateDoneCommand,
} from '../../src/components/done/doneLogic';
import { DONE_DEFAULTS, type DoneSpeech } from '../../src/lib/doneTypes';
import type { LuxLibraryModel, LuxModelLibrary } from '../../src/lib/luxApi';

const model = (id: string, extra: Partial<LuxLibraryModel> = {}): LuxLibraryModel => ({
  id,
  name: id,
  source: 'creador',
  ownerProfileId: null,
  fileName: null,
  bytes: 1024 * 1024,
  uploadedAt: null,
  reviewStatus: 'aprobado',
  licenseConfirmed: true,
  licenseNotice: null,
  ...extra,
});

const library: LuxModelLibrary = {
  library: [model('riot-lux', { source: 'riot', name: 'Lux Riot' }), model('admin-1', { name: 'Robot' })],
  mine: [model('mio-1', { name: 'Mi mascota', ownerProfileId: 'me', reviewStatus: 'pendiente' }), model('mio-2', { name: 'Prueba', ownerProfileId: 'me', reviewStatus: 'privado' })],
  limit: 10,
  used: 2,
  left: 8,
  chosen: null,
};

const speech = (id: string): DoneSpeech => ({ id, text: id, emotion: 'normal', gesture: null, viewer: null, kind: 'say', createdAt: '2026-01-01T00:00:00Z' });

describe('comando', () => {
  it('rechaza reservadas, cortas y símbolos', () => {
    for (const bad of ['s', 'luxon', 'luxoff', 'doneon', 'doneoff', 'tally', 'a', 'con espacio', 'ñu']) expect(validateDoneCommand(bad).ok).toBe(false);
    expect(validateDoneCommand('Done')).toEqual({ ok: true, word: 'done' });
    expect(validateDoneCommand('ayuda', ['ayuda']).ok).toBe(false);
  });
  it('alias y coincidencia', () => {
    expect(doneCommandWords('asistente', true)).toEqual(['asistente', 'done']);
    expect(doneCommandWords('done', true)).toEqual(['done']);
    expect(matchDoneCommand('!done hola', 'asistente', true)).toEqual({ word: 'done', rest: 'hola' });
    expect(matchDoneCommand('!done hola', 'asistente', false)).toBeNull();
    expect(matchDoneCommand('!donex', 'done', true)).toBeNull();
  });
});

describe('catálogo y galería', () => {
  const catalog = buildCatalog(library);
  it('incluye Done, Lux y todos los GLB sin repetir', () => {
    expect(catalog.map((e) => e.id)).toEqual(expect.arrayContaining(['svg:done', 'lux', 'glb:riot-lux', 'glb:admin-1', 'glb:mio-1', 'glb:mio-2']));
    expect(new Set(catalog.map((e) => e.id)).size).toBe(catalog.length);
  });
  it('filtros y búsqueda', () => {
    expect(filterCatalog(catalog, 'mios', '').map((e) => e.id).sort()).toEqual(['glb:mio-1', 'glb:mio-2']);
    expect(filterCatalog(catalog, 'pendientes', '').length).toBe(2);
    expect(filterCatalog(catalog, 'tally', '').every((e) => e.origin === 'tally')).toBe(true);
    expect(filterCatalog(catalog, 'todos', 'ROBOT').map((e) => e.id)).toEqual(['glb:admin-1']);
    expect(filterCatalog(catalog, 'todos', 'camara').map((e) => e.id)).toEqual(['svg:cam']);
  });
  it('selección y resolución', () => {
    const glb = catalog.find((e) => e.id === 'glb:admin-1')!;
    expect(selectionFor(glb)).toEqual({ characterId: 'glb:admin-1', modelId: 'admin-1' });
    expect(selectionFor(catalog.find((e) => e.id === 'lux')!)).toEqual({ characterId: 'lux', modelId: null });
    expect(resolveEntry(catalog, { characterId: null, modelId: null }).id).toBe('svg:done');
    expect(resolveEntry(catalog, { characterId: 'glb:mio-1', modelId: 'mio-1' }).id).toBe('glb:mio-1');
    expect(resolveEntry(catalog, { characterId: 'glb:x', modelId: 'x' }).id).toBe('svg:done');
  });
  it('cuota y gestos permitidos', () => {
    expect(quotaLabel(2, 10)).toBe('Cuota del plan: 2 de 10 modelos');
    expect(quotaLabel(0, 0)).toMatch(/no incluye/);
    expect(gestureAllowed({ allowedGestures: ['wave'] }, 'wave')).toBe(true);
    expect(gestureAllowed({ allowedGestures: ['wave'] }, 'spin')).toBe(false);
    expect(gestureAllowed({ allowedGestures: null }, 'spin')).toBe(true);
  });
});

describe('cola, escenario y ajustes', () => {
  it('la cola no repite ids y respeta el tope', () => {
    const q = new SpeechQueue();
    expect(q.push(speech('a'), speech('a'), speech('b'))).toBe(2);
    expect(q.next()?.id).toBe('a');
    for (let i = 0; i < 30; i++) q.push(speech(`n${i}`));
    expect(q.length).toBeLessThanOrEqual(12);
  });
  it('tamaño y posición', () => {
    expect(stageLayout(5, 'left').heightPct).toBe(10);
    expect(stageLayout(500, 'center')).toMatchObject({ heightPct: 100, anchor: 'center' });
  });
  it('límites de ajustes', () => {
    expect(clampSettings({ replyMax: 7 }).replyMax).toBe(60);
    expect(clampSettings({ replyMax: 999 }).replyMax).toBe(500);
    expect(clampSettings({ personality: 'x'.repeat(700) }).personality?.length).toBe(600);
    expect(clampSettings({ voiceVolume: 300 }).voiceVolume).toBe(100);
    expect(clampSettings({ typingCps: 1 }).typingCps).toBe(20);
    expect(diffSettings(DONE_DEFAULTS, { ...DONE_DEFAULTS, obsSize: 60 })).toEqual({ obsSize: 60 });
  });
  it('estilos de texto y tarjetas', () => {
    expect(normalizeTextStyle('arcade')).toBe('arcade');
    expect(normalizeTextStyle('nada')).toBe('cabina');
    expect(cardKindOf({ kind: 'say', viewer: 'x' })).toBe('none');
    expect(cardKindOf({ kind: 'chat', viewer: 'x' })).toBe('chat');
    expect(cardKindOf({ kind: 'event', viewer: null })).toBe('event');
  });
  it('rms de la voz', () => {
    expect(rmsOf(new Uint8Array(64).fill(128))).toBe(0);
    expect(rmsOf(new Uint8Array(64).fill(255))).toBeGreaterThan(0.9);
  });
});
