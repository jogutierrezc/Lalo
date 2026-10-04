/**
 * src/pages/admin/useAdminData.ts
 *
 * Toda la lectura de datos de la consola de administración en un solo sitio:
 * cuentas y totales, planes, códigos, canjes y el estado del almacenamiento.
 * Las secciones reciben este objeto y piden `reload` después de cambiar algo.
 */

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { fetchInvites, fetchPlans, fetchProfileMeta, fetchRedemptions, rpc, type ProfileMeta } from '../../lib/cloud';
import type { AdminOverview, InviteCodeRow, InviteRedemptionRow, PlanRow } from '../../lib/cloudTypes';
import { StorageApiError, fetchStorageStatus, type StorageStatus } from '../../lib/storageApi';

export interface AdminData {
  /** null hasta la primera lectura. */
  overview: AdminOverview | null;
  plans: PlanRow[];
  setPlans: Dispatch<SetStateAction<PlanRow[]>>;
  invites: InviteCodeRow[];
  redemptions: InviteRedemptionRow[];
  meta: Map<string, ProfileMeta>;
  /** Error de la lectura principal (Supabase). */
  error: string | null;
  setError: (message: string | null) => void;
  /** Estado del almacenamiento, tal como lo da el servidor. null si aún no se sabe o falló. */
  storage: StorageStatus | null;
  storageError: StorageApiError | null;
  storageLoading: boolean;
  reload: () => Promise<void>;
  reloadStorage: () => Promise<void>;
  planName: (id: string | null) => string;
}

export function useAdminData(): AdminData {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [invites, setInvites] = useState<InviteCodeRow[]>([]);
  const [redemptions, setRedemptions] = useState<InviteRedemptionRow[]>([]);
  const [metaRows, setMetaRows] = useState<ProfileMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [storageError, setStorageError] = useState<StorageApiError | null>(null);
  const [storageLoading, setStorageLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [nextOverview, nextPlans, nextInvites, nextRedemptions, nextMeta] = await Promise.all([
        rpc('admin_overview', {}),
        fetchPlans(),
        fetchInvites(),
        // Estas dos solo enriquecen la vista: si fallan, la consola sigue
        fetchRedemptions().catch(() => []),
        fetchProfileMeta().catch(() => []),
      ]);
      setOverview(nextOverview);
      setPlans(nextPlans);
      setInvites(nextInvites);
      setRedemptions(nextRedemptions);
      setMetaRows(nextMeta);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer la consola.');
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
  }, [reload, reloadStorage]);

  const meta = useMemo(() => new Map(metaRows.map((row) => [row.id, row])), [metaRows]);
  const planName = useCallback((id: string | null) => plans.find((plan) => plan.id === id)?.name || 'Sin plan', [plans]);

  return {
    overview,
    plans,
    setPlans,
    invites,
    redemptions,
    meta,
    error,
    setError,
    storage,
    storageError,
    storageLoading,
    reload,
    reloadStorage,
    planName,
  };
}
