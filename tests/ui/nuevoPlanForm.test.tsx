// @vitest-environment jsdom
/** NuevoPlanForm: validación, slug y que un fallo de onCreated no se confunda con un fallo de creación. */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, cleanup, click, flush, mount, submit, type } from './dom';

const net = vi.hoisted(() => ({ createPlan: vi.fn() }));
vi.mock('../../src/lib/cloud', () => ({ MB: 1024 * 1024, createPlan: net.createPlan }));

import { NuevoPlanForm } from '../../src/pages/admin/NuevoPlanForm';

const input = (host: HTMLElement, label: RegExp) => {
  const lab = Array.from(host.querySelectorAll('label')).find((l) => label.test(l.textContent ?? ''))!;
  return host.querySelector<HTMLInputElement>(`#${CSS.escape(lab.htmlFor)}`)!;
};
const alertText = (host: HTMLElement) => host.querySelector('[role="alert"]')?.textContent ?? '';

describe('NuevoPlanForm', () => {
  beforeEach(() => {
    net.createPlan.mockReset();
  });
  afterEach(cleanup);

  it('el botón queda desactivado sin nombre', async () => {
    const { host } = await mount(<NuevoPlanForm onCreated={() => {}} />);
    expect(byText(host, 'button', 'Crear plan')?.hasAttribute('disabled')).toBe(true);
    await type(input(host, /Nombre/), 'Pro');
    expect(byText(host, 'button', 'Crear plan')?.hasAttribute('disabled')).toBe(false);
  });

  it('genera el identificador del nombre (sin tildes) hasta que se edita a mano', async () => {
    const { host } = await mount(<NuevoPlanForm onCreated={() => {}} />);
    await type(input(host, /Nombre/), 'Súper Pro 2');
    expect(input(host, /Identificador/).value).toBe('super-pro-2');
    await type(input(host, /Identificador/), 'Mío');
    await type(input(host, /Nombre/), 'Otro');
    expect(input(host, /Identificador/).value).toBe('mío');
  });

  it('valida en el navegador: archivo sobre el tope y almacenamiento negativo no llaman al servidor', async () => {
    const { host } = await mount(<NuevoPlanForm onCreated={() => {}} />);
    await type(input(host, /Nombre/), 'Pro');
    await type(input(host, /Máximo por archivo/), '80');
    await submit(host.querySelector('form'));
    expect(alertText(host)).toMatch(/no puede pasar de 50 MB/);
    await type(input(host, /Máximo por archivo/), '10');
    await type(input(host, /Almacenamiento/), '-1');
    await submit(host.querySelector('form'));
    expect(alertText(host)).toMatch(/almacenamiento/);
    expect(net.createPlan).not.toHaveBeenCalled();
  });

  it('identificador inválido lo rechaza validateNewPlan', async () => {
    const { host } = await mount(<NuevoPlanForm onCreated={() => {}} />);
    await type(input(host, /Nombre/), 'Pro');
    await type(input(host, /Identificador/), 'con espacio');
    await submit(host.querySelector('form'));
    expect(alertText(host)).toMatch(/identificador/i);
    expect(net.createPlan).not.toHaveBeenCalled();
  });

  it('crea con los límites en bytes y avisa con el nombre', async () => {
    net.createPlan.mockResolvedValue({ name: 'Pro' });
    const onCreated = vi.fn();
    const { host } = await mount(<NuevoPlanForm onCreated={onCreated} />);
    await type(input(host, /Nombre/), 'Pro');
    await submit(host.querySelector('form'));
    await flush();
    expect(net.createPlan).toHaveBeenCalledWith(expect.objectContaining({ id: 'pro', name: 'Pro', storageLimitBytes: 1024 ** 3, maxFileBytes: 10 * 1024 * 1024, maxFiles: 100 }));
    expect(onCreated).toHaveBeenCalledWith('Pro');
    expect(alertText(host)).toBe('');
    expect(input(host, /Nombre/).value).toBe('');
  });

  it('si createPlan falla, dice «No se pudo crear» y no llama a onCreated', async () => {
    net.createPlan.mockRejectedValue(new Error('x'));
    const onCreated = vi.fn();
    const { host } = await mount(<NuevoPlanForm onCreated={onCreated} />);
    await type(input(host, /Nombre/), 'Pro');
    await submit(host.querySelector('form'));
    await flush();
    expect(alertText(host)).toMatch(/No se pudo crear/);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('si falla la recarga (onCreated), el plan ya existe: aviso aparte, sin «No se pudo crear», y reintentar recarga', async () => {
    net.createPlan.mockResolvedValue({ name: 'Pro' });
    const onCreated = vi.fn().mockRejectedValueOnce(new Error('sin red')).mockResolvedValueOnce(undefined);
    const { host } = await mount(<NuevoPlanForm onCreated={onCreated} />);
    await type(input(host, /Nombre/), 'Pro');
    await submit(host.querySelector('form'));
    await flush();
    expect(host.textContent).toContain('Plan creado, pero no se pudo recargar la lista');
    expect(host.textContent).not.toContain('No se pudo crear');
    const retry = byText(host, 'button', /Reintentar/);
    expect(retry).not.toBeNull();
    await click(retry);
    await flush();
    expect(onCreated).toHaveBeenCalledTimes(2);
    expect(net.createPlan).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain('no se pudo recargar');
  });
});
