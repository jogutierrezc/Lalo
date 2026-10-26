/**
 * src/utils/botCloud.ts
 *
 * Lógica pura de la tarjeta «Bot en la nube» del estudio de TwitchIO, sin DOM ni
 * red para poder probarla: qué estado tiene cada uno de los tres pasos y qué
 * comandos de los que el streamer ya tenía en el navegador se pueden importar.
 */

import { cleanCommandName } from '../components/bot/pythonScript';
import type { BotCommandDraft, BotConnectionView } from '../lib/botApi';
import type { CommandPermission, TwitchIOCommand } from '../types/twitchio';

// Mismos topes que server/twitch/botDb.ts
const RESPONSE_MAX = 500;
const NAME_MAX = 50;
const PERMISSIONS: CommandPermission[] = ['all', 'sub', 'mod', 'broadcaster'];
/** Los comandos de un streamer no pasan de este número en el servidor (BOT_COMMANDS_MAX). */
export const IMPORT_MAX = 100;

export interface ImportPlan {
  /** Comandos listos para guardar, ya sin repetidos y con el nombre limpio. */
  commands: BotCommandDraft[];
  /** Los que no se pueden importar (sin nombre, sin respuesta o repetidos). */
  skipped: number;
}

/**
 * De los comandos del navegador, los que se pueden llevar al servidor. Se
 * respeta el orden y el interruptor; el tiempo de espera no se importa porque el
 * servidor aún no lo guarda por comando. Un nombre ya existente en el servidor
 * (`taken`) no se pisa.
 */
export function planCommandImport(local: readonly TwitchIOCommand[], prefix: string, taken: readonly string[] = []): ImportPlan {
  const seen = new Set(taken.map((name) => name.toLowerCase()));
  const commands: BotCommandDraft[] = [];
  let skipped = 0;
  for (const command of local) {
    const name = cleanCommandName(command.name ?? '', prefix);
    const response = typeof command.response === 'string' ? command.response.trim() : '';
    if (!name || name.length > NAME_MAX || !response || response.length > RESPONSE_MAX || seen.has(name) || commands.length >= IMPORT_MAX) {
      skipped += 1;
      continue;
    }
    seen.add(name);
    commands.push({
      name,
      response,
      permission: PERMISSIONS.includes(command.permission) ? command.permission : 'all',
      enabled: command.enabled !== false,
      position: commands.length,
    });
  }
  return { commands, skipped };
}

/** Texto del aviso tras importar. */
export function importNotice(imported: number, skipped: number): string {
  if (imported === 0) return '';
  const base = `Hemos pasado a la nube ${imported === 1 ? 'el comando' : `los ${imported} comandos`} que tenías en este navegador.`;
  return skipped > 0 ? `${base} ${skipped === 1 ? 'Uno quedó fuera' : `${skipped} quedaron fuera`} por no tener nombre o respuesta, o estar repetidos.` : base;
}

// ---------- Ids, importación y avisos ----------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿Es un id del servidor? Los ids locales de las filas (new-…, cmd-…) no lo son. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** El id que se puede mandar al servidor: solo uno real. Un id local debe CREAR, no actualizar. */
export function serverId(value: unknown): string | null {
  return isUuid(value) ? value : null;
}

/** Bandera de «los comandos del navegador ya se llevaron a la nube»: un solo valor por navegador. */
export const IMPORT_FLAG = 'lalo_bot_cloud_imported';

/**
 * Quién reclamó ya los comandos de este navegador. La bandera guarda el id del
 * perfil que los importó; el valor antiguo «1» no dice quién, y se respeta:
 *   - none: nadie los ha importado, se pueden importar.
 *   - mine: esta cuenta ya los importó.
 *   - other: otra cuenta (o una versión antigua) ya los importó; esta no los toca.
 */
export function importClaim(flag: string | null, profileId: string): 'none' | 'mine' | 'other' {
  if (!flag) return 'none';
  return flag === profileId ? 'mine' : 'other';
}

/**
 * ¿Se da por terminada la importación? Sí si se pasó algo, o si no falló nada
 * (todo estaba fuera o ya existía). Si todo falló (red, 5xx), se reintenta la
 * próxima vez.
 */
export function importFinished(imported: number, failed: number): boolean {
  return imported > 0 || failed === 0;
}

/** Cuando el servidor dice que el comando ya existe no es un fallo de la importación. */
export function isImportFailure(code: string): boolean {
  return code !== 'duplicate';
}

/** Devuelve una fila a la lista sin repetir clave ni nombre (unique profile_id+name). */
export function reinsertRow<T extends { key: string; name: string; position: number }>(rows: readonly T[], row: T): T[] {
  const name = row.name.trim().toLowerCase();
  if (rows.some((item) => item.key === row.key || (name !== '' && item.name.trim().toLowerCase() === name))) return [...rows];
  return [...rows, row].sort((a, b) => a.position - b.position);
}

/** Mensajes claros y estables para los errores 503 del servidor del bot. */
export function botErrorMessage(code: string, fallback: string): string {
  if (code === 'chat_unavailable') return 'El bot en la nube todavía no está disponible en este servidor. Inténtalo más adelante.';
  if (code === 'migration_missing') return 'Al servidor le falta aplicar una actualización de la base de datos del bot. Avisa a quien administra Lalo.';
  return fallback;
}

export type StepState ='done' | 'todo' | 'waiting' | 'unavailable';

export interface BotStep {
  state: StepState;
  /** Texto de la etiqueta de la derecha cuando el paso no lleva botón. */
  label: string;
}

export interface BotSteps {
  account: BotStep;
  permission: BotStep;
  active: BotStep;
}

/**
 * Los tres pasos de la tarjeta. `connection` es null mientras no se ha leído
 * del servidor (o no se pudo): entonces todo queda en espera.
 *
 *   1. Cuenta: hay un canal de Twitch en la cuenta.
 *   2. Permiso: Twitch deja escuchar el chat (la suscripción existe o está en verificación).
 *   3. Activo: el streamer lo tiene encendido Y la escucha funciona.
 */
export function botSteps(connection: BotConnectionView | null): BotSteps {
  if (!connection) {
    return {
      account: { state: 'waiting', label: 'Comprobando' },
      permission: { state: 'waiting', label: 'Comprobando' },
      active: { state: 'waiting', label: 'Comprobando' },
    };
  }

  const account: BotStep = connection.hasChannel
    ? { state: 'done', label: 'Listo' }
    : { state: 'todo', label: 'Entra con Twitch' };

  let permission: BotStep;
  if (!connection.hasChannel) permission = { state: 'waiting', label: 'Pendiente del paso 1' };
  else if (connection.chat === 'enabled' || connection.chat === 'pending') permission = { state: 'done', label: 'Listo' };
  else if (connection.chat === 'unavailable') permission = { state: 'unavailable', label: 'Aún no disponible' };
  else permission = { state: 'todo', label: 'Conectar el bot' };

  let active: BotStep;
  if (permission.state !== 'done') active = { state: 'waiting', label: 'Pendiente del paso 2' };
  else if (!connection.enabled) active = { state: 'todo', label: 'Apagado' };
  else if (connection.chat === 'pending') active = { state: 'waiting', label: 'Twitch lo está comprobando' };
  else active = { state: 'done', label: 'Activo' };

  return { account, permission, active };
}
