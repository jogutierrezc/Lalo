import { describe, expect, it } from 'vitest';
import { effectiveSenderMode, senderIdFor } from '../server/twitch/senderMode';

describe('modo de envío sin cuenta Lalo', () => {
  it('«global» sin TWITCH_BOT_USER_ID cae a «streamer»', () => {
    expect(effectiveSenderMode('global', {})).toBe('streamer');
  });
  it('«global» con TWITCH_BOT_USER_ID se respeta', () => {
    expect(effectiveSenderMode('global', { TWITCH_BOT_USER_ID: '123' })).toBe('global');
  });
  it('«streamer» no cambia y escribe el propio canal', () => {
    expect(effectiveSenderMode('streamer', {})).toBe('streamer');
    expect(senderIdFor({ senderMode: effectiveSenderMode('global', {}) }, '999', {})).toBe('999');
  });
});
