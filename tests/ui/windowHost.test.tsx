// @vitest-environment jsdom
/** WindowHost: abrir, cerrar, minimizar, Escape, foco y máximo de 3 ventanas. */

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, click, flush, mount } from './dom';

vi.mock('../../src/lib/tools', () => {
  const Body: React.FC = () => <p>contenido</p>;
  const make = (id: string, name: string) => ({ id, name, icon: () => null, component: Body });
  const tools = [make('a', 'Alfa'), make('b', 'Beta'), make('c', 'Gamma'), make('d', 'Delta')];
  return { toolById: (id: string) => tools.find((t) => t.id === id) };
});

import { WindowHost } from '../../src/components/shell/WindowHost';
import { WindowsProvider, useWindows } from '../../src/components/shell/windowStore';

let lastResult: boolean | null = null;
const Launcher: React.FC = () => {
  const w = useWindows();
  return (
    <div>
      {['a', 'b', 'c', 'd'].map((id) => (
        <button key={id} type="button" data-open={id} onClick={(e) => (lastResult = w.open(id, e.currentTarget))}>
          abrir {id}
        </button>
      ))}
    </div>
  );
};

const App = () => (
  <WindowsProvider>
    <Launcher />
    <WindowHost />
  </WindowsProvider>
);

const dialogs = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
const visible = () => dialogs().filter((d) => !d.hidden);
const opener = (id: string) => document.querySelector<HTMLElement>(`[data-open="${id}"]`);

beforeEach(() => {
  lastResult = null;
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe('WindowHost', () => {
  it('abre una ventana no modal con role=dialog y aria-label, y el foco entra en ella', async () => {
    await mount(<App />);
    await click(opener('a'));
    await flush();
    const [dlg] = dialogs();
    expect(dlg.getAttribute('aria-label')).toBe('Alfa');
    expect(dlg.getAttribute('aria-modal')).toBeNull();
    expect(document.activeElement).toBe(dlg);
    expect(dlg.textContent).toContain('contenido');
  });

  it('permite como máximo 3 a la vez', async () => {
    await mount(<App />);
    for (const id of ['a', 'b', 'c']) await click(opener(id));
    await flush();
    expect(dialogs()).toHaveLength(3);
    await click(opener('d'));
    expect(lastResult).toBe(false);
    expect(dialogs()).toHaveLength(3);
  });

  it('cerrar devuelve el foco a quien la abrió', async () => {
    await mount(<App />);
    await click(opener('b'));
    await flush();
    await click(document.querySelector('[aria-label="Cerrar Beta"]'));
    await flush();
    expect(dialogs()).toHaveLength(0);
    expect(document.activeElement).toBe(opener('b'));
  });

  it('minimiza a la barra de tareas y se restaura desde su chip', async () => {
    await mount(<App />);
    await click(opener('a'));
    await flush();
    await click(document.querySelector('[aria-label="Minimizar Alfa"]'));
    expect(visible()).toHaveLength(0);
    expect(dialogs()).toHaveLength(1);
    const chip = document.querySelector<HTMLElement>('nav[aria-label="Ventanas abiertas"] button');
    expect(chip?.textContent).toContain('Alfa');
    await click(chip);
    expect(visible()).toHaveLength(1);
  });

  it('maximiza y restaura', async () => {
    await mount(<App />);
    await click(opener('a'));
    await click(document.querySelector('[aria-label="Maximizar Alfa"]'));
    expect(dialogs()[0].hasAttribute('data-max')).toBe(true);
    await click(document.querySelector('[aria-label="Restaurar Alfa"]'));
    expect(dialogs()[0].hasAttribute('data-max')).toBe(false);
  });

  it('Escape cierra la ventana de arriba', async () => {
    await mount(<App />);
    await click(opener('a'));
    await click(opener('b'));
    await flush();
    const top = dialogs().find((d) => d.dataset.win === 'b')!;
    await act(async () => {
      top.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(dialogs().map((d) => d.dataset.win)).toEqual(['a']);
  });
});
