/**
 * src/components/integraciones/KofiCard.tsx
 *
 * Ficha de Ko-fi en «Integraciones». Ko-fi no tiene inicio de sesión para apps:
 * el streamer copia aquí su dirección personal de Lalo, la pega en su Ko-fi y
 * pega en Lalo la clave de verificación que Ko-fi le da.
 *
 * Estados: sin conectar, conectando (dirección creada, falta la clave),
 * esperando el primer aviso y conectado.
 */

import React, { useCallback, useEffect, useId, useState } from 'react';
import { useCloudSession } from '../../hooks/useCloudSession';
import { kofiAction, kofiStatus, type KofiPanelAction, type KofiStatus } from '../../lib/integrationsApi';
import { ServiceCard, type CardTone } from './ServiceCard';

type Load = { kind: 'loading' } | { kind: 'ready'; status: KofiStatus } | { kind: 'problem'; message: string; missing: string[] };

const formatWhen = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString('es', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';

const STATE_LABEL: Record<KofiStatus['state'], string> = {
  none: 'Sin conectar',
  address: 'Conectando',
  waiting: 'Esperando el primer aviso',
  connected: 'Conectado',
};

export const KofiCard: React.FC = () => {
  const cloud = useCloudSession();
  const uid = useId();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const [changing, setChanging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await kofiStatus();
    setLoad(result.ok ? { kind: 'ready', status: result.data } : { kind: 'problem', message: result.message, missing: result.missing });
  }, []);

  useEffect(() => {
    if (cloud.enabled) refresh();
  }, [cloud.enabled, refresh]);

  const run = async (action: KofiPanelAction, done: string, body?: Record<string, unknown>) => {
    setBusy(true);
    const result = await kofiAction(action, body);
    setBusy(false);
    if (!result.ok) {
      setMessage(`${result.message}${result.missing.length ? ` Falta en el servidor: ${result.missing.join(', ')}.` : ''}`);
      return false;
    }
    setLoad({ kind: 'ready', status: result.data });
    setMessage(done);
    return true;
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Dirección copiada.');
    } catch {
      setMessage('No se pudo copiar: selecciónala a mano.');
    }
  };

  const saveToken = async () => {
    if (!token.trim()) return setMessage('Falta la clave de verificación.');
    if (await run('token', 'Clave guardada. Falta que Ko-fi envíe el primer aviso.', { token: token.trim() })) {
      setToken('');
      setChanging(false);
    }
  };

  const status = load.kind === 'ready' ? load.status : null;
  const state = status?.configured ? status.state : 'none';
  const tone: CardTone | undefined = state === 'connected' ? 'on' : state === 'waiting' ? 'soon' : undefined;
  const label = !cloud.enabled ? 'Sin la nube' : load.kind === 'loading' ? 'Comprobando' : STATE_LABEL[state];

  const address = status?.url ? (
    <>
      <code className="ic-addr">{status.url}</code>
      <div className="ic-row">
        <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => copy(status.url)}>
          Copiar dirección
        </button>
      </div>
      {status.localUrl && (
        <p className="cab-hint">
          Esta dirección usa el sitio desde el que has abierto el panel. Ko-fi necesita una dirección pública: solo funciona en la app publicada.
        </p>
      )}
    </>
  ) : null;

  const tokenField = (
    <>
      <label htmlFor={`${uid}-tok`}>Pega aquí la clave de verificación que te muestra Ko-fi en esa misma página.</label>
      <input
        id={`${uid}-tok`}
        className="cab-inp"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="clave de verificación"
        value={token}
        maxLength={200}
        onChange={(e) => setToken(e.target.value)}
      />
    </>
  );

  return (
    <ServiceCard mark="KF" name="Ko-fi" status={label} tone={tone}>
      {!cloud.enabled && (
        <>
          <p>Recibe en pantalla las donaciones, membresías, pedidos y comisiones de tu Ko-fi.</p>
          <p className="cab-note">
            Este despliegue no tiene la nube encendida, así que no hay cuenta de Lalo a la que Ko-fi pueda avisar. Las alertas se pueden probar con
            avisos de ejemplo en{' '}
            <a className="studio-link" href="#kofi">
              Ko-fi
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
          <p>Recibe en pantalla las donaciones, membresías, pedidos y comisiones de tu Ko-fi.</p>
          <p className="cab-note" role="status">
            Todavía no se puede conectar: al servidor de Lalo le falta configuración ({status.missing.join(', ')}). La añade quien administra Lalo.
            Mientras tanto, las alertas se pueden probar con avisos de ejemplo en{' '}
            <a className="studio-link" href="#kofi">
              Ko-fi
            </a>
            .
          </p>
        </>
      )}

      {status?.configured && state === 'none' && (
        <>
          <p>Recibe en pantalla las donaciones, membresías, pedidos y comisiones de tu Ko-fi.</p>
          <div className="ic-row">
            <button type="button" className="cab-btn cab-btn-sm" disabled={busy} onClick={() => run('connect', '')}>
              Conectar
            </button>
          </div>
        </>
      )}

      {status?.configured && state === 'address' && (
        <>
          <ol className="ic-steps">
            <li>
              Copia tu dirección personal de Lalo. Es privada: quien la tenga podría intentar enviar avisos falsos.
              {address}
            </li>
            <li>En Ko-fi, entra en Más, API y webhooks, y pégala en el campo de la dirección del webhook.</li>
            <li>{tokenField}</li>
          </ol>
          <div className="ic-row">
            <button type="button" className="cab-btn cab-btn-sm" disabled={busy} onClick={saveToken}>
              Guardar
            </button>
            <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={() => run('disconnect', 'No se conectó nada.')}>
              Cancelar
            </button>
          </div>
        </>
      )}

      {status?.configured && state === 'waiting' && (
        <>
          <p>
            Dirección y clave guardadas. Falta que Ko-fi envíe el primer aviso: en su página de webhooks hay un botón para mandar uno de prueba. Después
            pulsa «Volver a comprobar».
          </p>
          {address}
        </>
      )}

      {status?.configured && state === 'connected' && (
        <>
          <p>Conectado. Último aviso recibido: {formatWhen(status.lastEventAt)}.</p>
          {address}
          <p className="cab-hint">
            Lalo guarda cifradas en su servidor tu dirección y tu clave de verificación. No guarda correos ni direcciones de envío de quien te apoya.
          </p>
        </>
      )}

      {status?.configured && (state === 'waiting' || state === 'connected') && (
        <>
          {status.badTokenAt && (
            <p className="cab-note" role="status">
              El {formatWhen(status.badTokenAt)} llegó un aviso con una clave que no coincide con la guardada, y se descartó. Si era tuyo, copia de
              nuevo la clave de Ko-fi y guárdala.
            </p>
          )}
          {changing && (
            <div className="cab-field">
              {tokenField}
              <div className="ic-row">
                <button type="button" className="cab-btn cab-btn-sm" disabled={busy} onClick={saveToken}>
                  Guardar la clave
                </button>
                <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => setChanging(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
          <div className="ic-row">
            <button
              type="button"
              className="cab-btn2 cab-btn-sm"
              disabled={busy}
              onClick={async () => {
                await refresh();
                setMessage('Estado actualizado.');
              }}
            >
              Volver a comprobar
            </button>
            {!changing && (
              <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={() => setChanging(true)}>
                Cambiar la clave
              </button>
            )}
            <button
              type="button"
              className="cab-btn2 cab-btn-sm"
              disabled={busy}
              onClick={() => run('regenerate', 'Dirección nueva. La anterior ya no funciona: pega la nueva en Ko-fi.')}
            >
              Generar otra dirección
            </button>
            <button
              type="button"
              className="cab-btn2 cab-btn-sm"
              disabled={busy}
              onClick={() => run('disconnect', 'Ko-fi desconectado. La dirección y la clave se borraron del servidor.')}
            >
              Desconectar
            </button>
            <a className="cab-btn2 cab-btn-sm" href="#kofi">
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
      <p className="cab-hint">
        Sin límite de cuentas: cada streamer conecta su propio Ko-fi con una dirección y una clave suyas. No hay inicio de sesión con Ko-fi.
      </p>
    </ServiceCard>
  );
};
