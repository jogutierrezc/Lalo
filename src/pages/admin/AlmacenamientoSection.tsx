/**
 * src/pages/admin/AlmacenamientoSection.tsx
 *
 * Almacenamiento de archivos (Cloudflare R2). No hay botón de «conectar»: se
 * configura una vez con variables en el servidor. Esta sección dice qué falta,
 * permite probarlo de verdad y, cuando funciona, muestra cómo se reparte el
 * espacio.
 *
 * Nunca da el almacenamiento por bueno sin una prueba que haya pasado.
 */

import React, { useState } from 'react';
import { adminHref, capacitySplit, profileName, storageHealth, type StorageHealth } from '../../lib/adminLogic';
import { formatBytes } from '../../lib/cloud';
import { StorageApiError, runStorageTest, type StorageTestResult, type StorageTestStepId } from '../../lib/storageApi';
import { formatDateTime } from './adminFormat';
import type { AdminData } from './useAdminData';

const STEP_NAME: Record<StorageTestStepId, string> = {
  subir: 'Subir un archivo de prueba',
  leer: 'Leerlo por la dirección pública',
  permiso: 'Permiso para subir desde el navegador',
  borrar: 'Borrar el archivo de prueba',
};

/** Qué revisar cuando falla cada paso. */
const STEP_FIX: Record<StorageTestStepId, string> = {
  subir:
    'Revisa R2_ACCOUNT_ID y R2_BUCKET, y que el token de R2 tenga permiso de lectura y escritura de objetos sobre ese bucket.',
  leer: 'Activa el acceso público del bucket (dirección r2.dev o dominio propio) y comprueba que R2_PUBLIC_BASE_URL es esa dirección, sin el nombre del bucket al final.',
  permiso:
    'Añade la dirección de esta app a la regla CORS del bucket, con el método PUT y la cabecera Content-Type. La guía trae el texto listo para copiar.',
  borrar: 'El token de R2 necesita permiso de escritura, no solo de lectura.',
};

const HEALTH_CHIP: Record<StorageHealth, { status?: string; label: string }> = {
  unknown: { status: 'rejected', label: 'Sin respuesta' },
  missing: { status: 'skipped', label: 'Sin configurar' },
  untested: { status: 'skipped', label: 'Falta probar' },
  failed: { status: 'rejected', label: 'La prueba falló' },
  ok: { status: 'read', label: 'Funciona' },
};

const isStep = (value: string | null): value is StorageTestStepId => value !== null && value in STEP_NAME;

export const AlmacenamientoSection: React.FC<{ data: AdminData }> = ({ data }) => {
  const { overview, storage, storageError, storageLoading, reload, reloadStorage } = data;
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<StorageTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const health = storageHealth(storage);
  const chip = HEALTH_CHIP[health];

  const test = async () => {
    setTesting(true);
    setTestError(null);
    try {
      setResult(await runStorageTest());
    } catch (err) {
      setResult(null);
      setTestError(err instanceof StorageApiError ? err.message : 'No se pudo hacer la prueba.');
    } finally {
      setTesting(false);
      await Promise.all([reloadStorage(), reload()]);
    }
  };

  const testButton = (primary: boolean, label: string) => (
    <button type="button" className={primary ? 'cab-btn' : 'cab-btn2 cab-btn-sm'} onClick={test} disabled={testing}>
      {testing ? 'Probando' : label}
    </button>
  );

  const guide = (
    <p className="cab-hint">
      Los pasos en Cloudflare, uno por uno, están en la guía <span className="cab-mono">supabase/CLOUDFLARE-R2.md</span> del
      proyecto.
    </p>
  );

  const before = (
    <section className="cab-mod">
      <h2>Antes de empezar</h2>
      <ul className="cab-rows adm-list">
        <li className="adm-list-row">
          <span>
            <b>Dónde se guardan los archivos:</b> en un bucket de Cloudflare R2 a tu nombre. Cada streamer tiene su
            carpeta dentro.
          </span>
        </li>
        <li className="adm-list-row">
          <span>
            <b>Dónde quedan las claves:</b> en el servidor, nunca en el navegador de un streamer.
          </span>
        </li>
        <li className="adm-list-row">
          <span>
            <b>Qué pasa con los límites:</b> el servidor comprueba el plan de cada streamer antes de aceptar una subida y
            vuelve a medir el archivo cuando llega.
          </span>
        </li>
        <li className="adm-list-row">
          <span>
            <b>Cómo se apaga:</b> quitando las variables del servidor. Los archivos se quedan en tu bucket.
          </span>
        </li>
      </ul>
      {guide}
    </section>
  );

  if (!storage) {
    return (
      <section className="cab-mod">
        <h2 className="adm-h2">
          Almacenamiento
          {!storageLoading && (
            <b className="cab-chip" data-status={chip.status}>
              {chip.label}
            </b>
          )}
        </h2>
        {storageLoading ? (
          <p className="cab-hint">Preguntando al servidor por el almacenamiento.</p>
        ) : (
          <>
            <p className="cab-error" role="alert">
              {storageError?.message ?? 'No se pudo leer el estado del almacenamiento.'}
            </p>
            {storageError && storageError.missing.length > 0 && (
              <>
                <p>Al servidor le faltan estas variables para saber quién llama:</p>
                <MissingList names={storageError.missing} />
                <p className="cab-hint">
                  SUPABASE_URL puede ser también VITE_SUPABASE_URL, que ya usa la app. Se añaden en Vercel (Settings,
                  Environment Variables) o en el archivo .env en local, y hay que volver a desplegar o reiniciar.
                </p>
              </>
            )}
            <div>
              <button type="button" className="cab-btn2" onClick={reloadStorage}>
                Volver a comprobar
              </button>
            </div>
          </>
        )}
      </section>
    );
  }

  const split = overview
    ? capacitySplit(storage.capacityBytes, storage.usedBytes, overview.totals.storage_committed_bytes)
    : null;
  const top = overview ? [...overview.profiles].filter((row) => row.bytes_used > 0).sort((a, b) => b.bytes_used - a.bytes_used).slice(0, 4) : [];
  const failedStep = storage.lastTest && !storage.lastTest.ok && isStep(storage.lastTest.step) ? storage.lastTest.step : null;
  const stepState = (index: number): string | undefined => {
    const current = health === 'missing' ? 0 : health === 'ok' ? 3 : 1;
    return index < current ? 'done' : index === current ? 'now' : undefined;
  };

  const migrationNote = !storage.migrated && (
    <p className="cab-error" role="alert">
      Falta ejecutar la migración <span className="cab-mono">0005_r2_storage.sql</span> en Supabase. Sin ella no se puede
      guardar el resultado de la prueba ni registrar archivos.
    </p>
  );

  const testReport = (testError || result) && (
    <div className="grid gap-2" role="status">
      {testError && <p className="cab-error">{testError}</p>}
      {result && (
        <>
          <ul className="cab-rows adm-list">
            {result.steps.map((entry) => (
              <li key={entry.step} className="adm-list-row">
                <span>
                  <b>{STEP_NAME[entry.step]}.</b> {entry.detail}
                  {!entry.ok && <span className="cab-hint adm-block">{STEP_FIX[entry.step]}</span>}
                </span>
                <span className="cab-chip" data-status={entry.ok ? 'read' : 'rejected'}>
                  {entry.ok ? 'Bien' : 'Falló'}
                </span>
              </li>
            ))}
          </ul>
          {!result.saved && (
            <p className="cab-error">
              La prueba se hizo, pero su resultado no se pudo guardar{result.saveError ? `: ${result.saveError}` : ''}. Los
              streamers no verán el almacenamiento activo hasta que se guarde.
            </p>
          )}
        </>
      )}
    </div>
  );

  if (health !== 'ok') {
    return (
      <div className="adm-grid2">
        <section className="cab-mod">
          <h2 className="adm-h2">
            Poner en marcha
            <b className="cab-chip" data-status={chip.status}>
              {chip.label}
            </b>
          </h2>
          {migrationNote}
          <ol className="adm-steps">
            <li data-s={stepState(0)}>
              <span>
                <b>Variables</b>
                <span className="cab-hint adm-block">
                  Crear el bucket en Cloudflare y poner sus datos en las variables del servidor.
                </span>
              </span>
            </li>
            <li data-s={stepState(1)}>
              <span>
                <b>Prueba</b>
                <span className="cab-hint adm-block">
                  Subir un archivo de prueba, leerlo como lo haría una capa de OBS y borrarlo.
                </span>
              </span>
            </li>
            <li data-s={stepState(2)}>
              <span>
                <b>Listo</b>
                <span className="cab-hint adm-block">Los streamers ya pueden subir archivos desde «Mi cuenta».</span>
              </span>
            </li>
          </ol>

          {health === 'missing' && (
            <>
              <p>Al servidor le faltan estas variables:</p>
              <MissingList names={storage.missing} />
              <p className="cab-hint">
                Se añaden en Vercel (Settings, Environment Variables) o en el archivo .env en local. Después hay que volver
                a desplegar o reiniciar el servidor. Aquí solo se ven los nombres, nunca los valores.
              </p>
              <div>
                <button type="button" className="cab-btn2" onClick={reloadStorage}>
                  Ya las puse, comprobar de nuevo
                </button>
              </div>
            </>
          )}

          {health === 'untested' && (
            <>
              {storage.bucket && !storage.bucket.answers ? (
                <p className="cab-error" role="alert">
                  {storage.bucket.detail}
                </p>
              ) : (
                <p className="cab-note">
                  Las variables están puestas y el bucket <b className="cab-mono">{storage.bucketName}</b> responde. Falta
                  la prueba completa.
                </p>
              )}
              <div>{testButton(true, 'Probar almacenamiento')}</div>
            </>
          )}

          {health === 'failed' && storage.lastTest && (
            <>
              <div className="cab-note adm-note-bad grid gap-1" role="alert">
                <p>
                  La última prueba ({formatDateTime(storage.lastTest.at)}) falló
                  {failedStep ? ` en el paso «${STEP_NAME[failedStep]}»` : ''}. {storage.lastTest.detail}
                </p>
                {failedStep && <p>{STEP_FIX[failedStep]}</p>}
              </div>
              {storage.bucket && !storage.bucket.answers && <p className="cab-error">{storage.bucket.detail}</p>}
              <div>{testButton(true, 'Volver a probar')}</div>
            </>
          )}

          {testReport}
        </section>
        {before}
      </div>
    );
  }

  return (
    <div className="adm-grid2">
      <section className="cab-mod">
        <h2 className="adm-h2">
          Almacenamiento
          <b className="cab-chip" data-status="read">
            Funciona
          </b>
        </h2>
        {migrationNote}
        <dl className="adm-kv">
          <dt>Bucket</dt>
          <dd className="cab-mono">{storage.bucketName}</dd>
          <dt>Dirección pública</dt>
          <dd className="cab-mono">{storage.publicBaseUrl}</dd>
          <dt>Archivos</dt>
          <dd>{storage.fileCount}</dd>
          <dt>Última prueba</dt>
          <dd>{storage.lastTest ? `${formatDateTime(storage.lastTest.at)}, sin errores` : 'Sin datos'}</dd>
        </dl>
        {storage.bucket && !storage.bucket.answers && (
          <p className="cab-error" role="alert">
            Ahora mismo el bucket no responde. {storage.bucket.detail}
          </p>
        )}
        <div className="flex flex-wrap gap-2">{testButton(false, 'Probar almacenamiento')}</div>
        {testReport}
        <p className="cab-hint">
          No hay botón para desconectar: el almacenamiento se apaga quitando las variables del servidor. Los archivos se
          quedan en tu bucket, pero las capas de los streamers dejan de cargarlos si quitas el acceso público.
        </p>
      </section>

      <section className="cab-mod">
        <h2>Espacio</h2>
        {split && overview ? (
          <>
            <div
              className="adm-capbar"
              role="img"
              aria-label={`Usado ${formatBytes(split.used)}, prometido sin usar ${formatBytes(split.promised)}, libre ${formatBytes(split.free)}`}
            >
              <i style={{ width: `${split.capacity > 0 ? (split.used / split.capacity) * 100 : 0}%` }} />
              <i className="adm-cap-b" style={{ width: `${split.capacity > 0 ? (split.promised / split.capacity) * 100 : 0}%` }} />
            </div>
            <div className="adm-legend">
              <span>
                <i />
                Usado: {formatBytes(split.used)}
              </span>
              <span>
                <i className="adm-cap-b" />
                Prometido sin usar: {formatBytes(split.promised)}
              </span>
              <span>
                <i className="adm-cap-c" />
                Libre: {formatBytes(split.free)}
              </span>
            </div>
            <p className="cab-hint">
              Capacidad total: {formatBytes(split.capacity)}. Prometido a las cuentas activas según su plan:{' '}
              {formatBytes(overview.totals.storage_committed_bytes)}. Lo usado es la suma de los archivos registrados en
              Lalo; Cloudflare no informa del total del bucket por esta vía.{' '}
              <a className="studio-link" href={adminHref('limites')}>
                Cambiar la capacidad
              </a>
            </p>
            {split.overcommitted && (
              <p className="cab-error" role="status">
                Has prometido más espacio del que hay. Sube la capacidad o baja los planes en Límites.
              </p>
            )}
            <span className="cab-label">Quién ocupa más</span>
            {top.length === 0 ? (
              <p className="cab-note">Nadie ha subido archivos todavía.</p>
            ) : (
              <ul className="cab-rows adm-list">
                {top.map((row) => (
                  <li key={row.profile_id} className="adm-list-row">
                    <b>{profileName(row)}</b>
                    <span className="cab-mono">{formatBytes(row.bytes_used)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="cab-hint">Leyendo las cuentas.</p>
        )}
      </section>
    </div>
  );
};

const MissingList: React.FC<{ names: string[] }> = ({ names }) => (
  <ul className="flex flex-wrap gap-2">
    {names.map((name) => (
      <li key={name} className="cab-url cab-mono">
        {name}
      </li>
    ))}
  </ul>
);
