/**
 * src/components/tally-ui/Tabs.tsx
 *
 * Pestañas accesibles: role="tablist", flechas, Inicio y Fin para moverse, y
 * solo la pestaña activa entra en el orden de tabulación. `TabPanel` pinta el
 * contenido de la pestaña activa.
 */

import React, { useId, useRef } from 'react';

export interface TabItem {
  id: string;
  label: string;
}

interface TabsProps {
  label: string;
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Prefijo de los ids; permite enlazar con `TabPanel`. */
  idBase?: string;
}

export const Tabs: React.FC<TabsProps> = ({ label, tabs, value, onChange, idBase }) => {
  const auto = useId();
  const base = idBase ?? auto;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  const onKey = (event: React.KeyboardEvent, index: number) => {
    if (event.key === 'ArrowRight') move(index + 1);
    else if (event.key === 'ArrowLeft') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(tabs.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div className="tui-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="tab"
          id={`${base}-tab-${tab.id}`}
          aria-selected={tab.id === value}
          aria-controls={`${base}-panel-${tab.id}`}
          tabIndex={tab.id === value ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => onKey(event, index)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

interface TabPanelProps {
  idBase: string;
  id: string;
  value: string;
  children: React.ReactNode;
}

export const TabPanel: React.FC<TabPanelProps> = ({ idBase, id, value, children }) =>
  id === value ? (
    <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} className="tui-tabpanel">
      {children}
    </div>
  ) : null;
