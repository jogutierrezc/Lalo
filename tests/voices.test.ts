import { describe, expect, it } from 'vitest';
import {
  RECORD_SAMPLE_RATE,
  VOICE_MAX_TOTAL_BYTES,
  checkVoiceFiles,
  createChecklist,
  decodeVoiceEnvelope,
  encodeVoiceEnvelope,
  encodeWav,
  fishDeleteOutcome,
  fishErrorDetail,
  fishProblem,
  formatClock,
  isAllowedVoiceFile,
  permissionProblem,
  recordingProblem,
  voiceNameProblem,
  type VoiceEnvelopeMeta,
} from '../server/voices/rules';
import {
  catalogueCount,
  deleteWarning,
  pickCatalogue,
  presetCatalogue,
  resolveSavedVoice,
  sortAdminVoices,
  voiceMetaLine,
} from '../src/lib/voicesLogic';
import { adminHref, adminSectionFromHash } from '../src/lib/adminLogic';
import type { AdminVoiceRow, PublicVoiceRow } from '../src/lib/cloudTypes';
import { PRESET_VOICES } from '../src/types/settings';

const MB = 1024 * 1024;
const CHISPA = PRESET_VOICES[0].id;
const SEDA = PRESET_VOICES[1].id;

const row = (patch: Partial<AdminVoiceRow>): AdminVoiceRow => ({
  id: 'v1',
  name: 'Chispa',
  description: 'Aguda y traviesa.',
  reference_id: CHISPA,
  visible: true,
  is_default: false,
  origin: 'initial',
  created_at: '2026-10-01T10:00:00Z',
  voice_owner: 'unknown',
  permission_by: null,
  permission_confirmed_at: null,
  created_by: null,
  ...patch,
});

describe('archivos de audio', () => {
  it('acepta MP3, WAV y M4A y rechaza lo demás', () => {
    expect(isAllowedVoiceFile({ name: 'voz.mp3', type: 'audio/mpeg' })).toBe(true);
    expect(isAllowedVoiceFile({ name: 'VOZ.WAV', type: '' })).toBe(true);
    expect(isAllowedVoiceFile({ name: 'voz.m4a', type: 'audio/x-m4a' })).toBe(true);
    expect(isAllowedVoiceFile({ name: 'voz.webm', type: 'audio/webm' })).toBe(false);
    expect(isAllowedVoiceFile({ name: 'voz.mp3', type: 'image/png' })).toBe(false);
    expect(isAllowedVoiceFile({ name: 'sin-extension', type: 'audio/mpeg' })).toBe(false);
  });

  it('sin archivos no hay audio', () => {
    expect(checkVoiceFiles([]).ok).toBe(false);
  });

  it('da por buenos varios audios que caben', () => {
    const check = checkVoiceFiles([
      { name: 'a.mp3', type: 'audio/mpeg', size: MB },
      { name: 'b.wav', type: 'audio/wav', size: 2 * MB },
    ]);
    expect(check.ok).toBe(true);
    expect(check.totalBytes).toBe(3 * MB);
    expect(check.problem).toBeNull();
  });

  it('marca el archivo que no vale y no deja crear', () => {
    const check = checkVoiceFiles([
      { name: 'a.mp3', type: 'audio/mpeg', size: MB },
      { name: 'foto.png', type: 'image/png', size: 100 },
      { name: 'vacio.wav', type: 'audio/wav', size: 0 },
    ]);
    expect(check.ok).toBe(false);
    expect(check.files[0].problem).toBeNull();
    expect(check.files[1].problem).toContain('MP3, WAV o M4A');
    expect(check.files[2].problem).toContain('vacío');
  });

  it('el tope es de 4 MB entre todos, por debajo de los 4,5 MB de Vercel', () => {
    expect(VOICE_MAX_TOTAL_BYTES).toBe(4 * MB);
    expect(VOICE_MAX_TOTAL_BYTES).toBeLessThan(4.5 * 1000 * 1000);
    expect(checkVoiceFiles([{ name: 'a.mp3', type: 'audio/mpeg', size: 4 * MB }]).ok).toBe(true);

    const one = checkVoiceFiles([{ name: 'a.mp3', type: 'audio/mpeg', size: 4 * MB + 1 }]);
    expect(one.ok).toBe(false);
    expect(one.files[0].problem).toContain('4 MB');

    const several = checkVoiceFiles([
      { name: 'a.mp3', type: 'audio/mpeg', size: 3 * MB },
      { name: 'b.mp3', type: 'audio/mpeg', size: 2 * MB },
    ]);
    expect(several.ok).toBe(false);
    expect(several.files.every((file) => file.problem === null)).toBe(true);
    expect(several.problem).toContain('4 MB en total');
  });

  it('solo usa los cinco primeros', () => {
    const many = Array.from({ length: 7 }, (_, index) => ({ name: `${index}.mp3`, type: 'audio/mpeg', size: 1000 }));
    const check = checkVoiceFiles(many);
    expect(check.files).toHaveLength(5);
    expect(check.ignored).toBe(2);
    expect(check.ok).toBe(true);
  });
});

describe('grabación', () => {
  it('pide entre 15 y 60 segundos', () => {
    expect(recordingProblem(0)).toContain('vacía');
    expect(recordingProblem(14.9)).toContain('al menos 15 segundos');
    expect(recordingProblem(15)).toBeNull();
    expect(recordingProblem(60.3)).toBeNull();
    expect(recordingProblem(61)).toContain('más de 60');
    expect(recordingProblem(Number.NaN)).not.toBeNull();
  });

  it('un minuto a 24 kHz cabe en un envío', () => {
    expect(44 + 60 * RECORD_SAMPLE_RATE * 2).toBeLessThan(VOICE_MAX_TOTAL_BYTES);
  });

  it('escribe el reloj', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9.9)).toBe('0:09');
    expect(formatClock(75)).toBe('1:15');
  });
});

describe('nombre, permiso y lista de lo que falta', () => {
  const names = ['Chispa', 'Seda'];

  it('el nombre es obligatorio, corto y único sin mirar mayúsculas', () => {
    expect(voiceNameProblem('  ', names)).toBe('Falta el nombre.');
    expect(voiceNameProblem('x'.repeat(19), names)).toContain('18');
    expect(voiceNameProblem(' chispa ', names)).toBe('Ya hay una voz con ese nombre.');
    expect(voiceNameProblem('Trueno', names)).toBeNull();
  });

  it('el permiso es obligatorio', () => {
    expect(permissionProblem('own', '', false)).toContain('confirmar');
    expect(permissionProblem('own', '', true)).toBeNull();
    expect(permissionProblem('other', ' ', true)).toContain('quién dio el permiso');
    expect(permissionProblem('other', 'Ana Ruiz', true)).toBeNull();
    expect(permissionProblem('', '', true)).toContain('de quién es la voz');
  });

  it('dice lo que falta con las palabras de la maqueta', () => {
    const empty = createChecklist({
      audioReady: false,
      name: '',
      existingNames: names,
      owner: 'own',
      permissionBy: '',
      confirmed: false,
    });
    expect(empty.canCreate).toBe(false);
    expect(empty.message).toBe('Falta el audio, un nombre libre, la confirmación.');

    const other = createChecklist({
      audioReady: true,
      name: 'Seda',
      existingNames: names,
      owner: 'other',
      permissionBy: '',
      confirmed: true,
    });
    expect(other.missing).toEqual(['un nombre libre', 'quién dio el permiso']);

    const ready = createChecklist({
      audioReady: true,
      name: 'Trueno',
      existingNames: names,
      owner: 'other',
      permissionBy: 'Ana',
      confirmed: true,
    });
    expect(ready.canCreate).toBe(true);
    expect(ready.message).toBe('Todo listo.');
  });

  it('sin la casilla de confirmación no se puede crear nunca', () => {
    const check = createChecklist({
      audioReady: true,
      name: 'Trueno',
      existingNames: names,
      owner: 'own',
      permissionBy: '',
      confirmed: false,
    });
    expect(check.canCreate).toBe(false);
    expect(check.missing).toEqual(['la confirmación']);
  });
});

describe('envío al servidor', () => {
  const meta: VoiceEnvelopeMeta = {
    name: 'Trueno',
    description: 'Grave y tranquila.',
    origin: 'uploaded',
    owner: 'other',
    permissionBy: 'Ana Ruiz',
    confirmed: true,
    files: [
      { name: 'uno.mp3', type: 'audio/mpeg', size: 0 },
      { name: 'dos.wav', type: 'audio/wav', size: 0 },
    ],
  };
  const parts = [new Uint8Array([1, 2, 3]), new Uint8Array([9, 8, 7, 6, 5])];

  it('va y vuelve con los mismos datos y los mismos bytes', () => {
    const decoded = decodeVoiceEnvelope(encodeVoiceEnvelope(meta, parts));
    expect(decoded).not.toBeNull();
    expect(decoded!.meta.name).toBe('Trueno');
    expect(decoded!.meta.owner).toBe('other');
    expect(decoded!.meta.permissionBy).toBe('Ana Ruiz');
    expect(decoded!.meta.confirmed).toBe(true);
    expect(decoded!.meta.files.map((file) => file.size)).toEqual([3, 5]);
    expect(Array.from(decoded!.parts[0])).toEqual([1, 2, 3]);
    expect(Array.from(decoded!.parts[1])).toEqual([9, 8, 7, 6, 5]);
  });

  it('se lee igual si llega dentro de un búfer mayor (Buffer de Node)', () => {
    const bytes = encodeVoiceEnvelope(meta, parts);
    const padded = new Uint8Array(bytes.byteLength + 10);
    padded.set(bytes, 10);
    const decoded = decodeVoiceEnvelope(padded.subarray(10));
    expect(decoded?.meta.files).toHaveLength(2);
  });

  it('rechaza lo que no tiene la forma esperada', () => {
    const bytes = encodeVoiceEnvelope(meta, parts);
    expect(decodeVoiceEnvelope(new Uint8Array(0))).toBeNull();
    expect(decodeVoiceEnvelope(new TextEncoder().encode('{"name":"x"}'))).toBeNull();
    expect(decodeVoiceEnvelope(bytes.subarray(0, bytes.byteLength - 1))).toBeNull();
    const extra = new Uint8Array(bytes.byteLength + 1);
    extra.set(bytes);
    expect(decodeVoiceEnvelope(extra)).toBeNull();
  });

  it('la confirmación solo vale si es true de verdad', () => {
    const bytes = encodeVoiceEnvelope({ ...meta, confirmed: 'sí' as unknown as boolean }, parts);
    expect(decodeVoiceEnvelope(bytes)?.meta.confirmed).toBe(false);
  });
});

describe('WAV', () => {
  it('escribe una cabecera de 44 bytes, un canal y 16 bits', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 24000);
    const view = new DataView(wav.buffer);
    const text = (offset: number) => String.fromCharCode(...wav.subarray(offset, offset + 4));
    expect(wav.byteLength).toBe(44 + 8);
    expect(text(0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect(text(8)).toBe('WAVE');
    expect(text(12)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(28, true)).toBe(48000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(8);
  });

  it('pasa las muestras a enteros sin salirse del rango', () => {
    const view = new DataView(encodeWav(new Float32Array([0, 1, -1, 2, -2]), 24000).buffer);
    const at = (index: number) => view.getInt16(44 + index * 2, true);
    expect(at(0)).toBe(0);
    expect(at(1)).toBe(32767);
    expect(at(2)).toBe(-32768);
    expect(at(3)).toBe(32767);
    expect(at(4)).toBe(-32768);
  });
});

describe('respuestas de Fish Audio', () => {
  it('saca el texto del error', () => {
    expect(fishErrorDetail('{"status":401,"message":"Invalid token","reason":null}')).toBe('Invalid token');
    expect(fishErrorDetail('texto suelto')).toBe('texto suelto');
    expect(fishErrorDetail('')).toBe('');
  });

  it('explica cada código en español y cita lo que dijo Fish Audio', () => {
    expect(fishProblem('crear', 401, '{"message":"Invalid token"}')).toContain('FISH_AUDIO_API_KEY');
    expect(fishProblem('crear', 401, '{"message":"Invalid token"}')).toContain('«Invalid token»');
    expect(fishProblem('crear', 402, '')).toContain('saldo');
    expect(fishProblem('crear', 422, '{"message":"audio too short"}')).toContain('audio too short');
    expect(fishProblem('crear', 429, '')).toContain('esperar');
    expect(fishProblem('crear', 503, '')).toContain('saturado');
    expect(fishProblem('borrar', 401, '')).toContain('no es de esa cuenta');
    expect(fishProblem('borrar', 418, '')).toContain('418');
  });

  it('distingue borrado, modelo ajeno o inexistente y fallo', () => {
    expect(fishDeleteOutcome(200)).toBe('deleted');
    expect(fishDeleteOutcome(204)).toBe('deleted');
    expect(fishDeleteOutcome(404)).toBe('not_found');
    expect(fishDeleteOutcome(403)).toBe('not_owned');
    expect(fishDeleteOutcome(401)).toBe('failed');
    expect(fishDeleteOutcome(503)).toBe('failed');
  });
});

describe('catálogo del streamer', () => {
  const cloudRow = (patch: Partial<PublicVoiceRow>): PublicVoiceRow => ({
    id: 'x',
    name: 'Seda',
    description: 'Suave y cercana.',
    reference_id: SEDA,
    visible: true,
    is_default: false,
    origin: 'initial',
    created_at: '2026-10-01T10:00:02Z',
    ...patch,
  });
  const cloudRows = [
    cloudRow({ id: 'n', name: 'Trueno', reference_id: 'nueva0001', origin: 'recorded', created_at: '2026-10-03T10:00:00Z' }),
    cloudRow({}),
    cloudRow({ id: 'd', name: 'Chispa', reference_id: CHISPA, is_default: true, created_at: '2026-10-01T10:00:01Z' }),
  ];

  it('con la nube apagada, sin tabla o con fallo usa las cinco voces fijas', () => {
    expect(pickCatalogue({ cloudEnabled: false, rows: cloudRows }).source).toBe('fijas');
    expect(pickCatalogue({ cloudEnabled: true, rows: null }).source).toBe('fijas');
    expect(pickCatalogue({ cloudEnabled: true, rows: [] }).voices).toHaveLength(5);
    expect(presetCatalogue().defaultId).toBe(CHISPA);
  });

  it('sin una voz por defecto visible no se fía de la nube', () => {
    expect(pickCatalogue({ cloudEnabled: true, rows: [cloudRow({})] }).source).toBe('fijas');
  });

  it('con la nube usa sus voces visibles, en orden de alta', () => {
    const catalogue = pickCatalogue({ cloudEnabled: true, rows: [...cloudRows, cloudRow({ id: 'h', name: 'Oculta', reference_id: 'oculta001', visible: false })] });
    expect(catalogue.source).toBe('nube');
    expect(catalogue.voices.map((voice) => voice.name)).toEqual(['Chispa', 'Seda', 'Trueno']);
    expect(catalogue.defaultId).toBe(CHISPA);
    expect(catalogue.voices[2].id).toBe('nueva0001');
  });

  it('respeta la voz guardada si sigue en el catálogo', () => {
    const catalogue = pickCatalogue({ cloudEnabled: true, rows: cloudRows });
    expect(resolveSavedVoice(SEDA, catalogue, null)).toEqual({ id: SEDA, replaced: false, custom: false });
  });

  it('pasa a la voz por defecto si la guardada se retiró', () => {
    const catalogue = pickCatalogue({ cloudEnabled: true, rows: cloudRows });
    expect(resolveSavedVoice('borrada001', catalogue, 'retired')).toEqual({ id: CHISPA, replaced: true, custom: false });
    // Una de las cinco voces fijas que ya no está en la nube, aunque no se pudiera preguntar
    expect(resolveSavedVoice(PRESET_VOICES[4].id, catalogue, null)).toEqual({ id: CHISPA, replaced: true, custom: false });
  });

  it('un id propio del streamer no se toca', () => {
    const catalogue = pickCatalogue({ cloudEnabled: true, rows: cloudRows });
    expect(resolveSavedVoice('idpropio01', catalogue, 'unknown')).toEqual({ id: 'idpropio01', replaced: false, custom: true });
    expect(resolveSavedVoice('idpropio01', catalogue, null).custom).toBe(true);
    expect(resolveSavedVoice('idpropio01', presetCatalogue(), null).custom).toBe(true);
  });

  it('con las voces fijas no da por retirada ninguna', () => {
    expect(resolveSavedVoice(SEDA, presetCatalogue(), null).replaced).toBe(false);
    expect(resolveSavedVoice('', presetCatalogue(), null).id).toBe(CHISPA);
  });
});

describe('consola', () => {
  it('tiene la sección Voces', () => {
    expect(adminSectionFromHash('#admin/voces')).toBe('voces');
    expect(adminHref('voces')).toBe('#admin/voces');
  });

  it('pone primero las voces creadas, la más nueva arriba, y luego las iniciales', () => {
    const sorted = sortAdminVoices([
      row({ id: 'a', name: 'Chispa', created_at: '2026-10-01T10:00:01Z' }),
      row({ id: 'b', name: 'Seda', created_at: '2026-10-01T10:00:02Z' }),
      row({ id: 'c', name: 'Vieja', origin: 'uploaded', created_at: '2026-10-02T10:00:00Z' }),
      row({ id: 'd', name: 'Nueva', origin: 'recorded', created_at: '2026-10-03T10:00:00Z' }),
    ]);
    expect(sorted.map((voice) => voice.name)).toEqual(['Nueva', 'Vieja', 'Chispa', 'Seda']);
  });

  it('escribe el origen, el uso y el permiso', () => {
    expect(voiceMetaLine(row({ streamers: 14 }))).toBe('Inicial · la tienen guardada 14 streamers');
    expect(voiceMetaLine(row({ origin: 'recorded', voice_owner: 'own', streamers: 0 }))).toBe(
      'Grabada con micrófono · ningún streamer la tiene guardada · permiso: voz propia del administrador'
    );
    expect(voiceMetaLine(row({ origin: 'uploaded', voice_owner: 'other', permission_by: 'Ana Ruiz', streamers: 1 }))).toBe(
      'Audios subidos · la tiene guardada 1 streamer · permiso: Ana Ruiz'
    );
    // Sin recuento no se inventa
    expect(voiceMetaLine(row({}))).toBe('Inicial');
  });

  it('avisa de a cuántos afecta eliminar', () => {
    expect(deleteWarning({ streamers: 0 })).not.toContain('streamer');
    expect(deleteWarning({ streamers: 1 })).toContain('El streamer que la tiene guardada pasará');
    expect(deleteWarning({ streamers: 3 })).toContain('Los 3 streamers');
  });

  it('cuenta voces y visibles', () => {
    expect(catalogueCount([{ visible: true }, { visible: false }])).toBe('2 voces · 1 visible');
  });
});
