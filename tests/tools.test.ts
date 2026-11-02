/** Registro de herramientas: los alias de ruta viejos siguen llevando a la herramienta correcta. */

import { describe, expect, it } from 'vitest';
import { OBS_SOURCES, TOOLS, TOOL_GROUPS, connectionTools, matchTool, syncTargetFor, toolsByGroup } from '../src/lib/tools';

const find = (hash: string, path = '/') => matchTool(hash, path, 'early') ?? matchTool(hash, path, 'late');

describe('alias de ruta', () => {
  const cases: [string, string][] = [
    ['tts', 'tts'], ['ajustes', 'tts'],
    ['alertas', 'alertas'], ['alerts', 'alertas'],
    ['recompensas', 'recompensas'], ['rewards', 'recompensas'],
    ['metas', 'metas'], ['goals', 'metas'],
    ['twitchio', 'twitchio'], ['bot', 'twitchio'],
    ['ruleta', 'ruleta'], ['wheel', 'ruleta'], ['castigos', 'ruleta'], ['roulette', 'ruleta'],
    ['encuestas', 'encuestas'], ['versus', 'encuestas'], ['batallas', 'encuestas'], ['polls', 'encuestas'],
    ['chat', 'chat'], ['chat?x=1', 'chat'], ['raid', 'raid'], ['raids', 'raid'],
    ['studio', 'studio'], ['estudio', 'studio'], ['powerups', 'powerups'], ['power-ups', 'powerups'],
    ['mascotas', 'mascotas'], ['mascota', 'mascotas'], ['pets', 'mascotas'],
    ['juego', 'juego'], ['riot', 'juego'], ['torneos', 'torneos'], ['torneo', 'torneos'], ['tournament', 'torneos'],
    ['musica', 'musica'], ['ahora-suena', 'musica'], ['kofi', 'kofi'], ['ko-fi', 'kofi'], ['lux', 'lux'], ['done', 'done'],
  ];
  it.each(cases)('#%s -> %s', (hash, id) => {
    expect(find(hash)).toBe(id);
  });

  it('rutas que no son herramientas no coinciden', () => {
    for (const hash of ['', 'control', 'cuenta', 'integraciones', 'dashboard', 'catalogo', 'herramientas']) {
      expect(find(hash)).toBeNull();
    }
  });

  it('también por ruta de la dirección', () => {
    expect(find('', '/alertas')).toBe('alertas');
  });
});

describe('registro', () => {
  it('ids únicos y alias canónicos que resuelven a sí mismos', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    for (const tool of TOOLS) expect(find(tool.hash.slice(1))).toBe(tool.id);
  });

  it('agrupa las herramientas en los cuatro grupos', () => {
    const grouped = toolsByGroup();
    expect(grouped.map((g) => g.group)).toEqual([...TOOL_GROUPS]);
    expect(grouped.flatMap((g) => g.tools.map((t) => t.id))).toContain('done');
    expect(TOOLS.find((t) => t.id === 'done')).toMatchObject({ group: 'Voz e IA', isNew: true });
  });

  it('Conexiones reúne Ko-fi, Alertas de juego y Ahora suena', () => {
    expect(connectionTools().map((t) => t.id).sort()).toEqual(['juego', 'kofi', 'musica']);
  });

  it('destino de Actualizar OBS', () => {
    expect(syncTargetFor('ruleta')).toBe('roulette');
    expect(syncTargetFor('powerups')).toBe('rewards');
    expect(syncTargetFor('studio')).toBe('all');
    expect(syncTargetFor(null)).toBe('all');
  });

  it('16 fuentes de OBS, con «Todo en uno» recomendada', () => {
    expect(OBS_SOURCES).toHaveLength(16);
    expect(OBS_SOURCES[0]).toMatchObject({ app: 'all', recommended: true });
  });
});
