/**
 * src/App.tsx
 *
 * Enrutador principal de Lalo Stream Suite.
 * Soporta navegación por hash y rutas limpias para OBS:
 *   - #catalogo / #suite / raíz: Catálogo general de herramientas
 *   - #tts / #ajustes: Mesa de configuración de Text-to-Speech
 *   - #control: Mesa de control en vivo durante el stream
 *   - #alertas: Estudio de Alertas de Stream (Follow, Sub, Bits, Raid)
 *   - #twitchio / #bot: Estudio de Bot y EventSub (Powered by TwitchIO)
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
  | 'widget';

function resolveRoute(): AppRoute {
  const path = window.location.pathname.toLowerCase();
  const rawHash = window.location.hash.toLowerCase();
  // Limpiar '#' inicial y cualquier barra del hash: '#/control' -> 'control', '#tts' -> 'tts'
  const hash = rawHash.replace(/^#\/?/, '').replace(/\/$/, '');
  const search = window.location.search.toLowerCase();

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

export const App: React.FC = () => {
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

  switch (currentRoute) {
    case 'widget':
      return <Widget />;
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
    case 'twitchio':
      return <TwitchIOStudio />;
    case 'tts':
      return <Dashboard />;
    case 'catalogo':
    default:
      return <Catalog />;
  }
};

export default App;
