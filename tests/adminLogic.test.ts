import { describe, expect, it } from 'vitest';
import {
  accountsThatFit,
  adminHref,
  adminSectionFromHash,
  attentionCounts,
  buildActivity,
  buildAttention,
  capacitySplit,
  filterProfiles,
  inviteState,
  invitesExpiringSoon,
  isNearlyFull,
  passwordChangeProblem,
  passwordProblem,
  relativeDay,
  storageHealth,
  type StorageSummary,
} from '../src/lib/adminLogic';
import type { InviteCodeRow, ProfileUsageRow } from '../src/lib/cloudTypes';
import { buildPublicUrl } from '../src/lib/storageApi';

const NOW = new Date('2026-10-03T12:00:00Z').getTime();
const DAY = 86400000;
const MB = 1024 * 1024;

const profile = (patch: Partial<ProfileUsageRow>): ProfileUsageRow => ({
  profile_id: 'p1',
  twitch_login: 'mar_ia',
  display_name: 'Mar',
  status: 'active',
  role: 'streamer',
  plan_id: 'basico',
  bytes_used: 10 * MB,
  file_count: 3,
  storage_limit_bytes: 40 * MB,
  max_file_bytes: 5 * MB,
  max_files: 30,
  ...patch,
});

const invite = (patch: Partial<InviteCodeRow>): InviteCodeRow => ({
  id: 'i1',
  code: 'LALO-AAAA',
  plan_id: 'basico',
  max_uses: 1,
  used_count: 0,
  expires_at: null,
  revoked_at: null,
  note: null,
  created_by: null,
  created_at: new Date(NOW - 2 * DAY).toISOString(),
  ...patch,
});

const okStorage: StorageSummary = { configured: true, missing: [], capacityBytes: 1024 * MB, lastTest: { ok: true, step: null, detail: null } };

describe('adminSectionFromHash', () => {
  it('lee cada sección de la consola', () => {
    expect(adminSectionFromHash('#admin')).toBe('resumen');
    expect(adminSectionFromHash('#admin/codigos')).toBe('codigos');
    expect(adminSectionFromHash('#/admin/limites/')).toBe('limites');
    expect(adminSectionFromHash('#ADMIN/Almacenamiento')).toBe('almacenamiento');
    expect(adminSectionFromHash('#admin/streamers?x=1')).toBe('streamers');
    expect(adminSectionFromHash('#admin/acceso')).toBe('acceso');
  });

  it('las direcciones de streamer y las desconocidas llevan al Resumen', () => {
    for (const hash of ['', '#', '#tts', '#alertas', '#ruleta', '#control', '#cuenta', '#admin/drive', '#administrar/codigos']) {
      expect(adminSectionFromHash(hash)).toBe('resumen');
    }
  });

  it('adminHref y adminSectionFromHash son inversas', () => {
    for (const section of ['resumen', 'codigos', 'limites', 'almacenamiento', 'streamers', 'acceso'] as const) {
      expect(adminSectionFromHash(adminHref(section))).toBe(section);
    }
  });
});

describe('códigos', () => {
  it('distingue vigente, caducado, agotado y revocado', () => {
    expect(inviteState(invite({}), NOW)).toMatchObject({ label: 'Vigente', open: true });
    expect(inviteState(invite({ expires_at: new Date(NOW - 1).toISOString() }), NOW).label).toBe('Caducado');
    expect(inviteState(invite({ used_count: 1 }), NOW).label).toBe('Agotado');
    expect(inviteState(invite({ revoked_at: new Date(NOW).toISOString() }), NOW).label).toBe('Revocado');
  });

  it('solo avisa de los vigentes que caducan en 7 días', () => {
    const soon = invite({ id: 'a', expires_at: new Date(NOW + 6 * DAY).toISOString() });
    const later = invite({ id: 'b', expires_at: new Date(NOW + 8 * DAY).toISOString() });
    const never = invite({ id: 'c' });
    const usedUp = invite({ id: 'd', used_count: 1, expires_at: new Date(NOW + DAY).toISOString() });
    expect(invitesExpiringSoon([soon, later, never, usedUp], NOW).map((entry) => entry.id)).toEqual(['a']);
  });
});

describe('cuentas', () => {
  it('casi llena es activa y al 85% o más', () => {
    expect(isNearlyFull(profile({ bytes_used: 34 * MB }))).toBe(true);
    expect(isNearlyFull(profile({ bytes_used: 33 * MB }))).toBe(false);
    expect(isNearlyFull(profile({ bytes_used: 40 * MB, status: 'suspended' }))).toBe(false);
    expect(isNearlyFull(profile({ bytes_used: 0, storage_limit_bytes: 0 }))).toBe(false);
  });

  it('filtra por estado y por nombre', () => {
    const rows = [
      profile({ profile_id: 'a', display_name: 'Mar', twitch_login: 'mar_ia' }),
      profile({ profile_id: 'b', display_name: 'Dani', twitch_login: 'dani_gg', bytes_used: 39 * MB }),
      profile({ profile_id: 'c', display_name: null, twitch_login: 'xx_pro', status: 'suspended' }),
    ];
    const ids = (filter: Parameters<typeof filterProfiles>[1], search = '') => filterProfiles(rows, filter, search).map((row) => row.profile_id);
    expect(ids('todas')).toEqual(['a', 'b', 'c']);
    expect(ids('activas')).toEqual(['a', 'b']);
    expect(ids('llenas')).toEqual(['b']);
    expect(ids('suspendidas')).toEqual(['c']);
    expect(ids('todas', ' DANI ')).toEqual(['b']);
    expect(ids('activas', 'xx')).toEqual([]);
  });
});

describe('almacenamiento', () => {
  it('resume el estado', () => {
    expect(storageHealth(null)).toBe('unknown');
    expect(storageHealth({ ...okStorage, configured: false, missing: ['R2_BUCKET'], lastTest: null })).toBe('missing');
    expect(storageHealth({ ...okStorage, lastTest: null })).toBe('untested');
    expect(storageHealth({ ...okStorage, lastTest: { ok: false, step: 'leer', detail: '403' } })).toBe('failed');
    expect(storageHealth(okStorage)).toBe('ok');
  });

  it('reparte la capacidad en usado, prometido sin usar y libre', () => {
    expect(capacitySplit(1000, 100, 400)).toEqual({ capacity: 1000, used: 100, promised: 300, free: 600, overcommitted: false });
    // Más usado que prometido (cuentas suspendidas con archivos): no hay parte prometida
    expect(capacitySplit(1000, 500, 200)).toEqual({ capacity: 1000, used: 500, promised: 0, free: 500, overcommitted: false });
    // Prometido por encima de la capacidad
    expect(capacitySplit(1000, 100, 1500)).toEqual({ capacity: 1000, used: 100, promised: 900, free: 0, overcommitted: true });
  });

  it('cuenta cuántas cuentas caben', () => {
    expect(accountsThatFit(600 * MB, 40 * MB)).toBe(15);
    expect(accountsThatFit(39 * MB, 40 * MB)).toBe(0);
    expect(accountsThatFit(100, 0)).toBe(0);
  });

  it('monta la dirección pública de un archivo', () => {
    expect(buildPublicUrl('https://pub-x.r2.dev/', 'carpeta/mi archivo.png')).toBe('https://pub-x.r2.dev/carpeta/mi%20archivo.png');
    expect(buildPublicUrl('', 'carpeta/a.png')).toBeNull();
  });
});

describe('requiere tu atención', () => {
  const base = { profiles: [profile({})], invites: [invite({})], now: NOW };

  it('sin nada pendiente, la lista queda vacía', () => {
    expect(buildAttention({ ...base, storage: okStorage })).toEqual([]);
  });

  it('avisa del almacenamiento según su estado', () => {
    const first = (storage: StorageSummary | null) => buildAttention({ ...base, storage })[0];
    expect(first(null)).toMatchObject({ level: 'bad', section: 'almacenamiento' });
    expect(first({ ...okStorage, configured: false, missing: ['R2_BUCKET'], lastTest: null }).text).toContain('no está configurado');
    expect(first({ ...okStorage, lastTest: null })).toMatchObject({ level: 'warn' });
    expect(first({ ...okStorage, lastTest: { ok: false, step: 'permiso', detail: '' } }).text).toContain('falló');
  });

  it('junta las cuentas casi llenas y lista los códigos que caducan', () => {
    const items = buildAttention({
      storage: okStorage,
      now: NOW,
      profiles: [
        profile({ profile_id: 'a', display_name: 'Dani', bytes_used: 39 * MB }),
        profile({ profile_id: 'b', display_name: 'Caro', bytes_used: 36 * MB }),
        profile({ profile_id: 'c', display_name: 'Luz' }),
      ],
      invites: [invite({ code: 'LALO-7KQ2', expires_at: new Date(NOW + 6 * DAY - 1000).toISOString() })],
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ level: 'warn', section: 'streamers' });
    expect(items[0].text).toBe('2 cuentas están al 85% o más de su plan: Dani, Caro.');
    expect(items[1].text).toBe('El código LALO-7KQ2 caduca en 6 días y sigue sin usar.');
    expect(attentionCounts(items)).toEqual({ streamers: 1, codigos: 1 });
  });
});

describe('actividad', () => {
  it('mezcla canjes y códigos creados, lo más reciente primero', () => {
    const items = buildActivity(
      [invite({ id: 'i1', code: 'LALO-AAAA', note: 'Pau', created_at: new Date(NOW - 3 * DAY).toISOString() })],
      [{ invite_code_id: 'i1', profile_id: 'p1', redeemed_at: new Date(NOW - DAY).toISOString() }],
      [profile({})]
    );
    expect(items.map((item) => item.text)).toEqual(['Mar canjeó LALO-AAAA', 'Se creó el código LALO-AAAA para Pau']);
  });

  it('escribe la fecha de forma relativa', () => {
    expect(relativeDay(null, NOW)).toBe('Nunca');
    expect(relativeDay(new Date(NOW).toISOString(), NOW)).toBe('Hoy');
    expect(relativeDay(new Date(NOW - 9 * DAY).toISOString(), NOW)).toBe('Hace 9 días');
    expect(relativeDay(new Date(NOW - 21 * DAY).toISOString(), NOW)).toBe('Hace 3 semanas');
  });
});

describe('clave', () => {
  it('valida antes de enviar', () => {
    expect(passwordProblem('corta', 'corta')).toContain('al menos 8');
    expect(passwordProblem('clave-larga-1', 'clave-larga-2')).toContain('no coinciden');
    expect(passwordProblem(' clave-larga', ' clave-larga')).toContain('espacios');
    expect(passwordProblem('clave-larga-1', 'clave-larga-1')).toBeNull();
  });

  it('explica los errores de Supabase', () => {
    expect(passwordChangeProblem({ code: 'same_password' })).toContain('igual');
    expect(passwordChangeProblem({ code: 'weak_password' })).toContain('débil');
    expect(passwordChangeProblem({ status: 429 })).toContain('Demasiados');
    expect(passwordChangeProblem({ message: 'Failed to fetch' })).toContain('conectar');
    expect(passwordChangeProblem({ message: 'algo raro' })).toBe('No se pudo cambiar la clave: algo raro');
  });
});
