import { describe, it, expect } from 'vitest';
import {
  normalizeAccent,
  inkFor,
  clampScale,
  validateStickerSvg,
  encodeSticker,
  decodeSticker,
  normalizeAppearance,
  appearanceFromParams,
  stickerDataUri,
  DEFAULT_APPEARANCE,
  MAX_STICKER_BYTES,
} from '../src/utils/appearance';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#ff0"/><text>ñandú</text></svg>';

describe('appearance — Apariencia del widget', () => {
  it('normaliza colores de acento', () => {
    expect(normalizeAccent('#9146FF')).toBe('#9146ff');
    expect(normalizeAccent('53fc18')).toBe('#53fc18');
    expect(normalizeAccent('#abc')).toBe('#aabbcc');
    expect(normalizeAccent('red')).toBeNull();
    expect(normalizeAccent('#12345g')).toBeNull();
    expect(normalizeAccent(undefined)).toBeNull();
  });

  it('elige tinta legible sobre el acento', () => {
    expect(inkFor('#9146ff')).toBe('#ffffff');
    expect(inkFor('#53fc18')).toBe('#16141d');
    expect(inkFor('#000000')).toBe('#ffffff');
  });

  it('limita el tamaño al rango permitido', () => {
    expect(clampScale(5)).toBe(1.3);
    expect(clampScale('0.1')).toBe(0.8);
    expect(clampScale('1.1')).toBe(1.1);
    expect(clampScale('abc')).toBe(1);
  });

  it('acepta un SVG plano y rechaza los que no lo son', () => {
    expect(validateStickerSvg(SVG)).toEqual({ ok: true, svg: SVG });
    expect(validateStickerSvg('').ok).toBe(false);
    expect(validateStickerSvg('<div>hola</div>').ok).toBe(false);
    expect(validateStickerSvg('<svg><script>alert(1)</script></svg>').ok).toBe(false);
    expect(validateStickerSvg('<svg onload="alert(1)"></svg>').ok).toBe(false);
    expect(validateStickerSvg('<svg><a href="javascript:alert(1)">x</a></svg>').ok).toBe(false);
    expect(validateStickerSvg(`<svg>${'a'.repeat(MAX_STICKER_BYTES)}</svg>`).ok).toBe(false);
  });

  it('codifica y decodifica el sticker para la URL sin perder caracteres', () => {
    const encoded = encodeSticker(SVG);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSticker(encoded)).toBe(SVG);
    expect(decodeSticker('%%%no-es-base64')).toBeNull();
    expect(decodeSticker(encodeSticker('<p>no svg</p>'))).toBeNull();
    expect(decodeSticker(null)).toBeNull();
  });

  it('genera un data URI de imagen SVG', () => {
    expect(stickerDataUri(SVG).startsWith('data:image/svg+xml;charset=utf-8,%3Csvg')).toBe(true);
  });

  it('normaliza apariencias incompletas o manipuladas', () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(
      normalizeAppearance({ alertStyle: 'otro', accent: 'x', position: 'zz', scale: 9, energy: 1, stickerSvg: '<script>' })
    ).toEqual({ ...DEFAULT_APPEARANCE, scale: 1.3 });
    expect(normalizeAppearance({ alertStyle: 'sticker', stickerSvg: SVG }).stickerSvg).toBe(SVG);
  });

  it('lee de la URL solo los parámetros válidos', () => {
    const params = new URLSearchParams({ style: 'bocadillo', accent: 'ff2d46', pos: 'tr', scale: '1.2', energy: 'hype', sticker: encodeSticker(SVG) });
    expect(appearanceFromParams((k) => params.get(k))).toEqual({
      alertStyle: 'bocadillo',
      accent: '#ff2d46',
      position: 'tr',
      scale: 1.2,
      energy: 'hype',
      stickerSvg: SVG,
    });
    const bad = new URLSearchParams({ style: 'x', accent: 'zz', pos: 'q' });
    expect(appearanceFromParams((k) => bad.get(k))).toEqual({});
  });
});
