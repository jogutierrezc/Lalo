import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MAX_AUDIO_DURATION_SECONDS,
  DEFAULT_MEDIA_LIBRARY_PRESETS,
  loadMediaVault,
  saveMediaVault,
  inspectAudioFile,
  MEDIA_VAULT_STORAGE_KEY,
  MediaItem,
} from '../src/types/mediaLibrary';
import { DEFAULT_CUSTOM_EVENTS, loadAlertsSettings } from '../src/types/alerts';

describe('Media Vault & Audio Customization Specification', () => {
  beforeEach(() => {
    // Mock localStorage
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
    });
  });

  it('enforces a strict maximum audio duration of 30.0 seconds', () => {
    expect(MAX_AUDIO_DURATION_SECONDS).toBe(30.0);
  });

  it('ensures all curated media presets are <= 30 seconds and valid', () => {
    expect(DEFAULT_MEDIA_LIBRARY_PRESETS.length).toBeGreaterThan(0);
    DEFAULT_MEDIA_LIBRARY_PRESETS.forEach((preset) => {
      expect(preset.duration).toBeLessThanOrEqual(MAX_AUDIO_DURATION_SECONDS);
      expect(['mp3', 'wav', 'ogg', 'webm', 'mp4']).toContain(preset.format);
      expect(preset.url).toBeDefined();
      expect(preset.name.length).toBeGreaterThan(0);
    });
  });

  it('loads default presets when media vault storage is empty', () => {
    const items = loadMediaVault();
    expect(items.length).toBe(DEFAULT_MEDIA_LIBRARY_PRESETS.length);
    expect(items[0].id).toBe(DEFAULT_MEDIA_LIBRARY_PRESETS[0].id);
  });

  it('persists and retrieves user uploaded media items alongside presets', () => {
    const customItem: MediaItem = {
      id: 'custom-sound-123',
      name: 'Mi Grito de Guerra',
      type: 'audio',
      url: 'data:audio/mp3;base64,AAA...',
      duration: 12.5,
      format: 'mp3',
      category: 'personalizado',
      createdAt: Date.now(),
    };

    saveMediaVault([customItem, ...DEFAULT_MEDIA_LIBRARY_PRESETS]);
    const loaded = loadMediaVault();
    expect(loaded.some((i) => i.id === 'custom-sound-123')).toBe(true);
    const found = loaded.find((i) => i.id === 'custom-sound-123');
    expect(found?.duration).toBe(12.5);
    expect(found?.format).toBe('mp3');
  });

  it('inspectAudioFile correctly detects audio format from extension', async () => {
    // Mock File in Node
    const mockFile = {
      name: 'fanfarria_stream.wav',
      size: 1024,
      type: 'audio/wav',
    } as unknown as File;

    // FileReader mock for test environment
    vi.stubGlobal('FileReader', class {
      onload: any = null;
      readAsDataURL() {
        setTimeout(() => {
          this.onload({ target: { result: 'data:audio/wav;base64,TEST' } });
        }, 10);
      }
    });

    const result = await inspectAudioFile(mockFile);
    expect(result.format).toBe('wav');
    expect(result.dataUrl).toContain('data:audio/wav;base64,TEST');
    expect(result.duration).toBeLessThanOrEqual(MAX_AUDIO_DURATION_SECONDS);
  });

  it('validates default custom stream events structure and audio modes', () => {
    expect(DEFAULT_CUSTOM_EVENTS.length).toBeGreaterThanOrEqual(2);
    const hypeTrain = DEFAULT_CUSTOM_EVENTS.find((e) => e.triggerKeyword === '!hypetrain');
    expect(hypeTrain).toBeDefined();
    expect(hypeTrain?.audioMode).toBe('both');
    expect(hypeTrain?.screenShake).toBe(true);

    const secreto = DEFAULT_CUSTOM_EVENTS.find((e) => e.triggerKeyword === '!secreto');
    expect(secreto).toBeDefined();
    expect(secreto?.audioMode).toBe('custom_audio');

    const settings = loadAlertsSettings();
    expect(settings.customEvents.length).toBeGreaterThanOrEqual(2);
  });
});
