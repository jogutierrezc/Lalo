/**
 * src/components/done/useDoneCatalog.ts
 *
 * Catálogo de personajes de Done: las mascotas de Tally, Lux y todos los GLB de la biblioteca
 * compartida de Lux (los del administrador, los aprobados y los propios del creador).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doneModelLibrary } from '../../lib/doneClient';
import type { LuxModelLibrary } from '../../lib/luxApi';
import { buildCatalog, type CatalogEntry } from './doneLogic';

export interface DoneCatalog {
  catalog: CatalogEntry[];
  library: LuxModelLibrary | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useDoneCatalog(): DoneCatalog {
  const [library, setLibrary] = useState<LuxModelLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    const res = await doneModelLibrary();
    if (!alive.current) return;
    if (res.ok) {
      setLibrary(res.data);
      setError(null);
    } else {
      setError(res.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  const catalog = useMemo(() => buildCatalog(library), [library]);
  return { catalog, library, loading, error, reload };
}
