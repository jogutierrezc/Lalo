/**
 * src/hooks/useTournamentSignup.ts
 *
 * Lo que la pestaña «Torneo» del panel necesita para la inscripción por
 * enlace: el enlace del streamer (su slug y si la inscripción está abierta) y
 * las solicitudes que le han llegado.
 *
 * - Sin nube o sin cuenta activa (`profileId` null) no hace nada: `status` es
 *   `off` y la página lo explica.
 * - Lo PÚBLICO del torneo (nombre, juego, tamaño, plazas, logo, patrocinadores,
 *   estilo y color) se vuelve a publicar solo, con una pequeña espera, cada vez
 *   que cambian los ajustes y ya existe el enlace.
 * - Las solicitudes se vuelven a pedir cada quince segundos con la pestaña a la
 *   vista. No hay aviso en tiempo real: una inscripción nueva tarda eso en salir.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveMediaUrl } from '../lib/mediaRef';
import {
  type OwnTournament,
  deleteEntry,
  deleteOwnTournament,
  listEntries,
  loadOwnTournament,
  saveOwnTournament,
  setEntryStatus,
} from '../lib/tournamentSignupApi';
import type { TournamentSettings } from '../types/tournament';
import { type EntryStatus, type TournamentEntry, publicRowFromSettings } from '../utils/tournamentSignup';

const ENTRIES_EVERY_MS = 15000;
const PUBLISH_DELAY_MS = 900;

/** `off`: sin nube o sin cuenta. `error`: no se pudo leer (sin conexión o falta la migración 0017). */
export type SignupStatus = 'off' | 'loading' | 'ready' | 'error';

export function useTournamentSignup(profileId: string | null, settings: TournamentSettings) {
  const [status, setStatus] = useState<SignupStatus>(profileId ? 'loading' : 'off');
  const [own, setOwn] = useState<OwnTournament | null>(null);
  const [entries, setEntries] = useState<TournamentEntry[]>([]);
  /** true si la última publicación de los ajustes falló. */
  const [publishFailed, setPublishFailed] = useState(false);
  const ownRef = useRef(own);
  ownRef.current = own;

  const resolve = useCallback((url: string) => resolveMediaUrl(url), []);
  /** Lo que se publica, sin el slug ni el interruptor: si cambia, hay que volver a publicar. */
  const publicKey = useMemo(() => JSON.stringify(publicRowFromSettings(settings, '', false, resolve)), [settings, resolve]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const refresh = useCallback(async () => {
    if (!profileId) return;
    const next = await listEntries(profileId);
    if (next) setEntries(next);
  }, [profileId]);

  // Al entrar (o al cambiar de cuenta): el enlace y las solicitudes
  useEffect(() => {
    if (!profileId) {
      setStatus('off');
      setOwn(null);
      setEntries([]);
      return;
    }
    let alive = true;
    setStatus('loading');
    void loadOwnTournament(profileId).then((result) => {
      if (!alive) return;
      if (!result.ok) {
        setStatus('error');
        return;
      }
      setOwn(result.own);
      setStatus('ready');
      if (result.own) void refresh();
    });
    return () => {
      alive = false;
    };
  }, [profileId, refresh]);

  // Solicitudes nuevas: se pregunta cada poco, y al volver a la pestaña
  const hasLink = own !== null;
  useEffect(() => {
    if (!profileId || !hasLink) return;
    const tick = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    const timer = setInterval(tick, ENTRIES_EVERY_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [profileId, hasLink, refresh]);

  // Los ajustes públicos cambiaron y ya hay enlace: se vuelven a publicar. Al abrir la página
  // se publica una vez, por si los ajustes cambiaron en otro equipo o con la nube caída
  const published = useRef<string | null>(null);
  useEffect(() => {
    if (!profileId || !own || published.current === publicKey) return;
    const timer = setTimeout(() => {
      const current = ownRef.current;
      if (!current) return;
      void saveOwnTournament(profileId, publicRowFromSettings(settingsRef.current, current.slug, current.open, resolve)).then((result) => {
        setPublishFailed(result !== 'ok');
        if (result === 'ok') published.current = publicKey;
      });
    }, PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [profileId, own, publicKey, resolve]);

  /** Crea el enlace o le cambia la dirección. */
  const saveLink = useCallback(
    async (slug: string): Promise<'ok' | 'taken' | 'error'> => {
      if (!profileId) return 'error';
      const open = ownRef.current?.open ?? true;
      const result = await saveOwnTournament(profileId, publicRowFromSettings(settingsRef.current, slug, open, resolve));
      if (result === 'ok') {
        published.current = publicKey;
        setPublishFailed(false);
        setOwn({ slug, open });
      }
      return result;
    },
    [profileId, publicKey, resolve]
  );

  /** Abre o cierra la inscripción. Devuelve false si no se pudo guardar. */
  const setOpen = useCallback(
    async (open: boolean): Promise<boolean> => {
      const current = ownRef.current;
      if (!profileId || !current) return false;
      // El interruptor responde al momento; si la nube no lo guarda, vuelve a su sitio
      setOwn({ ...current, open });
      const result = await saveOwnTournament(profileId, publicRowFromSettings(settingsRef.current, current.slug, open, resolve));
      if (result !== 'ok') setOwn((prev) => (prev ? { ...prev, open: current.open } : prev));
      return result === 'ok';
    },
    [profileId, resolve]
  );

  /** Borra el enlace y todas sus inscripciones. */
  const removeLink = useCallback(async (): Promise<boolean> => {
    if (!profileId) return false;
    const ok = await deleteOwnTournament(profileId);
    if (ok) {
      setOwn(null);
      setEntries([]);
      published.current = null;
    }
    return ok;
  }, [profileId]);

  const mark = useCallback(
    async (id: number, next: EntryStatus): Promise<boolean> => {
      const ok = await setEntryStatus(id, next);
      if (ok) setEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, status: next } : entry)));
      return ok;
    },
    []
  );

  const remove = useCallback(async (id: number): Promise<boolean> => {
    const ok = await deleteEntry(id);
    if (ok) setEntries((prev) => prev.filter((entry) => entry.id !== id));
    return ok;
  }, []);

  const pending = useMemo(() => entries.filter((entry) => entry.status === 'pending'), [entries]);
  const answered = useMemo(() => entries.filter((entry) => entry.status !== 'pending'), [entries]);

  return { status, own, pending, answered, publishFailed, refresh, saveLink, setOpen, removeLink, mark, remove };
}
