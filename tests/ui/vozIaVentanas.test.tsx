// @vitest-environment jsdom
/**
 * Voz del chat, Mi AI y Bot dentro de su ventana con pestañas.
 *
 * Comprueba que cada pestaña muestra sus módulos, que ninguna opción se pierde
 * (todas se alcanzan recorriendo las pestañas), que el panel fijo (monitor o
 * «Probar») y el «Guardar ajustes» manual de Mi AI siguen a la vista, que las
 * pestañas se mueven con el teclado y que las guías cambian de pestaña antes de
 * enseñar cada paso.
 */

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { advance, byText, cleanup, click, flush, mount } from './dom';

const session = vi.hoisted(() => ({ profile: null as Record<string, unknown> | null }));

vi.mock('../../src/hooks/useCloudSession', () => ({
  useCloudSession: () => ({ enabled: false, loading: false, session: null, profile: session.profile, refresh: async () => {} }),
}));
vi.mock('../../src/components/SuiteNav', () => ({ SuiteNav: () => <div data-testid="barra-herramienta">barra</div> }));
vi.mock('../../src/lib/luxApi', () => ({
  luxGetSettings: () => new Promise(() => {}),
  luxSaveSettings: () => new Promise(() => {}),
  luxAsk: () => new Promise(() => {}),
  luxCharacterView: () => new Promise(() => {}),
  luxModelLibrary: () => new Promise(() => {}),
  luxModelOp: () => new Promise(() => {}),
  luxSay: () => new Promise(() => {}),
  luxSayList: () => new Promise(() => {}),
  luxMemories: () => new Promise(() => {}),
  luxCreateMemory: () => new Promise(() => {}),
  luxDeleteMemory: () => new Promise(() => {}),
  luxUpdateMemory: () => new Promise(() => {}),
}));
vi.mock('../../src/lib/twitchEventsApi', () => ({ callSubscriptions: () => new Promise(() => {}) }));
vi.mock('../../src/lib/voicesCloud', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/lib/voicesCloud')>();
  return { ...original, loadVoiceCatalogue: () => new Promise(() => {}) };
});

import { Dashboard } from '../../src/pages/Dashboard';
import { LuxAI } from '../../src/pages/LuxAI';
import { TwitchIOStudio } from '../../src/pages/TwitchIOStudio';

const tabsOf = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]'));
const tabNames = (host: HTMLElement) => tabsOf(host).map((tab) => tab.textContent);
const selected = (host: HTMLElement) => tabsOf(host).find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent;
const goTo = (host: HTMLElement, name: string) => click(byText(host, '[role="tab"]', name));

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // sin almacenamiento
  }
  // Sin animación y sin desplazamientos reales en jsdom
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
  session.profile = null;
});
afterEach(async () => {
  vi.useRealTimers();
  await cleanup();
});

describe('Voz del chat', () => {
  it('tiene tres pestañas (Voz, Reglas, Apariencia) con la barra de la herramienta fija encima', async () => {
    const { host } = await mount(<Dashboard />);
    expect(tabNames(host)).toEqual(['Voz', 'Reglas', 'Apariencia']);
    expect(selected(host)).toBe('Voz');
    const bar = host.querySelector('.vt-bar');
    const tablist = host.querySelector('[role="tablist"]');
    expect(bar?.textContent).toContain('barra');
    // La barra queda antes que las pestañas en el árbol
    expect(bar!.compareDocumentPosition(tablist!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('cada pestaña conserva sus opciones y el monitor con «Probar» queda visible en las tres', async () => {
    const { host } = await mount(<Dashboard />);
    const monitor = () => host.querySelector('.vt-aside');

    // Voz
    expect(host.textContent).toContain('Anunciar quién escribe');
    expect(host.textContent).toContain('Sonido antes de la voz');
    expect(host.textContent).toContain('Avanzado');
    expect(host.textContent).toContain('Emociones que puede escribir el chat');
    expect(monitor()?.textContent).toContain('Enviar al widget');
    expect(monitor()?.textContent).toContain('Copiar URL para OBS');

    // Reglas
    await goTo(host, 'Reglas');
    expect(selected(host)).toBe('Reglas');
    expect(host.textContent).toContain('Qué lee la voz');
    expect(host.textContent).toContain('Espera por usuario');
    expect(host.textContent).toContain('Prioridad a puntos y bits');
    expect(host.textContent).toContain('Bloqueos');
    expect(host.textContent).toContain('Cómo se activa');
    expect(monitor()?.textContent).toContain('Enviar al widget');

    // Apariencia
    await goTo(host, 'Apariencia');
    expect(host.textContent).toContain('Estilo de alerta');
    expect(host.textContent).toContain('Posición en pantalla');
    expect(host.textContent).toContain('Energía del movimiento');
    expect(host.textContent).toContain('Tamaño');
    expect(monitor()?.textContent).toContain('Enviar al widget');
    expect(monitor()?.textContent).toContain('Fondo claro');
  });

  it('las pestañas se mueven con las flechas, Inicio y Fin', async () => {
    const { host } = await mount(<Dashboard />);
    const press = async (key: string) => {
      const current = tabsOf(host).find((tab) => tab.getAttribute('aria-selected') === 'true')!;
      await act(async () => {
        current.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
    };
    await press('ArrowRight');
    expect(selected(host)).toBe('Reglas');
    await press('End');
    expect(selected(host)).toBe('Apariencia');
    await press('ArrowRight');
    expect(selected(host)).toBe('Voz');
    await press('ArrowLeft');
    expect(selected(host)).toBe('Apariencia');
    await press('Home');
    expect(selected(host)).toBe('Voz');
  });

  it('la guía de la primera vez cambia a la pestaña del módulo antes de cada paso', async () => {
    vi.useFakeTimers();
    const { host } = await mount(<Dashboard />);
    await goTo(host, 'Apariencia');
    await advance(700, vi);
    const dock = document.querySelector('.tour-dock');
    expect(dock).not.toBeNull();
    // Paso 1 (bienvenida) → paso 2: apunta a voz-editor, que vive en la pestaña Voz
    await click(byText(document.body, '.tour-dock button', /Empezar/));
    await flush();
    expect(selected(host)).toBe('Voz');
    expect(host.querySelector('[data-tour="voz-editor"]')).not.toBeNull();
    // Paso 3: el monitor es el panel fijo
    await click(byText(document.body, '.tour-dock button', /Siguiente/));
    await flush();
    expect(host.querySelector('[data-tour="voz-monitor"]')).not.toBeNull();
  });
});

describe('Mi AI', () => {
  it('sin Mi AI activada muestra solo la puerta, sin pestañas', async () => {
    session.profile = { id: 'p1', role: 'streamer', lux_enabled: false };
    const { host } = await mount(<LuxAI />);
    expect(host.textContent).toContain('Mi AI no está activada para tu cuenta');
    expect(tabsOf(host)).toHaveLength(0);
    expect(host.textContent).not.toContain('Guardar ajustes');
  });

  it('reparte los módulos de Ajustes en pestañas y no pierde ninguno', async () => {
    session.profile = { id: 'p1', role: 'streamer', lux_enabled: true };
    const { host } = await mount(<LuxAI />);
    expect(tabNames(host)).toEqual(['Personaje', 'Comando', 'Respuestas', 'Eventos', 'En OBS', 'Memoria']);

    // Personaje: personaje, modelo 3D y personalidad
    expect(host.textContent).toContain('Tu personaje');
    expect(host.textContent).toContain('Modelo 3D de tu personaje');
    expect(host.textContent).toContain('Personalidad');
    expect(host.textContent).toContain('Cómo habla Lux');

    await goTo(host, 'Comando');
    expect(host.textContent).toContain('Comando de activación');
    expect(host.textContent).toContain('Nombre de tu IA en el chat');
    expect(host.textContent).toContain('Palabra para hablar con tu IA');
    expect(host.textContent).toContain('De 2 a 20 letras o números, sin espacios. Por defecto: lux.');
    expect(host.textContent).toContain('estudio de TwitchIO');

    await goTo(host, 'Respuestas');
    expect(host.querySelector('[aria-label="Longitud máxima"]')).not.toBeNull();
    for (const text of ['Voz', 'Idioma', 'Recordar la conversación', 'Cuando alguien me provoca', 'Lux aprende del chat']) {
      expect(host.textContent).toContain(text);
    }

    await goTo(host, 'Eventos');
    for (const text of ['Comentarios espontáneos', 'Saludar cuando haya', 'Seguidores nuevos', 'Suscripciones', 'Raids', 'Inicio del directo', 'Ir a Power-ups']) {
      expect(host.textContent).toContain(text);
    }

    await goTo(host, 'En OBS');
    for (const text of ['Personaje en OBS', 'Dirección para la fuente de navegador', 'Vista previa']) expect(host.textContent).toContain(text);
    expect(host.querySelector('[aria-label="Giro del personaje"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Tamaño en pantalla"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Volumen de la voz"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('#lux-url')?.value).toContain('/lux/overlay.html?overlay=1&size=40');
    expect(host.querySelector('iframe[title="Vista previa del personaje de Lux"]')).not.toBeNull();
  });

  it('«Guardar ajustes» y el panel de pruebas quedan fijos en las pestañas de ajustes y se van en Memoria', async () => {
    session.profile = { id: 'p1', role: 'streamer', lux_enabled: true };
    const { host } = await mount(<LuxAI />);
    for (const name of ['Personaje', 'Comando', 'Respuestas', 'Eventos', 'En OBS']) {
      await goTo(host, name);
      expect(host.querySelector('.vt-foot')?.textContent).toContain('Guardar ajustes');
      const aside = host.querySelector('.vt-aside');
      expect(aside?.textContent).toContain('Probar a Lux');
      expect(aside?.textContent).toContain('Decir en el chat');
      expect(aside?.textContent).toContain('¿Funciona?');
    }
    await goTo(host, 'Memoria');
    expect(host.querySelector('.vt-foot')).toBeNull();
    expect(host.querySelector('.vt-aside')).toBeNull();
  });
});

describe('Bot', () => {
  it('tiene Conexión y Comandos, con «Probar» fijo en las dos', async () => {
    const { host } = await mount(<TwitchIOStudio />);
    expect(tabNames(host)).toEqual(['Conexión', 'Comandos']);
    expect(selected(host)).toBe('Conexión');
    expect(host.textContent).toContain('Bot en la nube');
    expect(host.textContent).toContain('Opción avanzada: ejecutar el bot en tu PC');
    expect(host.querySelector('.vt-aside')?.textContent).toContain('Mensaje de chat');

    await goTo(host, 'Comandos');
    expect(host.textContent).toContain('Nuevo comando');
    expect(host.textContent).toContain('Ajustes del bot');
    expect(host.textContent).toContain('Prefijo');
    expect(host.textContent).not.toContain('Bot en la nube');
    expect(host.querySelector('.vt-aside')?.textContent).toContain('Mensaje de chat');
  });

  it('la conversación de prueba no se pierde al cambiar de pestaña', async () => {
    const { host } = await mount(<TwitchIOStudio />);
    const input = host.querySelector<HTMLInputElement>('.vt-aside input');
    expect(input).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input!, 'hola sin prefijo');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      host.querySelector('.vt-aside form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(host.querySelector('.vt-aside')?.textContent).toContain('El bot no contesta');
    await goTo(host, 'Comandos');
    await goTo(host, 'Conexión');
    expect(host.querySelector('.vt-aside')?.textContent).toContain('El bot no contesta');
  });

  it('la guía cambia a Comandos y vuelve a Conexión según el módulo de cada paso', async () => {
    vi.useFakeTimers();
    const { host } = await mount(<TwitchIOStudio />);
    await advance(700, vi);
    expect(document.querySelector('.tour-dock')).not.toBeNull();
    const next = async () => {
      await click(byText(document.body, '.tour-dock button', /Empezar|Siguiente/));
      await flush();
    };
    await next(); // paso 2: bot-nube
    expect(selected(host)).toBe('Conexión');
    expect(host.querySelector('[data-tour="bot-nube"]')).not.toBeNull();
    await next(); // paso 3: bot-comandos
    expect(selected(host)).toBe('Comandos');
    expect(host.querySelector('[data-tour="bot-comandos"]')).not.toBeNull();
    await next(); // paso 4: bot-probar (panel fijo)
    expect(host.querySelector('[data-tour="bot-probar"]')).not.toBeNull();
    await next(); // paso 5: bot-arranque
    expect(selected(host)).toBe('Conexión');
    expect(host.querySelector('[data-tour="bot-arranque"]')).not.toBeNull();
    // Atrás vuelve a Comandos
    await click(byText(document.body, '.tour-dock button', /Atrás/));
    await click(byText(document.body, '.tour-dock button', /Atrás/));
    await flush();
    expect(selected(host)).toBe('Comandos');
  });
});
