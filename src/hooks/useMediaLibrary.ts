/**
 * src/hooks/useMediaLibrary.ts
 *
 * Hook de gestión para la Biblioteca Central de Medios (Media Vault).
 * Controla la carga, persistencia en localStorage, reproducción de vista previa y filtrado.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MediaCategory,
  MediaItem,
  inspectAudioFile,
  loadMediaVault,
  saveMediaVault,
} from '../types/mediaLibrary';
import { playCustomAudio } from '../utils/alertsAudio';

export function useMediaLibrary() {
  const [items, setItems] = useState<MediaItem[]>(() => loadMediaVault());
  const [playingId, setPlayingId] = useState<string | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Detener audio al desmontar
  useEffect(() => {
    return () => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current.src = '';
      }
    };
  }, []);

  const persist = useCallback((newItems: MediaItem[]) => {
    saveMediaVault(newItems);
    setItems(newItems);
  }, []);

  const addItem = useCallback(
    (item: MediaItem) => {
      setItems((prev) => {
        const next = [item, ...prev.filter((i) => i.id !== item.id)];
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const deleteItem = useCallback(
    (id: string) => {
      setItems((prev) => {
        const next = prev.filter((i) => i.id !== id);
        persist(next);
        return next;
      });
      if (playingId === id) {
        stopPreview();
      }
    },
    [persist, playingId]
  );

  /**
   * Sube un archivo de audio (.mp3, .wav, .ogg, etc.) validando que no exceda 30 segundos.
   */
  const uploadAudioFile = useCallback(
    async (
      file: File,
      customName?: string,
      category: MediaCategory = 'personalizado'
    ): Promise<MediaItem> => {
      const { dataUrl, duration, format } = await inspectAudioFile(file);

      const newItem: MediaItem = {
        id: `audio-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: customName?.trim() || file.name.replace(/\.[^/.]+$/, ''),
        type: 'audio',
        url: dataUrl,
        duration,
        format,
        category,
        sizeBytes: file.size,
        createdAt: Date.now(),
      };

      addItem(newItem);
      return newItem;
    },
    [addItem]
  );

  /**
   * Sube un video transparente (.webm, .mp4).
   */
  const uploadVideoFile = useCallback(
    (file: File, customName?: string): Promise<MediaItem> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('No se pudo leer el archivo de video.'));
        reader.onload = (e) => {
          const res = e.target?.result as string;
          const format = file.name.toLowerCase().endsWith('.webm') ? 'webm' : 'mp4';

          const newItem: MediaItem = {
            id: `video-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            name: customName?.trim() || file.name.replace(/\.[^/.]+$/, ''),
            type: 'video',
            url: res,
            duration: 5.0,
            format,
            category: 'meme',
            sizeBytes: file.size,
            createdAt: Date.now(),
          };

          addItem(newItem);
          resolve(newItem);
        };
        reader.readAsDataURL(file);
      });
    },
    [addItem]
  );

  const playPreview = useCallback((item: MediaItem) => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = '';
    }

    if (item.type === 'audio') {
      const audio = playCustomAudio(item.url, 0.85);
      if (audio) {
        currentAudioRef.current = audio;
        setPlayingId(item.id);
        audio.onended = () => {
          setPlayingId(null);
        };
      }
    }
  }, []);

  const stopPreview = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = '';
      currentAudioRef.current = null;
    }
    setPlayingId(null);
  }, []);

  return {
    items,
    playingId,
    addItem,
    deleteItem,
    uploadAudioFile,
    uploadVideoFile,
    playPreview,
    stopPreview,
  };
}
