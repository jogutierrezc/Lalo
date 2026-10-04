/**
 * src/components/envivo/useDelayedAction.ts
 *
 * Confirmación con cuenta atrás para acciones que el widget no puede deshacer
 * (vaciar la cola, silencio total). La orden no sale hasta que la cuenta llega
 * a cero o el streamer pulsa «ahora»; mientras tanto se puede cancelar.
 * Si la página se cierra con la cuenta en marcha, la orden no se envía.
 */

import { useEffect, useRef, useState } from 'react';

export function useDelayedAction<K extends string>(seconds = 5) {
  const [pending, setPending] = useState<{ key: K; left: number } | null>(null);
  const runRef = useRef<(() => void) | null>(null);

  const finish = (execute: boolean) => {
    const run = runRef.current;
    runRef.current = null;
    setPending(null);
    if (execute) run?.();
  };

  useEffect(() => {
    if (!pending) return;
    if (pending.left <= 0) {
      finish(true);
      return;
    }
    const timer = setTimeout(() => setPending((prev) => (prev ? { ...prev, left: prev.left - 1 } : prev)), 1000);
    return () => clearTimeout(timer);
  }, [pending]);

  return {
    pending,
    arm: (key: K, run: () => void) => {
      runRef.current = run;
      setPending({ key, left: seconds });
    },
    cancel: () => finish(false),
    runNow: () => finish(true),
  };
}
