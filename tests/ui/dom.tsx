/**
 * tests/ui/dom.tsx
 *
 * Ayudas mínimas para probar componentes en jsdom sin librerías extra:
 * monta con react-dom/client dentro de act y ofrece clic, escritura y esperas.
 * Cada archivo de prueba declara `// @vitest-environment jsdom`.
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; host: HTMLElement }[] = [];

export async function mount(node: React.ReactElement): Promise<{ host: HTMLElement; root: Root; unmount: () => Promise<void> }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => {
    root.render(node);
  });
  return {
    host,
    root,
    unmount: async () => {
      await act(async () => root.unmount());
    },
  };
}

export async function cleanup() {
  while (mounted.length) {
    const item = mounted.pop()!;
    try {
      await act(async () => item.root.unmount());
    } catch {
      // ya desmontado
    }
    item.host.remove();
  }
  document.body.innerHTML = '';
}

/** Deja correr promesas pendientes (y temporizadores simulados si los hay). */
export async function flush(times = 5) {
  for (let i = 0; i < times; i++) await act(async () => {});
}

export async function advance(ms: number, vi: { advanceTimersByTimeAsync: (ms: number) => Promise<unknown> }) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

export async function click(el: Element | null) {
  if (!el) throw new Error('No se encontró el elemento para hacer clic.');
  await act(async () => {
    (el as HTMLElement).click();
  });
}

export async function type(el: HTMLInputElement | null, value: string) {
  if (!el) throw new Error('No se encontró el campo.');
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

export async function submit(form: Element | null) {
  if (!form) throw new Error('No se encontró el formulario.');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

export const byText = (root: ParentNode, selector: string, text: string | RegExp): HTMLElement | null =>
  Array.from(root.querySelectorAll<HTMLElement>(selector)).find((el) => (typeof text === 'string' ? el.textContent?.trim() === text : text.test(el.textContent ?? ''))) ?? null;
