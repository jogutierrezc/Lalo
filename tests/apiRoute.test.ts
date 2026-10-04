import { describe, expect, it } from 'vitest';
import { routeFromRequest } from '../server/apiRoute';

describe('routeFromRequest', () => {
  it('compone la ruta con los parámetros que pone vercel.json', () => {
    expect(routeFromRequest({ query: { g: 'media', a: 'upload-session' } }, ['storage', 'media'])).toBe('media/upload-session');
    expect(routeFromRequest({ query: { g: 'twitch', a: 'clip', login: 'pau_rl' } }, ['twitch'])).toBe('twitch/clip');
  });

  it('lee la dirección original si no llegan los parámetros', () => {
    expect(routeFromRequest({ url: '/api/voices/create?x=1' }, ['voices'])).toBe('voices/create');
  });

  it('rechaza grupos ajenos y valores raros', () => {
    expect(routeFromRequest({ query: { g: 'voices', a: 'create' } }, ['storage', 'media'])).toBe('');
    expect(routeFromRequest({ query: { g: 'media', a: '../x' } }, ['media'])).toBe('');
    expect(routeFromRequest({ query: { g: ['media'], a: ['delete'] } }, ['media'])).toBe('media/delete');
    expect(routeFromRequest({}, ['media'])).toBe('');
  });
});
