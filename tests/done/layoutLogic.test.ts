import { describe, expect, it } from 'vitest';
import { DEFAULT_PREVIEW_SIZE, PREVIEW_SIZE_KEY, PREVIEW_WIDTH, botStripView, parsePreviewSize, previewHeight, readPreviewSize, savePreviewSize } from '../../src/components/done/layoutLogic';
import { publicModuleUrl } from '../../src/components/done/renderers/publicUrl';
import type { BotConnectionView } from '../../src/lib/botApi';

const conn = (over: Partial<BotConnectionView> = {}): BotConnectionView => ({ hasChannel: true, twitchLogin: 'canal', chat: 'enabled', enabled: true, globalAvailable: false, ...over });

describe('tamaño de la vista previa', () => {
  it('S, M y L miden 260, 340 y 440 px y la altura sale del 16:9', () => {
    expect(PREVIEW_WIDTH).toEqual({ S: 260, M: 340, L: 440 });
    expect(previewHeight('M')).toBe(191);
  });
  it('un valor desconocido vuelve a M', () => {
    expect(parsePreviewSize('XL')).toBe(DEFAULT_PREVIEW_SIZE);
    expect(parsePreviewSize(null)).toBe('M');
    expect(parsePreviewSize('L')).toBe('L');
  });
  it('se guarda y se lee, y sin almacenamiento no falla', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    savePreviewSize('S', storage);
    expect(data.get(PREVIEW_SIZE_KEY)).toBe('S');
    expect(readPreviewSize(storage)).toBe('S');
    const broken = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };
    expect(() => savePreviewSize('L', broken)).not.toThrow();
    expect(readPreviewSize(broken)).toBe('M');
    expect(readPreviewSize(null)).toBe('M');
  });
});

describe('franja del bot', () => {
  it('sin leer el estado no ofrece acción', () => {
    const v = botStripView(null);
    expect(v.action).toBe('none');
    expect(v.steps.every((s) => !s.ok)).toBe(true);
  });
  it('sin canal lleva a la pantalla del bot', () => {
    expect(botStripView(conn({ hasChannel: false, chat: 'missing', enabled: false })).action).toBe('open-bot');
  });
  it('con permiso pero apagado ofrece conectar', () => {
    const v = botStripView(conn({ enabled: false }));
    expect(v.action).toBe('connect');
    expect(v.steps[2].label).toBe('Bot apagado');
  });
  it('sin permiso del chat ofrece conectar', () => {
    expect(botStripView(conn({ chat: 'missing', enabled: false })).action).toBe('connect');
  });
  it('activo ofrece apagar', () => {
    const v = botStripView(conn());
    expect(v.action).toBe('disconnect');
    expect(v.steps.map((s) => s.ok)).toEqual([true, true, true]);
    expect(v.steps[2].label).toBe('Bot activo');
  });
  it('si el servidor no puede escuchar el chat no hay acción y se explica', () => {
    const v = botStripView(conn({ chat: 'unavailable', enabled: false }));
    expect(v.action).toBe('none');
    expect(v.hint).not.toBe('');
  });
});

describe('módulos 3D de public/', () => {
  it('se piden con URL absoluta para que Vite en desarrollo no les añada ?import', () => {
    expect(publicModuleUrl('/lux/mascota/mascota.js', 'http://localhost:5173')).toBe('http://localhost:5173/lux/mascota/mascota.js');
    expect(publicModuleUrl('lux/proc/luxProcedural.js', 'https://tally.example')).toBe('https://tally.example/lux/proc/luxProcedural.js');
    expect(publicModuleUrl('https://cdn.example/x.js', 'http://localhost:5173')).toBe('https://cdn.example/x.js');
  });
});
