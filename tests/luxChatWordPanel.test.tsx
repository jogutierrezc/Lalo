// @vitest-environment jsdom
/**
 * tests/luxChatWordPanel.test.tsx
 *
 * Panel de Mi AI: la pestaña «Comando» muestra el comando de activación
 * (ejemplo con la palabra por defecto y botón de copiar).
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, click, mount } from './ui/dom';

const session = vi.hoisted(() => ({ profile: null as Record<string, unknown> | null }));

vi.mock('../src/hooks/useCloudSession', () => ({
  useCloudSession: () => ({ profile: session.profile }),
}));
vi.mock('../src/components/SuiteNav', () => ({ SuiteNav: () => null }));
vi.mock('../src/lib/luxApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  luxGetSettings: () => new Promise(() => {}),
  luxSaveSettings: () => new Promise(() => {}),
  luxAsk: () => new Promise(() => {}),
  luxCharacterView: () => new Promise(() => {}),
  luxSay: () => new Promise(() => {}),
  luxSayList: () => new Promise(() => {}),
  luxModelLibrary: () => new Promise(() => {}),
}));

import { LuxAI } from '../src/pages/LuxAI';

describe('panel: comando de activación', () => {
  afterEach(cleanup);

  it('muestra la sección, el ejemplo con la palabra por defecto y el botón de copiar', async () => {
    session.profile = { id: 'p1', role: 'streamer', lux_enabled: true };
    await mount(React.createElement(LuxAI));
    // La sección vive en la pestaña «Comando» de la ventana de Mi AI
    const pestana = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find((t) => t.textContent === 'Comando') ?? null;
    await click(pestana);
    const html = document.body.innerHTML;
    expect(html).toContain('Comando de activación');
    expect(html).toContain('<strong>!lux</strong> para hablar con tu personaje');
    expect(html).toContain('Copiar comando');
    // Con la palabra por defecto no hay alias que apagar
    expect(html).not.toContain('Seguir aceptando');
  });
});
