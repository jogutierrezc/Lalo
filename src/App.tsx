/**
 * src/App.tsx
 *
 * Enrutador principal de Tally Studio.
 * Soporta navegación por hash y rutas limpias para OBS:
 *   - #catalogo / #suite / raíz: Catálogo general de herramientas
 *   - #tts / #ajustes: Mesa de configuración de Text-to-Speech
 *   - #control: Mesa de control en vivo durante el stream
 *   - #alertas: Estudio de Alertas de Stream (Follow, Sub, Bits, Raid)
 *   - #chat: Estudio de la capa Chat en vivo
 *   - #raid: Estudio del saludo de raid con corto
 *   - #studio: Studio, el editor de escenas (cada escena, una URL para OBS)
 *   - #powerups: Power-ups de Twitch y canal de eventos (bits, Power-ups y canjes sin texto)
 *   - #mascotas: Mascotas, el personaje que reacciona con voz a canjes, bits y al chat
 *   - #juego: Alertas de juego, la placa con lo que pasa en la cuenta de Riot del streamer
 *   - #torneos: Torneos, la llave de eliminación directa con sus pantallas para OBS
 *   - #torneo/<slug>: inscripción de un torneo. Página pública: se ve sin iniciar sesión
 *   - #integraciones: galería de servicios conectados (Spotify, Ko-fi, Twitch...)
 *   - #musica: estudio de la capa «Ahora suena»
 *   - #kofi: estudio de las alertas y capas fijas de Ko-fi
 *   - #twitchio / #bot: Estudio de Bot y EventSub (Powered by TwitchIO)
 *   - #cuenta: Mi cuenta del streamer (con la nube)
 *   - #admin, #admin/...: consola del administrador. Quien tiene rol de
 *     administrador solo ve esa consola; a un streamer, #admin lo lleva a Inicio
 *   - Bienvenida: un streamer que entra con Twitch y aún no la terminó la ve
 *     antes del panel, escriba la dirección que escriba. El administrador no la ve
 *   - #legal, #legal/voces...: Términos y políticas. Página pública: se ve sin iniciar sesión
 *   - Aceptación: con la nube, una cuenta activa que no aceptó la versión vigente de los
 *     términos los ve antes de su panel o su consola (las cuentas nuevas, en la bienvenida)
 *   - #nube: Qué falta para encender la nube (sin la nube configurada)
 *   - #widget / /widget / ?channel=: Overlay transparente para OBS Studio
 */

import React, { useState, useEffect, Suspense, lazy } from 'react';
import { AceptacionCargando, AceptacionGate } from './pages/AceptacionGate';
import { useAceptacion } from './hooks/useAceptacion';

const Widget = lazy(() => import('./pages/Widget').then((m) => ({ default: m.Widget })));
const Access = lazy(() => import('./pages/Access').then((m) => ({ default: m.Access })));
const Bienvenida = lazy(() => import('./pages/Bienvenida').then((m) => ({ default: m.Bienvenida })));
const AdminShell = lazy(() => import('./components/admin/AdminShell').then((m) => ({ default: m.AdminShell })));
const Legal = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Legal })));
const TournamentSignup = lazy(() => import('./pages/TournamentSignup').then((m) => ({ default: m.TournamentSignup })));
import { parseRutaLegal } from './legal/logica';
import { AppShell } from './components/shell/AppShell';
import { matchTool, type ToolId } from './lib/tools';
import { CloudProvider, useCloudSession } from './hooks/useCloudSession';
import { readWidgetKey, startWidgetCloud } from './lib/widgetCloud';
import { isCloudEnabled } from './lib/supabase';
import { takeReturnHash } from './lib/cloud';
import { hasTwitchIdentity } from './lib/access';
import { BienvenidaTally } from './components/welcome/BienvenidaTally';
import { bienvenidaHechaAqui, necesitaRecorrido } from './lib/recorrido';
import { selectPanelTournamentStore, startWidgetTournament } from './lib/tournamentCloud';
import { parseSignupRoute } from './utils/tournamentSignup';

export type AppRoute =
  | 'catalogo'
  | 'herramientas'
  | 'control'
  | ToolId
  | 'integraciones'
  | 'cuenta'
  | 'admin'
  | 'nube'
  | 'legal'
  | 'inscripcion'
  | 'widget';

function resolveRoute(): AppRoute {
  const path = window.location.pathname.toLowerCase();
  const rawHash = window.location.hash.toLowerCase();
  // Limpiar '#' inicial y cualquier barra del hash: '#/control' -> 'control', '#tts' -> 'tts'
  const hash = rawHash.replace(/^#\/?/, '').replace(/\/$/, '');
  const search = window.location.search.toLowerCase();

  // Términos y políticas: página pública
  if (parseRutaLegal(rawHash)) return 'legal';
  // Inscripción de un torneo: página pública. Sin slug, #torneo es el panel (más abajo)
  if (parseSignupRoute(rawHash)) return 'inscripcion';

  // Herramientas (alias en src/lib/tools.ts): voz, alertas, recompensas, metas, bot, ruleta, batallas,
  // chat, raid, studio, power-ups, mascotas, juego y torneos. Tienen prioridad ante cualquier query param
  const early = matchTool(hash, path, 'early');
  if (early) return early;

  // Cuenta del streamer y portal de administración (solo con la nube configurada)
  if (hash.startsWith('cuenta')) return 'cuenta';
  if (hash.startsWith('admin')) return 'admin';
  // Qué falta para encender la nube (solo cuando no está configurada)
  if (hash.startsWith('nube')) return 'nube';

  // 8. Control en vivo del TTS
  if (hash.startsWith('control') || path.includes('/control')) {
    return 'control';
  }

  // Lanzador de herramientas
  if (/^herramientas([?/]|$)/.test(hash)) return 'herramientas';
  // Integraciones: la galería de servicios; después «Ahora suena», Ko-fi, Mi AI y Done
  if (/^integraciones([?/]|$)/.test(hash)) return 'integraciones';
  const late = matchTool(hash, path, 'late');
  if (late) return late;

  // 9. Fuentes de navegador para OBS Studio
  if (
    path.includes('/widget') ||
    hash.startsWith('widget') ||
    (!hash && search.includes('channel='))
  ) {
    return 'widget';
  }

  // 10. Dashboard de la Suite / Catálogo (por defecto para raíz, #dashboard, #catalogo, #suite)
  return 'catalogo';
}

const Routes: React.FC = () => {
  const [currentRoute, setCurrentRoute] = useState<AppRoute>(resolveRoute);

  // Al volver de Twitch se aterriza en la raíz: se regresa a la página desde la que se salió
  useEffect(() => {
    const back = takeReturnHash();
    if (back && !window.location.hash) window.location.hash = back;
  }, []);

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentRoute(resolveRoute());
    };

    window.addEventListener('hashchange', handleLocationChange);
    window.addEventListener('popstate', handleLocationChange);

    return () => {
      window.removeEventListener('hashchange', handleLocationChange);
      window.removeEventListener('popstate', handleLocationChange);
    };
  }, []);

  const cloud = useCloudSession();
  // Cuentas que terminaron la bienvenida en esta visita (por si no se pudo guardar en ningún sitio)
  const [bienvenidas, setBienvenidas] = useState<string[]>([]);
  // El streamer pidió escribir un código de recuperación en vez de uno de invitación
  const [recuperando, setRecuperando] = useState(false);
  const sinSesion = !cloud.session;
  useEffect(() => {
    if (sinSesion) setRecuperando(false);
  }, [sinSesion]);

  // Las capas de OBS leen la configuración del streamer con la clave de su URL
  const isWidget = currentRoute === 'widget';
  const [widgetReady, setWidgetReady] = useState(() => !(isCloudEnabled && readWidgetKey()));
  useEffect(() => {
    const key = isWidget && isCloudEnabled ? readWidgetKey() : null;
    if (!key) return;
    let stop: (() => void) | null = null;
    let alive = true;
    // A la vez que la configuración, el estado vivo del torneo: su almacén pasa a ser el de la nube
    Promise.all([startWidgetCloud(key), startWidgetTournament(key)]).then(([stopSync, stopTournament]) => {
      const stopAll = () => {
        stopSync();
        stopTournament();
      };
      if (alive) {
        stop = stopAll;
        setWidgetReady(true);
      } else {
        stopAll();
      }
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, [isWidget]);

  // Qué documentos legales le falta aceptar a la cuenta que ha entrado (solo con la nube)
  const aceptacion = useAceptacion(cloud.enabled && !isWidget && cloud.session ? (cloud.profile?.id ?? null) : null);

  // Las capas de OBS nunca piden iniciar sesión
  if (isWidget) return widgetReady ? <Widget /> : null;

  // Estado vivo de «Torneos»: con una cuenta de streamer activa, el panel lo guarda en la nube.
  // Va aquí y no en un efecto porque la página lee el almacén al montarse; repetirlo no hace nada.
  selectPanelTournamentStore(
    cloud.enabled && cloud.session && cloud.profile?.status === 'active' && cloud.profile.role !== 'admin' ? cloud.profile.id : null
  );

  // Los términos y políticas se leen sin iniciar sesión y con la nube apagada
  if (currentRoute === 'legal') return <Legal />;
  // La inscripción de un torneo la abre gente sin cuenta: tampoco pasa por el acceso
  if (currentRoute === 'inscripcion') return <TournamentSignup />;

  // Bienvenida: el streamer que entró con Twitch y aún no la terminó (o aún no canjeó su código)
  if (cloud.enabled && cloud.session && cloud.profile) {
    const perfil = cloud.profile;
    const hechaAqui = bienvenidas.includes(perfil.id) || bienvenidaHechaAqui(perfil.id);
    if (necesitaRecorrido(perfil, hasTwitchIdentity(cloud.session.user), hechaAqui)) {
      // El paso de los términos necesita saber qué aceptó ya la cuenta
      if (aceptacion.cargando) return <AceptacionCargando />;
      if (recuperando && perfil.status === 'pending') {
        return <Access inicio="recovery-code" onVolver={() => setRecuperando(false)} />;
      }
      return (
        <Bienvenida
          onTerminar={(perfilId) => setBienvenidas((prev) => (prev.includes(perfilId) ? prev : [...prev, perfilId]))}
          onRecuperar={() => setRecuperando(true)}
          aceptacion={aceptacion}
        />
      );
    }
  }

  // Con la nube configurada, el panel exige una cuenta activa
  if (cloud.enabled && (cloud.loading || !cloud.session || cloud.profile?.status !== 'active')) {
    return <Access />;
  }

  // Cuentas que ya existían y administradores: aceptan una vez, y otra si cambia algún documento
  if (cloud.enabled) {
    if (aceptacion.cargando) return <AceptacionCargando />;
    if (aceptacion.pendientes.length > 0) return <AceptacionGate aceptacion={aceptacion} />;
  }

  // El administrador no es un streamer: solo ve su consola, escriba la dirección que escriba
  if (cloud.enabled && cloud.profile?.role === 'admin') return <AdminShell />;

  // Todo el panel del creador va dentro del cascarón único; la bienvenida de Tally Studio
  // (fundadores y cuentas nuevas) se monta sobre él
  return (
    <>
      <AppShell route={currentRoute} />
      <BienvenidaTally />
    </>
  );
};

export const App: React.FC = () => (
  <CloudProvider>
    <Suspense fallback={null}>
      <Routes />
    </Suspense>
  </CloudProvider>
);

export default App;
