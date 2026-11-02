/**
 * src/components/shell/ShellContext.tsx
 *
 * Dice a las páginas si se muestran dentro del cascarón único (AppShell).
 * `useInShell()` es true dentro del cascarón: allí <SuiteNav> no pinta barra
 * lateral ni cabecera, solo la barra pequeña de la herramienta (guía, guardado
 * y actualizar OBS). `toolId` es la herramienta de la ventana, si la hay.
 */

import React, { createContext, useContext } from 'react';

interface ShellInfo {
  inShell: boolean;
  toolId: string | null;
}

const ShellContext = createContext<ShellInfo>({ inShell: false, toolId: null });

export const EmbeddedProvider: React.FC<{ toolId?: string | null; children: React.ReactNode }> = ({ toolId = null, children }) => (
  <ShellContext.Provider value={{ inShell: true, toolId }}>{children}</ShellContext.Provider>
);

export const useInShell = (): boolean => useContext(ShellContext).inShell;
export const useShellTool = (): string | null => useContext(ShellContext).toolId;
