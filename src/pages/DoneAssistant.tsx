/**
 * src/pages/DoneAssistant.tsx
 *
 * Done · Asistente del canal: ventana provisional. Solo muestra la descripción
 * de TEXTOS (src/lib/fundadores.ts). POR CONFIRMAR: no se anuncian capacidades
 * hasta que se confirme qué hace.
 */

import React from 'react';
import { TEXTOS } from '../lib/fundadores';
import { Pill } from '../components/tally-ui';

export const DoneAssistant: React.FC = () => {
  const done = TEXTOS.ventajas.done;
  return (
    <div className="cab">
      <div className="mx-auto grid max-w-3xl gap-5 px-5 py-6">
        <section className="cab-mod">
          <h2>
            {done.titulo} <Pill tone="live">{done.etiqueta}</Pill>
          </h2>
          <p>{done.texto}</p>
          <p className="cab-hint">
            Descripción provisional. Se ajustará cuando se confirme qué hace el asistente.
          </p>
        </section>
      </div>
    </div>
  );
};
