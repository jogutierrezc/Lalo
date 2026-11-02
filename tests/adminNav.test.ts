/**
 * Navegación de la consola de administración en grupos: las 12 rutas antiguas
 * siguen funcionando (alias), los grupos cubren todas las secciones y los
 * avisos de las secciones antiguas se suman en la nueva.
 */

import { describe, expect, it } from 'vitest';
import {
  ADMIN_ALIASES,
  ADMIN_GROUPS,
  ADMIN_HOME,
  ADMIN_SECTIONS,
  adminHref,
  adminRouteFromHash,
  adminSectionFromHash,
  navCounts,
} from '../src/lib/adminLogic';

// Las 12 secciones planas de antes del rediseño
const OLD_IDS = ['resumen', 'uso', 'codigos', 'limites', 'precios', 'suscripciones', 'almacenamiento', 'voces', 'personajes', 'streamers', 'integraciones', 'acceso'];

describe('grupos del menú', () => {
  it('son Cobros, Creadores, Contenido y Sistema, con el orden del diseño', () => {
    expect(ADMIN_GROUPS.map((g) => g.label)).toEqual(['Cobros', 'Creadores', 'Contenido', 'Sistema']);
    expect(ADMIN_GROUPS[0].sections.map((s) => s.label)).toEqual(['Bandeja de pagos', 'Facturación', 'Suscripciones', 'Planes y precios', 'Códigos y regalos']);
    expect(ADMIN_GROUPS[1].sections.map((s) => s.id)).toEqual(['cuentas', 'uso']);
    expect(ADMIN_GROUPS[2].sections.map((s) => s.id)).toEqual(['voces', 'almacenamiento']);
    expect(ADMIN_GROUPS[3].sections.map((s) => s.id)).toEqual(['integraciones', 'acceso']);
  });

  it('Resumen queda arriba como inicio y cada sección sale una sola vez', () => {
    expect(ADMIN_SECTIONS[0]).toEqual(ADMIN_HOME);
    const ids = ADMIN_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(12);
  });
});

describe('rutas antiguas', () => {
  it('cada una de las 12 direcciones antiguas lleva a una sección existente', () => {
    const known = new Set(ADMIN_SECTIONS.map((s) => s.id));
    for (const id of OLD_IDS) {
      const hash = id === 'resumen' ? '#admin' : `#admin/${id}`;
      expect(known.has(adminSectionFromHash(hash))).toBe(true);
    }
  });

  it('los alias llevan a la sección nueva que absorbió su contenido', () => {
    expect(adminSectionFromHash('#admin/limites')).toBe('precios');
    expect(adminSectionFromHash('#admin/streamers')).toBe('cuentas');
    expect(adminSectionFromHash('#admin/personajes')).toBe('voces');
    expect(adminSectionFromHash('#/ADMIN/Limites/')).toBe('precios');
    expect(ADMIN_ALIASES.limites.section).toBe('precios');
  });

  it('#admin/personajes abre la pestaña Personajes; #admin/voces, la de Voces', () => {
    expect(adminRouteFromHash('#admin/personajes')).toEqual({ section: 'voces', tab: 'personajes' });
    expect(adminRouteFromHash('#admin/voces/personajes')).toEqual({ section: 'voces', tab: 'personajes' });
    expect(adminRouteFromHash('#admin/voces')).toEqual({ section: 'voces', tab: null });
    expect(adminRouteFromHash('#admin/codigos/personajes')).toEqual({ section: 'codigos', tab: null });
  });

  it('adminHref escribe los nombres antiguos con su destino nuevo', () => {
    expect(adminHref('limites')).toBe('#admin/precios');
    expect(adminHref('streamers')).toBe('#admin/cuentas');
    expect(adminHref('personajes')).toBe('#admin/voces/personajes');
    expect(adminHref('voces')).toBe('#admin/voces');
    expect(adminHref('bandeja')).toBe('#admin/bandeja');
    expect(adminHref('resumen')).toBe('#admin');
  });

  it('las rutas nuevas son las mismas que se escriben al navegar', () => {
    for (const section of ADMIN_SECTIONS) expect(adminSectionFromHash(adminHref(section.id))).toBe(section.id);
  });
});

describe('navCounts', () => {
  it('suma los avisos de las secciones antiguas en la nueva', () => {
    expect(navCounts({ streamers: 2, uso: 1, codigos: 1, limites: 1, personajes: 3 })).toEqual({ cuentas: 2, uso: 1, codigos: 1, precios: 1, voces: 3 });
    expect(navCounts({ streamers: 1, cuentas: 1 })).toEqual({ cuentas: 2 });
    expect(navCounts({})).toEqual({});
  });
});
