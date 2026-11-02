// @vitest-environment jsdom
/**
 * Participación: Metas, Ruleta y Batallas en pestañas dentro de su ventana.
 * Comprueba que se cambia de pestaña (clic y teclado), que ninguna opción se
 * pierde al reorganizar, que el monitor queda fijo y que cada paso de la guía
 * cambia primero a la pestaña que contiene su elemento.
 */

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, cleanup, click, flush, mount } from './dom';

vi.mock('../../src/components/SuiteNav', () => ({
  SuiteNav: (props: { onOpenTour?: () => void }) => (
    <div data-testid="suite-nav">
      <button type="button" onClick={props.onOpenTour}>
        Guía
      </button>
    </div>
  ),
}));
vi.mock('../../src/components/MediaLibraryModal', () => ({ MediaLibraryModal: () => null }));
vi.mock('../../src/hooks/useCloudSession', () => ({ useCloudSession: () => ({ profile: null }) }));
vi.mock('../../src/hooks/useVoiceCatalogue', () => ({
  useVoiceCatalogue: () => ({ catalogue: { voices: [] } }),
}));

import { GoalsStudio } from '../../src/pages/GoalsStudio';
import { RouletteStudio } from '../../src/pages/RouletteStudio';
import { PollsStudio } from '../../src/pages/PollsStudio';

const tabs = () => Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
const tab = (name: string) => tabs().find((t) => t.textContent === name) ?? null;
const panel = (name: string) => {
  const id = tab(name)?.getAttribute('aria-controls');
  return id ? document.getElementById(id) : null;
};
const visiblePanels = () => Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]')).filter((p) => !p.hidden);

beforeEach(() => {
  localStorage.clear();
  // Guía ya vista: no se abre sola
  ['metas', 'ruleta'].forEach((id) => localStorage.setItem(`lalo_tts_tour_done_${id}`, '1'));
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
  window.HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

describe('Metas en pestañas', () => {
  it('tiene Ajustes y Apariencia, y cambia con clic y con las flechas', async () => {
    await mount(<GoalsStudio />);
    expect(tabs().map((t) => t.textContent)).toEqual(['Ajustes', 'Apariencia']);
    expect(tab('Ajustes')?.getAttribute('aria-selected')).toBe('true');
    expect(visiblePanels()).toHaveLength(1);
    expect(panel('Apariencia')?.hidden).toBe(true);

    await click(tab('Apariencia'));
    expect(tab('Apariencia')?.getAttribute('aria-selected')).toBe('true');
    expect(panel('Apariencia')?.hidden).toBe(false);
    expect(panel('Ajustes')?.hidden).toBe(true);

    await act(async () => {
      tab('Apariencia')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(tab('Ajustes')?.getAttribute('aria-selected')).toBe('true');
  });

  it('conserva todas las opciones, repartidas entre las pestañas', async () => {
    await mount(<GoalsStudio />);
    const ajustes = panel('Ajustes')!;
    const apariencia = panel('Apariencia')!;
    for (const label of ['Título', 'Qué cuenta', 'Va en', 'Meta']) expect(byText(ajustes, 'label', label)).not.toBeNull();
    expect(byText(ajustes, 'summary', 'Al completar')).not.toBeNull();
    expect(byText(ajustes, 'summary', 'Voz')).not.toBeNull();
    for (const label of ['Reparto', 'Posición', 'Diseño', 'Color de avance']) {
      expect(byText(apariencia, '.cab-label', label)).not.toBeNull();
    }
    for (const name of ['Barra', 'Anillo', 'Bloques', 'Cinta', 'Columna', 'Personalizado']) {
      expect(byText(apariencia, 'button', name)).not.toBeNull();
    }
  });

  it('deja la lista, el monitor y las pruebas fuera de las pestañas', async () => {
    await mount(<GoalsStudio />);
    const fijo = document.querySelector<HTMLElement>('.pa-fijo')!;
    expect(fijo.closest('[role="tabpanel"]')).toBeNull();
    for (const text of ['Aporte +1', 'Aporte +5', 'Hasta el siguiente hito', 'Completar', 'Reiniciar', 'Probar celebración', 'Copiar URL para OBS']) {
      expect(byText(fijo, 'button', text), text).not.toBeNull();
    }
    expect(document.querySelector('[data-tour="goals-list"]')?.closest('[role="tabpanel"]')).toBeNull();
    // La barra de la suite queda fija encima de las pestañas
    const cabecera = document.querySelector('.pa-cabecera')!;
    expect(cabecera.querySelector('[data-testid="suite-nav"]')).not.toBeNull();
    expect(cabecera.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it('la guía cambia de pestaña antes de cada paso', async () => {
    await mount(<GoalsStudio />);
    const next = () => byText(document.body, 'button', /Siguiente|Entendido|Empezar/);
    await click(byText(document.body, 'button', 'Guía'));
    await flush();
    expect(tab('Ajustes')?.getAttribute('aria-selected')).toBe('true');
    // Bienvenida -> Tus metas -> Cómo se reparten (Apariencia) -> Editor (Ajustes)
    await click(next());
    await click(next());
    await flush();
    expect(tab('Apariencia')?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-tour="goals-mode"]')?.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(false);
    await click(next());
    await flush();
    expect(tab('Ajustes')?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-tour="goals-editor"]')?.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(false);
  });
});

describe('Ruleta en pestañas', () => {
  it('reparte Segmentos y Cómo se gira en Ajustes, Al caer en Apariencia, y el monitor queda fijo', async () => {
    await mount(<RouletteStudio />);
    expect(tabs().map((t) => t.textContent)).toEqual(['Ajustes', 'Apariencia']);
    const ajustes = panel('Ajustes')!;
    const apariencia = panel('Apariencia')!;
    expect(byText(ajustes, 'h2', 'Segmentos')).not.toBeNull();
    expect(byText(ajustes, 'h2', 'Cómo se gira')).not.toBeNull();
    expect(byText(ajustes, 'button', 'Añadir segmento')).not.toBeNull();
    expect(byText(apariencia, 'h2', 'Al caer')).not.toBeNull();
    expect(byText(apariencia, 'summary', 'Avanzado')).not.toBeNull();
    const fijo = document.querySelector<HTMLElement>('.pa-fijo')!;
    for (const text of ['Girar', 'Copiar URL para OBS', 'Simular canje', 'Simular cheer']) {
      expect(byText(fijo, 'button', text), text).not.toBeNull();
    }
    await click(tab('Apariencia'));
    expect(panel('Apariencia')?.hidden).toBe(false);
  });

  it('la guía cambia de pestaña: segmentos en Ajustes, Al caer en Apariencia', async () => {
    await mount(<RouletteStudio />);
    const next = () => byText(document.body, 'button', /Siguiente|Entendido|Empezar/);
    await click(byText(document.body, 'button', 'Guía'));
    await flush();
    await click(tab('Apariencia'));
    await click(next()); // Segmentos
    await flush();
    expect(tab('Ajustes')?.getAttribute('aria-selected')).toBe('true');
    await click(next()); // Cómo se gira
    await click(next()); // Al caer
    await flush();
    expect(tab('Apariencia')?.getAttribute('aria-selected')).toBe('true');
  });
});

describe('Batallas en pestañas', () => {
  it('reparte batalla, reglas, comandos y locutor en Ajustes, tema en Apariencia y pruebas en el panel fijo', async () => {
    await mount(<PollsStudio />);
    expect(tabs().map((t) => t.textContent)).toEqual(['Ajustes', 'Apariencia']);
    const ajustes = panel('Ajustes')!;
    expect(byText(ajustes, 'h2', 'Batalla')).not.toBeNull();
    for (const name of ['Reglas y sonido', 'Comandos para moderadores', 'Locutor']) {
      expect(byText(ajustes, 'summary', name), name).not.toBeNull();
    }
    expect(byText(panel('Apariencia')!, 'h2', 'Aspecto')).not.toBeNull();
    const fijo = document.querySelector<HTMLElement>('.pa-fijo')!;
    expect(byText(fijo, 'summary', 'Probar sin chat')).not.toBeNull();
    for (const text of ['Iniciar batalla', 'Reiniciar', 'Copiar URL para OBS']) {
      expect(byText(fijo, 'button', text), text).not.toBeNull();
    }
  });
});
