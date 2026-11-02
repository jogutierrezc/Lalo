/**
 * src/pages/admin/CodigosRegalosSection.tsx
 *
 * Códigos y regalos: junta en una pantalla los códigos de invitación (con el
 * interruptor de invitaciones, que ya vive dentro de CodigosSection) y el
 * regalo a Creadores Fundadores. No cambia ninguna de sus reglas ni textos.
 */

import React from 'react';
import { CodigosSection } from './CodigosSection';
import { RegaloFundadorCard } from './RegaloFundadorCard';
import type { AdminData } from './useAdminData';

export const CodigosRegalosSection: React.FC<{ data: AdminData }> = ({ data }) => (
  <>
    <CodigosSection data={data} />
    <RegaloFundadorCard plans={data.plans} />
  </>
);
