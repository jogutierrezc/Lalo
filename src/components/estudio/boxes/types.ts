/**
 * src/components/estudio/boxes/types.ts
 *
 * El contrato de una capa de Lalo dentro de una escena de Studio. Lo comparten
 * LaloBoxes.tsx (chat, metas, alertas, raid) y las cajas de cada fase
 * (fase1.tsx, fase2.tsx, fase3.tsx).
 *
 * Cómo se hace una caja nueva:
 *
 * 1. Es un componente `React.FC<BoxProps>` que pinta la capa DENTRO de su caja:
 *    la caja (.es-box) ya tiene posición, tamaño y `container-type: size`, así
 *    que todo se mide en cqw/cqh o en em a partir de `font-size: calc(100cqw / N)`.
 *    Nada de `position: fixed`, de vw/vh ni de elegir esquina: eso lo decide
 *    quien coloca la caja.
 * 2. Sus ajustes los lee ella misma de su módulo (loadXSettings) y los refresca
 *    escuchando el bus (X_SETTINGS_UPDATE). Studio solo coloca la capa.
 * 3. `mode="edit"`: enseña una muestra fija y representativa, sin red, sin voz
 *    y sin temporizadores que la retiren. `mode="live"`: funciona como la
 *    fuente suelta de OBS.
 * 4. Los avisos le llegan por `registry.sinks`: registra una función con su
 *    `layer.id` y recibe cada SceneSignal. Si era un comando suyo devuelve
 *    `true`. La prueba del editor va en `registry.test`.
 * 5. Para hablar usa `services.speak` (la misma cola de voz del widget). En el
 *    editor `services` no existe.
 * 6. Se registra en el mapa de su fase (FASE1_BOXES...) con su tipo de capa, y
 *    su tipo sale de SOON en SidePanel.tsx.
 */

import type React from 'react';
import type { ChatOverlayHandle } from '../../chat/ChatOverlayView';
import type { PetVoiceEvent } from '../../mascotas/PetLayer';
import type { RaidLayerHandle } from '../../raid/RaidLayer';
import type { RewardsLayerHandle } from '../../recompensas/RewardsLayer';
import type { StreamAlertsSettings } from '../../../types/alerts';
import type { ChatSettings } from '../../../types/chat';
import type { GoalsSettings } from '../../../types/goals';
import type { RaidSettings } from '../../../types/raid';
import type { LaloLayerType, StudioLayer } from '../../../types/studio';
import type { BusMessage, StreamAlertEvent } from '../../../utils/bus';
import type { UserRole } from '../../../utils/moderation';
import type { TwitchEvent } from '../../../utils/twitchEvents';
import type { SceneMode } from '../SceneElements';

/** Ajustes de los módulos que Studio ya repartía a sus capas. Las cajas nuevas leen los suyos (ver arriba). */
export interface SceneData {
  chat: ChatSettings;
  raid: RaidSettings;
  goals: GoalsSettings;
  alerts: StreamAlertsSettings;
  /** Meta que acaba de recibir progreso (el carrusel salta a ella). */
  goalEventId?: string | null;
}

/** Etiquetas de un mensaje de chat tal como llegan de Twitch: las mismas que ya recibe la capa «Recompensas». */
export type SceneChatTags = Parameters<RewardsLayerHandle['chat']>[0];

/** Todo lo que el widget reparte a las capas de una escena. */
export type SceneSignal =
  /** Evento del canal de Twitch: bits, Power-up o canje de puntos. */
  | { kind: 'twitch'; event: TwitchEvent }
  /** Cada mensaje del chat, con sus etiquetas y el rol de quien escribe. */
  | { kind: 'chat'; tags: SceneChatTags; message: string; role: UserRole }
  /** Mensaje del streamer o de un moderador: devuelve true la capa cuyo comando era. */
  | { kind: 'staff'; message: string; sender: { name: string; role: UserRole } }
  | { kind: 'raid'; channel: string; viewers: number; login: string }
  /** Aviso de Ko-fi (viaja por el canal de eventos). */
  | { kind: 'kofi'; payload: unknown; test: boolean }
  /** Una frase de la cola de voz empieza a sonar o terminó (por su id). */
  | { kind: 'voice'; event: PetVoiceEvent }
  /** Mensaje del bus del panel: ajustes nuevos, pruebas, giros, votos... */
  | { kind: 'bus'; message: BusMessage };

export type SceneSink = (signal: SceneSignal) => boolean | void;

/** Por dónde llegan los avisos a cada capa montada. */
export interface SceneRegistry {
  chat: Map<string, ChatOverlayHandle>;
  raid: Map<string, RaidLayerHandle>;
  alert: Map<string, (alert: StreamAlertEvent) => void>;
  test: Map<string, () => void>;
  /** Cajas de las fases: reciben todas las señales y se quedan con las suyas. */
  sinks: Map<string, SceneSink>;
}

/** Lo que el widget presta a las capas de una escena en OBS. En el editor no existe. */
export interface SceneServices {
  /**
   * Pone una frase en la cola de voz del widget. Devuelve el id del mensaje (para reconocer
   * su señal `voice`) o null si no entró. `system` la lee tal cual, sin «X dice» ni tarjeta.
   */
  speak: (text: string, username: string, system: boolean, options?: { voiceId?: string; front?: boolean }) => string | null;
  /** Mensajes que esperan en la cola de voz. */
  queueLength: () => number;
  blockedWords: string[];
  blockedUsers: string[];
  ignoredBots: string[];
}

export interface BoxProps {
  layer: StudioLayer;
  mode: SceneMode;
  data: SceneData;
  registry: SceneRegistry;
  demo?: boolean;
  /** La voz del streamer lee una frase del sistema (la bienvenida de una raid). */
  onSpeak?: (text: string) => void;
  services?: SceneServices;
}

export type BoxMap = Partial<Record<LaloLayerType, React.FC<BoxProps>>>;
