/**
 * tests/goalDesign.test.ts
 *
 * Reglas puras de los diseños de metas: migración de estilos antiguos, bloques
 * encendidos, tinta sobre el color de avance, siguiente hito, colocación de las
 * piezas y parámetros de muestra de la capa.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GOAL_CUSTOM,
  GOAL_DESIGNS,
  blocksLit,
  cintaEdge,
  goalShape,
  goalsFlow,
  inkOn,
  migrateGoalItem,
  migrateGoalStyle,
  mixHex,
  nextMilestoneValue,
  normalizeGoalCustom,
  normalizeGoalsPosition,
  parseGoalsDemo,
} from '../src/utils/goalDesign';

describe('diseños de metas', () => {
  it('ofrece cinco diseños y el personalizado', () => {
    expect(GOAL_DESIGNS.map((design) => design.id)).toEqual(['barra', 'anillo', 'bloques', 'cinta', 'columna', 'custom']);
  });

  describe('migración de estilos antiguos', () => {
    it('pasa cabina, neón, cyber y minimal a Barra', () => {
      for (const old of ['cabina', 'neon', 'cyber', 'minimal']) {
        expect(migrateGoalStyle(old)).toBe('barra');
      }
    });

    it('pasa a Barra cualquier valor desconocido o ausente', () => {
      expect(migrateGoalStyle(undefined)).toBe('barra');
      expect(migrateGoalStyle(null)).toBe('barra');
      expect(migrateGoalStyle('otro')).toBe('barra');
    });

    it('respeta los diseños nuevos', () => {
      for (const design of GOAL_DESIGNS) expect(migrateGoalStyle(design.id)).toBe(design.id);
    });

    it('conserva el color y el resto de la meta', () => {
      const saved = { id: 'g1', title: 'Subs', style: 'neon', accentColor: '#00f5ff', current: 7, target: 20 };
      const migrated = migrateGoalItem(saved);
      expect(migrated).toEqual({ ...saved, style: 'barra' });
      expect('custom' in migrated).toBe(false);
    });

    it('completa los ajustes del personalizado', () => {
      const migrated = migrateGoalItem({ style: 'custom', custom: { shape: 'anillo', size: 400 } });
      expect(migrated.style).toBe('custom');
      expect(migrated.custom).toEqual({ ...DEFAULT_GOAL_CUSTOM, shape: 'anillo', size: 150 });
    });
  });

  describe('personalizado', () => {
    it('rechaza la cinta como forma y los colores mal escritos', () => {
      const custom = normalizeGoalCustom({ shape: 'cinta', background: 'rojo', text: '#FFFFFF', radius: -3, font: 'comic' });
      expect(custom.shape).toBe('barra');
      expect(custom.background).toBe(DEFAULT_GOAL_CUSTOM.background);
      expect(custom.text).toBe('#FFFFFF');
      expect(custom.radius).toBe(0);
      expect(custom.font).toBe('archivo');
    });

    it('muestra título y meta salvo que se apaguen', () => {
      expect(normalizeGoalCustom({}).showTitle).toBe(true);
      expect(normalizeGoalCustom({ showTitle: false, showTarget: false })).toMatchObject({
        showTitle: false,
        showTarget: false,
      });
    });

    it('pinta la forma elegida; los demás diseños, la suya', () => {
      expect(goalShape('custom', { ...DEFAULT_GOAL_CUSTOM, shape: 'columna' })).toBe('columna');
      expect(goalShape('custom')).toBe('barra');
      expect(goalShape('cinta')).toBe('cinta');
    });
  });

  describe('bloques encendidos', () => {
    it('va de 0 a 12 con el porcentaje', () => {
      expect(blocksLit(0)).toBe(0);
      expect(blocksLit(25)).toBe(3);
      expect(blocksLit(50)).toBe(6);
      expect(blocksLit(72)).toBe(9);
      expect(blocksLit(100)).toBe(12);
    });

    it('con cualquier avance enciende uno y reserva el último para la meta cumplida', () => {
      expect(blocksLit(1)).toBe(1);
      expect(blocksLit(99)).toBe(11);
      expect(blocksLit(140)).toBe(12);
      expect(blocksLit(-5)).toBe(0);
      expect(blocksLit(Number.NaN)).toBe(0);
    });
  });

  describe('tinta sobre el color de avance', () => {
    it('usa tinta oscura sobre colores claros y blanca sobre oscuros', () => {
      expect(inkOn('#ffd700')).toBe('#1b1c1f');
      expect(inkOn('#00f5ff')).toBe('#1b1c1f');
      expect(inkOn('#ffffff')).toBe('#1b1c1f');
      expect(inkOn('#9146ff')).toBe('#ffffff');
      expect(inkOn('#1b1c1f')).toBe('#ffffff');
    });

    it('no falla con un color mal escrito', () => {
      expect(inkOn('morado')).toBe('#ffffff');
    });

    it('mezcla dos colores', () => {
      expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
      expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
      expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
      expect(mixHex('nada', '#ffffff', 0.5)).toBe('nada');
    });
  });

  describe('siguiente hito', () => {
    it('lleva al 25, 50, 75 y 100 % por orden', () => {
      expect(nextMilestoneValue(12, 60)).toBe(15);
      expect(nextMilestoneValue(15, 60)).toBe(30);
      expect(nextMilestoneValue(42, 60)).toBe(45);
      expect(nextMilestoneValue(45, 60)).toBe(60);
    });

    it('redondea hacia arriba cuando el hito no cae en un entero', () => {
      expect(nextMilestoneValue(0, 25)).toBe(7);
      expect(nextMilestoneValue(18, 25)).toBe(19);
    });

    it('no pasa de la meta ni retrocede', () => {
      expect(nextMilestoneValue(60, 60)).toBe(60);
      expect(nextMilestoneValue(80, 60)).toBe(80);
      expect(nextMilestoneValue(5, 0)).toBe(5);
    });
  });

  describe('posición', () => {
    it('acepta los seis puntos y cae arriba al centro si no reconoce el valor', () => {
      for (const pos of ['tl', 'tc', 'tr', 'bl', 'bc', 'br']) expect(normalizeGoalsPosition(pos)).toBe(pos);
      expect(normalizeGoalsPosition('ml')).toBe('tc');
      expect(normalizeGoalsPosition(undefined)).toBe('tc');
    });

    it('la cinta ocupa el borde de arriba o el de abajo', () => {
      expect(cintaEdge('tl')).toBe('t');
      expect(cintaEdge('tr')).toBe('t');
      expect(cintaEdge('bc')).toBe('b');
    });

    it('al centro las piezas van en fila; en un lateral, apiladas', () => {
      expect(goalsFlow('tc', ['barra', 'bloques'])).toBe('fila');
      expect(goalsFlow('bc', ['anillo'])).toBe('fila');
      expect(goalsFlow('tl', ['barra', 'anillo'])).toBe('pila');
      expect(goalsFlow('br', ['bloques'])).toBe('pila');
    });

    it('las columnas siempre van una al lado de otra', () => {
      expect(goalsFlow('tl', ['columna', 'columna'])).toBe('fila');
      expect(goalsFlow('br', ['barra', 'columna'])).toBe('fila');
    });
  });

  describe('muestra de la capa por URL', () => {
    it('solo se activa con demo=1', () => {
      expect(parseGoalsDemo(new URLSearchParams('app=goals'))).toBeNull();
      expect(parseGoalsDemo(new URLSearchParams('app=goals&demo=1'))).toEqual({
        design: null,
        position: null,
        count: 1,
        done: false,
      });
    });

    it('lee diseño, posición, número de metas y meta cumplida', () => {
      expect(parseGoalsDemo(new URLSearchParams('demo=1&design=anillo&pos=br&n=3&done=1'))).toEqual({
        design: 'anillo',
        position: 'br',
        count: 3,
        done: true,
      });
    });

    it('ignora valores que no conoce', () => {
      expect(parseGoalsDemo(new URLSearchParams('demo=1&design=neon&pos=xx&n=40'))).toEqual({
        design: null,
        position: null,
        count: 5,
        done: false,
      });
    });
  });
});
