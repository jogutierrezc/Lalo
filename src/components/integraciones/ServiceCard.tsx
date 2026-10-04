/**
 * src/components/integraciones/ServiceCard.tsx
 *
 * Marco común de una ficha de servicio en «Integraciones»: sigla, nombre y
 * estado. La sigla es texto: aquí no se dibuja el logotipo de nadie.
 */

import React from 'react';

export type CardTone = 'on' | 'soon' | 'warn';

export const ServiceCard: React.FC<{
  mark: string;
  name: string;
  status: string;
  tone?: CardTone;
  adminOnly?: boolean;
  children: React.ReactNode;
}> = ({ mark, name, status, tone, adminOnly, children }) => (
  <section className="cab-mod ic">
    <div className="ic-h">
      <span className="ic-m" aria-hidden="true">
        {mark}
      </span>
      <h2>{name}</h2>
      <span className="ic-st" data-s={tone}>
        {status}
      </span>
    </div>
    {adminOnly && <span className="ic-tag">Solo administrador</span>}
    {children}
  </section>
);
