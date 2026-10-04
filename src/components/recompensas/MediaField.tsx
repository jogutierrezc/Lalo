/**
 * src/components/recompensas/MediaField.tsx
 *
 * Un hueco para un archivo (sonido, vídeo o imagen) en el editor.
 *
 * - Con cuenta en la nube, el archivo se sube al almacén (R2) con el permiso
 *   del servidor y los límites del plan, y se guarda su dirección pública: así
 *   se sincroniza y OBS lo carga.
 * - Sin nube, o si el almacén aún no está activo, se guarda incrustado en este
 *   navegador como antes, y se dice claro que no llegará a OBS.
 * - Un archivo antiguo incrustado sigue funcionando aquí y ofrece «Subir a la nube».
 * - Al quitar o cambiar un archivo subido, se libera el anterior del almacén.
 */

import React, { useEffect, useRef, useState } from 'react';
import { CloudUpload } from 'lucide-react';
import { canFallBackToLocal, dataUrlToFile, isLocalOnlyMedia, mediaKindOfMime, uploadMediaForLayer } from '../../lib/mediaRef';
import { StorageApiError } from '../../lib/storageApi';

export interface MediaValue {
  url?: string;
  name?: string;
  mediaId?: string;
}

interface MediaFieldProps {
  id: string;
  accept: string;
  value: MediaValue;
  /** Hay una cuenta activa en la nube: los archivos se suben al almacén. */
  cloudOn: boolean;
  emptyHint: string;
  /** Con `null` se quita el archivo. `mime` es el tipo del archivo recién elegido. */
  onChange: (next: MediaValue | null, mime?: string) => void;
  /** Un archivo del almacén deja de usarse aquí. Quien lo recibe decide si se borra. */
  onRelease: (mediaId: string) => void;
  /** Comprobación previa (por ejemplo, la duración de un sonido). Lanza un Error para rechazarlo. */
  prepare?: (file: File) => Promise<void>;
  /** Botones extra junto a «Subir archivo». */
  children?: React.ReactNode;
}

const LOCAL_NOTE = 'Guardado solo en este navegador: no llegará a OBS.';
const BAD_TYPE =
  'Ese tipo de archivo no se admite en la nube. Usa MP3, WAV u OGG para sonido; WebM o MP4 para vídeo; PNG, GIF, WebP o SVG para imagen.';

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Archivo vacío.')));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });

export const MediaField: React.FC<MediaFieldProps> = ({ id, accept, value, cloudOn, emptyHint, onChange, onRelease, prepare, children }) => {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);
  // Al cambiar de recompensa, los avisos del archivo anterior ya no aplican
  useEffect(() => {
    setError(null);
    setNote(null);
  }, [id]);

  const has = Boolean(value.url);
  const local = isLocalOnlyMedia(value.url);
  const busy = progress !== null;

  const keepLocal = async (file: File, why: string) => {
    const url = await readAsDataUrl(file);
    if (!aliveRef.current) return;
    if (value.mediaId) onRelease(value.mediaId);
    onChange({ url, name: file.name }, file.type);
    setNote(why);
  };

  const toCloud = async (file: File): Promise<boolean> => {
    if (!mediaKindOfMime(file.type)) {
      setError(BAD_TYPE);
      return false;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress(0);
    try {
      const done = await uploadMediaForLayer(file, (loaded, total) => setProgress(total > 0 ? loaded / total : 0), controller.signal);
      if (!aliveRef.current) return true;
      if (value.mediaId && value.mediaId !== done.mediaId) onRelease(value.mediaId);
      onChange({ url: done.url, name: file.name, mediaId: done.mediaId }, file.type);
      setNote('Subido a tu espacio en la nube: OBS lo carga desde allí.');
      return true;
    } finally {
      abortRef.current = null;
      if (aliveRef.current) setProgress(null);
    }
  };

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setNote(null);
    try {
      if (prepare) await prepare(file);
      if (!cloudOn) {
        await keepLocal(file, `${LOCAL_NOTE} Con una cuenta en la nube se sube a tu espacio y OBS lo carga desde allí.`);
        return;
      }
      await toCloud(file);
    } catch (err) {
      if (!aliveRef.current) return;
      if (err instanceof StorageApiError && err.code === 'cancelled') {
        setNote('Subida cancelada. No se guardó nada.');
      } else if (canFallBackToLocal(err)) {
        // El almacén no está disponible: el archivo no se pierde, se queda en este navegador
        const reason = err instanceof Error ? err.message : 'El almacén no respondió.';
        await keepLocal(file, `${reason} ${LOCAL_NOTE}`).catch(() => setError('No se pudo leer el archivo.'));
      } else {
        setError(err instanceof Error && err.message ? err.message : 'No se pudo subir el archivo.');
      }
    }
  };

  /** Archivo antiguo incrustado: se sube tal cual y la referencia pasa a ser su dirección pública. */
  const moveToCloud = async () => {
    if (!value.url) return;
    setError(null);
    setNote(null);
    const file = dataUrlToFile(value.url, value.name || 'archivo');
    if (!file) {
      setError('Este archivo no se puede convertir para subirlo. Vuelve a elegirlo con «Subir archivo».');
      return;
    }
    try {
      await toCloud(file);
    } catch (err) {
      if (!aliveRef.current) return;
      if (err instanceof StorageApiError && err.code === 'cancelled') setNote('Subida cancelada. El archivo sigue en este navegador.');
      else setError(`${err instanceof Error && err.message ? err.message : 'No se pudo subir.'} El archivo sigue en este navegador.`);
    }
  };

  const remove = () => {
    if (value.mediaId) onRelease(value.mediaId);
    onChange(null);
    setError(null);
    setNote(null);
  };

  return (
    <div className="grid gap-2">
      <p className="cab-hint">
        {has
          ? `Archivo: ${value.name || 'sin nombre'} · ${local ? 'solo en este navegador' : value.mediaId ? 'en tu espacio de la nube' : 'enlazado'}`
          : emptyHint}
      </p>
      <div className="flex flex-wrap gap-2">
        {children}
        <label className="cab-btn2 cab-btn-sm" htmlFor={id} aria-disabled={busy || undefined}>
          {has ? 'Cambiar archivo' : 'Subir archivo'}
        </label>
        <input id={id} type="file" accept={accept} className="studio-file" disabled={busy} onChange={pick} />
        {has && local && cloudOn && (
          <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={moveToCloud}>
            <CloudUpload className="h-4 w-4" />
            <span>Subir a la nube</span>
          </button>
        )}
        {has && (
          <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={remove}>
            Quitar
          </button>
        )}
        {busy && (
          <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => abortRef.current?.abort()}>
            Cancelar subida
          </button>
        )}
      </div>
      {busy && (
        <div className="rw-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)}>
          <u style={{ transform: `scaleX(${progress ?? 0})` }} />
        </div>
      )}
      {has && local && !note && (
        <p className="cab-hint">
          {cloudOn
            ? `${LOCAL_NOTE} Pulsa «Subir a la nube» para que se sincronice.`
            : `${LOCAL_NOTE} Sirve para probar aquí; en OBS sonará el sonido de serie o no saldrá el vídeo.`}
        </p>
      )}
      {note && (
        <p className="cab-hint" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="cab-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
