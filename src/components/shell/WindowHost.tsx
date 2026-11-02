/**
 * src/components/shell/WindowHost.tsx
 *
 * Capa de ventanas internas y barra de tareas.
 *
 * - Cada herramienta abierta es un role="dialog" con aria-label, no modal: el
 *   resto de la app sigue usable. Hasta 3 a la vez.
 * - Botones: minimizar (a la barra de tareas), maximizar y cerrar.
 * - Escape cierra la ventana de arriba (si el foco está dentro de la capa).
 * - El foco entra en la ventana al abrirla y vuelve a quien la abrió al cerrarla.
 * - Apertura desde el mosaico de origen con GSAP (280 ms, expo.out). Con
 *   «reducir movimiento» no hay animación.
 * - Cada ventana pinta el componente de la herramienta en modo embebido, con su
 *   propio scroll. No añade botón «Guardar»: lo que la página ya tiene, se queda.
 */

import React, { Suspense, useEffect, useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Maximize2, Minimize2, Minus, X } from 'lucide-react';
import { reduced } from '../../utils/alertMotion';
import { toolById } from '../../lib/tools';
import { EmbeddedProvider } from './ShellContext';
import { MAX_WINDOWS, useWindows, type WinState } from './windowStore';

gsap.registerPlugin(useGSAP);

const EASE = 'expo.out';

const WindowView: React.FC<{ win: WinState; index: number }> = ({ win, index }) => {
  const api = useWindows();
  const tool = toolById(win.id);
  const ref = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(false);
  const lastTick = useRef(win.restoreTick);

  // Apertura desde el mosaico de origen
  useGSAP(
    () => {
      const el = ref.current;
      if (!el || reduced()) return;
      const o = win.origin ?? { x: 60, y: 40 };
      gsap.fromTo(
        el,
        { opacity: 0, scale: 0.95, transformOrigin: `${o.x}px ${o.y}px` },
        { opacity: 1, scale: 1, duration: 0.28, ease: EASE, clearProps: 'transform,opacity,transformOrigin' }
      );
    },
    { scope: ref }
  );

  // El foco entra en la ventana al abrirla; al cerrarla vuelve a quien la abrió
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    mounted.current = true;
    const id = win.id;
    return () => {
      const opener = api.openerOf(id);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
    // Solo al montar y desmontar la ventana
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al restaurar desde la barra de tareas
  useEffect(() => {
    if (win.restoreTick === lastTick.current) return;
    lastTick.current = win.restoreTick;
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (!reduced()) gsap.fromTo(el, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25, ease: EASE, clearProps: 'transform,opacity' });
  }, [win.restoreTick]);

  if (!tool) return null;
  const Tool = tool.component;
  const Icon = tool.icon;
  const offset = (index % MAX_WINDOWS) * 26;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={tool.name}
      tabIndex={-1}
      className="tally-win cab"
      data-max={win.maximized ? '' : undefined}
      data-win={win.id}
      hidden={win.minimized}
      style={{ zIndex: win.z, left: win.maximized ? undefined : 20 + offset, top: win.maximized ? undefined : 12 + offset }}
      onPointerDownCapture={() => api.focus(win.id)}
    >
      <div className="tally-win-bar">
        <span className="tally-win-ic">
          <Icon className="h-4 w-4" />
        </span>
        <b>{tool.name}</b>
        <button type="button" className="tally-wb" aria-label={`Minimizar ${tool.name}`} onClick={() => api.minimize(win.id)}>
          <Minus />
        </button>
        <button
          type="button"
          className="tally-wb"
          aria-label={win.maximized ? `Restaurar ${tool.name}` : `Maximizar ${tool.name}`}
          onClick={() => api.toggleMax(win.id)}
        >
          {win.maximized ? <Minimize2 /> : <Maximize2 />}
        </button>
        <button type="button" className="tally-wb" data-x="" aria-label={`Cerrar ${tool.name}`} onClick={() => api.close(win.id)}>
          <X />
        </button>
      </div>
      <div className="tally-win-body">
        <EmbeddedProvider toolId={win.id}>
          <Suspense fallback={<p className="cab-hint p-4">Abriendo {tool.name}…</p>}>
            <Tool />
          </Suspense>
        </EmbeddedProvider>
      </div>
    </div>
  );
};

export const WindowHost = React.forwardRef<HTMLDivElement>((_props, layerRef) => {
  const api = useWindows();

  // Escape cierra la ventana de arriba (y minimizar no es cerrar)
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const top = api.topId();
    if (top) {
      event.stopPropagation();
      api.close(top);
    }
  };

  return (
    <>
      <div className="tally-wins" ref={layerRef} onKeyDown={onKeyDown}>
        {api.wins.map((win, index) => (
          <WindowView key={win.id} win={win} index={index} />
        ))}
      </div>
      <nav className="tally-dock" aria-label="Ventanas abiertas">
        {api.wins.length === 0 ? (
          <span className="tally-dock-hint">Las herramientas que abras aparecen aquí.</span>
        ) : (
          api.wins.map((win) => {
            const tool = toolById(win.id);
            if (!tool) return null;
            const Icon = tool.icon;
            const top = api.topId() === win.id;
            return (
              <button
                key={win.id}
                type="button"
                className="tally-dchip"
                data-min={win.minimized ? '' : undefined}
                aria-pressed={!win.minimized && top}
                onClick={() => (win.minimized ? api.open(win.id) : top ? api.minimize(win.id) : api.focus(win.id))}
              >
                <Icon className="h-4 w-4" />
                {tool.name}
              </button>
            );
          })
        )}
      </nav>
    </>
  );
});
WindowHost.displayName = 'WindowHost';
