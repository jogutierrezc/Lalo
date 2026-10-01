/**
 * PanelNav.tsx
 *
 * Navegación entre las dos mesas del panel: Ajustes (se prepara antes del
 * directo) y Control en vivo (se usa durante el directo).
 */

import React from 'react';

export const PanelNav: React.FC<{ current: 'ajustes' | 'control' }> = ({ current }) => (
  <nav className="cab-nav" aria-label="Secciones del panel" data-tour="nav">
    <a href="#ajustes" aria-current={current === 'ajustes' ? 'page' : undefined}>
      Ajustes
    </a>
    <a href="#control" aria-current={current === 'control' ? 'page' : undefined}>
      Control en vivo
    </a>
  </nav>
);
