/**
 * src/components/inicio/toolStatus.ts
 *
 * Estado real de cada herramienta para la lista de Inicio, calculado a partir
 * de lo guardado. Si de una herramienta no se puede decir nada cierto, no hay
 * estado y la fila no muestra etiqueta.
 */

export type ToolId =
  | 'tts'
  | 'alertas'
  | 'recompensas'
  | 'metas'
  | 'ruleta'
  | 'encuestas'
  | 'chat'
  | 'raid'
  | 'twitchio'
  | 'studio'
  | 'powerups'
  | 'mascotas'
  | 'torneos'
  | 'musica'
  | 'kofi'
  | 'juego';

export interface ToolStatus {
  text: string;
  /** true cuando no hay nada activo y conviene avisar */
  empty: boolean;
}

export interface ToolSnapshot {
  alerts?: { events: Record<string, { enabled: boolean }> };
  rewards?: { rewards: { enabled: boolean }[] };
  goals?: { goals: { enabled: boolean }[] };
  roulette?: { segments: { enabled: boolean }[] };
  bot?: { commands: { enabled: boolean }[] };
  studio?: { scenes: unknown[] };
  powerups?: { enabled: boolean; rules?: Record<string, { action: string }> };
  pets?: { enabled: boolean; name?: string };
  tournament?: { enabled: boolean; size?: number };
  music?: { show: 'cambio' | 'siempre' | 'oculto' };
  kofi?: { events?: Record<string, { on?: boolean }> };
  game?: { enabled: boolean; alerts?: Record<string, { on: boolean }> };
}

const countOn = (items: { enabled: boolean }[] | undefined) =>
  Array.isArray(items) ? items.filter((item) => item && item.enabled).length : 0;

function counted(count: number, one: string, many: string, none: string): ToolStatus {
  if (count === 0) return { text: none, empty: true };
  return { text: count === 1 ? `1 ${one}` : `${count} ${many}`, empty: false };
}

export function toolStatusFrom(snapshot: ToolSnapshot): Partial<Record<ToolId, ToolStatus>> {
  const status: Partial<Record<ToolId, ToolStatus>> = {};

  if (snapshot.alerts) {
    const events = Object.values(snapshot.alerts.events || {});
    const on = countOn(events);
    status.alertas = { text: on === 0 ? 'Ninguna activa' : `${on} de ${events.length} activas`, empty: on === 0 };
  }
  if (snapshot.rewards) {
    status.recompensas = counted(countOn(snapshot.rewards.rewards), 'activa', 'activas', 'Ninguna activa');
  }
  if (snapshot.goals) {
    status.metas = counted(countOn(snapshot.goals.goals), 'meta activa', 'metas activas', 'Sin metas activas');
  }
  if (snapshot.roulette) {
    status.ruleta = counted(countOn(snapshot.roulette.segments), 'segmento activo', 'segmentos activos', 'Sin segmentos activos');
  }
  if (snapshot.bot) {
    status.twitchio = counted(countOn(snapshot.bot.commands), 'comando activo', 'comandos activos', 'Sin comandos activos');
  }
  if (snapshot.studio) {
    const count = Array.isArray(snapshot.studio.scenes) ? snapshot.studio.scenes.length : 0;
    status.studio = counted(count, 'escena', 'escenas', 'Sin escenas');
  }
  if (snapshot.powerups) {
    if (!snapshot.powerups.enabled) {
      status.powerups = { text: 'Apagado', empty: true };
    } else {
      const rules = Object.values(snapshot.powerups.rules || {}).filter((r) => r && r.action !== 'none');
      status.powerups = counted(rules.length, 'regla activa', 'reglas activas', 'Sin reglas activas');
    }
  }
  if (snapshot.pets) {
    status.mascotas = snapshot.pets.enabled
      ? { text: snapshot.pets.name ? `${snapshot.pets.name} activa` : 'Activa', empty: false }
      : { text: 'Apagada', empty: true };
  }
  if (snapshot.tournament) {
    status.torneos = snapshot.tournament.enabled
      ? { text: snapshot.tournament.size ? `${snapshot.tournament.size} equipos` : 'Activo', empty: false }
      : { text: 'Apagado', empty: true };
  }
  if (snapshot.music) {
    status.musica =
      snapshot.music.show === 'oculto'
        ? { text: 'Oculta', empty: true }
        : { text: snapshot.music.show === 'siempre' ? 'Siempre visible' : 'Al cambiar canción', empty: false };
  }
  if (snapshot.kofi) {
    const active = Object.values(snapshot.kofi.events || {}).filter((ev) => ev && ev.on).length;
    status.kofi = counted(active, 'aviso activo', 'avisos activos', 'Sin avisos activos');
  }
  if (snapshot.game) {
    if (!snapshot.game.enabled) {
      status.juego = { text: 'Apagadas', empty: true };
    } else {
      const active = Object.values(snapshot.game.alerts || {}).filter((a) => a && a.on).length;
      status.juego = counted(active, 'alerta activa', 'alertas activas', 'Ninguna activa');
    }
  }
  return status;
}
