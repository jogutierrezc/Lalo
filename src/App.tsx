/**
 * src/App.tsx
 *
 * Enrutador principal de Lalo Stream Suite.
 * Soporta navegación por hash y rutas limpias para OBS:
 *   - #catalogo / #suite / raíz: Catálogo general de herramientas
 *   - #tts / #ajustes: Mesa de configuración de Text-to-Speech
 *   - #control: Mesa de control en vivo durante el stream
 *   - #alertas: Estudio de Alertas de Stream (Follow, Sub, Bits, Raid)
 *   - #chat: Estudio de la capa Chat en vivo
 *   - #raid: Estudio del saludo de raid con corto
 *   - #studio: Studio, el editor de escenas (cada escena, una URL para OBS)
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

import React, { useState, useEffect } from 'react';
import { Catalog } from './pages/Catalog';
import { Dashboard } from './pages/Dashboard';
import { Widget } from './pages/Widget';
import { Control } from './pages/Control';
import { AlertsStudio } from './pages/AlertsStudio';
import { TwitchIOStudio } from './pages/TwitchIOStudio';
import { RewardsStudio } from './pages/RewardsStudio';
import { GoalsStudio } from './pages/GoalsStudio';
import { RouletteStudio } from './pages/RouletteStudio';
import { PollsStudio } from './pages/PollsStudio';
import { ChatStudio } from './pages/ChatStudio';
import { RaidStudio } from './pages/RaidStudio';
import { Studio } from './pages/Studio';
import { Access } from './pages/Access';
import { Bienvenida, bienvenidaHechaAqui } from './pages/Bienvenida';
import { Account } from './pages/Account';
import { AdminShell } from './components/admin/AdminShell';
import { CloudSetup } from './pages/CloudSetup';
import { Legal } from './pages/Legal';
import { AceptacionCargando, AceptacionGate } from './pages/AceptacionGate';
import { useAceptacion } from './hooks/useAceptacion';
import { parseRutaLegal } from './legal/logica';
import { CloudProvider, useCloudSession } from './hooks/useCloudSession';
import { readWidgetKey, startWidgetCloud } from './lib/widgetCloud';
import { isCloudEnabled } from './lib/supabase';
import { hasTwitchIdentity } from './lib/access';
import { necesitaRecorrido } from './lib/recorrido';

export type AppRoute =
  | 'catalogo'
  | 'tts'
  | 'control'
  | 'alertas'
  | 'recompensas'
  | 'twitchio'
  | 'metas'
  | 'ruleta'
  | 'encuestas'
  | 'chat'
  | 'raid'
  | 'studio'
  | 'cuenta'
  | 'admin'
  | 'nube'
  | 'legal'
  | 'widget';

function resolveRoute(): AppRoute {
  const path = window.location.pathname.toLowerCase();
  const rawHash = window.location.hash.toLowerCase();
  // Limpiar '#' inicial y cualquier barra del hash: '#/control' -> 'control', '#tts' -> 'tts'
  const hash = rawHash.replace(/^#\/?/, '').replace(/\/$/, '');
  const search = window.location.search.toLowerCase();

  // Términos y políticas: página pública
  if (parseRutaLegal(rawHash)) return 'legal';

  // 1. Ajustes de TTS (prioridad alta ante cualquier query param)
  if (
    hash.startsWith('tts') ||
    hash.startsWith('ajustes') ||
    path.includes('/tts') ||
    path.includes('/ajustes')
  ) {
    return 'tts';
  }

  // 2. Estudio de Alertas
  if (
    hash.startsWith('alertas') ||
    hash.startsWith('alerts') ||
    path.includes('/alertas') ||
    path.includes('/alerts')
  ) {
    return 'alertas';
  }

  // 3. Estudio de Recompensas, Puntos de Canal y Videos FX
  if (
    hash.startsWith('recompensas') ||
    hash.startsWith('rewards') ||
    path.includes('/recompensas') ||
    path.includes('/rewards')
  ) {
    return 'recompensas';
  }

  // 4. Metas Comunitarias & Marcadores (Sub Goals, Follower Goals, Bit Goals)
  if (
    hash.startsWith('metas') ||
    hash.startsWith('goals') ||
    path.includes('/metas') ||
    path.includes('/goals')
  ) {
    return 'metas';
  }

  // 5. Estudio de Bot & EventSub (Powered by TwitchIO)
  if (
    hash.startsWith('twitchio') ||
    hash.startsWith('bot') ||
    path.includes('/twitchio') ||
    path.includes('/bot')
  ) {
    return 'twitchio';
  }

  // 6. Ruleta de Castigos & Retos en Vivo
  if (
    hash.startsWith('ruleta') ||
    hash.startsWith('wheel') ||
    hash.startsWith('castigos') ||
    hash.startsWith('roulette') ||
    path.includes('/ruleta') ||
    path.includes('/wheel') ||
    path.includes('/roulette')
  ) {
    return 'ruleta';
  }

  // 7. Batallas & Encuestas Cinemáticas en Vivo
  if (
    hash.startsWith('encuestas') ||
    hash.startsWith('versus') ||
    hash.startsWith('batallas') ||
    hash.startsWith('polls') ||
    path.includes('/encuestas') ||
    path.includes('/versus') ||
    path.includes('/polls')
  ) {
    return 'encuestas';
  }

  // Chat en vivo: el chat de Twitch como capa
  if (hash === 'chat' || hash.startsWith('chat?') || hash.startsWith('chat/')) return 'chat';

  // Saludo de raid con corto
  if (hash === 'raid' || hash === 'raids' || hash.startsWith('raid?') || hash.startsWith('raid/')) return 'raid';

  // Studio: el editor de escenas
  if (/^(studio|estudio)([?/]|$)/.test(hash)) return 'studio';

  // Cuenta del streamer y portal de administración (solo con la nube configurada)
  if (hash.startsWith('cuenta')) return 'cuenta';
  if (hash.startsWith('admin')) return 'admin';
  // Qué falta para encender la nube (solo cuando no está configurada)
  if (hash.startsWith('nube')) return 'nube';

  // 8. Control en vivo del TTS
  if (hash.startsWith('control') || path.includes('/control')) {
    return 'control';
  }

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
    startWidgetCloud(key).then((stopSync) => {
      if (alive) {
        stop = stopSync;
        setWidgetReady(true);
      } else {
        stopSync();
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

  // Los términos y políticas se leen sin iniciar sesión y con la nube apagada
  if (currentRoute === 'legal') return <Legal />;

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

  switch (currentRoute) {
    case 'cuenta':
      return <Account />;
    case 'nube':
      return cloud.enabled ? <Catalog /> : <CloudSetup />;
    case 'control':
      return <Control />;
    case 'alertas':
      return <AlertsStudio />;
    case 'recompensas':
      return <RewardsStudio />;
    case 'metas':
      return <GoalsStudio />;
    case 'ruleta':
      return <RouletteStudio />;
    case 'encuestas':
      return <PollsStudio />;
    case 'chat':
      return <ChatStudio />;
    case 'raid':
      return <RaidStudio />;
    case 'studio':
      return <Studio />;
    case 'twitchio':
      return <TwitchIOStudio />;
    case 'tts':
      return <Dashboard />;
    case 'catalogo':
    default:
      return <Catalog />;
  }
};

export const App: React.FC = () => (
  <CloudProvider>
    <Routes />
  </CloudProvider>
);

export default App;
