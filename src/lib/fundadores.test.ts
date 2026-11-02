/**
 * src/lib/fundadores.test.ts
 *
 * Pruebas de la lógica de fundadores y de la bienvenida de Tally Studio.
 */

import { describe, expect, it } from 'vitest';
import {
  REGALO_POR_DEFECTO,
  escenasDe,
  esFundador,
  estadoDesdeResultado,
  estadoInicialRegalo,
  etiquetaNumero,
  fechaVencimiento,
  inicios,
  leerConfigRegalo,
  leerDemo,
  nombreEmblema,
  numeroFundador,
  textoMeses,
  textoRegalo,
  varianteAMostrar,
  type ContextoBienvenida,
  type PerfilFundador,
} from './fundadores';

const activa: PerfilFundador = { role: 'streamer', status: 'active' };
const fundador: PerfilFundador = { ...activa, founder_number: 14 };

const ctx = (perfil: PerfilFundador | null, extra: Partial<ContextoBienvenida> = {}): ContextoBienvenida => ({
  perfil,
  vista: false,
  recorridoRecienTerminado: false,
  repeticion: false,
  ...extra,
});

describe('fundador', () => {
  it('es fundador solo con un número entero positivo', () => {
    expect(esFundador(fundador)).toBe(true);
    expect(esFundador(activa)).toBe(false);
    expect(esFundador({ ...activa, founder_number: null })).toBe(false);
    expect(esFundador({ ...activa, founder_number: 0 })).toBe(false);
    expect(esFundador({ ...activa, founder_number: 1.5 })).toBe(false);
    expect(esFundador(null)).toBe(false);
    expect(numeroFundador(fundador)).toBe(14);
  });

  it('numera el emblema con tres cifras', () => {
    expect(etiquetaNumero(14)).toBe('Nº 014');
    expect(etiquetaNumero(7)).toBe('Nº 007');
    expect(etiquetaNumero(1234)).toBe('Nº 1234');
    expect(nombreEmblema(14)).toBe('Creador Fundador Nº 014');
  });
});

describe('variante de la bienvenida', () => {
  it('el fundador que no la vio recibe la variante de fundador, sin recorrido', () => {
    expect(varianteAMostrar(ctx(fundador))).toBe('fundador');
  });

  it('el fundador no la ve dos veces: ni por la cuenta ni por el navegador', () => {
    expect(varianteAMostrar(ctx({ ...fundador, welcome_seen_at: '2026-11-03T10:00:00Z' }))).toBeNull();
    expect(varianteAMostrar(ctx(fundador, { vista: true }))).toBeNull();
  });

  it('la cuenta nueva la ve solo al terminar el recorrido', () => {
    expect(varianteAMostrar(ctx(activa))).toBeNull();
    expect(varianteAMostrar(ctx(activa, { recorridoRecienTerminado: true }))).toBe('nueva');
  });

  it('la cuenta nueva no la repite una vez vista', () => {
    expect(varianteAMostrar(ctx(activa, { recorridoRecienTerminado: true, vista: true }))).toBeNull();
    expect(varianteAMostrar(ctx({ ...activa, welcome_seen_at: '2026-11-03T10:00:00Z' }, { recorridoRecienTerminado: true }))).toBeNull();
  });

  it('la repetición a mano usa la variante de su cuenta aunque ya la haya visto', () => {
    expect(varianteAMostrar(ctx(fundador, { vista: true, repeticion: true }))).toBe('fundador');
    expect(varianteAMostrar(ctx(activa, { vista: true, repeticion: true }))).toBe('nueva');
  });

  it('administradores, cuentas sin activar y sin perfil nunca la ven', () => {
    expect(varianteAMostrar(ctx({ ...fundador, role: 'admin' }, { repeticion: true }))).toBeNull();
    expect(varianteAMostrar(ctx({ ...fundador, status: 'pending' }))).toBeNull();
    expect(varianteAMostrar(ctx({ ...fundador, status: 'suspended' }))).toBeNull();
    expect(varianteAMostrar(ctx(null))).toBeNull();
  });
});

describe('regalo', () => {
  it('meses en singular y plural', () => {
    expect(textoMeses(1)).toBe('1 mes');
    expect(textoMeses(3)).toBe('3 meses');
  });

  it('lee la configuración de la nube y cae en el respaldo si viene mal', () => {
    expect(leerConfigRegalo({ plan_id: 'x', plan_name: 'Equis', months: 3 })).toEqual({ planId: 'x', planNombre: 'Equis', meses: 3 });
    expect(leerConfigRegalo(null)).toEqual(REGALO_POR_DEFECTO);
    expect(leerConfigRegalo({ months: 0 }).meses).toBe(REGALO_POR_DEFECTO.meses);
    expect(leerConfigRegalo({ months: 99 }).meses).toBe(REGALO_POR_DEFECTO.meses);
    expect(leerConfigRegalo({ months: '3' }).meses).toBe(REGALO_POR_DEFECTO.meses);
  });

  it('el vencimiento suma meses y respeta el fin de mes', () => {
    expect(fechaVencimiento(new Date(2026, 10, 2), 1)).toEqual(new Date(2026, 11, 2));
    expect(fechaVencimiento(new Date(2026, 0, 31), 1)).toEqual(new Date(2026, 1, 28));
    expect(fechaVencimiento(new Date(2026, 10, 15), 3)).toEqual(new Date(2027, 1, 15));
    expect(fechaVencimiento(new Date(2026, 10, 15), 12)).toEqual(new Date(2027, 10, 15));
  });

  it('traduce el resultado de la nube al estado del botón', () => {
    expect(estadoDesdeResultado('ok')).toBe('activado');
    expect(estadoDesdeResultado('already_claimed')).toBe('activado');
    expect(estadoDesdeResultado('has_plan')).toBe('tiene-plan');
    expect(estadoDesdeResultado('not_founder')).toBe('oculto');
    expect(estadoDesdeResultado(null)).toBe('pendiente-admin');
    expect(estadoDesdeResultado(undefined)).toBe('pendiente-admin');
  });

  it('el estado inicial sale del perfil', () => {
    expect(estadoInicialRegalo(activa)).toBe('oculto');
    expect(estadoInicialRegalo(fundador)).toBe('disponible');
    expect(estadoInicialRegalo({ ...fundador, founder_gift_claimed_at: '2026-11-03T10:00:00Z' })).toBe('activado');
  });

  it('solo el estado disponible deja pulsar y el pendiente lo dice con claridad', () => {
    expect(textoRegalo('disponible').habilitado).toBe(true);
    expect(textoRegalo('pendiente-admin').habilitado).toBe(false);
    expect(textoRegalo('pendiente-admin').boton).toBe('Pendiente de activar por el administrador');
    expect(textoRegalo('activado').habilitado).toBe(false);
  });
});

describe('demostración por URL', () => {
  it('lee la variante de la búsqueda o del hash', () => {
    expect(leerDemo('?bienvenida=fundador')?.variante).toBe('fundador');
    expect(leerDemo('', '#catalogo?bienvenida=nueva')?.variante).toBe('nueva');
    expect(leerDemo('?bienvenida=otra')).toBeNull();
    expect(leerDemo('')).toBeNull();
  });

  it('acepta nombre, número y meses, con valores seguros por defecto', () => {
    expect(leerDemo('?bienvenida=fundador&nombre=Luz&n=7&meses=3')).toEqual({ variante: 'fundador', nombre: 'Luz', numero: 7, meses: 3 });
    expect(leerDemo('?bienvenida=fundador&n=-2&meses=40')).toMatchObject({ nombre: 'Gaby', numero: 14, meses: REGALO_POR_DEFECTO.meses });
  });
});

describe('escenas', () => {
  it('la cuenta nueva tiene tres escenas y el fundador siete, siempre terminando en el cierre', () => {
    expect(escenasDe('nueva')).toEqual(['saludo', 'ventajas', 'cierre']);
    expect(escenasDe('fundador')).toHaveLength(7);
    expect(escenasDe('fundador').at(-1)).toBe('cierre');
  });

  it('los inicios van en orden creciente', () => {
    for (const variante of ['nueva', 'fundador'] as const) {
      const tiempos = escenasDe(variante).map((id) => inicios(variante)[id] as number);
      expect(tiempos).toEqual([...tiempos].sort((a, b) => a - b));
      expect(tiempos[0]).toBe(0);
    }
  });
});
