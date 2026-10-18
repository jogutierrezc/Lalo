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
import {
  luxPublishRelease,
  luxRelease,
  luxSaveKey,
  luxSetModel,
  luxSetProvider,
  luxStatus,
  luxTest,
  type LuxProviderId,
  type LuxReleaseInfo,
  type LuxStatus,
} from '../../lib/luxApi';
import { adminHref, storageHealth, type StorageHealth } from '../../lib/adminLogic';
import { rpc } from '../../lib/cloud';
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
  const [elevenSlot, setElevenSlot] = useState<1 | 2 | null>(null);
  const [elevenSlotProblem, setElevenSlotProblem] = useState<string | null>(null);
  const [elevenSlotBusy, setElevenSlotBusy] = useState(false);
  const [lux, setLux] = useState<LuxStatus | null>(null);
  const [luxProblem, setLuxProblem] = useState<string | null>(null);
  const [luxInput, setLuxInput] = useState('');
  // Proveedor al que va la clave que se pega. Es independiente del proveedor activo.
  const [luxKeyProvider, setLuxKeyProvider] = useState<LuxProviderId | null>(null);
  const [release, setRelease] = useState<LuxReleaseInfo | null>(null);
  const [releaseNote, setReleaseNote] = useState('');
  const [luxBusy, setLuxBusy] = useState(false);
  const [luxNote, setLuxNote] = useState<string | null>(null);

  const refreshLux = useCallback(async () => {
    const res = await luxStatus();
    if (res.ok) {
      setLux(res.data);
      setLuxProblem(null);
    } else {
      setLuxProblem(res.message);
    }
  }, []);

  useEffect(() => {
    refreshLux();
    luxRelease().then((res) => {
      if (res.ok) setRelease(res.data);
    });
  }, [refreshLux]);

  // La clave pasa por el servidor y no se conserva en el estado: al guardar se vacía el campo.
  const keyTarget: LuxProviderId = luxKeyProvider ?? lux?.provider ?? 'nvidia';

  const saveLuxKey = async (value: string, provider: LuxProviderId) => {
    setLuxBusy(true);
    setLuxNote(null);
    const res = await luxSaveKey(value, provider);
    setLuxInput('');
    if (res.ok) {
      setLuxProblem(null);
      setLuxNote(value ? 'Clave guardada.' : 'Clave borrada.');
      await refreshLux();
    } else {
      setLuxProblem(res.message);
    }
    setLuxBusy(false);
  };

  const changeLuxModel = async (model: string) => {
    setLuxBusy(true);
    setLuxNote(null);
    const res = await luxSetModel(model);
    if (res.ok) {
      setLuxProblem(null);
      setLuxNote(`Modelo cambiado a ${res.data.model}. Prueba la conexión para confirmar que responde.`);
      await refreshLux();
    } else {
      setLuxProblem(res.message);
    }
    setLuxBusy(false);
  };

  const publishRelease = async () => {
    setLuxBusy(true);
    setLuxNote(null);
    const res = await luxPublishRelease(releaseNote.trim());
    if (res.ok) {
      setRelease(res.data);
      setReleaseNote('');
      setLuxNote(`Actualización ${res.data.version} publicada. Los overlays de OBS se recargan solos en menos de un minuto.`);
    } else {
      setLuxProblem(res.message);
    }
    setLuxBusy(false);
  };

  const changeLuxProvider = async (provider: LuxProviderId) => {
    setLuxBusy(true);
    setLuxNote(null);
    const res = await luxSetProvider(provider);
    if (res.ok) {
      setLuxProblem(null);
      setLuxNote(`Lux usa ahora ${provider === 'mistral' ? 'Mistral AI' : 'NVIDIA'}. Prueba la conexión para confirmar.`);
      await refreshLux();
    } else {
      setLuxProblem(res.message);
    }
    setLuxBusy(false);
  };

  const testLux = async () => {
    setLuxBusy(true);
    setLuxNote(null);
    const res = await luxTest();
    setLuxNote(res.ok ? `Respuesta correcta de ${res.data.model} en ${res.data.latencyMs} ms.` : res.message);
    setLuxBusy(false);
  };

  const refresh = useCallback(async () => {
    setLoad({ kind: 'loading' });
    const result = await integrationsServerStatus();
    setLoad(result.ok ? { kind: 'ready', status: result.data } : { kind: 'problem', message: result.message, missing: result.missing });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Clave de ElevenLabs que el servidor usa ahora. La lee de Supabase
  // (migración 0020) y la puede cambiar el administrador con los botones.
  useEffect(() => {
    let alive = true;
    rpc('eleven_active_slot', {})
      .then((slot) => {
        if (alive) {
          setElevenSlot(slot === 2 ? 2 : 1);
          setElevenSlotProblem(null);
        }
      })
      .catch(() => {
        if (alive) setElevenSlotProblem('No se pudo leer la clave activa: puede faltar la migración 0020 (claves de ElevenLabs) en Supabase.');
      });
    return () => {
      alive = false;
    };
  }, []);

  const setElevenKey = async (slot: 1 | 2) => {
    setElevenSlotBusy(true);
    try {
      const value = await rpc('admin_set_eleven_active_slot', { p_slot: slot });
      setElevenSlot(value === 2 ? 2 : 1);
      setElevenSlotProblem(null);
    } catch (err) {
      setElevenSlotProblem(err instanceof Error ? err.message : 'No se pudo cambiar la clave de ElevenLabs.');
    } finally {
      setElevenSlotBusy(false);
    }
  };

  const status = load.kind === 'ready' ? load.status : null;
  const r2 = R2_STATE[data.storageLoading ? 'unknown' : storageHealth(data.storage)];
  const spotifyReady = status !== null && status.spotifyMissing.length === 0 && status.database.length === 0;
  const kofiReady = status !== null && status.kofiMissing.length === 0 && status.database.length === 0;
  const elevenActive = elevenSlot !== null && (status ? (elevenSlot === 1 ? status.elevenKey1 : status.elevenKey2) : false);
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

        <ServiceCard
          mark="EL"
          name="ElevenLabs"
          status={elevenSlotProblem ? 'Sin datos' : elevenSlot === null ? 'Leyendo' : elevenActive ? `Activa (clave ${elevenSlot})` : 'Sin clave'}
          tone={elevenSlotProblem ? 'warn' : elevenActive ? 'on' : 'warn'}
          adminOnly
        >
          <p>Servicio de voces alternativo a Fish Audio. El servidor puede llevar dos claves y aquí se elige cuál se usa para sintetizar, importar y clonar voces.</p>
          {elevenSlotProblem && <p className="cab-note">{elevenSlotProblem}</p>}
          {elevenSlot !== null && (
            <div className="flex flex-wrap items-center gap-2">
              {([1, 2] as const).map((slot) => (
                <button
                  key={slot}
                  type="button"
                  className="cab-btn2 cab-btn-sm"
                  aria-pressed={elevenSlot === slot}
                  disabled={elevenSlotBusy || (status ? !(slot === 1 ? status.elevenKey1 : status.elevenKey2) : true)}
                  onClick={() => setElevenKey(slot)}
                >
                  Clave {slot}
                  {slot === 1 ? ' (ELEVENLABS_API_KEY)' : ' (ELEVENLABS_API_KEY_2)'}
                </button>
              ))}
            </div>
          )}
          <p className="cab-hint">
            {status
              ? !status.elevenKey1 && !status.elevenKey2
                ? 'Falta ELEVENLABS_API_KEY en el servidor: el motor de ElevenLabs no puede hablar.'
                : !status.elevenKey2
                  ? 'El servidor tiene solo la clave 1. Añade ELEVENLABS_API_KEY_2 como variable de entorno para poder alternar.'
                  : 'Las dos claves están en el servidor.'
              : 'Sin datos del servidor.'}{' '}
            Las voces de ElevenLabs pertenecen a la cuenta de su clave: al cambiar de clave, las voces creadas con la otra dejan de encontrarse hasta importarlas de nuevo.
          </p>
        </ServiceCard>

        <ServiceCard
          mark="NV"
          name="NVIDIA (Lux)"
          status={lux ? (lux.configured ? 'Configurada' : 'Sin clave') : luxProblem ? 'Sin datos' : 'Comprobando'}
          tone={lux ? (lux.configured && lux.vault ? 'on' : 'warn') : luxProblem ? 'warn' : undefined}
          adminOnly
        >
          <p>Modelo de lenguaje del personaje Lux: NVIDIA (build.nvidia.com) o Mistral AI. Pega aquí la clave del proveedor activo: el servidor la guarda cifrada y nunca vuelve a mostrarla.</p>
          {luxProblem && <p className="cab-note">{luxProblem}</p>}
          {lux && (
            <div className="cab-field">
              <label className="cab-label" htmlFor="adm-lux-provider">
                Proveedor de IA
              </label>
              <select
                id="adm-lux-provider"
                className="cab-inp"
                value={lux.provider}
                disabled={luxBusy}
                onChange={(e) => changeLuxProvider(e.target.value as LuxProviderId)}
              >
                {lux.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                    {lux.configuredByProvider[provider.id] ? '' : ' (sin clave)'}
                  </option>
                ))}
              </select>
              <span className="cab-hint">Mistral responde más rápido. Cada proveedor tiene su propia clave y su propio modelo.</span>
            </div>
          )}
          {lux && !lux.vault && (
            <p className="cab-error" role="alert">
              Falta INTEGRATIONS_ENC_KEY en el servidor: no se puede guardar la clave.
            </p>
          )}
          <div className="cab-field">
            <label className="cab-label" htmlFor="adm-lux-key-provider">
              Clave para
            </label>
            <select
              id="adm-lux-key-provider"
              className="cab-inp"
              value={keyTarget}
              disabled={luxBusy}
              onChange={(e) => setLuxKeyProvider(e.target.value as LuxProviderId)}
            >
              {(lux?.providers ?? []).map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                  {lux?.configuredByProvider[provider.id] ? ' (con clave)' : ' (sin clave)'}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="cab-field">
              <label className="cab-label" htmlFor="adm-lux-key">
                Clave de NVIDIA
              </label>
              <input
                id="adm-lux-key"
                type="password"
                className="cab-inp"
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  lux?.configuredByProvider[keyTarget]
                    ? 'Guardada · escribe una nueva para cambiarla'
                    : keyTarget === 'mistral'
                      ? 'Clave de Mistral'
                      : 'nvapi-…'
                }
                value={luxInput}
                disabled={luxBusy}
                onChange={(e) => setLuxInput(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="cab-btn2 cab-btn-sm"
              disabled={luxBusy || !lux?.vault || luxInput.trim() === ''}
              onClick={() => saveLuxKey(luxInput.trim(), keyTarget)}
            >
              Guardar clave
            </button>
            <button type="button" className="cab-btn2 cab-btn-sm" disabled={luxBusy || !lux?.configured} onClick={testLux}>
              Probar conexión
            </button>
            {lux?.configuredByProvider[keyTarget] && (
              <button type="button" className="cab-btn2 cab-btn-sm" disabled={luxBusy} onClick={() => saveLuxKey('', keyTarget)}>
                Borrar clave
              </button>
            )}
          </div>
          {luxNote && <p className="cab-note" role="status">{luxNote}</p>}
          <div className="cab-field">
            <label className="cab-label" htmlFor="adm-lux-release-note">
              Publicar actualización para los streams
            </label>
            <input
              id="adm-lux-release-note"
              className="cab-inp"
              maxLength={200}
              placeholder="Qué cambió, por ejemplo: nuevos comandos de Lux"
              value={releaseNote}
              disabled={luxBusy}
              onChange={(e) => setReleaseNote(e.target.value)}
            />
            <span className="cab-hint">
              Versión publicada: {release ? release.version : '…'}
              {release?.at ? ` · ${new Date(release.at).toLocaleString('es-ES')}` : ''}. Los overlays de OBS se recargan solos. Los bots avisan al
              arrancar para que cada streamer regenere su script en el estudio de TwitchIO.
            </span>
          </div>
          <button type="button" className="cab-btn2 cab-btn-sm" disabled={luxBusy} onClick={publishRelease}>
            Publicar actualización
          </button>
          {lux && lux.models.length > 0 && (
            <div className="cab-field">
              <label className="cab-label" htmlFor="adm-lux-model">
                Modelo por defecto
              </label>
              <select
                id="adm-lux-model"
                className="cab-inp"
                value={lux.model}
                disabled={luxBusy}
                onChange={(e) => changeLuxModel(e.target.value)}
              >
                {lux.models.filter((model) => model.enabled !== false).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="cab-hint">Cada streamer activa Mi AI desde su ficha en «Streamers». Los personajes y los modelos con su coste se gestionan en «Personajes».</p>
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
