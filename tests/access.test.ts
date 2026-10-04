import { describe, expect, it } from 'vitest';
import {
  INVITE_SUBJECT,
  adminSignInProblem,
  buildInviteLink,
  buildInviteMailto,
  buildInviteMessage,
  hasTwitchIdentity,
  isEmailAddress,
  readInviteCode,
} from '../src/lib/access';

describe('readInviteCode', () => {
  it('lee el código de ?codigo= y lo pasa a mayúsculas', () => {
    expect(readInviteCode('?codigo=lalo-ab12cd34ef56')).toBe('LALO-AB12CD34EF56');
    expect(readInviteCode('?channel=canal&codigo=%20LALO-1234%20')).toBe('LALO-1234');
  });

  it('no confunde el ?code= de Supabase con una invitación', () => {
    expect(readInviteCode('?code=8f2c1e')).toBeNull();
  });

  it('devuelve null si falta, está vacío o no tiene forma de código', () => {
    expect(readInviteCode('')).toBeNull();
    expect(readInviteCode('?codigo=')).toBeNull();
    expect(readInviteCode('?codigo=<script>alert(1)</script>')).toBeNull();
    expect(readInviteCode(`?codigo=${'A'.repeat(60)}`)).toBeNull();
  });
});

describe('buildInviteLink', () => {
  it('usa el parámetro codigo y quita la barra final del origen', () => {
    expect(buildInviteLink('https://lalo.example/', 'lalo-abc123')).toBe('https://lalo.example/?codigo=LALO-ABC123');
  });

  it('el enlace se vuelve a leer con readInviteCode', () => {
    const link = buildInviteLink('https://lalo.example', 'LALO-ABC123');
    expect(readInviteCode(new URL(link).search)).toBe('LALO-ABC123');
  });
});

describe('buildInviteMessage', () => {
  const base = { origin: 'https://lalo.example', code: 'LALO-ABC123', planName: 'Plus' };

  it('incluye el enlace, el código y el plan', () => {
    const message = buildInviteMessage(base);
    expect(message).toContain('https://lalo.example/?codigo=LALO-ABC123');
    expect(message).toContain('es este: LALO-ABC123');
    expect(message).toContain('Plan: Plus');
    expect(message).not.toContain('caduca');
    expect(message).not.toContain('—');
  });

  it('añade la caducidad cuando la hay', () => {
    expect(buildInviteMessage({ ...base, expires: '10 oct 2026' })).toContain('El código caduca el 10 oct 2026.');
  });
});

describe('buildInviteMailto', () => {
  it('sin destinatario abre el correo sin dirección', () => {
    const href = buildInviteMailto('', INVITE_SUBJECT, 'Hola');
    expect(href.startsWith('mailto:?subject=')).toBe(true);
  });

  it('pone el destinatario y codifica asunto y cuerpo', () => {
    const href = buildInviteMailto(' ana@correo.com ', 'Tu invitación', 'Línea 1\nLínea 2 & más');
    expect(href.startsWith('mailto:ana@correo.com?')).toBe(true);
    const query = new URLSearchParams(href.slice(href.indexOf('?')));
    expect(query.get('subject')).toBe('Tu invitación');
    expect(query.get('body')).toBe('Línea 1\r\nLínea 2 & más');
    expect(href).not.toContain(' ');
  });

  it('descarta un destinatario que no es un correo, para no inyectar cabeceras', () => {
    expect(buildInviteMailto('ana@correo.com?bcc=otro@x.com', 'A', 'B').startsWith('mailto:ana%40')).toBe(false);
    expect(buildInviteMailto('no es un correo', 'A', 'B').startsWith('mailto:?')).toBe(true);
  });
});

describe('isEmailAddress', () => {
  it('acepta correos normales y rechaza lo demás', () => {
    expect(isEmailAddress('ana@correo.com')).toBe(true);
    expect(isEmailAddress('ana@correo')).toBe(false);
    expect(isEmailAddress('a@b.com, c@d.com')).toBe(false);
    expect(isEmailAddress('')).toBe(false);
  });
});

describe('hasTwitchIdentity', () => {
  it('reconoce Twitch por proveedor, lista de proveedores o identidades', () => {
    expect(hasTwitchIdentity({ app_metadata: { provider: 'twitch' } })).toBe(true);
    expect(hasTwitchIdentity({ app_metadata: { provider: 'email', providers: ['email', 'twitch'] } })).toBe(true);
    expect(hasTwitchIdentity({ identities: [{ provider: 'twitch' }] })).toBe(true);
  });

  it('una cuenta de correo y clave no tiene Twitch', () => {
    expect(hasTwitchIdentity({ app_metadata: { provider: 'email', providers: ['email'] }, identities: [{ provider: 'email' }] })).toBe(false);
    expect(hasTwitchIdentity(null)).toBe(false);
  });
});

describe('adminSignInProblem', () => {
  it('distingue credenciales incorrectas de nube inalcanzable', () => {
    expect(adminSignInProblem({ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' })).toContain(
      'no son correctos'
    );
    expect(adminSignInProblem({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' })).toContain(
      'No se pudo conectar'
    );
    expect(adminSignInProblem({ message: 'TypeError: Failed to fetch' })).toContain('No se pudo conectar');
  });

  it('explica el correo sin confirmar, el proveedor apagado y el exceso de intentos', () => {
    expect(adminSignInProblem({ code: 'email_not_confirmed', status: 400 })).toContain('confirmado');
    expect(adminSignInProblem({ code: 'email_provider_disabled', status: 400 })).toContain('desactivada');
    expect(adminSignInProblem({ status: 429 })).toContain('Demasiados intentos');
  });

  it('en cualquier otro caso muestra el mensaje original', () => {
    expect(adminSignInProblem({ status: 400, message: 'Algo raro' })).toBe('No se pudo entrar: Algo raro');
  });
});
