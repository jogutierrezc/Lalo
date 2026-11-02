/**
 * src/pages/admin/VocesPersonajesSection.tsx
 *
 * Voces y personajes en pestañas: «Voces» (catálogo, nueva voz, importar de
 * ElevenLabs) y «Personajes» (personajes de Mi AI, biblioteca de modelos 3D y
 * modelo de cada personaje). Las rutas #admin/voces y #admin/personajes
 * abren cada una su pestaña. Cambiar de pestaña no apila historial.
 */

import React, { useEffect, useId, useState } from 'react';
import { Tabs, TabPanel } from '../../components/tally-ui';
import { adminHref } from '../../lib/adminLogic';
import { VocesSection } from './VocesSection';
import { PersonajesSection } from './PersonajesSection';
import type { AdminData } from './useAdminData';

export type VocesTab = 'voces' | 'personajes';
const TABS = [
  { id: 'voces', label: 'Voces' },
  { id: 'personajes', label: 'Personajes' },
];

export const VocesPersonajesSection: React.FC<{ data: AdminData; tab?: string | null }> = ({ data, tab }) => {
  const idBase = useId();
  const [current, setCurrent] = useState<VocesTab>(tab === 'personajes' ? 'personajes' : 'voces');

  // Si la dirección cambia desde fuera (un enlace a #admin/personajes), la pestaña la sigue
  useEffect(() => {
    setCurrent(tab === 'personajes' ? 'personajes' : 'voces');
  }, [tab]);

  const choose = (id: string) => {
    const next: VocesTab = id === 'personajes' ? 'personajes' : 'voces';
    setCurrent(next);
    try {
      window.history.replaceState(null, '', adminHref(next === 'personajes' ? 'personajes' : 'voces'));
    } catch {
      // Sin historial disponible: la pestaña cambia igual
    }
  };

  return (
    <>
      <Tabs label="Voces y personajes" tabs={TABS} value={current} onChange={choose} idBase={idBase} />
      <TabPanel idBase={idBase} id="voces" value={current}>
        <VocesSection data={data} />
      </TabPanel>
      <TabPanel idBase={idBase} id="personajes" value={current}>
        <PersonajesSection />
      </TabPanel>
    </>
  );
};
