/**
 * src/components/estudio/boxes/index.ts
 *
 * Todas las cajas de las fases, por tipo de capa. LaloBoxes.tsx busca aquí las
 * capas que no dibuja ella misma.
 */

import { FASE1_BOXES } from './fase1';
import { FASE2_BOXES } from './fase2';
import { FASE3_BOXES } from './fase3';
import type { BoxMap } from './types';

export const PHASE_BOXES: BoxMap = { ...FASE1_BOXES, ...FASE2_BOXES, ...FASE3_BOXES };
