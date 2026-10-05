/**
 * src/pages/admin/IntegracionesSection.tsx
 *
 * Sección «Integraciones» de la consola del administrador: fichas de estado de
 * los servicios que usa el servidor de Lalo. Solo dicen si cada cosa está
 * configurada y qué variable falta; nunca enseñan una clave.
 *
 * El administrador no emite, así que aquí no se conecta ninguna cuenta: eso lo
 * hace cada streamer en su página «Integraciones».
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ServiceCard, type CardTone } from '../../components/integraciones/ServiceCard';
import { integrationsServerStatus, type IntegrationsServerStatus } from '../../lib/integrationsApi';
import { adminHref, storageHealth, type StorageHealth } from '../../lib/adminLogic';
import type { AdminData } from './useAdminData';
import '../../styles/integraciones.css';

type Load = { kind: 'loading' } | { kind: 'ready'; status: IntegrationsServerStatus } | { kind: 'problem'; message: string; missing: string[] };

const R2_STATE: Record<StorageHealth, { label: string; tone?: CardTone; text: string }> = {
  unknown: { label: 'Sin respuesta', tone: 'warn', text: 'No se pudo preguntar al servidor por el almacenamiento.' },
  missing: { label: 'Sin configurar', tone: 'warn', text: 'Faltan variables de R2 en el servidor: los streamers no pueden subir archivos.' },
  untested: { label: 'Sin probar', tone: 'soon', text: 'Configurado, pero aún no se ha hecho la prueba de subida y lectura.' },
  failed: { label: 'Con fallo', tone: 'warn', text: 'La última prueba de subida y lectura falló.' },
  ok: { label: 'Activo', tone: 'on', text: 'La última prueba de subida y lectura fue correcta.' },
};

const list = (items: string[]): string => items.join(', ');

export const IntegracionesSection: React.FC<{ data: AdminData }> = ({ data }) => {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  const refresh = useCallback(async () => {
    setLoad({ kind: 'loading' });
    const result = await integrationsServerStatus();
    setLoad(result.ok ? { kind: 'ready', status: result.data } : { kind: 'problem', message: result.message, missing: result.missing });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const status = load.kind === 'ready' ? load.status : null;
  const r2 = R2_STATE[data.storageLoading ? 'unknown' : storageHealth(data.storage)];
  const spotifyReady = status !== null && status.spotifyMissing.length === 0 && status.database.length === 0;
  const kofiReady = status !== null && status.kofiMissing.length === 0 && status.database.length === 0;
  const pending = load.kind === 'loading' ? 'Comprobando' : 'Sin respuesta';

  return (
    <div className="grid gap-5">
      <p className="ig-lede">
        Estado de los servicios que usa el servidor de Lalo. Aquí no se conecta ninguna cuenta: cada streamer conecta su Spotify y su Ko-fi desde su
        página «Integraciones». Las claves viven en las variables de entorno del servidor y nunca se muestran.
      </p>

      {load.kind === 'problem' && (
        <p className="cab-note" role="status">
          {load.message}
          {load.missing.length > 0 && ` Falta en el servidor: ${list(load.missing)}.`}{' '}
          <button type="button" className="studio-link" onClick={refresh}>
            Volver a comprobar
          </button>
        </p>
      )}
      {status && status.migration === 'missing' && (
        <p className="cab-error" role="alert">
          Falta aplicar la migración 0013 (integraciones) en Supabase. Hasta entonces nadie puede conectar Spotify ni Ko-fi.
        </p>
      )}
      {status && status.database.length > 0 && (
        <p className="cab-error" role="alert">
          Al servidor le faltan variables de Supabase: {list(status.database)}.
        </p>
      )}

      <div className="ig">
        <ServiceCard mark="SP" name="Spotify" status={status ? (spotifyReady ? 'Configurado' : 'Sin configurar') : pending} tone={status ? (spotifyReady ? 'on' : 'warn') : undefined} adminOnly>
          <p>Lee la canción que escucha cada streamer para la capa «Ahora suena».</p>
          {status && status.spotifyMissing.length > 0 && <p className="cab-note">Faltan en el servidor: {list(status.spotifyMissing)}.</p>}
          {status && (
            <p className="cab-hint">
              Dirección de vuelta que hay que registrar en la app de Spotify, exactamente así:{' '}
              {status.spotifyRedirectUri ? <code className="ic-addr">{status.spotifyRedirectUri}</code> : 'aún no se puede calcular (falta SPOTIFY_REDIRECT_URI).'}
            </p>
          )}
          <p className="cab-hint">
            {status?.seats !== null && status?.seats !== undefined && (
              <>
                Plazas ocupadas: <b>{status.seats} de {status.seatsMax}</b>.{' '}
              </>
            )}
            Mientras la app de Spotify esté en modo desarrollo solo pueden conectarse cinco cuentas. El correo de Spotify de cada streamer se añade a
            mano en el panel de desarrolladores de Spotify (apartado de usuarios de la app): Lalo no puede hacerlo ni lleva esa lista. La cuenta dueña de
            la app necesita Premium; si lo pierde, la integración deja de funcionar.
          </p>
        </ServiceCard>

        <ServiceCard mark="KF" name="Ko-fi" status={status ? (kofiReady ? 'Configurado' : 'Sin configurar') : pending} tone={status ? (kofiReady ? 'on' : 'warn') : undefined} adminOnly>
          <p>Recibe los avisos de pago que Ko-fi envía a la dirección personal de cada streamer.</p>
          {status && status.kofiMissing.length > 0 && <p className="cab-note">Faltan en el servidor: {list(status.kofiMissing)}.</p>}
          {status && (
            <p className="cab-hint">
              {status.kofiBase
                ? `Las direcciones de los streamers empiezan por ${status.kofiBase}/api/kofi/.`
                : 'El servidor no conoce su dirección pública (PUBLIC_BASE_URL): cada streamer verá la dirección del sitio desde el que abre el panel.'}{' '}
              No hace falta ninguna clave de Ko-fi en el servidor: cada streamer guarda la suya, cifrada.
            </p>
          )}
        </ServiceCard>

        <ServiceCard mark="RG" name="Riot Games" status={status ? (status.riotConfigured ? 'Activa' : 'Sin clave') : pending} tone={status ? (status.riotConfigured ? 'on' : 'warn') : undefined} adminOnly>
          <p>Lee el rango y las partidas de League of Legends de cada streamer para «Alertas de juego». La clave vive en el servidor y no se muestra aquí.</p>
          <p className="cab-hint">
            {status
              ? status.riotConfigured
                ? 'El servidor tiene la clave (RIOT_API_KEY). Esta ficha no hace una llamada de prueba: la clave de desarrollo de Riot caduca cada 24 horas.'
                : 'Falta RIOT_API_KEY en el servidor: nadie puede vincular su Riot ID.'
              : 'Sin datos del servidor.'}
            {status && status.riotLinked !== null && ` Cuentas vinculadas: ${status.riotLinked}.`} Necesita la migración 0015 en Supabase.
          </p>
        </ServiceCard>

        <ServiceCard mark="FA" name="Fish Audio" status={status ? (status.fishConfigured ? 'Activa' : 'Sin clave') : pending} tone={status ? (status.fishConfigured ? 'on' : 'warn') : undefined} adminOnly>
          <p>Servicio de voces. La clave vive en el servidor y no se muestra aquí.</p>
          <p className="cab-hint">
            {status
              ? status.fishConfigured
                ? 'El servidor tiene la clave (FISH_AUDIO_API_KEY). Esta ficha no hace una llamada de prueba: si la voz falla, se ve al probarla en «Voces».'
                : 'Falta FISH_AUDIO_API_KEY en el servidor: la voz no puede hablar.'
              : 'Sin datos del servidor.'}{' '}
            <a className="studio-link" href={adminHref('voces')}>
              Voces
            </a>
          </p>
        </ServiceCard>

        <ServiceCard mark="R2" name="Cloudflare R2" status={data.storageLoading ? 'Comprobando' : r2.label} tone={data.storageLoading ? undefined : r2.tone} adminOnly>
          <p>Almacenamiento de los archivos que suben los streamers.</p>
          <p className="cab-hint">
            {data.storageLoading ? 'Preguntando al servidor.' : r2.text}
            {data.storage && data.storage.missing.length > 0 && ` Faltan: ${list(data.storage.missing)}.`}{' '}
            <a className="studio-link" href={adminHref('almacenamiento')}>
              Almacenamiento
            </a>
          </p>
        </ServiceCard>
      </div>
    </div>
  );
};
