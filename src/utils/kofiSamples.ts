/**
 * src/utils/kofiSamples.ts
 *
 * Avisos de Ko-fi de ejemplo para las pruebas del panel y el modo demo de las
 * capas. Nombres, cantidades y mensajes son inventados. Tienen la misma forma
 * que un aviso real ya reducido por el servidor (kofiEventToStored).
 */

import type { KofiKind, KofiRecent } from '../../server/integrations/kofiRules';

export type KofiSampleId = 'd3' | 'd25' | 'long' | 'priv' | 'bad' | 'mem' | 'ren' | 'shop' | 'com';

interface Sample {
  ev: KofiKind;
  name: string;
  amount: number;
  msg: string;
  pub: boolean;
  tier?: string;
  /** Simula un mensaje con una palabra de la lista de bloqueadas. */
  blk?: boolean;
}

export const KOFI_SAMPLES: Record<KofiSampleId, Sample> = {
  d3: { ev: 'don', name: 'Vera Lozano', amount: 3, msg: 'Para el café de hoy.', pub: true },
  d25: { ev: 'don', name: 'TioGalleta', amount: 25, msg: 'Llevo meses viendo los directos. Gracias por todo.', pub: true },
  long: {
    ev: 'don',
    name: 'Candela Ruiz Montalbán',
    amount: 10,
    msg: 'Te escribo desde el trabajo porque no llego nunca al directo, pero veo todas las repeticiones mientras ceno y quería decirte que la serie de los jueves me está encantando, sobre todo cuando se tuerce todo y acabáis improvisando hasta las tantas.',
    pub: true,
  },
  priv: { ev: 'don', name: 'Nombre que no se enseña', amount: 5, msg: 'Mensaje que no se enseña.', pub: false },
  bad: { ev: 'don', name: 'pulpo_veloz', amount: 2, msg: 'Mensaje con una palabra de tu lista de bloqueadas.', pub: true, blk: true },
  mem: { ev: 'mem', name: 'Hugo Barrena', amount: 6, tier: 'Oro', msg: 'Por fin me apunto.', pub: true },
  ren: { ev: 'ren', name: 'Paula M.', amount: 6, tier: 'Oro', msg: '', pub: true },
  shop: { ev: 'shop', name: 'Samu', amount: 12, msg: '', pub: true },
  com: { ev: 'com', name: 'Lía Torres', amount: 40, msg: 'Un retrato de mi gata, por favor.', pub: true },
};

/** El aviso de ejemplo en la forma que viaja por el canal de eventos, en la moneda de la meta. */
export function kofiSamplePayload(id: KofiSampleId, currency: string): Record<string, unknown> {
  const sample = KOFI_SAMPLES[id];
  return { ev: sample.ev, name: sample.name, msg: sample.msg, amount: sample.amount, currency, tier: sample.tier ?? '', pub: sample.pub, blk: sample.blk === true, test: true };
}

/** Lo que enseñan las capas fijas en modo demo. */
export const KOFI_DEMO_RAISED = 64;
export const KOFI_DEMO_RECENT: KofiRecent[] = [
  { name: 'Paula M.', amount: 6, currency: 'EUR', kind: 'ren' },
  { name: 'Samu', amount: 12, currency: 'EUR', kind: 'shop' },
  { name: 'Alguien', amount: 5, currency: 'EUR', kind: 'don' },
];

/** Orden en que el modo demo va enseñando alertas. */
export const KOFI_DEMO_SEQUENCE: KofiSampleId[] = ['d3', 'mem', 'd25', 'shop', 'long', 'ren', 'com', 'priv'];
