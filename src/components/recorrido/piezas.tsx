/**
 * src/components/recorrido/piezas.tsx
 *
 * Piezas de la bienvenida que comparten la pantalla de acceso (pasos antes de
 * Twitch) y la página de bienvenida (pasos con la sesión abierta): el marco con
 * la aurora, la lista de pasos, el título palabra a palabra, la tarjeta del
 * plan y el movimiento de entrada y salida de cada paso.
 *
 * Con «reducir movimiento» nada se desplaza: solo cambia la opacidad.
 */

import React, { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Check } from 'lucide-react';
import { AuroraFondo } from '../acceso/AuroraFondo';
import { Narrador } from './Narrador';
import { reduced } from '../../utils/alertMotion';
import { ETIQUETA, NARRACION, estadoPaso, pasosVisibles, type Camino, type PasoId, type PasoNarrado } from '../../lib/recorrido';
import '../../styles/acceso.css';
import '../../styles/recorrido.css';

gsap.registerPlugin(useGSAP);

const SALIDA = 'expo.out';

// ---------- Marco ----------

interface MarcoProps {
  /** Cambia en cada cambio de paso: la aurora da un pulso. */
  pulso: string;
  /** Columna izquierda: la marca, los pasos y Chispa. */
  lateral: React.ReactNode;
  children: React.ReactNode;
}

/** Fondo de aurora y panel de cristal de la pantalla de acceso. */
export const MarcoRecorrido: React.FC<MarcoProps> = ({ pulso, lateral, children }) => {
  const tarjetaRef = useRef<HTMLDivElement | null>(null);

  // Entrada del panel
  useGSAP(
    () => {
      if (!tarjetaRef.current) return;
      if (reduced()) {
        gsap.fromTo(tarjetaRef.current, { opacity: 0 }, { opacity: 1, duration: 0.25 });
        return;
      }
      gsap.fromTo(
        tarjetaRef.current,
        { y: 24, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.7, ease: SALIDA, clearProps: 'transform' }
      );
    },
    { scope: tarjetaRef }
  );

  return (
    <div className="cab acc rec">
      <AuroraFondo pulso={pulso} />
      <div ref={tarjetaRef} className="acc-card">
        <div className="acc-brand">{lateral}</div>
        <div className="acc-form">{children}</div>
      </div>
    </div>
  );
};

// ---------- Columna izquierda ----------

/** Lista de pasos del camino elegido. El paso en curso lleva aria-current="step". */
export const ListaPasos: React.FC<{ camino: Camino; actual: PasoId }> = ({ camino, actual }) => (
  <ol className="rec-pasos" aria-label="Pasos de la bienvenida">
    {pasosVisibles(camino).map((paso, i) => {
      const estado = estadoPaso(camino, actual, paso);
      return (
        <li key={paso} data-estado={estado} aria-current={estado === 'actual' ? 'step' : undefined}>
          <i aria-hidden="true">{estado === 'hecho' ? <Check className="h-3.5 w-3.5" /> : i + 1}</i>
          <span>
            {ETIQUETA[paso]}
            {estado === 'hecho' && <span className="sr-only"> (hecho)</span>}
          </span>
        </li>
      );
    })}
  </ol>
);

/** Marca, pasos y Chispa: la columna izquierda durante la bienvenida. */
export const LateralRecorrido: React.FC<{ camino: Camino; paso: PasoNarrado }> = ({ camino, paso }) => (
  <>
    <div>
      <p className="cab-label">Lalo Stream Suite</p>
      <ListaPasos camino={camino} actual={paso} />
    </div>
    <Narrador paso={paso} texto={NARRACION[paso]} />
  </>
);

// ---------- Título ----------

/** Título del paso, partido en palabras para que entren una a una. */
export const TituloPaso: React.FC<{ children: string }> = ({ children }) => (
  <h2 className="rec-titulo" tabIndex={-1}>
    {children.split(' ').map((palabra, i) => (
      <React.Fragment key={i}>
        {i > 0 && ' '}
        <span className="rec-palabra">{palabra}</span>
      </React.Fragment>
    ))}
  </h2>
);

// ---------- Tarjeta del plan ----------

interface TarjetaPlanProps {
  rotulo: string;
  nombre: string;
  /** Límites del plan ya escritos. Sin ellos solo se enseña el nombre. */
  lineas?: string[];
}

/** El momento marcado del recorrido: la tarjeta se descubre de izquierda a derecha. */
export const TarjetaPlan: React.FC<TarjetaPlanProps> = ({ rotulo, nombre, lineas }) => {
  const ref = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      if (!ref.current) return;
      if (reduced()) {
        gsap.fromTo(ref.current, { opacity: 0 }, { opacity: 1, duration: 0.25 });
        return;
      }
      gsap.fromTo(
        ref.current,
        { clipPath: 'inset(0 100% 0 0)' },
        { clipPath: 'inset(0 0% 0 0)', duration: 0.6, delay: 0.1, ease: SALIDA, clearProps: 'clipPath' }
      );
    },
    { scope: ref }
  );

  return (
    <div ref={ref} className="rec-plan">
      <span className="cab-caps">{rotulo}</span>
      <b>{nombre}</b>
      {lineas && lineas.length > 0 && (
        <ul>
          {lineas.map((linea) => (
            <li key={linea}>{linea}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ---------- Movimiento de cada paso ----------

/**
 * Entrada y salida del contenido de un paso. `ref` va en la caja del paso (que
 * debe llevar `key` con la misma clave, para estrenar nodos en cada paso) y
 * `salir` se llama antes de cambiar de paso: el contenido sale rápido y, al
 * terminar, se ejecuta el cambio.
 */
export function usePasoAnimado(clave: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Solo se mueve el foco cuando el cambio de paso lo pidió la persona, no al terminar una carga
  const enfocar = useRef(false);

  const { contextSafe } = useGSAP(
    () => {
      const caja = ref.current;
      if (!caja) return;

      // Tras un cambio de paso, el foco va al primer campo o al título
      if (enfocar.current) {
        enfocar.current = false;
        caja.querySelector<HTMLElement>('input:not([type="checkbox"]), .rec-titulo, h2')?.focus({ preventScroll: true });
      }

      if (reduced()) {
        gsap.fromTo(caja, { opacity: 0 }, { opacity: 1, duration: 0.2 });
        return;
      }
      gsap.fromTo(
        caja.querySelectorAll(':scope > :not(form), :scope > form > *'),
        { y: 14, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.4, ease: SALIDA, stagger: 0.05 }
      );
      const palabras = caja.querySelectorAll('.rec-palabra');
      if (palabras.length) {
        gsap.fromTo(palabras, { y: '0.45em', opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: SALIDA, stagger: 0.04 });
      }
      const filas = caja.querySelectorAll('.rec-pide li, .rec-tareas li, .rec-datos > div');
      if (filas.length) {
        gsap.fromTo(filas, { x: -8, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: SALIDA, stagger: 0.035, delay: 0.15 });
      }
    },
    { dependencies: [clave], revertOnUpdate: true }
  );

  const salir = contextSafe((despues: () => void) => {
    const caja = ref.current;
    enfocar.current = true;
    if (!caja || reduced()) {
      despues();
      return;
    }
    gsap.to(caja, { y: -10, opacity: 0, duration: 0.16, ease: 'power2.out', onComplete: despues });
  });

  return { ref, salir };
}
