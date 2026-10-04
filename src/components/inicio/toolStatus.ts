/**
 * src/components/inicio/toolStatus.ts
 *
 * Estado real de cada herramienta para la lista de Inicio, calculado a partir
 * de lo guardado. Si de una herramienta no se puede decir nada cierto, no hay
 * estado y la fila no muestra etiqueta.
 */

export type ToolId = 'tts' | 'alertas' | 'recompensas' | 'metas' | 'ruleta' | 'encuestas' | 'chat' | 'twitchio';

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
  return status;
}
