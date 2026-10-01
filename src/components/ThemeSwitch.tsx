/**
 * ThemeSwitch.tsx
 *
 * Tema del panel: Claro, Oscuro o Twitch (morado). Es una preferencia de quien
 * usa el panel, no un ajuste del widget, así que se guarda aparte y no viaja a
 * OBS. El tema se aplica como atributo en <body>; los colores viven en index.css.
 */

import React, { useLayoutEffect, useState } from 'react';

export type PanelTheme = 'claro' | 'oscuro' | 'twitch';

const THEME_KEY = 'lalo_tts_panel_theme';
const THEMES: { id: PanelTheme; name: string }[] = [
  { id: 'claro', name: 'Claro' },
  { id: 'oscuro', name: 'Oscuro' },
  { id: 'twitch', name: 'Twitch' },
];

function loadTheme(): PanelTheme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (THEMES.some((theme) => theme.id === stored)) return stored as PanelTheme;
  } catch {
    // Sin almacenamiento: se usa la preferencia del sistema
  }
  // Primera visita: seguir la preferencia del sistema
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'oscuro';
}

export const ThemeSwitch: React.FC = () => {
  const [theme, setTheme] = useState<PanelTheme>(loadTheme);

  // useLayoutEffect: el tema se aplica antes del primer pintado, sin parpadeo
  useLayoutEffect(() => {
    document.body.dataset.panelTheme = theme;
    return () => {
      delete document.body.dataset.panelTheme;
    };
  }, [theme]);

  const choose = (next: PanelTheme) => {
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Ignorar si no está soportado
    }
  };

  return (
    <div className="cab-seg" role="group" aria-label="Tema del panel">
      {THEMES.map((option) => (
        <button key={option.id} type="button" aria-pressed={theme === option.id} onClick={() => choose(option.id)}>
          {option.name}
        </button>
      ))}
    </div>
  );
};
