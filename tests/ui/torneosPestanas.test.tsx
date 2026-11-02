// @vitest-environment jsdom
/**
 * Torneos: cuatro pestañas (Torneo, En directo, Marca, Narrador y comandos) con
 * el monitor fijo, la insignia de solicitudes pendientes y las opciones intactas.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, cleanup, click, mount } from './dom';

vi.mock('../../src/components/SuiteNav', () => ({ SuiteNav: () => <div data-testid="suite-nav" /> }));
vi.mock('../../src/hooks/useCloudSession', () => ({ useCloudSession: () => ({ profile: null }) }));
vi.mock('../../src/hooks/useVoiceCatalogue', () => ({ useVoiceCatalogue: () => ({ catalogue: { voices: [] } }) }));
vi.mock('../../src/components/recompensas/MediaField', () => ({ MediaField: () => <div data-testid="media-field" /> }));

import { TournamentStudio } from '../../src/pages/TournamentStudio';

const tabs = () => Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
const tab = (name: string) => tabs().find((t) => t.textContent?.startsWith(name)) ?? null;
const panel = () => document.querySelector<HTMLElement>('[role="tabpanel"]')!;

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe('Torneos en pestañas', () => {
  it('conserva las cuatro pestañas y el monitor fijo con la Pantalla y las URL', async () => {
    await mount(<TournamentStudio />);
    expect(tabs().map((t) => t.textContent)).toEqual(['Torneo', 'En directo', 'Marca', 'Narrador y comandos']);
    const fijo = document.querySelector<HTMLElement>('.pa-fijo')!;
    expect(fijo.closest('[role="tabpanel"]')).toBeNull();
    expect(byText(fijo, 'h2', 'Monitor')).not.toBeNull();
    expect(fijo.querySelector('[aria-label="Pantalla"]')).not.toBeNull();
    expect(byText(fijo, 'button', 'Copiar URL para OBS')).not.toBeNull();
    expect(byText(fijo, 'button', 'Copiar URL con pantallas de muestra')).not.toBeNull();
    expect(document.querySelector('.pa-cabecera [data-testid="suite-nav"]')).not.toBeNull();
  });

  it('cada pestaña trae sus módulos', async () => {
    await mount(<TournamentStudio />);
    expect(byText(panel(), 'h2', 'Torneo')).not.toBeNull();
    expect(byText(panel(), 'h2', 'Equipos')).not.toBeNull();
    await click(tab('En directo'));
    expect(byText(panel(), 'h2', 'Mesa de control')).not.toBeNull();
    await click(tab('Marca'));
    for (const name of ['Estilo', 'Logo', 'Patrocinadores']) expect(byText(panel(), 'h2', name), name).not.toBeNull();
    await click(tab('Narrador y comandos'));
    for (const name of ['Narrador', 'Comandos']) expect(byText(panel(), 'h2', name), name).not.toBeNull();
  });
});
