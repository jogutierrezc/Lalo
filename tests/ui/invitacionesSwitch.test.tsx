// @vitest-environment jsdom
/** InvitacionesSwitch: interruptor, foco, región de estado siempre montada y error con reintento. */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, cleanup, click, flush, mount } from './dom';

const net = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/lib/cloud', () => ({ rpc: net.rpc }));

import { InvitacionesSwitch } from '../../src/pages/admin/InvitacionesSwitch';

const sw = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[role="switch"]')!;
const status = (host: HTMLElement) => host.querySelector('[role="status"]');

describe('InvitacionesSwitch', () => {
  beforeEach(() => {
    net.rpc.mockReset();
  });
  afterEach(cleanup);

  it('lee el estado y lo enseña (encendido = pide código)', async () => {
    net.rpc.mockResolvedValue(true);
    const { host } = await mount(<InvitacionesSwitch />);
    await flush();
    expect(sw(host).getAttribute('aria-checked')).toBe('true');
    expect(host.textContent).toContain('Solo con invitación');
  });

  it('alternar llama al RPC con el valor contrario y confirma', async () => {
    net.rpc.mockImplementation(async (name: string) => (name === 'invites_required' ? true : false));
    const { host } = await mount(<InvitacionesSwitch />);
    await flush();
    await click(sw(host));
    await flush();
    expect(net.rpc).toHaveBeenCalledWith('admin_set_invites_required', { p_required: false });
    expect(sw(host).getAttribute('aria-checked')).toBe('false');
    expect(status(host)?.textContent).toBe('Listo: la entrada está abierta.');
  });

  it('mientras guarda: aria-disabled, sin disabled (no pierde el foco) y un segundo clic no repite', async () => {
    let release: (v: boolean) => void = () => {};
    net.rpc.mockImplementation((name: string) => (name === 'invites_required' ? Promise.resolve(true) : new Promise<boolean>((r) => (release = r))));
    const { host } = await mount(<InvitacionesSwitch />);
    await flush();
    const button = sw(host);
    button.focus();
    await click(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(button);
    await click(button);
    expect(net.rpc.mock.calls.filter((c) => c[0] === 'admin_set_invites_required')).toHaveLength(1);
    await act(async () => release(false));
    await flush();
    expect(button.getAttribute('aria-disabled')).toBe('false');
  });

  it('la región de estado existe desde el inicio y su texto cambia (Guardando, Listo)', async () => {
    let release: (v: boolean) => void = () => {};
    net.rpc.mockImplementation((name: string) => (name === 'invites_required' ? Promise.resolve(true) : new Promise<boolean>((r) => (release = r))));
    const { host } = await mount(<InvitacionesSwitch />);
    await flush();
    const region = status(host);
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe('');
    await click(sw(host));
    expect(status(host)).toBe(region);
    expect(region?.textContent).toBe('Guardando.');
    await act(async () => release(false));
    await flush();
    expect(status(host)).toBe(region);
    expect(region?.textContent).toMatch(/^Listo/);
  });

  it('si falla al guardar, el error va aparte con role alert y el interruptor no cambia', async () => {
    net.rpc.mockImplementation(async (name: string) => {
      if (name === 'invites_required') return true;
      throw new Error('boom');
    });
    const { host } = await mount(<InvitacionesSwitch />);
    await flush();
    await click(sw(host));
    await flush();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(status(host)?.textContent).toBe('');
    expect(sw(host).getAttribute('aria-checked')).toBe('true');
  });

  it('si no puede leer el estado, muestra el error y «Reintentar» lo vuelve a pedir', async () => {
    net.rpc.mockRejectedValueOnce(new Error('sin red')).mockResolvedValueOnce(false);
    const { host } = await mount(<InvitacionesSwitch />);
    await flush();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('button[role="switch"]')).toBeNull();
    await click(byText(host, 'button', 'Reintentar'));
    await flush();
    expect(net.rpc).toHaveBeenCalledTimes(2);
    expect(sw(host).getAttribute('aria-checked')).toBe('false');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
