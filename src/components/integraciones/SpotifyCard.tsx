/**
 * src/components/integraciones/SpotifyCard.tsx
 *
 * Ficha de Spotify en «Integraciones»: conecta la cuenta del streamer para que
 * la capa «Ahora suena» lea la canción. La conexión ocurre en la página de
 * Spotify; aquí solo se explica qué permiso se pide, se va y se vuelve.
 *
 * Dice en claro qué falta cuando no se puede conectar: la nube, el servidor,
 * sus variables o la migración de la base de datos.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useCloudSession } from '../../hooks/useCloudSession';
import { spotifyDisconnect, spotifyLoginUrl, spotifyStatus, spotifyTest, type SpotifyStatus } from '../../lib/integrationsApi';
import { ServiceCard } from './ServiceCard';

type Load = { kind: 'loading' } | { kind: 'ready'; status: SpotifyStatus } | { kind: 'problem'; code: string; message: string; missing: string[] };

/** Lo que cuenta la dirección al volver de Spotify (#integraciones?spotify=...). */
const RETURN_MESSAGES: Record<string, string> = {
  connected: 'Cuenta conectada. La capa ya puede leer la canción.',
  denied: 'No se conectó nada: cancelaste el permiso en Spotify.',
  bad_state: 'La conexión caducó o no empezó en este navegador. Pulsa «Conectar con Spotify» otra vez.',
  not_allowed:
    'Spotify no deja leer esta cuenta: todavía no está en la lista de usuarios de la app de Lalo. Pide a quien administra Lalo que añada tu correo de Spotify y vuelve a conectar.',
  not_configured: 'Al servidor de Lalo le falta configuración para conectar con Spotify.',
  error: 'No se pudo completar la conexión con Spotify. Prueba otra vez en un momento.',
};

function readReturn(): string | null {
  const hash = window.location.hash;
  const at = hash.indexOf('?');
  if (at === -1) return null;
  const code = new URLSearchParams(hash.slice(at + 1)).get('spotify');
  if (!code) return null;
  // La dirección queda limpia para que el aviso no se repita al recargar
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#integraciones`);
  return RETURN_MESSAGES[code] ?? RETURN_MESSAGES.error;
}

const formatDay = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

export const SpotifyCard: React.FC = () => {
  const cloud = useCloudSession();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<React.ReactNode>(null);

  const refresh = useCallback(async () => {
    const result = await spotifyStatus();
    setLoad(result.ok ? { kind: 'ready', status: result.data } : { kind: 'problem', code: result.code, message: result.message, missing: result.missing });
  }, []);

  useEffect(() => {
    const back = readReturn();
    if (back) setMessage(back);
    if (cloud.enabled) refresh();
  }, [cloud.enabled, refresh]);

  const status = load.kind === 'ready' ? load.status : null;
  const connected = status?.state === 'connected';

  const go = async () => {
    setBusy(true);
    const result = await spotifyLoginUrl();
    if (!result.ok) {
      setBusy(false);
      setMessage(`${result.message}${result.missing.length ? ` Falta: ${result.missing.join(', ')}.` : ''}`);
      return;
    }
    window.location.assign(result.data);
  };

  const disconnect = async () => {
    setBusy(true);
    const result = await spotifyDisconnect();
    setBusy(false);
    setMessage(result.ok ? 'Cuenta desconectada. El permiso se borró del servidor y la capa deja de mostrarse.' : result.message);
    refresh();
  };

  const test = async () => {
    setBusy(true);
    const result = await spotifyTest();
    setBusy(false);
    if (!result.ok) return setMessage(result.message);
    const { status: code, reading } = result.data;
    if (code === 'expired' || code === 'not_connected') {
      setMessage('El permiso ya no vale. Vuelve a conectar la cuenta.');
      return void refresh();
    }
    if (code === 'forbidden') return setMessage('Spotify no deja leer esta cuenta. Puede que no esté en la lista de usuarios de la app de Lalo, o que la app haya perdido Premium.');
    if (code === 'rate_limited') return setMessage('Spotify pide esperar un momento antes de volver a preguntar.');
    if (code !== 'ok') return setMessage('Spotify no respondió. Prueba otra vez en un momento.');
    if (!reading.track) return setMessage('Spotify responde que ahora no suena nada (o suena un anuncio).');
    setMessage(
      <>
        Spotify responde: {reading.playing ? 'suena' : 'en pausa'} «{reading.track.title}»{reading.track.artists ? `, de ${reading.track.artists}` : ''}.{' '}
        {reading.track.url && (
          <a className="studio-link" href={reading.track.url} target="_blank" rel="noreferrer">
            Abrir en Spotify
          </a>
        )}
      </>
    );
  };

  const label = !cloud.enabled ? 'Sin la nube' : load.kind === 'loading' ? 'Comprobando' : connected ? 'Conectado' : status?.state === 'expired' ? 'Caducado' : asking ? 'Pidiendo permiso' : 'Sin conectar';

  return (
    <ServiceCard mark="SP" name="Spotify" status={label} tone={connected ? 'on' : status?.state === 'expired' ? 'warn' : undefined}>
      {!cloud.enabled && (
        <>
          <p>Conecta tu cuenta para que la capa «Ahora suena» muestre en pantalla la canción que estás escuchando.</p>
          <p className="cab-note">
            Este despliegue no tiene la nube encendida, así que no hay cuenta de Lalo a la que conectar Spotify. Los seis diseños se pueden probar con
            canciones de ejemplo en{' '}
            <a className="studio-link" href="#musica">
              Ahora suena
            </a>
            .
          </p>
        </>
      )}

      {cloud.enabled && load.kind === 'loading' && <p className="cab-hint">Preguntando al servidor de Lalo.</p>}

      {cloud.enabled && load.kind === 'problem' && (
        <>
          <p className="cab-note" role="status">
            {load.message}
            {load.missing.length > 0 && ` Falta en el servidor: ${load.missing.join(', ')}.`}
          </p>
          <div className="ic-row">
            <button type="button" className="cab-btn2 cab-btn-sm" onClick={refresh}>
              Volver a comprobar
            </button>
          </div>
        </>
      )}

      {status && !status.configured && (
        <>
          <p>Conecta tu cuenta para que la capa «Ahora suena» muestre en pantalla la canción que estás escuchando.</p>
          <p className="cab-note" role="status">
            Todavía no se puede conectar: al servidor de Lalo le falta configuración ({status.missing.join(', ')}). La añade quien administra Lalo.
            Mientras tanto, la capa se puede probar con canciones de ejemplo en{' '}
            <a className="studio-link" href="#musica">
              Ahora suena
            </a>
            .
          </p>
        </>
      )}

      {status?.configured && !connected && !asking && (
        <>
          <p>
            {status.state === 'expired'
              ? 'El permiso de Spotify caducó o se retiró. Vuelve a conectar para que la capa siga leyendo la canción.'
              : 'Conecta tu cuenta para que la capa «Ahora suena» muestre en pantalla la canción que estás escuchando.'}
          </p>
          <div className="ic-row">
            <button type="button" className="cab-btn cab-btn-sm" onClick={() => setAsking(true)}>
              Conectar con Spotify
            </button>
          </div>
        </>
      )}

      {status?.configured && !connected && asking && (
        <>
          <p>Lalo pide un solo permiso. Lo aceptas en la página de Spotify: Lalo nunca ve tu contraseña.</p>
          <ul className="ic-perm">
            <li data-y="">
              <b>SÍ</b>
              <span>Ver qué canción o pódcast suena ahora mismo en tu cuenta</span>
            </li>
            <li>
              <b>NO</b>
              <span>Pausar, saltar o cambiar lo que suena</span>
            </li>
            <li>
              <b>NO</b>
              <span>Ver tus listas ni tu biblioteca</span>
            </li>
            <li>
              <b>NO</b>
              <span>Ver tu correo ni tus datos de pago</span>
            </li>
          </ul>
          <div className="ic-row">
            <button type="button" className="cab-btn cab-btn-sm" disabled={busy} onClick={go}>
              {busy ? 'Abriendo Spotify' : 'Continuar en Spotify'}
            </button>
            <button
              type="button"
              className="cab-btn2 cab-btn-sm"
              disabled={busy}
              onClick={() => {
                setAsking(false);
                setMessage('No se conectó nada.');
              }}
            >
              Cancelar
            </button>
          </div>
        </>
      )}

      {status && connected && (
        <>
          <p>
            Conectado como <span className="ic-who">{status.accountName || 'tu cuenta de Spotify'}</span>
          </p>
          <ul className="ic-perm">
            <li data-y="">
              <b>SÍ</b>
              <span>Leer lo que suena ahora</span>
            </li>
          </ul>
          <p className="cab-hint">
            Lalo guarda este permiso cifrado en su servidor para que OBS pueda leer la canción. Spotify lo hace caducar a los 6 meses
            {status.expiresAt ? ` (hacia el ${formatDay(status.expiresAt)})` : ''}: entonces esta ficha te pedirá volver a conectar. Al desconectar se borra.
          </p>
          <div className="ic-row">
            <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={test}>
              Probar
            </button>
            <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={disconnect}>
              Desconectar
            </button>
            <a className="cab-btn2 cab-btn-sm" href="#musica">
              Ajustar la capa
            </a>
          </div>
        </>
      )}

      {message && (
        <p className="cab-hint" role="status">
          {message}
        </p>
      )}
      <p className="cab-hint">
        {status?.seats !== null && status?.seats !== undefined && (
          <>
            Plazas ocupadas: <b>{status.seats} de {status.seatsMax}</b>.{' '}
          </>
        )}
        Mientras la app de Spotify de Lalo esté en modo desarrollo, solo pueden conectarse cinco cuentas, y quien administra Lalo tiene que añadir antes
        el correo de Spotify de cada una.
      </p>
    </ServiceCard>
  );
};
