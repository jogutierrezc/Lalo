/**
 * tests/recorrido.test.ts
 *
 * Lógica pura de la bienvenida de streamers: orden de los pasos en cada camino,
 * paso siguiente y anterior, qué le falta a un perfil y estado de las tareas.
 */

import { describe, expect, it } from 'vitest';
import {
  ETIQUETA,
  NARRACION,
  ORDEN,
  TAREAS,
  claveBienvenida,
  claveTareas,
  esCamino,
  estadoPaso,
  hayPrimerosPasos,
  leerTareas,
  lineasDelPlan,
  marcarTarea,
  necesitaRecorrido,
  pasoAnterior,
  pasoConSesion,
  pasoSiguiente,
  pasosPendientes,
  pasosVisibles,
  tareasPendientes,
} from '../src/lib/recorrido';
import { DEFAULT_SETTINGS, PRESET_VOICES } from '../src/types/settings';

describe('orden de los pasos', () => {
  it('los dos caminos tienen los mismos pasos y solo cambia el orden', () => {
    expect([...ORDEN.tw].sort()).toEqual([...ORDEN.co].sort());
    expect(ORDEN.tw).toEqual(['entrar', 'permisos', 'datos', 'codigo', 'canal', 'bienvenida', 'panel']);
    expect(ORDEN.co).toEqual(['entrar', 'codigo', 'permisos', 'datos', 'canal', 'bienvenida', 'panel']);
  });

  it('en los dos caminos se explica qué se pide antes de enseñar lo que se tomó', () => {
    for (const camino of ['tw', 'co'] as const) {
      expect(ORDEN[camino].indexOf('permisos')).toBeLessThan(ORDEN[camino].indexOf('datos'));
    }
  });

  it('la lista visible no incluye el panel y todos los pasos tienen etiqueta', () => {
    expect(pasosVisibles('tw')).not.toContain('panel');
    expect(pasosVisibles('co')).toHaveLength(6);
    ORDEN.tw.forEach((paso) => expect(ETIQUETA[paso]).toBeTruthy());
  });

  it('paso siguiente y anterior según el camino', () => {
    expect(pasoSiguiente('tw', 'entrar')).toBe('permisos');
    expect(pasoSiguiente('co', 'entrar')).toBe('codigo');
    expect(pasoSiguiente('co', 'codigo')).toBe('permisos');
    expect(pasoSiguiente('tw', 'panel')).toBeNull();
    expect(pasoAnterior('tw', 'permisos')).toBe('entrar');
    expect(pasoAnterior('co', 'permisos')).toBe('codigo');
    expect(pasoAnterior('co', 'entrar')).toBeNull();
  });

  it('estado de cada paso respecto al actual', () => {
    expect(estadoPaso('tw', 'datos', 'permisos')).toBe('hecho');
    expect(estadoPaso('tw', 'datos', 'datos')).toBe('actual');
    expect(estadoPaso('tw', 'datos', 'codigo')).toBe('pendiente');
    expect(estadoPaso('co', 'datos', 'codigo')).toBe('hecho');
  });

  it('reconoce los caminos válidos', () => {
    expect(esCamino('tw')).toBe(true);
    expect(esCamino('co')).toBe(true);
    expect(esCamino('otro')).toBe(false);
    expect(esCamino(null)).toBe(false);
  });
});

describe('qué le falta a un perfil', () => {
  const streamer = { role: 'streamer', status: 'active' } as const;

  it('un streamer activo que no terminó ve la bienvenida', () => {
    expect(necesitaRecorrido({ ...streamer, onboarded_at: null }, true, false)).toBe(true);
    // Sin la migración aplicada la columna no llega
    expect(necesitaRecorrido(streamer, true, false)).toBe(true);
  });

  it('quien ya la terminó va directo al panel', () => {
    expect(necesitaRecorrido({ ...streamer, onboarded_at: '2026-01-01T00:00:00Z' }, true, false)).toBe(false);
  });

  it('el recuerdo de este navegador evita el bucle si la cuenta no pudo guardarlo', () => {
    expect(necesitaRecorrido(streamer, true, true)).toBe(false);
  });

  it('una cuenta pendiente con Twitch siempre la ve: le falta el código', () => {
    expect(necesitaRecorrido({ role: 'streamer', status: 'pending' }, true, true)).toBe(true);
  });

  it('nunca la ven el administrador, una cuenta sin Twitch, una suspendida ni quien no tiene perfil', () => {
    expect(necesitaRecorrido({ role: 'admin', status: 'active' }, true, false)).toBe(false);
    expect(necesitaRecorrido({ role: 'admin', status: 'active' }, false, false)).toBe(false);
    expect(necesitaRecorrido({ role: 'streamer', status: 'pending' }, false, false)).toBe(false);
    expect(necesitaRecorrido({ role: 'streamer', status: 'suspended' }, true, false)).toBe(false);
    expect(necesitaRecorrido(null, true, false)).toBe(false);
  });

  it('empezando con Twitch, tras entrar quedan datos, código, canal y bienvenida', () => {
    const nada = { activo: false, datosConfirmados: false, canalListo: false };
    expect(pasosPendientes('tw', nada)).toEqual(['datos', 'codigo', 'canal', 'bienvenida']);
    expect(pasoConSesion('tw', nada)).toBe('datos');
    expect(pasoConSesion('tw', { ...nada, datosConfirmados: true })).toBe('codigo');
  });

  it('empezando con el código, si ya se canjeó no se vuelve a pedir', () => {
    const canjeado = { activo: true, datosConfirmados: false, canalListo: false };
    expect(pasosPendientes('co', canjeado)).toEqual(['datos', 'canal', 'bienvenida']);
    // Si el canje falló al volver de Twitch, el código es lo primero
    expect(pasoConSesion('co', { ...canjeado, activo: false })).toBe('codigo');
  });

  it('con todo hecho solo queda la bienvenida', () => {
    const todo = { activo: true, datosConfirmados: true, canalListo: true };
    expect(pasosPendientes('tw', todo)).toEqual(['bienvenida']);
    expect(pasoConSesion('co', todo)).toBe('bienvenida');
  });
});

describe('plan', () => {
  it('escribe los límites reales del plan', () => {
    expect(lineasDelPlan({ storage_limit_bytes: 40 * 1024 * 1024, max_file_bytes: 5 * 1024 * 1024, max_files: 30 })).toEqual([
      '40 MB para tus archivos',
      '5 MB por archivo',
      '30 archivos',
    ]);
    expect(lineasDelPlan({ storage_limit_bytes: 2 * 1024 * 1024 * 1024, max_file_bytes: 1024 * 1024, max_files: 1 })).toEqual([
      '2 GB para tus archivos',
      '1 MB por archivo',
      '1 archivo',
    ]);
  });
});

describe('primeros pasos', () => {
  it('son tres tareas, en orden', () => {
    expect(TAREAS.map((tarea) => tarea.id)).toEqual(['obs', 'voz', 'alertas']);
  });

  it('lee lo guardado e ignora lo que no reconoce', () => {
    expect(leerTareas(null)).toEqual({});
    expect(leerTareas('no es json')).toEqual({});
    expect(leerTareas('[]')).toEqual({});
    expect(leerTareas('{"obs":"hecha","voz":"otra","extra":"hecha","alertas":"quitada"}')).toEqual({
      obs: 'hecha',
      alertas: 'quitada',
    });
  });

  it('marca tareas sin tocar el estado anterior', () => {
    const inicial = {};
    const una = marcarTarea(inicial, 'obs', 'hecha');
    expect(inicial).toEqual({});
    expect(una).toEqual({ obs: 'hecha' });
    expect(tareasPendientes(una)).toEqual(['voz', 'alertas']);
  });

  it('una tarea hecha no pasa a quitada, pero una quitada sí puede quedar hecha', () => {
    expect(marcarTarea({ obs: 'hecha' }, 'obs', 'quitada')).toEqual({ obs: 'hecha' });
    expect(marcarTarea({ obs: 'quitada' }, 'obs', 'hecha')).toEqual({ obs: 'hecha' });
  });

  it('el módulo se enseña hasta que cada tarea está hecha o quitada', () => {
    expect(hayPrimerosPasos({})).toBe(true);
    expect(hayPrimerosPasos({ obs: 'hecha', voz: 'quitada' })).toBe(true);
    expect(hayPrimerosPasos({ obs: 'hecha', voz: 'quitada', alertas: 'hecha' })).toBe(false);
  });

  it('el estado se guarda por cuenta', () => {
    expect(claveTareas('a')).not.toBe(claveTareas('b'));
    expect(claveBienvenida('a')).not.toBe(claveBienvenida('b'));
    expect(claveTareas('a')).not.toBe(claveBienvenida('a'));
  });
});

describe('Teemo', () => {
  it('tiene explicación para cada paso de la bienvenida', () => {
    pasosVisibles('tw').forEach((paso) => expect(NARRACION[paso as keyof typeof NARRACION]).toBeTruthy());
  });

  it('el paso de permisos dice que Lalo puede escribir en el chat con el bot y con LSS AI en beta', () => {
    expect(NARRACION.permisos).toMatch(/puede escribir en tu chat/);
    expect(NARRACION.permisos).toMatch(/bot/);
    expect(NARRACION.permisos).toMatch(/LSS AI/);
    expect(NARRACION.permisos).toMatch(/beta/);
    expect(NARRACION.permisos).not.toMatch(/no vamos a escribir/i);
  });

  it('es la voz por defecto de las cuentas nuevas', () => {
    expect(PRESET_VOICES.find((voice) => voice.id === DEFAULT_SETTINGS.referenceId)?.name).toBe('Teemo');
  });
});
