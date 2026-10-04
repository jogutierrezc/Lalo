/**
 * src/pages/admin/useAdminData.ts
 *
 * Toda la lectura de datos de la consola de administración en un solo sitio:
 * cuentas y totales, planes, códigos, canjes, voces y el estado del almacenamiento.
 * Las secciones reciben este objeto y piden `reload` después de cambiar algo.
 */

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  fetchAllAcceptances,
  fetchInvites,
  fetchPlans,
  fetchProfileMeta,
  fetchRedemptions,
  rpc,
  type ProfileMeta,
} from '../../lib/cloud';
import type { AdminOverview, AdminVoiceRow, InviteCodeRow, InviteRedemptionRow, PlanRow, TermsAcceptanceRow } from '../../lib/cloudTypes';
import { fetchAdminVoices } from '../../lib/voicesCloud';
import { StorageApiError, fetchStorageStatus, type StorageStatus } from '../../lib/storageApi';

export interface AdminData {
  /** null hasta la primera lectura. */
  overview: AdminOverview | null;
  plans: PlanRow[];
  setPlans: Dispatch<SetStateAction<PlanRow[]>>;
  invites: InviteCodeRow[];
  redemptions: InviteRedemptionRow[];
  meta: Map<string, ProfileMeta>;
  /** Aceptaciones de términos por cuenta. null: no se pudieron leer (falta la migración 0008). */
  acceptances: Map<string, TermsAcceptanceRow[]> | null;
  /** Catálogo de voces. null: aún no se leyó o no se pudo leer (falta la migración 0009). */
  voices: AdminVoiceRow[] | null;
  /** Por qué no se pudo leer el catálogo de voces, o null. */
  voicesError: string | null;
  /** Error de la lectura principal (Supabase). */
  error: string | null;
  setError: (message: string | null) => void;
  /** Estado del almacenamiento, tal como lo da el servidor. null si aún no se sabe o falló. */
  storage: StorageStatus | null;
  storageError: StorageApiError | null;
  storageLoading: boolean;
  reload: () => Promise<void>;
  reloadStorage: () => Promise<void>;
  reloadVoices: () => Promise<void>;
  planName: (id: string | null) => string;
}

export function useAdminData(): AdminData {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [invites, setInvites] = useState<InviteCodeRow[]>([]);
  const [redemptions, setRedemptions] = useState<InviteRedemptionRow[]>([]);
  const [metaRows, setMetaRows] = useState<ProfileMeta[]>([]);
  const [acceptanceRows, setAcceptanceRows] = useState<TermsAcceptanceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<AdminVoiceRow[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [storageError, setStorageError] = useState<StorageApiError | null>(null);
  const [storageLoading, setStorageLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [nextOverview, nextPlans, nextInvites, nextRedemptions, nextMeta, nextAcceptances] = await Promise.all([
        rpc('admin_overview', {}),
        fetchPlans(),
        fetchInvites(),
        // Estas tres solo enriquecen la vista: si fallan, la consola sigue
        fetchRedemptions().catch(() => []),
        fetchProfileMeta().catch(() => []),
        fetchAllAcceptances().catch(() => null),
      ]);
      setOverview(nextOverview);
      setPlans(nextPlans);
      setInvites(nextInvites);
      setRedemptions(nextRedemptions);
      setMetaRows(nextMeta);
      setAcceptanceRows(nextAcceptances);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer la consola.');
    }
  }, []);

  const reloadVoices = useCallback(async () => {
    try {
      setVoices(await fetchAdminVoices());
      setVoicesError(null);
    } catch (err) {
      setVoices(null);
      setVoicesError(err instanceof Error ? err.message : 'No se pudo leer el catálogo de voces.');
    }
  }, []);

  const reloadStorage = useCallback(async () => {
    setStorageLoading(true);
    try {
      setStorage(await fetchStorageStatus());
      setStorageError(null);
    } catch (err) {
      setStorage(null);
      setStorageError(
        err instanceof StorageApiError ? err : new StorageApiError('No se pudo leer el estado del almacenamiento.', 'error', 0)
      );
    } finally {
      setStorageLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    reloadStorage();
    reloadVoices();
  }, [reload, reloadStorage, reloadVoices]);

  const meta = useMemo(() => new Map(metaRows.map((row) => [row.id, row])), [metaRows]);
  const acceptances = useMemo(() => {
    if (!acceptanceRows) return null;
    const byProfile = new Map<string, TermsAcceptanceRow[]>();
    for (const row of acceptanceRows) byProfile.set(row.profile_id, [...(byProfile.get(row.profile_id) ?? []), row]);
    return byProfile;
  }, [acceptanceRows]);
  const planName = useCallback((id: string | null) => plans.find((plan) => plan.id === id)?.name || 'Sin plan', [plans]);

  return {
    overview,
    plans,
    setPlans,
    invites,
    redemptions,
    meta,
    acceptances,
    voices,
    voicesError,
    error,
    setError,
    storage,
    storageError,
    storageLoading,
    reload,
    reloadStorage,
    reloadVoices,
    planName,
  };
}
