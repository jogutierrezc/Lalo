/**
 * src/components/integraciones/RiotCard.tsx
 *
 * Ficha de Riot Games en «Integraciones»: el streamer escribe su Riot ID
 * (nombre#etiqueta), elige su servidor y Lalo lo vincula para que «Alertas de
 * juego» muestre lo que pasa en su cuenta de League of Legends. No hay inicio
 * de sesión de Riot ni contraseña: el servidor de Lalo resuelve el Riot ID con
 * su propia clave, que nunca llega aquí.
 *
 * Lleva el aviso de no afiliación que pide Riot, en inglés y en español. Ni
 * aquí ni en ninguna otra pantalla se dibuja un logotipo de Riot o de sus
 * juegos: el nombre va en texto.
 */

import React, { useCallback, useEffect, useId, useState } from 'react';
import { useCloudSession } from '../../hooks/useCloudSession';
import { riotLink, riotStatus, riotUnlink, type RiotStatus } from '../../lib/integrationsApi';
import { ServiceCard } from './ServiceCard';

type Load = { kind: 'loading' } | { kind: 'ready'; status: RiotStatus } | { kind: 'problem'; code: string; message: string; missing: string[] };

/** Texto oficial de Riot para productos de terceros, con el nombre del producto. No se traduce ni se recorta. */
export const RIOT_DISCLAIMER_EN =
  "Lalo Stream Suite isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";
export const RIOT_DISCLAIMER_ES =
  'Lalo Stream Suite no está respaldada por Riot Games y no refleja los puntos de vista ni las opiniones de Riot Games ni de nadie que participe oficialmente en la producción o la gestión de las propiedades de Riot Games. Riot Games y todas las propiedades asociadas son marcas comerciales o marcas registradas de Riot Games, Inc.';

const DEFAULT_PLATFORM = 'la1';

export const RiotCard: React.FC = () => {
  const cloud = useCloudSession();
  const uid = useId();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [riotId, setRiotId] = useState('');
  const [platform, setPlatform] = useState(DEFAULT_PLATFORM);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await riotStatus();
    setLoad(result.ok ? { kind: 'ready', status: result.data } : { kind: 'problem', code: result.code, message: result.message, missing: result.missing });
  }, []);

  useEffect(() => {
    if (cloud.enabled) refresh();
  }, [cloud.enabled, refresh]);

  const status = load.kind === 'ready' ? load.status : null;
  const linked = status?.state === 'linked';
  const platformName = status?.platforms.find((item) => item.id === status.platform)?.name ?? status?.platform ?? '';

  const link = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!riotId.includes('#')) {
      setMessage('Escribe tu Riot ID completo, con la etiqueta: nombre#etiqueta.');
      return;
    }
    setBusy(true);
    const result = await riotLink(riotId, platform);
    setBusy(false);
    if (!result.ok) {
      setMessage(`${result.message}${result.missing.length ? ` Falta: ${result.missing.join(', ')}.` : ''}`);
      return;
    }
    setLoad({ kind: 'ready', status: result.data });
    setRiotId('');
    setMessage('Cuenta vinculada. Las alertas empiezan a salir con lo que pase a partir de ahora.');
  };

  const unlink = async () => {
    setBusy(true);
    const result = await riotUnlink();
    setBusy(false);
    setMessage(result.ok ? 'Cuenta desvinculada. Tu Riot ID se borró del servidor y las alertas dejan de salir.' : result.message);
    refresh();
  };

  const label = !cloud.enabled ? 'Sin la nube' : load.kind === 'loading' ? 'Comprobando' : linked ? 'Vinculada' : 'Sin vincular';
  const intro = 'Vincula tu Riot ID para que «Alertas de juego» muestre en pantalla tus victorias, tus cambios de rango y tus jugadas de League of Legends.';

  return (
    <ServiceCard mark="RG" name="Riot Games" status={label} tone={linked ? 'on' : undefined}>
      {!cloud.enabled && (
        <>
          <p>{intro}</p>
          <p className="cab-note">
            Este despliegue no tiene la nube encendida, así que no hay cuenta de Lalo a la que vincular un Riot ID. La placa se puede probar con datos de
            ejemplo en{' '}
            <a className="studio-link" href="#juego">
              Alertas de juego
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
          <p>{intro}</p>
          <p className="cab-note" role="status">
            Todavía no se puede vincular: al servidor de Lalo le falta configuración ({status.missing.join(', ')}). La añade quien administra Lalo.
            Mientras tanto, la placa se puede probar con datos de ejemplo en{' '}
            <a className="studio-link" href="#juego">
              Alertas de juego
            </a>
            .
          </p>
        </>
      )}

      {status?.configured && !linked && (
        <form className="grid gap-[14px]" onSubmit={link}>
          <p>{intro}</p>
          <div className="cab-field">
            <label className="cab-label" htmlFor={`${uid}-id`}>
              Riot ID
            </label>
            <input
              id={`${uid}-id`}
              type="text"
              className="cab-inp"
              placeholder="nombre#etiqueta"
              maxLength={40}
              spellCheck={false}
              autoComplete="off"
              value={riotId}
              onChange={(e) => setRiotId(e.target.value)}
            />
            <span className="cab-hint">Es el nombre que ves en el cliente de Riot, con la etiqueta de detrás de la almohadilla. Por ejemplo: Lalo#LAN.</span>
          </div>
          <div className="cab-field">
            <label className="cab-label" htmlFor={`${uid}-platform`}>
              Servidor
            </label>
            <select id={`${uid}-platform`} className="cab-inp" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {status.platforms.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <span className="cab-hint">El servidor de League of Legends en el que juegas con esa cuenta.</span>
          </div>
          <ul className="ic-perm">
            <li data-y="">
              <b>SÍ</b>
              <span>Leer el rango, la partida en curso, tu última partida y tu maestría de esa cuenta</span>
            </li>
            <li>
              <b>NO</b>
              <span>Ver datos de tus rivales ni de tus compañeros de partida</span>
            </li>
            <li>
              <b>NO</b>
              <span>Pedir tu contraseña de Riot ni entrar en tu cuenta</span>
            </li>
          </ul>
          <div className="ic-row">
            <button type="submit" className="cab-btn cab-btn-sm" disabled={busy || !riotId.trim()}>
              {busy ? 'Buscando la cuenta' : 'Vincular'}
            </button>
          </div>
          <p className="cab-hint">
            No hay inicio de sesión de Riot: Lalo busca la cuenta por su Riot ID, que es un dato público. Vincula solo tu propia cuenta.
          </p>
        </form>
      )}

      {status && linked && (
        <>
          <p>
            Vinculada con <span className="ic-who">{status.riotId}</span>
            {platformName ? ` · ${platformName}` : ''}
          </p>
          <ul className="ic-perm">
            <li data-y="">
              <b>SÍ</b>
              <span>Leer el rango, la partida en curso, tu última partida y tu maestría de esa cuenta</span>
            </li>
            <li>
              <b>NO</b>
              <span>Ver datos de tus rivales ni de tus compañeros de partida</span>
            </li>
          </ul>
          <p className="cab-hint">
            Lalo guarda en su servidor tu Riot ID, tu servidor y el identificador que Riot da a esa cuenta. Al desvincular se borran. Las alertas no llegan
            al instante: Riot informa al terminar la partida y la capa pregunta cada medio minuto.
          </p>
          <div className="ic-row">
            <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={unlink}>
              Desvincular
            </button>
            <a className="cab-btn2 cab-btn-sm" href="#juego">
              Ajustar las alertas
            </a>
          </div>
        </>
      )}

      {message && (
        <p className="cab-hint" role="status">
          {message}
        </p>
      )}

      {/* Aviso de no afiliación: el texto oficial en inglés y su traducción */}
      <p className="cab-hint" lang="en">
        {RIOT_DISCLAIMER_EN}
      </p>
      <p className="cab-hint">{RIOT_DISCLAIMER_ES}</p>
    </ServiceCard>
  );
};
