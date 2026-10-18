/**
 * tests/adminModelo3d.test.ts
 *
 * Bloque «Modelo 3D» de la ficha del personaje (portal admin): reglas puras del
 * navegador. El navegador comprueba .glb y 50 MB antes de pedir autorización; los
 * fallos de envío a R2 salen con un único mensaje, sin detalles técnicos.
 */

import { describe, expect, it } from 'vitest';
import {
  MODEL_MAX_BYTES,
  MODEL_UPLOAD_FAILED,
  checkModelFileForUpload,
  describeModelFile,
} from '../src/lib/luxModelUpload';

describe('comprobación del archivo en el navegador', () => {
  it('acepta .glb y hasta 50 MB', () => {
    expect(checkModelFileForUpload({ name: 'warwick.glb', size: 9 * 1024 * 1024 })).toBeNull();
    expect(checkModelFileForUpload({ name: 'Modelo.GLB', size: MODEL_MAX_BYTES })).toBeNull();
  });

  it('rechaza lo que no es .glb antes de subir', () => {
    expect(checkModelFileForUpload({ name: 'modelo.obj', size: 1024 })).toBe('El archivo no es un .glb.');
    expect(checkModelFileForUpload({ name: 'modelo.gltf', size: 1024 })).toBe('El archivo no es un .glb.');
  });

  it('rechaza más de 50 MB y archivos vacíos antes de subir', () => {
    expect(checkModelFileForUpload({ name: 'a.glb', size: MODEL_MAX_BYTES + 1 })).toBe('El archivo pesa más de 50 MB.');
    expect(checkModelFileForUpload({ name: 'a.glb', size: 0 })).toBe('El archivo está vacío.');
  });

  it('el mensaje de fallo de subida es el del diseño', () => {
    expect(MODEL_UPLOAD_FAILED).toBe('No se pudo subir. Vuelve a intentarlo.');
  });
});

describe('texto del archivo actual', () => {
  it('muestra nombre, tamaño y fecha', () => {
    const text = describeModelFile({ name: 'warwick.glb', bytes: 9.5 * 1024 * 1024, uploadedAt: '2026-10-18T10:00:00.000Z' });
    expect(text).toMatch(/^warwick\.glb · 9,5 MB · subido el /);
  });

  it('un modelo subido por terminal no tiene datos y se dice así', () => {
    expect(describeModelFile({ name: null, bytes: null, uploadedAt: null })).toBe('Modelo subido por terminal');
  });

  it('sin modelo no hay texto', () => {
    expect(describeModelFile(null)).toBeNull();
  });
});
