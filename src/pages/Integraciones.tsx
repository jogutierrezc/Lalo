/**
 * src/pages/Integraciones.tsx
 *
 * Página «Integraciones»: una ficha por servicio, con su estado (conectado, sin
 * conectar, próximamente o no disponible). Spotify, Ko-fi y Riot Games se
 * conectan aquí de verdad; Twitch enseña la cuenta con la que se entró y los permisos concedidos.
 *
 * Las fichas de estado del servidor (Fish Audio, Cloudflare R2 y la
 * configuración de Spotify y Ko-fi) son solo para el administrador y viven en
 * su consola: #admin/integraciones.
 */

import React, { useEffect, useState } from 'react';
import { SuiteNav } from '../components/SuiteNav';
import { KofiCard } from '../components/integraciones/KofiCard';
import { RiotCard } from '../components/integraciones/RiotCard';
import { ServiceCard } from '../components/integraciones/ServiceCard';
import { SpotifyCard } from '../components/integraciones/SpotifyCard';
import { useCloudSession } from '../hooks/useCloudSession';
import { hasTwitchIdentity } from '../lib/access';
import { signInWithTwitch } from '../lib/cloud';
import { validateTwitchToken } from '../lib/twitchEventsApi';
import { loadPowerupsSettings } from '../types/powerups';
import { loadSettings } from '../types/settings';
import { EVENT_SCOPES, missingScopes } from '../utils/twitchEvents';
import '../styles/integraciones.css';

/** Twitch: la cuenta con la que se entró en Lalo y qué puede leer Lalo de ella. */
const TwitchCard: React.FC = () => {
  const cloud = useCloudSession();
  const account = cloud.enabled && cloud.profile?.status === 'active' ? cloud.profile : null;
  const withTwitch = Boolean(account && cloud.session && hasTwitchIdentity(cloud.session.user));
  const token = cloud.session?.provider_token ?? null;
  // Twitch solo deja ver los permisos un rato después de entrar; si no, vale lo último que se supo
  const [scopes, setScopes] = useState<string[] | null>(() => loadPowerupsSettings().scopes);
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!withTwitch || !token) return;
    let alive = true;
    validateTwitchToken(token).then((info) => {
      if (!alive || !info) return;
      setScopes(info.scopes);
      setFresh(true);
    });
    return () => {
      alive = false;
    };
  }, [withTwitch, token]);

  const authorize = async () => {
    setBusy(true);
    try {
      await signInWithTwitch();
    } catch (err) {
      setBusy(false);
      setMessage(err instanceof Error ? `No se pudo abrir Twitch: ${err.message}` : 'No se pudo abrir Twitch.');
    }
  };

  if (!cloud.enabled) {
    return (
      <ServiceCard mark="TW" name="Twitch" status="Sin la nube">
        <p>Con la nube encendida, aquí aparece la cuenta de Twitch con la que entras en Lalo y los permisos que le has dado.</p>
        <p className="cab-hint">Sin la nube, las capas leen el chat de tu canal sin iniciar sesión: basta con escribir el nombre del canal en Inicio.</p>
      </ServiceCard>
    );
  }
  if (!withTwitch) {
    return (
      <ServiceCard mark="TW" name="Twitch" status="Sin conectar">
        <p>Esta cuenta de Lalo no está conectada a un canal de Twitch.</p>
      </ServiceCard>
    );
  }

  const missing = missingScopes(scopes);
  return (
    <ServiceCard mark="TW" name="Twitch" status="Conectado" tone="on">
      <p>
        Conectado como <span className="ic-who">{account?.twitch_login || account?.display_name || 'tu canal'}</span>
      </p>
      <ul className="ic-perm">
        <li data-y="">
          <b>SÍ</b>
          <span>Identificarte en Lalo con tu cuenta de Twitch</span>
        </li>
        {EVENT_SCOPES.map((item) => {
          const granted = missing !== null && !missing.includes(item.scope);
          return (
            <li key={item.scope} data-y={granted ? '' : undefined}>
              <b>{missing === null ? '?' : granted ? 'SÍ' : 'NO'}</b>
              <span>{item.what.charAt(0).toUpperCase() + item.what.slice(1)}</span>
            </li>
          );
        })}
      </ul>
      <div className="ic-row">
        <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={authorize}>
          {busy ? 'Abriendo Twitch' : 'Volver a autorizar'}
        </button>
        <a className="cab-btn2 cab-btn-sm" href="#powerups">
          Canal de eventos
        </a>
      </div>
      <p className="cab-hint" role="status">
        {message ||
          (missing === null
            ? 'Ahora no se pueden comprobar los permisos: Twitch solo deja verlos un rato después de entrar. Pulsa «Volver a autorizar» para mirarlos.'
            : fresh
              ? 'Permisos comprobados ahora mismo con Twitch. Son de solo lectura.'
              : 'Es lo que había la última vez que se pudo comprobar. Para mirarlo ahora, pulsa «Volver a autorizar».')}
      </p>
    </ServiceCard>
  );
};

export const Integraciones: React.FC = () => {
  const [voice] = useState(loadSettings);

  return (
    <div className="cab">
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav currentApp="integraciones" channel={voice.channel} />

        <p className="ig-lede">
          Conecta cuentas de otros servicios. Cada ficha dice con qué cuenta está conectada, qué puede leer Lalo y cómo desconectarla. Las capas que
          usan estos servicios se ajustan en «Ahora suena», «Ko-fi» y «Alertas de juego».
        </p>

        <div className="ig">
          <SpotifyCard />
          <KofiCard />
          <RiotCard />
          <TwitchCard />

          <ServiceCard mark="LF" name="Last.fm" status="Próximamente" tone="soon">
            <p>
              Un puente para quien no usa Spotify. Apple Music y YouTube Music pueden enviar lo que escuchas a Last.fm (scrobbling), y Lalo leería de
              ahí la canción para la misma capa.
            </p>
            <p className="cab-hint">Pendiente de verificar: cómo se activa el envío a Last.fm desde cada servicio y con qué retraso llega.</p>
          </ServiceCard>

          <ServiceCard mark="AM" name="Apple Music" status="No disponible">
            <p>
              Pendiente de verificar: no está confirmado en la documentación de Apple que un servidor pueda leer lo que suena ahora en la cuenta de un
              usuario.
            </p>
          </ServiceCard>

          <ServiceCard mark="YT" name="YouTube Music" status="No disponible">
            <p>Pendiente de verificar: no está confirmado que exista una API pública oficial que diga qué suena en una cuenta de YouTube Music.</p>
          </ServiceCard>
        </div>

        <section className="cab-mod ic">
          <h2>Cómo funciona y qué se guarda</h2>
          <ul className="ic-facts">
            <li>
              <b>Spotify:</b> aceptas un solo permiso en la página de Spotify, el de leer lo que estás reproduciendo (<code>user-read-currently-playing</code>
              ). No permite controlar la reproducción ni ver listas o biblioteca.
            </li>
            <li>
              <b>Por qué se guarda algo en el servidor:</b> el navegador de OBS no tiene sesión, así que no puede hablar con Spotify. El servidor de Lalo
              guarda cifrado tu permiso y es quien pregunta. OBS solo recibe título, artista, álbum, portada y tiempos.
            </li>
            <li>
              <b>Retraso:</b> Spotify no avisa de los cambios, hay que preguntar. La capa pregunta cada 5 segundos, así que un cambio de canción tarda
              entre 1 y 10 segundos en verse.
            </li>
            <li>
              <b>Ko-fi:</b> pegas en tu Ko-fi una dirección personal de Lalo, y Ko-fi envía ahí cada pago con una clave de verificación que solo
              conocéis tú y Lalo. Lalo comprueba la clave y descarta lo que no coincida.
            </li>
            <li>
              <b>Privacidad en Ko-fi:</b> si el apoyo no es público, sale como «Alguien», sin mensaje, y la voz no lo lee. El correo y la dirección de
              envío que manda Ko-fi no se guardan ni se muestran nunca.
            </li>
            <li>
              <b>Riot Games:</b> escribes tu Riot ID y eliges tu servidor; no hay contraseña ni inicio de sesión de Riot. El servidor de Lalo guarda tu
              Riot ID, tu servidor y el identificador que Riot da a esa cuenta, y con su propia clave pregunta por tu rango, tu partida en curso, tu
              última partida y tu maestría. De cada partida solo se leen tus datos, nunca los de rivales o compañeros.
            </li>
            <li>
              <b>Retraso en Riot:</b> Riot no avisa de los cambios y publica el resultado al terminar la partida. La capa pregunta cada medio minuto,
              así que una alerta puede tardar entre uno y dos minutos. Las partidas y el rango no se guardan en la base de datos de Lalo.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
};
