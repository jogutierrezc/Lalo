/**
 * src/lib/tools.ts
 *
 * Registro único de herramientas del creador. Es la fuente de verdad de:
 *   - nombre, descripción, grupo e icono de cada herramienta;
 *   - los alias de ruta hash (#alertas, #alerts, #wheel, #versus, #riot...);
 *   - el parámetro `app` de su fuente de OBS y el destino de «Actualizar OBS»;
 *   - el componente (carga diferida) que se abre en su ventana interna.
 *
 * Antes estas listas estaban repetidas en SuiteNav, Catalog, toolStatus y App.
 * Aquí se derivan todas. La ruta pública del widget de OBS no pasa por aquí.
 */

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import {
  BellRing,
  Bot,
  Clapperboard,
  Coffee,
  Coins,
  Gamepad2,
  Layers,
  Medal,
  MessagesSquare,
  Mic,
  Music,
  PawPrint,
  Sparkles,
  Swords,
  Target,
  Trophy,
  Wand2,
  Zap,
} from 'lucide-react';
import type { WidgetAppType } from '../utils/widgetUrl';

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
  | 'juego'
  | 'lux'
  | 'done';

export const TOOL_GROUPS = ['Voz e IA', 'Alertas y premios', 'Participación', 'En pantalla'] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

/** Una herramienta aparece en «Herramientas»; una conexión, en «Conexiones». Ahora suena está en ambas. */
export type ToolKind = 'herramienta' | 'conexion';

export interface ToolDef {
  id: ToolId;
  name: string;
  text: string;
  /** Grupo del lanzador de Herramientas. Ko-fi y Alertas de juego no tienen: viven en Conexiones. */
  group: ToolGroup | null;
  /** Dónde se lanza. `conexion` + `enConexiones` en Ahora suena: aparece en las dos vistas. */
  kind: ToolKind;
  enConexiones?: boolean;
  icon: ComponentType<{ className?: string }>;
  /** Alias canónico del hash. */
  hash: string;
  /** ¿Esta dirección lleva a la herramienta? `early` se evalúa antes que control/integraciones; `late`, después. */
  phase: 'early' | 'late';
  match: (hash: string, path: string) => boolean;
  /** Parámetro `app` de su fuente de OBS, si tiene una propia. */
  widgetApp?: WidgetAppType;
  /** Fuente a la que «Actualizar OBS» envía los cambios desde esta herramienta. */
  syncTarget?: WidgetAppType;
  isNew?: boolean;
  component: LazyExoticComponent<ComponentType>;
}

const starts = (...prefixes: string[]) => (hash: string) => prefixes.some((p) => hash.startsWith(p));
const pathHas = (...parts: string[]) => (path: string) => parts.some((p) => path.includes(p));
const either = (a: (h: string) => boolean, b: (p: string) => boolean) => (hash: string, path: string) => a(hash) || b(path);

export const TOOLS: ToolDef[] = [
  {
    id: 'tts',
    name: 'Voz del chat',
    text: 'Lee en voz alta los mensajes del chat que tú decidas.',
    group: 'Voz e IA',
    kind: 'herramienta',
    icon: Mic,
    hash: '#tts',
    phase: 'early',
    match: either(starts('tts', 'ajustes'), pathHas('/tts', '/ajustes')),
    widgetApp: 'tts',
    syncTarget: 'tts',
    component: lazy(() => import('../pages/Dashboard').then((m) => ({ default: m.Dashboard }))),
  },
  {
    id: 'alertas',
    name: 'Alertas',
    text: 'Avisos en pantalla cuando alguien te sigue, se suscribe, envía bits o hace una raid.',
    group: 'Alertas y premios',
    kind: 'herramienta',
    icon: BellRing,
    hash: '#alertas',
    phase: 'early',
    match: either(starts('alertas', 'alerts'), pathHas('/alertas', '/alerts')),
    widgetApp: 'alerts',
    syncTarget: 'alerts',
    component: lazy(() => import('../pages/AlertsStudio').then((m) => ({ default: m.AlertsStudio }))),
  },
  {
    id: 'recompensas',
    name: 'Recompensas',
    text: 'Vídeos, sonidos y efectos cuando alguien canjea puntos del canal.',
    group: 'Alertas y premios',
    kind: 'herramienta',
    icon: Coins,
    hash: '#recompensas',
    phase: 'early',
    match: either(starts('recompensas', 'rewards'), pathHas('/recompensas', '/rewards')),
    widgetApp: 'rewards',
    syncTarget: 'rewards',
    component: lazy(() => import('../pages/RewardsStudio').then((m) => ({ default: m.RewardsStudio }))),
  },
  {
    id: 'metas',
    name: 'Metas',
    text: 'Barras de progreso de seguidores, suscripciones o bits, con celebración al llegar.',
    group: 'Participación',
    kind: 'herramienta',
    icon: Target,
    hash: '#metas',
    phase: 'early',
    match: either(starts('metas', 'goals'), pathHas('/metas', '/goals')),
    widgetApp: 'goals',
    syncTarget: 'goals',
    component: lazy(() => import('../pages/GoalsStudio').then((m) => ({ default: m.GoalsStudio }))),
  },
  {
    id: 'twitchio',
    name: 'Bot',
    text: 'Comandos del chat con respuestas automáticas.',
    group: 'Voz e IA',
    kind: 'herramienta',
    icon: Bot,
    hash: '#twitchio',
    phase: 'early',
    match: either(starts('twitchio', 'bot'), pathHas('/twitchio', '/bot')),
    component: lazy(() => import('../pages/TwitchIOStudio').then((m) => ({ default: m.TwitchIOStudio }))),
  },
  {
    id: 'ruleta',
    name: 'Ruleta',
    text: 'Rueda de retos y castigos que el chat puede hacer girar.',
    group: 'Participación',
    kind: 'herramienta',
    icon: Gamepad2,
    hash: '#ruleta',
    phase: 'early',
    match: either(starts('ruleta', 'wheel', 'castigos', 'roulette'), pathHas('/ruleta', '/wheel', '/roulette')),
    widgetApp: 'roulette',
    syncTarget: 'roulette',
    component: lazy(() => import('../pages/RouletteStudio').then((m) => ({ default: m.RouletteStudio }))),
  },
  {
    id: 'encuestas',
    name: 'Batallas',
    text: 'Votaciones entre dos opciones que el chat decide escribiendo su voto.',
    group: 'Participación',
    kind: 'herramienta',
    icon: Swords,
    hash: '#encuestas',
    phase: 'early',
    match: either(starts('encuestas', 'versus', 'batallas', 'polls'), pathHas('/encuestas', '/versus', '/polls')),
    widgetApp: 'polls',
    syncTarget: 'polls',
    component: lazy(() => import('../pages/PollsStudio').then((m) => ({ default: m.PollsStudio }))),
  },
  {
    id: 'chat',
    name: 'Chat',
    text: 'El chat de tu canal en pantalla, con plantillas, destacados y moderación visible.',
    group: 'En pantalla',
    kind: 'herramienta',
    icon: MessagesSquare,
    hash: '#chat',
    phase: 'early',
    match: (hash) => hash === 'chat' || hash.startsWith('chat?') || hash.startsWith('chat/'),
    widgetApp: 'chat',
    syncTarget: 'chat',
    component: lazy(() => import('../pages/ChatStudio').then((m) => ({ default: m.ChatStudio }))),
  },
  {
    id: 'raid',
    name: 'Raids',
    text: 'Saludo a quien llega con una raid, con un corto de su canal, y comandos !so y !clip para moderadores.',
    group: 'En pantalla',
    kind: 'herramienta',
    icon: Clapperboard,
    hash: '#raid',
    phase: 'early',
    match: (hash) => hash === 'raid' || hash === 'raids' || hash.startsWith('raid?') || hash.startsWith('raid/'),
    widgetApp: 'raid',
    syncTarget: 'raid',
    component: lazy(() => import('../pages/RaidStudio').then((m) => ({ default: m.RaidStudio }))),
  },
  {
    id: 'studio',
    name: 'Studio',
    text: 'Editor visual de escenas a 1920 × 1080 para combinar capas, textos, cámaras y temporizadores.',
    group: 'En pantalla',
    kind: 'herramienta',
    icon: Layers,
    hash: '#studio',
    phase: 'early',
    match: (hash) => /^(studio|estudio)([?/]|$)/.test(hash),
    component: lazy(() => import('../pages/Studio').then((m) => ({ default: m.Studio }))),
  },
  {
    id: 'powerups',
    name: 'Power-ups',
    text: 'Sonidos, vídeos o voz cuando alguien usa un Power-up de Bits en el canal.',
    group: 'Alertas y premios',
    kind: 'herramienta',
    icon: Zap,
    hash: '#powerups',
    phase: 'early',
    match: (hash) => /^power-?ups([?/]|$)/.test(hash),
    syncTarget: 'rewards',
    component: lazy(() => import('../pages/PowerupsStudio').then((m) => ({ default: m.PowerupsStudio }))),
  },
  {
    id: 'mascotas',
    name: 'Mascotas',
    text: 'Tu personaje reacciona con voz y emociones a canjes, bits, raids y menciones.',
    group: 'Alertas y premios',
    kind: 'herramienta',
    icon: PawPrint,
    hash: '#mascotas',
    phase: 'early',
    match: (hash) => /^(mascotas?|pets)([?/]|$)/.test(hash),
    widgetApp: 'pets',
    syncTarget: 'pets',
    component: lazy(() => import('../pages/PetsStudio').then((m) => ({ default: m.PetsStudio }))),
  },
  {
    id: 'juego',
    name: 'Alertas de juego',
    text: 'Avisos automáticos de victorias, rachas, subidas de rango y pentakills en League of Legends.',
    group: null,
    kind: 'conexion',
    icon: Trophy,
    hash: '#juego',
    phase: 'early',
    match: (hash) => /^(juego|riot)([?/]|$)/.test(hash),
    widgetApp: 'game',
    syncTarget: 'game',
    component: lazy(() => import('../pages/GameStudio').then((m) => ({ default: m.GameStudio }))),
  },
  {
    id: 'torneos',
    name: 'Torneos',
    text: 'Llaves de eliminación directa en vivo con narrador y página de inscripción.',
    group: 'Participación',
    kind: 'herramienta',
    icon: Medal,
    hash: '#torneos',
    phase: 'early',
    match: (hash) => /^(torneos?|tournament)([?/]|$)/.test(hash),
    widgetApp: 'tournament',
    syncTarget: 'tournament',
    component: lazy(() => import('../pages/TournamentStudio').then((m) => ({ default: m.TournamentStudio }))),
  },
  {
    id: 'musica',
    name: 'Ahora suena',
    text: 'Muestra la canción actual con diseños animados y comandos de chat.',
    group: 'En pantalla',
    kind: 'herramienta',
    enConexiones: true,
    icon: Music,
    hash: '#musica',
    phase: 'late',
    match: (hash) => /^(musica|ahora-suena)([?/]|$)/.test(hash),
    widgetApp: 'music',
    syncTarget: 'music',
    component: lazy(() => import('../pages/MusicStudio').then((m) => ({ default: m.MusicStudio }))),
  },
  {
    id: 'kofi',
    name: 'Ko-fi',
    text: 'Alertas de donaciones, membresías y pedidos de tienda, con barra de meta y apoyos recientes.',
    group: null,
    kind: 'conexion',
    icon: Coffee,
    hash: '#kofi',
    phase: 'late',
    match: (hash) => /^ko-?fi([?/]|$)/.test(hash),
    widgetApp: 'kofi',
    syncTarget: 'kofi',
    component: lazy(() => import('../pages/KofiStudio').then((m) => ({ default: m.KofiStudio }))),
  },
  {
    id: 'lux',
    name: 'Mi AI',
    text: 'Tu personaje con IA.',
    group: 'Voz e IA',
    kind: 'herramienta',
    icon: Sparkles,
    hash: '#lux',
    phase: 'late',
    match: (hash) => /^lux([?/]|$)/.test(hash),
    component: lazy(() => import('../pages/LuxAI').then((m) => ({ default: m.LuxAI }))),
  },
  {
    id: 'done',
    name: 'Done · Asistente del canal',
    // POR CONFIRMAR: la descripción es provisional (ver TEXTOS en src/lib/fundadores.ts).
    text: 'Un asistente que te acompaña en el directo y se encarga de lo repetitivo para que te dediques a crear.',
    group: 'Voz e IA',
    kind: 'herramienta',
    icon: Wand2,
    hash: '#done',
    phase: 'late',
    match: (hash) => /^(done|asistente)([?/]|$)/.test(hash),
    isNew: true,
    component: lazy(() => import('../pages/DoneAssistant').then((m) => ({ default: m.DoneAssistant }))),
  },
];

export const toolById = (id: string): ToolDef | undefined => TOOLS.find((t) => t.id === id);

/** Herramientas del lanzador de «Herramientas», agrupadas. */
export const toolsByGroup = (): { group: ToolGroup; tools: ToolDef[] }[] =>
  TOOL_GROUPS.map((group) => ({ group, tools: TOOLS.filter((t) => t.kind === 'herramienta' && t.group === group) }));

/** Entradas de la vista «Conexiones»: Ko-fi, Alertas de juego y Ahora suena. */
export const connectionTools = (): ToolDef[] => TOOLS.filter((t) => t.kind === 'conexion' || t.enConexiones);

/** Qué herramienta abre esta dirección (hash sin '#', en minúsculas, y ruta). Primero las `early`, luego las `late`. */
export function matchTool(hash: string, path: string, phase: 'early' | 'late'): ToolId | null {
  const found = TOOLS.find((t) => t.phase === phase && t.match(hash, path));
  return found ? found.id : null;
}

/** Destino de «Actualizar OBS» desde una herramienta; sin destino propio, la fuente «Todo en uno». */
export const syncTargetFor = (id: string | null | undefined): WidgetAppType =>
  (id && toolById(id)?.syncTarget) || 'all';

/** Fuentes de navegador de OBS: la lista única que usan Inicio y el panel de la barra superior. */
export interface ObsSource {
  app: WidgetAppType;
  name: string;
  note: string;
  recommended?: boolean;
  /** Herramienta que la configura, si tiene una. */
  tool?: ToolId;
}

export const OBS_SOURCES: ObsSource[] = [
  { app: 'all', name: 'Todo en uno', note: 'Recomendada: una sola fuente con todas las capas', recommended: true },
  { app: 'tts', name: 'Voz del chat', note: 'Mensajes leídos en voz alta', tool: 'tts' },
  { app: 'alerts', name: 'Alertas', note: 'Follows, suscripciones, bits y raids', tool: 'alertas' },
  { app: 'goals', name: 'Metas', note: 'Barras de progreso', tool: 'metas' },
  { app: 'roulette', name: 'Ruleta', note: 'Rueda de castigos y retos', tool: 'ruleta' },
  { app: 'polls', name: 'Batallas', note: 'Votación entre dos opciones', tool: 'encuestas' },
  { app: 'chat', name: 'Chat', note: 'El chat de tu canal en pantalla', tool: 'chat' },
  { app: 'raid', name: 'Saludo de raid', note: 'Placa de bienvenida con un corto del canal', tool: 'raid' },
  { app: 'rewards', name: 'Recompensas', note: 'Sonidos, placas y vídeos por puntos de canal o bits', tool: 'recompensas' },
  { app: 'pets', name: 'Mascota', note: 'Tu personaje reacciona con voz a canjes, bits y al chat', tool: 'mascotas' },
  { app: 'music', name: 'Ahora suena', note: 'La canción que estás escuchando', tool: 'musica' },
  { app: 'kofi', name: 'Alertas de Ko-fi', note: 'Donaciones, membresías, pedidos y comisiones', tool: 'kofi' },
  { app: 'kofigoal', name: 'Meta de Ko-fi', note: 'Lo recaudado, en barra o en depósito', tool: 'kofi' },
  { app: 'kofirecent', name: 'Últimos apoyos de Ko-fi', note: 'Lista corta de quien te apoyó', tool: 'kofi' },
  { app: 'game', name: 'Alertas de juego', note: 'Victorias, rango y jugadas de tu cuenta de Riot', tool: 'juego' },
  { app: 'tournament', name: 'Torneo', note: 'La llave, la tabla y el campeón de tu torneo', tool: 'torneos' },
];
