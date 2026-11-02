// @vitest-environment jsdom
/**
 * Hallazgo #1: «Entrada abierta» no puede llamar claim_open_access en bucle
 * cuando el servidor no devuelve 'ok' (no_twitch / invites_required).
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, flush, mount } from './dom';

const h = vi.hoisted(() => ({
  claimResult: 'no_twitch' as string,
  claimCalls: 0,
  profileLoads: 0,
}));

vi.mock('../../src/lib/supabase', () => ({
  isCloudEnabled: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
    },
  },
}));

vi.mock('../../src/lib/cloud', () => ({
  fetchInvitesRequired: async () => false,
  // Objeto nuevo en cada lectura, como en la app real
  fetchOwnProfile: async (id: string) => {
    h.profileLoads++;
    return { id, status: 'pending', plan_id: null, plan_expires_at: null };
  },
  getPendingCode: () => null,
  setPendingCode: () => {},
  signOut: async () => {},
  rpc: async (name: string) => {
    if (name === 'claim_open_access') {
      h.claimCalls++;
      // Corta el bucle del defecto para que la prueba falle con un número, no con un cuelgue
      if (h.claimCalls > 25) throw new Error('bucle');
      return h.claimResult;
    }
    return null;
  },
}));

vi.mock('../../src/lib/cloudConfig', () => ({ pullConfigsToLocal: async () => {}, setCloudProfile: () => {} }));
vi.mock('../../src/lib/access', () => ({ hasTwitchIdentity: () => true }));

import { CloudProvider } from '../../src/hooks/useCloudSession';

describe('Entrada abierta: sin bucle de claim_open_access', () => {
  beforeEach(() => {
    h.claimCalls = 0;
    h.profileLoads = 0;
  });
  afterEach(cleanup);

  for (const result of ['no_twitch', 'invites_required']) {
    it(`si el RPC devuelve '${result}' se llama una sola vez`, async () => {
      h.claimResult = result;
      await mount(
        <CloudProvider>
          <span>hijo</span>
        </CloudProvider>
      );
      await flush(30);
      expect(h.claimCalls).toBe(1);
    });
  }
});
