/**
 * src/hooks/useAlertsSettings.ts
 *
 * Hook de gestión de configuración de alertas de stream con guardado automático
 * y sincronización bidireccional vía BroadcastChannel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ALERTS_STORAGE_KEY,
  loadAlertsSettings,
  saveAlertsSettings,
  StreamAlertsSettings,
} from '../types/alerts';
import { postBus } from '../utils/bus';

export function useAlertsSettings() {
  const [alertsSettings, setAlertsSettings] = useState<StreamAlertsSettings>(loadAlertsSettings);
  const [saved, setSaved] = useState(true);
  const dirtyRef = useRef(false);

  const updateAlerts = useCallback((patch: Partial<StreamAlertsSettings>) => {
    dirtyRef.current = true;
    setSaved(false);
    setAlertsSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // Guardado automático y broadcast a los widgets de OBS abiertos
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => {
      dirtyRef.current = false;
      saveAlertsSettings(alertsSettings);
      postBus({ type: 'ALERT_SETTINGS_UPDATE', settings: alertsSettings });
      setSaved(true);
    }, 350);
    return () => clearTimeout(timer);
  }, [alertsSettings]);

  // Sincronización entre pestañas
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === ALERTS_STORAGE_KEY && !dirtyRef.current) {
        setAlertsSettings(loadAlertsSettings());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { alertsSettings, updateAlerts, saved };
}
