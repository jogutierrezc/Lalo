/**
 * src/lib/access.ts
 *
 * Funciones puras de la pantalla de acceso y de las invitaciones: el enlace con
 * el código de afiliado, el mensaje para compartirlo, el enlace mailto: y la
 * lectura del parámetro `codigo`. No tocan la red ni el navegador.
 *
 * El parámetro se llama `codigo` y no `code` porque Supabase usa `?code=` al
 * volver de Twitch (flujo PKCE).
 */

export const INVITE_PARAM = 'codigo';

const CODE_SHAPE = /^[A-Z0-9][A-Z0-9-]{3,39}$/;
const EMAIL_SHAPE = /^[^\s@<>,;:"]+@[^\s@<>,;:"]+\.[^\s@<>,;:"]+$/;

/** Código de afiliado que venga en la URL (`?codigo=`), en mayúsculas. null si no hay o no tiene forma de código. */
export function readInviteCode(search: string): string | null {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get(INVITE_PARAM);
  } catch {
    return null;
  }
  const clean = (raw ?? '').trim().toUpperCase();
  return CODE_SHAPE.test(clean) ? clean : null;
}

/** Enlace que abre la app con el código ya escrito. */
export function buildInviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/?${INVITE_PARAM}=${encodeURIComponent(code.trim().toUpperCase())}`;
}

export interface InviteMessageInput {
  origin: string;
  code: string;
  planName: string;
  /** Fecha de caducidad ya escrita para leer, o null si no caduca. */
  expires?: string | null;
}

export const INVITE_SUBJECT = 'Tu invitación a Lalo Stream Suite';

/** Mensaje corto para pegar en un chat o un correo. */
export function buildInviteMessage({ origin, code, planName, expires }: InviteMessageInput): string {
  const lines = [
    'Hola:',
    '',
    'Te invito a Lalo Stream Suite. Abre este enlace y entra con tu cuenta de Twitch:',
    buildInviteLink(origin, code),
    '',
    `Si te pide el código de afiliado, es este: ${code.trim().toUpperCase()}`,
    `Plan: ${planName}`,
  ];
  if (expires) lines.push(`El código caduca el ${expires}.`);
  return lines.join('\n');
}

export function isEmailAddress(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}

/**
 * Enlace mailto: con asunto y cuerpo. Sin destinatario (o con uno que no parece
 * un correo) el enlace queda sin dirección y se escribe en el programa de correo.
 */
export function buildInviteMailto(recipient: string, subject: string, body: string): string {
  const to = recipient.trim();
  const address = isEmailAddress(to) ? encodeURIComponent(to).replace(/%40/g, '@') : '';
  const crlf = body.replace(/\r?\n/g, '\r\n');
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(crlf)}`;
}

// ---------- Sesión ----------

interface UserLike {
  app_metadata?: { provider?: unknown; providers?: unknown } | null;
  identities?: { provider?: string }[] | null;
}

/** ¿La cuenta que ha entrado tiene Twitch? Una cuenta de administrador con correo y clave no lo tiene. */
export function hasTwitchIdentity(user: UserLike | null | undefined): boolean {
  if (!user) return false;
  const meta = user.app_metadata;
  if (meta?.provider === 'twitch') return true;
  if (Array.isArray(meta?.providers) && meta.providers.includes('twitch')) return true;
  return Boolean(user.identities?.some((identity) => identity.provider === 'twitch'));
}

export interface AuthErrorLike {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
}

/** Explica por qué falló la entrada con correo y clave de administración. */
export function adminSignInProblem(error: AuthErrorLike): string {
  const message = (error.message || '').toLowerCase();
  const offline =
    error.name === 'AuthRetryableFetchError' ||
    error.status === 0 ||
    (typeof error.status === 'number' && error.status >= 500) ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('load failed');
  if (offline) {
    return 'No se pudo conectar con la nube. Revisa tu conexión y que el proyecto de Supabase no esté en pausa.';
  }
  if (error.code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'El correo o la clave de administración no son correctos.';
  }
  if (error.code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'Ese correo aún no está confirmado. Al crear el usuario en Supabase hay que marcar la confirmación automática.';
  }
  if (error.code === 'email_provider_disabled' || message.includes('email logins are disabled')) {
    return 'La entrada con correo está desactivada en Supabase. Actívala en Authentication, Providers, Email.';
  }
  if (error.status === 429 || error.code === 'over_request_rate_limit') {
    return 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.';
  }
  return `No se pudo entrar: ${error.message || 'error desconocido'}`;
}
