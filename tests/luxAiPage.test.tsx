/**
 * tests/luxAiPage.test.tsx
 *
 * Panel de Lux AI: se renderiza a HTML con la sesión y las llamadas al servidor
 * simuladas. Comprueba la estructura de los dos casos (cuenta activada y no
 * activada), no la interacción. La interacción la cubren tests/lux*.test.ts.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ profile: null as Record<string, unknown> | null }));

vi.mock('../src/hooks/useCloudSession', () => ({
  useCloudSession: () => ({ profile: session.profile }),
}));

// El menú toca document en el render y solo se pinta en el navegador: se prueba aparte.
vi.mock('../src/components/SuiteNav', () => ({ SuiteNav: () => null }));

vi.mock('../src/lib/luxApi', () => ({
  luxGetSettings: () => new Promise(() => {}),
  luxSaveSettings: () => new Promise(() => {}),
  luxAsk: () => new Promise(() => {}),
}));

import { LuxAI } from '../src/pages/LuxAI';

describe('panel de Lux AI', () => {
  it('sin Lux activada para la cuenta, dice cómo activarla y no muestra controles', () => {
    session.profile = { id: 'p1', role: 'streamer', lux_enabled: false };
    const html = renderToStaticMarkup(<LuxAI />);
    expect(html).toContain('Lux no está activado para tu cuenta');
    expect(html).not.toContain('Guardar ajustes');
  });

  it('con Lux activada, muestra las tres secciones de configuración y la prueba', () => {
    session.profile = { id: 'p1', role: 'streamer', lux_enabled: true };
    const html = renderToStaticMarkup(<LuxAI />);
    expect(html).toContain('Personalidad');
    expect(html).toContain('Respuestas');
    expect(html).toContain('Personaje en OBS');
    expect(html).toContain('Probar a Lux');
    expect(html).toContain('¿Funciona?');
    expect(html).toContain('Guardar ajustes');
  });

  it('la dirección de OBS lleva el overlay y el tamaño por defecto', () => {
    session.profile = { id: 'p1', role: 'streamer', lux_enabled: true };
    const html = renderToStaticMarkup(<LuxAI />);
    expect(html).toContain('/lux/index.html?overlay=1&amp;size=40');
  });

  it('el administrador ve el panel aunque no tenga Lux activada para sí mismo', () => {
    session.profile = { id: 'a1', role: 'admin', lux_enabled: false };
    const html = renderToStaticMarkup(<LuxAI />);
    expect(html).toContain('Guardar ajustes');
  });
});
