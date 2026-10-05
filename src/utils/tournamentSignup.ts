/**
 * src/utils/tournamentSignup.ts
 *
 * Lo que la inscripción por enlace de «Torneos» decide sin pintar ni llamar a
 * nadie: el slug de la dirección `#torneo/<slug>`, la validación del
 * formulario, el mensaje de cada respuesta de `tournament_register`, y la
 * limpieza de lo que llega de la nube (lo público de un torneo y las
 * solicitudes que ve el organizador). Funciones puras.
 *
 * Las mismas reglas están en supabase/migrations/0017_tournament_cloud.sql: el
 * navegador avisa pronto, pero quien manda es la base.
 *
 * Lo PÚBLICO se arma campo a campo (normalizePublicTournament): aunque la
 * respuesta trajera algo de más, de aquí no sale ningún Riot ID, jugador, clave
 * ni identificador.
 */

import {
  TOURNAMENT_LIMITS,
  TOURNAMENT_SIZES,
  TOURNAMENT_STYLES,
  type TournamentSettings,
  type TournamentSize,
  type TournamentStyle,
  type TournamentTeam,
} from '../types/tournament';
import { foldText, freshId } from './tournamentLogic';

// ---------- Slug ----------

export const SLUG_LIMITS = { min: 3, max: 40 } as const;
/** De 3 a 40: minúsculas, números y guiones, sin guion en los extremos. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** Lo que se va escribiendo en el campo del slug: sin tildes, sin espacios y sin nada que no quepa en una dirección. */
export function draftSlug(raw: string): string {
  // Sin recortar el final: el espacio que se acaba de escribir es el guion de la palabra siguiente
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_LIMITS.max);
}

/** Slug propuesto a partir del nombre del torneo: «Copa Lalo» da «copa-lalo». */
export function proposeSlug(name: string): string {
  const slug = draftSlug(name).replace(/-+$/, '');
  return SLUG_RE.test(slug) ? slug : slug ? `torneo-${slug}`.slice(0, SLUG_LIMITS.max).replace(/-+$/, '') : 'mi-torneo';
}

/** Qué le pasa a un slug, o null si vale. */
export function slugProblem(slug: string): string | null {
  if (slug.length < SLUG_LIMITS.min) return `La dirección necesita al menos ${SLUG_LIMITS.min} caracteres.`;
  if (!SLUG_RE.test(slug)) return 'Usa solo letras minúsculas, números y guiones, sin guion al principio ni al final.';
  return null;
}

export const signupHash = (slug: string): string => `#torneo/${slug}`;
export const signupUrl = (origin: string, slug: string): string => `${origin.replace(/\/+$/, '')}/${signupHash(slug)}`;

export interface SignupRoute {
  slug: string;
  /** Valor de `?demo=`, o null. Solo se atiende en desarrollo. */
  demo: string | null;
}

/** `#torneo/<slug>` es la página pública. `#torneo` y `#torneos`, sin slug, son el panel: devuelve null. */
export function parseSignupRoute(hash: string): SignupRoute | null {
  const clean = hash.trim().toLowerCase().replace(/^#\/?/, '');
  const [path, query = ''] = clean.split('?');
  const match = /^torneo\/([^/]+)\/?$/.exec(path);
  if (!match) return null;
  let slug = match[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Se queda como vino: no pasará la comprobación de la página
  }
  return { slug, demo: new URLSearchParams(query).get('demo') };
}

// ---------- Formulario ----------

/** Riot ID: nombre de 3 a 16 caracteres, almohadilla y etiqueta de 3 a 5 letras o números. */
export const RIOT_ID_RE = /^[^#]{3,16}#[A-Za-z0-9]{3,5}$/;
export const SIGNUP_LIMITS = { team: { min: 2, max: TOURNAMENT_LIMITS.team }, riotId: 22 } as const;

/** Caracteres de control, < > [ ] y marcas invisibles de dirección o anchura cero. */
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f<>[\]​-‏‪-‮⁦-⁩﻿]/;
const tidy = (value: string): string => value.replace(/\s+/g, ' ').trim();
/** Un Riot ID como se envía: sin espacios sobrantes ni alrededor de la almohadilla. */
export const tidyRiotId = (value: string): string => tidy(value).replace(/\s*#\s*/, '#');

export interface SignupForm {
  team: string;
  captain: string;
  /** Los demás jugadores; los huecos en blanco no se envían. */
  players: string[];
}

export interface SignupErrors {
  team?: string;
  captain?: string;
  /** Por cada jugador escrito, su problema o null. */
  players: (string | null)[];
}

export type SignupCheck = { ok: true; value: SignupForm } | { ok: false; errors: SignupErrors };

const RIOT_ID_HELP = 'Un Riot ID es nombre#etiqueta, como Lalo#LAN. El nombre lleva de 3 a 16 caracteres y la etiqueta de 3 a 5 letras o números.';

function riotIdProblem(value: string): string | null {
  if (FORBIDDEN.test(value)) return 'El Riot ID no puede llevar < > ni corchetes. Quítalos.';
  return RIOT_ID_RE.test(value) ? null : RIOT_ID_HELP;
}

/**
 * Revisa el formulario antes de enviarlo. `teamSize` es el número de jugadores
 * por equipo (capitán incluido) y `taken` los nombres que ya están en la llave.
 */
export function validateSignup(form: SignupForm, teamSize: number, taken: readonly string[] = []): SignupCheck {
  const errors: SignupErrors = { players: [] };
  const team = tidy(form.team);
  if (!team) errors.team = 'Escribe el nombre de tu equipo.';
  else if (FORBIDDEN.test(team)) errors.team = 'El nombre no puede llevar < > ni corchetes. Quítalos.';
  else if (team.length < SIGNUP_LIMITS.team.min) errors.team = `El nombre necesita al menos ${SIGNUP_LIMITS.team.min} caracteres.`;
  else if (team.length > SIGNUP_LIMITS.team.max) errors.team = `El nombre no puede pasar de ${SIGNUP_LIMITS.team.max} caracteres. Acórtalo.`;
  else if (taken.some((name) => foldText(name) === foldText(team))) errors.team = 'Ya hay un equipo con ese nombre en el torneo. Elige otro.';

  const captain = tidyRiotId(form.captain);
  if (!captain) errors.captain = 'Escribe el Riot ID del capitán.';
  else {
    const problem = riotIdProblem(captain);
    if (problem) errors.captain = problem;
  }

  const seen = [foldText(captain)];
  const players: string[] = [];
  form.players.slice(0, Math.max(0, teamSize - 1)).forEach((raw) => {
    const player = tidyRiotId(raw);
    if (!player) {
      errors.players.push(null);
      return;
    }
    const folded = foldText(player);
    const problem = riotIdProblem(player) ?? (seen.includes(folded) ? 'Este Riot ID ya está en el equipo. Cada jugador va una sola vez.' : null);
    errors.players.push(problem);
    seen.push(folded);
    players.push(player);
  });

  if (errors.team || errors.captain || errors.players.some(Boolean)) return { ok: false, errors };
  return { ok: true, value: { team, captain, players } };
}

// ---------- Respuestas de tournament_register ----------

export const REGISTER_CODES = ['ok', 'closed', 'full', 'duplicate', 'busy', 'invalid', 'not_found'] as const;
/** `error`: la llamada no llegó o respondió algo que no se entiende. */
export type RegisterCode = (typeof REGISTER_CODES)[number] | 'error';

export function registerCodeOf(raw: unknown): RegisterCode {
  const code = typeof raw === 'object' && raw !== null ? (raw as { code?: unknown }).code : raw;
  return (REGISTER_CODES as readonly unknown[]).includes(code) ? (code as RegisterCode) : 'error';
}

export interface RegisterMessage {
  title: string;
  /** Qué pasó y qué hacer ahora. */
  text: string;
}

export const REGISTER_MESSAGES: Record<RegisterCode, RegisterMessage> = {
  ok: {
    title: 'Solicitud recibida',
    text: 'Tu equipo queda pendiente de que el organizador lo acepte. Cuando lo haga, su nombre aparecerá en esta página.',
  },
  closed: {
    title: 'La inscripción está cerrada',
    text: 'El organizador no admite más equipos por ahora. Pregúntale en su canal si piensa volver a abrirla.',
  },
  full: {
    title: 'El torneo está completo',
    text: 'Ya están todos los equipos de la llave. Si alguno se cae, el organizador puede volver a abrir un hueco.',
  },
  duplicate: {
    title: 'Ese nombre ya está cogido',
    text: 'Hay otro equipo con ese nombre en el torneo o esperando respuesta. Cámbialo y vuelve a enviar.',
  },
  busy: {
    title: 'Demasiadas solicitudes a la vez',
    text: 'El torneo está recibiendo muchas inscripciones. Espera un minuto y vuelve a enviar: no has perdido lo que escribiste.',
  },
  invalid: {
    title: 'Hay un dato que no vale',
    text: 'Revisa el nombre del equipo y que cada Riot ID sea nombre#etiqueta, sin repetir jugadores.',
  },
  not_found: {
    title: 'No encontramos ese torneo',
    text: 'Puede que la dirección esté mal copiada o que el organizador la haya cambiado. Pídele el enlace otra vez.',
  },
  error: {
    title: 'No se pudo enviar',
    text: 'No hubo respuesta del servidor. Comprueba tu conexión y vuelve a intentarlo: no has perdido lo que escribiste.',
  },
};

// ---------- Lo público de un torneo ----------

export interface PublicSponsor {
  name: string;
  /** Dirección https de su logo, o null: entonces sale el nombre. */
  logo: string | null;
}

export interface PublicTournament {
  name: string;
  game: string;
  /** Nombre visible del canal que organiza. */
  organizer: string;
  teamSize: number;
  slots: TournamentSize;
  open: boolean;
  logo: string | null;
  sponsors: PublicSponsor[];
  style: TournamentStyle;
  /** Color propio, o null si usa el del estilo. */
  color: string | null;
  /** Nombres de los equipos que ya están en la llave. */
  teams: string[];
  left: number;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** Texto llano para pintar: sin caracteres de control ni < > [ ]. */
const plain = (value: unknown, max: number): string =>
  typeof value === 'string' ? tidy(value.replace(new RegExp(FORBIDDEN.source, 'g'), ' ')).slice(0, max) : '';
/** Solo direcciones públicas que una <img> carga sin ejecutar nada. */
const httpsUrl = (value: unknown): string | null => (typeof value === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(value) && value.length <= 600 ? value : null);

/** Lo público de un torneo a partir de la respuesta de `tournament_public`. null si no hay torneo. */
export function normalizePublicTournament(raw: unknown): PublicTournament | null {
  if (!isObject(raw)) return null;
  const name = plain(raw.name, TOURNAMENT_LIMITS.name);
  if (!name) return null;
  const slots = TOURNAMENT_SIZES.some((item) => item.id === raw.slots) ? (raw.slots as TournamentSize) : 8;
  const teams = (Array.isArray(raw.teams) ? raw.teams : [])
    // Solo textos: si llegara un equipo entero (con su capitán), no se pinta ni se guarda
    .map((item) => plain(item, TOURNAMENT_LIMITS.team))
    .filter(Boolean)
    .slice(0, slots);
  const teamSize = typeof raw.teamSize === 'number' && Number.isFinite(raw.teamSize) ? Math.round(raw.teamSize) : 5;
  return {
    name,
    game: plain(raw.game, TOURNAMENT_LIMITS.game),
    organizer: plain(raw.organizer, 40),
    teamSize: Math.min(TOURNAMENT_LIMITS.teamSize.max, Math.max(TOURNAMENT_LIMITS.teamSize.min, teamSize)),
    slots,
    open: raw.open === true,
    logo: httpsUrl(raw.logo),
    sponsors: (Array.isArray(raw.sponsors) ? raw.sponsors : [])
      .filter(isObject)
      .map((item) => ({ name: plain(item.name, TOURNAMENT_LIMITS.sponsor), logo: httpsUrl(item.logo) }))
      .filter((item) => item.name || item.logo)
      .slice(0, TOURNAMENT_LIMITS.sponsors),
    style: TOURNAMENT_STYLES.some((item) => item.id === raw.style) ? (raw.style as TournamentStyle) : 'grieta',
    color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toLowerCase() : null,
    teams,
    left: Math.max(0, slots - teams.length),
  };
}

/** La fila de `tournaments`: lo que el dueño publica. */
export interface TournamentRow {
  slug: string;
  name: string;
  game: string;
  team_size: number;
  slots: TournamentSize;
  signup_open: boolean;
  logo_url: string | null;
  sponsors: PublicSponsor[];
  style: TournamentStyle;
  color: string | null;
}

/**
 * Lo que se publica de los ajustes del torneo. `resolve` convierte una imagen
 * guardada en su dirección pública (lib/mediaRef.ts); las que solo viven en este
 * navegador no se pueden publicar y se quedan fuera.
 */
export function publicRowFromSettings(
  settings: TournamentSettings,
  slug: string,
  open: boolean,
  resolve: (url: string) => string | null
): TournamentRow {
  const image = (url: string | undefined): string | null => httpsUrl(url ? resolve(url) : null);
  return {
    slug,
    name: settings.name,
    game: settings.game,
    team_size: settings.teamSize,
    slots: settings.size,
    signup_open: open,
    logo_url: image(settings.logo?.url),
    sponsors: settings.sponsors.map((sponsor) => ({ name: sponsor.name, logo: image(sponsor.image?.url) })),
    style: settings.style,
    color: settings.customColor ? settings.color : null,
  };
}

// ---------- Solicitudes (las ve el organizador) ----------

export type EntryStatus = 'pending' | 'accepted' | 'rejected';

export interface TournamentEntry {
  id: number;
  team: string;
  captain: string;
  players: string[];
  status: EntryStatus;
  /** Fecha ISO de la solicitud. */
  createdAt: string;
}

/** Las filas de `tournament_entries`, limpias. Lo que no se entiende se descarta. */
export function normalizeEntries(raw: unknown): TournamentEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: TournamentEntry[] = [];
  raw.filter(isObject).forEach((row) => {
    const team = plain(row.team, TOURNAMENT_LIMITS.team);
    if (typeof row.id !== 'number' || !team) return;
    entries.push({
      id: row.id,
      team,
      captain: plain(row.captain, TOURNAMENT_LIMITS.captain),
      players: (Array.isArray(row.players) ? row.players : []).map((player) => plain(player, TOURNAMENT_LIMITS.player)).filter(Boolean).slice(0, TOURNAMENT_LIMITS.teamSize.max),
      status: row.status === 'accepted' || row.status === 'rejected' ? row.status : 'pending',
      createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    });
  });
  return entries;
}

/**
 * El equipo que entra en la llave al aceptar una solicitud. Solo lleva el
 * nombre: el estado de la llave viaja a las fuentes de OBS con la clave de
 * widget, y los Riot ID se quedan en la solicitud, que solo ve el organizador.
 */
export function teamFromEntry(entry: Pick<TournamentEntry, 'team'>, teams: readonly TournamentTeam[]): TournamentTeam {
  return { id: freshId('t', teams.map((team) => team.id)), name: entry.team, captain: '', players: [] };
}
