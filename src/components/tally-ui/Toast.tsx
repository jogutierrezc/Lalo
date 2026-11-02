/**
 * src/components/tally-ui/Toast.tsx
 *
 * Avisos breves. `ToastProvider` monta una región con role="status" (los
 * lectores de pantalla anuncian cada aviso) y `useToast()` devuelve la función
 * que lo lanza. Entra con GSAP (expo.out, 300 ms) y sale en 200 ms; con
 * «reducir movimiento» solo aparece y desaparece.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { reduced } from '../../utils/alertMotion';

interface ToastItem {
  id: number;
  text: string;
}

type ToastFn = (text: string) => void;

const ToastContext = createContext<ToastFn>(() => {});

export const useToast = () => useContext(ToastContext);

const VIDA_MS = 2600;

const ToastView: React.FC<{ item: ToastItem; onDone: (id: number) => void }> = ({ item, onDone }) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!reduced()) gsap.fromTo(el, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3, ease: 'expo.out', clearProps: 'transform' });
    const timer = window.setTimeout(() => {
      if (reduced()) onDone(item.id);
      else gsap.to(el, { opacity: 0, y: 6, duration: 0.2, ease: 'power2.out', onComplete: () => onDone(item.id) });
    }, VIDA_MS);
    return () => {
      window.clearTimeout(timer);
      gsap.killTweensOf(el);
    };
  }, [item.id, onDone]);

  return (
    <div ref={ref} className="tui-toast">
      {item.text}
    </div>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const push = useCallback<ToastFn>((text) => {
    setItems((prev) => [...prev.slice(-2), { id: next.current++, text }]);
  }, []);
  const drop = useCallback((id: number) => setItems((prev) => prev.filter((i) => i.id !== id)), []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="tui-toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <ToastView key={item.id} item={item} onDone={drop} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};
