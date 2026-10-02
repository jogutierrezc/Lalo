import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadRewardsSettings,
  saveRewardsSettings,
  buildRewardNotice,
  DEFAULT_REWARDS_SETTINGS,
  PRESET_REWARDS,
  REWARDS_STORAGE_KEY,
} from '../src/types/rewards';

const createStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
};

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createStorageMock(),
    writable: true,
  });
}

describe('Rewards & Transparent Video Engine', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads default preset rewards when localStorage is empty', () => {
    const settings = loadRewardsSettings();
    expect(settings.channel).toBe('laloplay_');
    expect(settings.rewards.length).toBeGreaterThanOrEqual(4);
    expect(settings.rewards[0].id).toBe('reward-confetti');
    expect(settings.rewards[0].blendMode).toBe('transparent');
  });

  it('persists and restores updated rewards settings', () => {
    const updated = {
      ...DEFAULT_REWARDS_SETTINGS,
      channel: 'teststreamer',
      defaultVolume: 0.95,
    };
    saveRewardsSettings(updated);

    const reloaded = loadRewardsSettings();
    expect(reloaded.channel).toBe('teststreamer');
    expect(reloaded.defaultVolume).toBe(0.95);
  });

  it('formats custom notice template correctly with tokens', () => {
    const template = '¡{user} activó {reward}! Mensaje: {message}';
    const notice = buildRewardNotice(template, 'Juancito', 'Bomba de Humo', '¡Salvense quien pueda!');
    expect(notice).toBe('¡Juancito activó Bomba de Humo! Mensaje: ¡Salvense quien pueda!');
  });

  it('handles notice template without optional message', () => {
    const template = '¡{user} canjeó {reward}!';
    const notice = buildRewardNotice(template, 'Maria', 'Level Up');
    expect(notice).toBe('¡Maria canjeó Level Up!');
  });

  it('validates preset transparent blend modes and positions', () => {
    PRESET_REWARDS.forEach((reward) => {
      expect(['transparent', 'screen', 'chroma-green']).toContain(reward.blendMode);
      expect(['center', 'fullscreen', 'bottom-right', 'bottom-left', 'top-right', 'top-left']).toContain(reward.position);
      expect(reward.scale).toBeGreaterThanOrEqual(0.5);
      expect(reward.scale).toBeLessThanOrEqual(2.0);
    });
  });
});
