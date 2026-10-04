/**
 * src/hooks/useCloudSession.tsx
 *
 * Sesión de la nube para todo el panel: quién ha entrado, su perfil y su estado
 * (pendiente de código, activo o suspendido). Al volver de Twitch canjea el
 * código que el usuario escribió antes de salir.
 *
 * Si la nube no está configurada, `enabled` es false y el panel funciona como
 * siempre, solo con el almacenamiento del navegador.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { isCloudEnabled, supabase } from '../lib/supabase';
import { fetchOwnProfile, getPendingCode, rpc, setPendingCode, signOut as cloudSignOut } from '../lib/cloud';
import type { ProfileRow, RedeemInviteResult, RedeemRecoveryResult } from '../lib/cloudTypes';
import { pullConfigsToLocal, setCloudProfile } from '../lib/cloudConfig';
import { hasTwitchIdentity } from '../lib/access';

export type RedeemOutcome =
  | { kind: 'invite'; result: RedeemInviteResult }
  | { kind: 'recovery'; result: RedeemRecoveryResult }
  | { kind: 'error'; message: string };

interface CloudSession {
  enabled: boolean;
  loading: boolean;
  session: Session | null;
  profile: ProfileRow | null;
  /** Resultado del último canje de código, para explicarlo en la pantalla de acceso. */
  outcome: RedeemOutcome | null;
  error: string | null;
  refresh: () => Promise<void>;
  redeem: (kind: 'invite' | 'recovery', code: string) => Promise<RedeemOutcome>;
  signOut: () => Promise<void>;
}

const CloudContext = createContext<CloudSession>({
  enabled: false,
  loading: false,
  session: null,
  profile: null,
  outcome: null,
  error: null,
  refresh: async () => {},
  redeem: async () => ({ kind: 'error', message: 'La nube no está configurada.' }),
  signOut: async () => {},
});

export const useCloudSession = () => useContext(CloudContext);

export const CloudProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(isCloudEnabled);
  const [outcome, setOutcome] = useState<RedeemOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const redeemingRef = useRef(false);
  // Cuenta cuya configuración ya está en este navegador
  const [syncedFor, setSyncedFor] = useState<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    try {
      setProfile(await fetchOwnProfile(userId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer tu perfil.');
    }
  }, []);

  const redeem = useCallback(
    async (kind: 'invite' | 'recovery', code: string): Promise<RedeemOutcome> => {
      let result: RedeemOutcome;
      try {
        result =
          kind === 'invite'
            ? { kind, result: await rpc('redeem_invite', { p_code: code }) }
            : { kind, result: await rpc('redeem_recovery_code', { p_code: code }) };
      } catch (err) {
        result = { kind: 'error', message: err instanceof Error ? err.message : 'No se pudo canjear el código.' };
      }
      setOutcome(result);
      const user = (await supabase?.auth.getUser())?.data.user;
      if (user) await loadProfile(user.id);
      return result;
    },
    [loadProfile]
  );

  // Sesión inicial y cambios de sesión
  useEffect(() => {
    if (!supabase) return;
    let alive = true;

    const apply = async (next: Session | null) => {
      if (!alive) return;
      setSession(next);
      if (!next) {
        setProfile(null);
        setLoading(false);
        return;
      }
      await loadProfile(next.user.id);
      if (alive) setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      // Fuera del callback de Supabase, que no admite llamadas a su API dentro
      setTimeout(() => apply(next), 0);
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  // Al volver de Twitch con un código pendiente y el perfil aún sin activar, se canjea
  useEffect(() => {
    if (!session || !profile || profile.status !== 'pending' || redeemingRef.current) return;
    // Una cuenta de administrador (correo y clave) no canjea códigos de afiliado
    if (!hasTwitchIdentity(session.user)) return;
    const pending = getPendingCode();
    if (!pending) return;
    redeemingRef.current = true;
    setPendingCode(null);
    redeem(pending.kind, pending.code).finally(() => {
      redeemingRef.current = false;
    });
  }, [session, profile, redeem]);

  // Marca la última visita de las cuentas activas
  const activeId = profile?.status === 'active' ? profile.id : null;
  useEffect(() => {
    if (activeId) rpc('touch_profile', {}).catch(() => {});
  }, [activeId]);

  // Al entrar con una cuenta activa, la nube manda: se trae su configuración
  useEffect(() => {
    if (!activeId) {
      setCloudProfile(null);
      setSyncedFor(null);
      return;
    }
    // Una capa de OBS abierta en este mismo navegador no sube ni baja nada por esta vía
    const path = window.location.pathname.toLowerCase();
    if (path.includes('/widget') || window.location.hash.toLowerCase().startsWith('#widget')) {
      setSyncedFor(activeId);
      return;
    }
    let alive = true;
    pullConfigsToLocal(activeId)
      .catch((err) => setError(err instanceof Error ? `No se pudo traer tu configuración: ${err.message}` : 'No se pudo traer tu configuración.'))
      .finally(() => {
        if (!alive) return;
        setCloudProfile(activeId);
        setSyncedFor(activeId);
      });
    return () => {
      alive = false;
    };
  }, [activeId]);

  const syncing = activeId !== null && syncedFor !== activeId;

  const value = useMemo<CloudSession>(
    () => ({
      enabled: isCloudEnabled,
      loading: loading || syncing,
      session,
      profile,
      outcome,
      error,
      refresh: async () => {
        if (session) await loadProfile(session.user.id);
      },
      redeem,
      signOut: async () => {
        setOutcome(null);
        await cloudSignOut();
      },
    }),
    [loading, syncing, session, profile, outcome, error, loadProfile, redeem]
  );

  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
};
