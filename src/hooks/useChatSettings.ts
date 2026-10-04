/**
 * src/hooks/useChatSettings.ts
 *
 * Ajustes de la capa «Chat en vivo» con guardado automático. Cada cambio se
 * guarda en este navegador (y en la nube, si hay cuenta abierta) y se envía a
 * las fuentes de OBS abiertas en este mismo navegador.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_STORAGE_KEY, ChatCustom, ChatSettings, loadChatSettings, saveChatSettings } from '../types/chat';
import { postBus } from '../utils/bus';

export function useChatSettings() {
  const [chatSettings, setChatSettings] = useState<ChatSettings>(loadChatSettings);
  const [saved, setSaved] = useState(true);
  const dirtyRef = useRef(false);

  const updateSettings = useCallback((patch: Partial<ChatSettings>) => {
    dirtyRef.current = true;
    setSaved(false);
    setChatSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateCustom = useCallback((patch: Partial<ChatCustom>) => {
    dirtyRef.current = true;
    setSaved(false);
    setChatSettings((prev) => ({ ...prev, custom: { ...prev.custom, ...patch } }));
  }, []);

  // Guardado con una pequeña espera, solo cuando el cambio nació en esta pestaña
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => {
      dirtyRef.current = false;
      saveChatSettings(chatSettings);
      postBus({ type: 'CHAT_SETTINGS_UPDATE', settings: chatSettings });
      setSaved(true);
    }, 350);
    return () => clearTimeout(timer);
  }, [chatSettings]);

  // Cambios hechos en otra pestaña del panel
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === CHAT_STORAGE_KEY && !dirtyRef.current) setChatSettings(loadChatSettings());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { chatSettings, saved, updateSettings, updateCustom };
}
