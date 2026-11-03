/**
 * src/components/done/DoneBotStrip.tsx
 *
 * Franja de estado del bot arriba de la pantalla de Done: cuenta de Twitch, permiso del chat y bot
 * activo o apagado, con el botón para conectarlo o apagarlo. Usa el mismo estado en la nube que la
 * pantalla del bot (useBotCloud + botSteps); no duplica su lógica. En modo demo no hay servidor y el
 * botón solo cambia el estado de muestra.
 */

import React, { useState } from 'react';
import { Boton } from '../tally-ui';
import { useBotCloud } from '../../hooks/useBotCloud';
import { signInWithTwitch } from '../../lib/cloud';
import type { BotConnectionView } from '../../lib/botApi';
import { botStripView } from './layoutLogic';

// Aquí no se importan los comandos de este navegador: eso lo hace la pantalla del bot.
const NO_LOCAL = { commands: [], prefix: '!', hasSaved: false };

const DEMO_CONNECTION = (enabled: boolean): BotConnectionView => ({ hasChannel: true, twitchLogin: 'gaby_live', chat: 'enabled', enabled, globalAvailable: false });

interface Props {
  /** Id del perfil con cuenta activa; vacío si no hay nube. */
  accountId: string;
  demo: boolean;
  /** Se pinta a la derecha, antes del botón (el estado del guardado). */
  trailing?: React.ReactNode;
}

export const DoneBotStrip: React.FC<Props> = ({ accountId, demo, trailing }) => {
  const bot = useBotCloud(Boolean(accountId) && !demo, accountId, NO_LOCAL);
  const [demoOn, setDemoOn] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  const connection = demo ? DEMO_CONNECTION(demoOn) : accountId && bot.phase === 'ready' ? bot.connection : null;
  const view = botStripView(connection);
  const busy = bot.busy;

  const connect = async () => {
    setMessage(null);
    if (demo) return setDemoOn(true);
    const res = await bot.connect();
    if ('error' in res) return setMessage({ text: res.error, bad: true });
    if (res.outcome === 'no_permission') {
      setMessage({ text: 'Twitch necesita que aceptes el permiso del bot. Te llevamos a Twitch; cuando vuelvas, pulsa «Conectar el bot» otra vez.', bad: false });
      try {
        await signInWithTwitch({ returnHere: true });
      } catch (err) {
        setMessage({ text: err instanceof Error ? `No se pudo abrir Twitch: ${err.message}` : 'No se pudo abrir Twitch.', bad: true });
      }
      return;
    }
    if (res.outcome === 'error') return setMessage({ text: res.detail || 'Twitch no dejó conectar el bot. Prueba de nuevo en un momento.', bad: true });
    setMessage({ text: 'Hecho. Twitch tarda unos segundos en comprobar la conexión.', bad: false });
  };

  const disconnect = async () => {
    setMessage(null);
    if (demo) return setDemoOn(false);
    const problem = await bot.disconnect();
    setMessage(problem ? { text: problem, bad: true } : { text: 'Bot apagado. Ya no escucha ni responde en tu chat.', bad: false });
  };

  const loadFailed = !demo && Boolean(accountId) && bot.phase === 'error';

  return (
    <div className="done-bot">
      {view.steps.map((step) => (
        <span key={step.id} className="done-bot-step" data-ok={step.ok ? '1' : '0'}>
          <i aria-hidden="true" />
          {step.label}
        </span>
      ))}
      <span className="sp" />
      {trailing}
      {view.action === 'open-bot' && (
        <a className="tui-btn" data-variante="principal" data-sm="" href="#twitchio">
          {view.actionLabel}
        </a>
      )}
      {view.action === 'connect' && (
        <Boton variante="principal" pequeno disabled={busy} onClick={() => void connect()}>
          {view.actionLabel}
        </Boton>
      )}
      {view.action === 'disconnect' && (
        <Boton pequeno disabled={busy} onClick={() => void disconnect()}>
          {view.actionLabel}
        </Boton>
      )}
      {loadFailed && (
        <Boton pequeno onClick={() => void bot.reload()}>
          Reintentar
        </Boton>
      )}
      {(message || view.hint || loadFailed) && (
        <p className="done-bot-msg" role="status" data-tone={message?.bad || loadFailed ? 'bad' : undefined}>
          {message?.text ?? (loadFailed ? `No se pudo leer el estado del bot: ${bot.loadError}` : view.hint)}
        </p>
      )}
    </div>
  );
};
