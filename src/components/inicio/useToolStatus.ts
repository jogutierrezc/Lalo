/**
 * src/components/inicio/useToolStatus.ts
 *
 * Estado real de cada herramienta, leído de lo guardado. Se refresca cuando
 * termina de bajar la nube y cuando cambia localStorage en otra pestaña.
 * Lo usan Inicio y el lanzador de Herramientas.
 */

import { useEffect, useState } from 'react';
import { useCloudSession } from '../../hooks/useCloudSession';
import { toolStatusFrom } from './toolStatus';
import { loadAlertsSettings } from '../../types/alerts';
import { loadRewardsSettings } from '../../types/rewards';
import { loadGoalsSettings } from '../../types/goals';
import { loadRouletteSettings } from '../../types/roulette';
import { loadTwitchIOSettings } from '../../types/twitchio';
import { loadStudioSettings } from '../../types/studio';
import { loadPowerupsSettings } from '../../types/powerups';
import { loadPetsSettings } from '../../types/pets';
import { loadTournamentSettings } from '../../types/tournament';
import { loadMusicSettings } from '../../types/music';
import { loadKofiSettings } from '../../types/kofi';
import { loadGameSettings } from '../../types/game';

/** Lee lo guardado de cada herramienta para decir cuánto hay activo. */
export function readToolStatus() {
  return toolStatusFrom({
    alerts: loadAlertsSettings(),
    rewards: loadRewardsSettings(),
    goals: loadGoalsSettings(),
    roulette: loadRouletteSettings(),
    bot: loadTwitchIOSettings(),
    studio: loadStudioSettings(),
    powerups: loadPowerupsSettings(),
    pets: loadPetsSettings(),
    tournament: loadTournamentSettings(),
    music: loadMusicSettings(),
    kofi: loadKofiSettings(),
    game: loadGameSettings(),
  });
}

export function useToolStatus() {
  const cloud = useCloudSession();
  const [status, setStatus] = useState(readToolStatus);

  useEffect(() => {
    setStatus(readToolStatus());
  }, [cloud.loading]);

  useEffect(() => {
    const refresh = () => setStatus(readToolStatus());
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);

  return status;
}
