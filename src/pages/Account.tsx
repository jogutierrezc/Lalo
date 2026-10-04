/**
 * src/pages/Account.tsx
 *
 * Mi cuenta: el espacio que ocupa cada streamer, sus archivos (subir y borrar),
 * su plan y la clave privada que va en sus URL de OBS.
 *
 * Las subidas van directas al almacenamiento con un permiso que da el servidor
 * de Lalo después de comprobar el plan. Aquí se hace la misma comprobación
 * antes, solo para avisar pronto: quien decide es el servidor.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { SuiteNav } from '../components/SuiteNav';
import { useCloudSession } from '../hooks/useCloudSession';
import { fetchOwnMedia, formatBytes, rpc } from '../lib/cloud';
import type { MediaFileRow, ProfileUsageRow } from '../lib/cloudTypes';
import { StorageApiError, deleteMediaFile, uploadMediaFile } from '../lib/storageApi';
import { UPLOAD_ALLOWED_MIME, checkUpload } from '../../server/storage/limits';
import { UsageMeter } from '../components/UsageMeter';
import '../styles/admin.css';

const KIND_LABEL: Record<MediaFileRow['kind'], string> = { image: 'imagen', video: 'vídeo', audio: 'sonido' };

interface Upload {
  name: string;
  loaded: number;
  total: number;
}

export const Account: React.FC = () => {
  const { enabled, profile, refresh, signOut } = useCloudSession();
  const uid = useId();
  const [usage, setUsage] = useState<ProfileUsageRow | null>(null);
  const [files, setFiles] = useState<MediaFileRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [showKey, setShowKey] = useState(false);

  // null: aún no se sabe. false: el administrador no lo ha activado (o falta la migración)
  const [storageReady, setStorageReady] = useState<boolean | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      const [rows, media] = await Promise.all([rpc('profile_usage', {}), fetchOwnMedia(profile.id)]);
      setUsage(rows[0] || null);
      setFiles(media);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer tu cuenta.');
    }
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  const profileId = profile?.id ?? null;
  useEffect(() => {
    if (!enabled || !profileId) return;
    let alive = true;
    rpc('storage_ready', {})
      .then((ready) => {
        if (alive) setStorageReady(ready === true);
      })
      .catch(() => {
        if (alive) setStorageReady(false);
      });
    return () => {
      alive = false;
    };
  }, [enabled, profileId]);

  // Al salir de la página se corta la subida en curso
  useEffect(() => () => abortRef.current?.abort(), []);

  const rotate = async () => {
    try {
      await rpc('rotate_widget_key', {});
      await refresh();
      setConfirmRotate(false);
      setRotated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar la clave.');
    }
  };

  const startUpload = async (file: File) => {
    setUploadError(null);
    setUploadNote(null);
    if (!usage) return;
    const check = checkUpload(usage, { bytes: usage.bytes_used, files: usage.file_count }, { size: file.size, mime: file.type });
    if (!check.ok) {
      setUploadError(check.message);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setUpload({ name: file.name, loaded: 0, total: file.size });
    try {
      await uploadMediaFile(file, (loaded, total) => setUpload({ name: file.name, loaded, total }), controller.signal);
      setUploadNote(`«${file.name}» subido.`);
    } catch (err) {
      if (err instanceof StorageApiError && err.code === 'cancelled') {
        setUploadNote('Subida cancelada. No se guardó nada.');
      } else if (err instanceof StorageApiError && err.code === 'storage_not_configured') {
        setStorageReady(false);
      } else {
        setUploadError(err instanceof Error ? err.message : 'No se pudo subir el archivo.');
      }
    } finally {
      abortRef.current = null;
      setUpload(null);
      await load();
    }
  };

  const remove = async (file: MediaFileRow) => {
    setDeleting(file.id);
    setUploadError(null);
    try {
      await deleteMediaFile(file.id);
      setUploadNote(`«${file.name}» borrado.`);
      setConfirmDelete(null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'No se pudo borrar el archivo.');
    } finally {
      setDeleting(null);
      await load();
    }
  };

  const ratio = usage && usage.storage_limit_bytes > 0 ? usage.bytes_used / usage.storage_limit_bytes : 0;
  const left = usage ? Math.max(0, usage.storage_limit_bytes - usage.bytes_used) : 0;
  const key = profile?.widget_key || '';
  const progress = upload && upload.total > 0 ? Math.min(1, upload.loaded / upload.total) : 0;

  return (
    <div className="cab">
      <div className="mx-auto grid max-w-5xl gap-5 px-5 py-6">
        <SuiteNav currentApp="cuenta" channel={profile?.twitch_login || undefined} />

        {!enabled || !profile ? (
          <p className="cab-note">
            La nube no está configurada en este despliegue, así que no hay cuenta que mostrar. La app sigue guardando
            todo en este navegador.
          </p>
        ) : (
          <div className="grid items-start gap-5 md:grid-cols-2">
            <section className="cab-mod">
              <h2>Tu espacio</h2>
              {error && (
                <p className="cab-error" role="alert">
                  {error}
                </p>
              )}
              {usage ? (
                <>
                  <div className="grid gap-2">
                    <p className="cab-mono text-2xl">{formatBytes(usage.bytes_used)}</p>
                    <p className="cab-hint">
                      de {formatBytes(usage.storage_limit_bytes)} · {usage.file_count} de {usage.max_files} archivos
                    </p>
                    <UsageMeter used={usage.bytes_used} limit={usage.storage_limit_bytes} label="Espacio usado" />
                  </div>
                  {ratio >= 1 ? (
                    <p className="cab-error" role="status">
                      Has llenado tu espacio. Borra archivos para poder subir más.
                    </p>
                  ) : ratio >= 0.85 ? (
                    <p className="cab-note">
                      Te quedan {formatBytes(left)}. Un archivo puede pesar como máximo {formatBytes(usage.max_file_bytes)}.
                    </p>
                  ) : null}
                </>
              ) : (
                !error && <p className="cab-hint">Leyendo tu uso.</p>
              )}

              {usage && storageReady === false && (
                <p className="cab-note">
                  Todavía no se pueden subir archivos: el administrador aún no ha puesto en marcha el almacenamiento.
                  Cuando lo haga, aquí aparecerá el botón para subir.
                </p>
              )}

              {usage && storageReady && (
                <div className="acc-upload">
                  {upload ? (
                    <div className="acc-progress" role="status">
                      <span className="cab-row-text">
                        Subiendo «{upload.name}»: {formatBytes(upload.loaded)} de {formatBytes(upload.total)}
                      </span>
                      <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => abortRef.current?.abort()}>
                        Cancelar
                      </button>
                      <div
                        className="cab-meter"
                        role="progressbar"
                        aria-label={`Subida de ${upload.name}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(progress * 100)}
                      >
                        <i style={{ transform: `scaleX(${progress})` }} />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <input
                        id={`${uid}-file`}
                        type="file"
                        className="acc-file"
                        accept={UPLOAD_ALLOWED_MIME.join(',')}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (file) startUpload(file);
                        }}
                      />
                      <label htmlFor={`${uid}-file`} className="cab-btn">
                        Subir un archivo
                      </label>
                    </div>
                  )}
                  <p className="cab-hint">
                    Imágenes PNG, GIF, WebP o SVG, vídeos MP4 o WebM y sonidos MP3, WAV u OGG. Hasta{' '}
                    {formatBytes(usage.max_file_bytes)} por archivo.
                  </p>
                </div>
              )}
              {uploadError && (
                <p className="cab-error" role="alert">
                  {uploadError}
                </p>
              )}
              {uploadNote && !uploadError && (
                <p className="cab-hint" role="status">
                  {uploadNote}
                </p>
              )}

              {files && files.length > 0 ? (
                <ul className="cab-rows">
                  {files.map((file) => (
                    <li key={file.id} className="cab-row">
                      <div className="min-w-0">
                        <p className="cab-row-text font-semibold">{file.name}</p>
                        <p className="cab-hint">
                          {KIND_LABEL[file.kind]} · <span className="cab-mono">{formatBytes(file.size_bytes)}</span>
                        </p>
                        {confirmDelete === file.id && (
                          <p className="cab-hint" role="status">
                            Se borrará del todo y dejará de verse en tus capas. No se puede deshacer.
                          </p>
                        )}
                      </div>
                      {confirmDelete === file.id ? (
                        <div className="cab-row-actions">
                          <button
                            type="button"
                            className="cab-btn cab-btn-sm cab-btn-danger"
                            disabled={deleting === file.id}
                            onClick={() => remove(file)}
                          >
                            {deleting === file.id ? 'Borrando' : 'Borrar'}
                          </button>
                          <button
                            type="button"
                            className="cab-btn2 cab-btn-sm"
                            disabled={deleting === file.id}
                            onClick={() => setConfirmDelete(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="cab-btn2 cab-btn-sm"
                          aria-label={`Borrar ${file.name}`}
                          onClick={() => setConfirmDelete(file.id)}
                        >
                          Borrar
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                files && <p className="cab-note">Aún no has subido archivos. Aparecerán aquí con su tamaño.</p>
              )}
            </section>

            <section className="cab-mod">
              <h2>Tu cuenta</h2>
              <div className="cab-field">
                <span className="cab-label">Twitch</span>
                <span>{profile.display_name || profile.twitch_login || 'Sin nombre'}</span>
              </div>
              <div className="cab-field">
                <span className="cab-label">Clave de OBS</span>
                <span className="cab-url cab-mono">{showKey ? key : `${key.slice(0, 6)}…${key.slice(-4)}`}</span>
                <span className="cab-hint">
                  Va dentro de tus URL de OBS. Quien la tenga puede ver tus capas, no cambiarlas.
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="cab-btn2" onClick={() => setShowKey(!showKey)}>
                  {showKey ? 'Ocultar clave' : 'Ver clave'}
                </button>
                {!confirmRotate && (
                  <button type="button" className="cab-btn2" onClick={() => setConfirmRotate(true)}>
                    Generar clave nueva
                  </button>
                )}
              </div>
              {confirmRotate && (
                <div className="cab-note grid gap-3">
                  <p>La clave actual dejará de funcionar y tendrás que volver a pegar las URL en OBS.</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="cab-btn cab-btn-danger" onClick={rotate}>
                      Generar y anular la anterior
                    </button>
                    <button type="button" className="cab-btn2" onClick={() => setConfirmRotate(false)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              {rotated && (
                <p className="cab-note" role="status">
                  Clave nueva generada. Copia otra vez las URL desde «Fuentes de OBS».
                </p>
              )}
              <div className="cab-field">
                <span className="cab-label">Términos y políticas</span>
                <span>
                  <a className="studio-link" href="#legal">
                    Leer los documentos
                  </a>
                </span>
                <span className="cab-hint">
                  Los aceptaste al entrar. Si cambian, te lo avisamos y te pedimos aceptarlos de nuevo. Cómo tratamos tus
                  datos está en{' '}
                  <a className="studio-link" href="#legal/privacidad">
                    Privacidad
                  </a>
                  .
                </span>
              </div>
              <button type="button" className="cab-btn2" onClick={signOut}>
                Cerrar sesión
              </button>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
