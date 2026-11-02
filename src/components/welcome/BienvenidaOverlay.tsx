/**
 * src/components/welcome/BienvenidaOverlay.tsx
 *
 * Bienvenida de Tally Studio a pantalla completa, con GSAP. Un solo motor de
 * escenas (bienvenidaMotion.ts) y dos variantes:
 *   - «nueva»: cuenta que acaba de terminar el recorrido. Saludo con el nombre
 *     del canal, ventajas de la suite y «Estás al aire». Sin insignia ni regalo.
 *   - «fundador»: creador que ya existía. Anuncio del nombre nuevo, por qué
 *     tally, manifiesto, saludo de fundador, ventajas, y el cierre con el emblema
 *     «Creador Fundador Nº xxx», el regalo del plan y el rótulo con su nombre.
 *
 * Accesibilidad: role="dialog" modal, foco atrapado dentro, «Omitir» siempre
 * visible y con teclado (Escape también omite), movimiento reducido con solo
 * fundidos y un aviso de cada escena para lectores de pantalla.
 *
 * Los textos de Done e Integraciones viven en TEXTOS (src/lib/fundadores.ts).
 * Estilos: src/styles/bienvenida-tally.css.
 */

import React, { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import {
  TEXTOS,
  fechaCorta,
  fechaVencimiento,
  nombreEmblema,
  textoMeses,
  textoRegalo,
  type EscenaId,
  type EstadoRegalo,
  type VarianteBienvenida,
} from '../../lib/fundadores';
import { reduced } from '../../utils/alertMotion';
import { construirLinea } from './bienvenidaMotion';
import { InsigniaFundador } from './InsigniaFundador';
import { BalizaTally, FondoCurvas, LogotipoTally } from './tallyMark';
import '../../styles/bienvenida-tally.css';

export interface BienvenidaOverlayProps {
  variante: VarianteBienvenida;
  /** Nombre del canal, tomado de Twitch o del perfil. */
  nombre: string;
  /** Número de fundador; solo en la variante «fundador». */
  numero: number | null;
  /** Meses y nombre del plan del regalo (solo fundador). */
  meses: number;
  planNombre: string;
  estadoRegalo: EstadoRegalo;
  onActivarRegalo: () => void;
  /** Se cierra la bienvenida, vista entera o saltada. */
  onTerminar: (como: 'completa' | 'omitida') => void;
}

/** Parte un texto en palabras con su envoltorio, para que GSAP las anime una a una. */
const Palabras: React.FC<{ texto: string }> = ({ texto }) => {
  const trozos = texto.split(/\s+/).filter(Boolean);
  return (
    <>
      {trozos.map((palabra, i) => (
        <React.Fragment key={i}>
          <span className="bt-pal">{palabra}</span>
          {i < trozos.length - 1 ? ' ' : null}
        </React.Fragment>
      ))}
    </>
  );
};

const ANUNCIO: Record<EscenaId, (nombre: string) => string> = {
  standby: () => 'Algo cambia en tu set.',
  revelacion: () => 'Lalo Stream Suite ahora es Tally Studio. Professional tools for rising creators.',
  porque: () => '¿Por qué tally? La luz roja que te avisa: estás al aire.',
  manifiesto: () => 'Tu esfuerzo es real. Tu transmisión también debe serlo.',
  saludo: (nombre) => `Hola, ${nombre}.`,
  ventajas: () => TEXTOS.ventajas.titulo,
  cierre: () => 'Estás al aire.',
};

const FOCALIZABLES = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export const BienvenidaOverlay: React.FC<BienvenidaOverlayProps> = ({
  variante,
  nombre,
  numero,
  meses,
  planNombre,
  estadoRegalo,
  onActivarRegalo,
  onTerminar,
}) => {
  const raizRef = useRef<HTMLDivElement>(null);
  const omitirRef = useRef<HTMLButtonElement>(null);
  const ctxRef = useRef<gsap.Context | null>(null);
  const cerradaRef = useRef(false);
  const idTitulo = useId();
  const [anuncio, setAnuncio] = useState('');
  const fundador = variante === 'fundador' && numero !== null;

  // La línea de tiempo: un solo guion; el contexto la limpia al cerrar
  useLayoutEffect(() => {
    const raiz = raizRef.current;
    if (!raiz) return;
    const ctx = gsap.context(() => {
      construirLinea({
        variante: fundador ? 'fundador' : 'nueva',
        reducido: reduced(),
        raiz,
        alLlegar: (id) => setAnuncio(ANUNCIO[id](nombre)),
      });
    }, raiz);
    ctxRef.current = ctx;
    return () => {
      ctx.revert();
      ctxRef.current = null;
    };
    // El guion depende solo de la variante; el nombre solo cambia el texto anunciado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundador]);

  // Foco al abrir (en «Omitir») y de vuelta a donde estaba al cerrar; el fondo no se desplaza
  useLayoutEffect(() => {
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    omitirRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previo?.focus?.();
    };
  }, []);

  const cerrar = useCallback(
    (como: 'completa' | 'omitida') => {
      if (cerradaRef.current) return;
      cerradaRef.current = true;
      ctxRef.current?.kill();
      const raiz = raizRef.current;
      if (!raiz || reduced()) {
        onTerminar(como);
        return;
      }
      gsap.to(raiz, { opacity: 0, duration: 0.35, ease: 'power2.out', onComplete: () => onTerminar(como) });
    },
    [onTerminar]
  );

  // Escape omite; Tab y Mayús+Tab dan la vuelta dentro de la bienvenida
  const alTeclear = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cerrar('omitida');
      return;
    }
    if (event.key !== 'Tab') return;
    const raiz = raizRef.current;
    if (!raiz) return;
    const visibles = Array.from(raiz.querySelectorAll<HTMLElement>(FOCALIZABLES)).filter(
      (el) => getComputedStyle(el).visibility !== 'hidden'
    );
    if (visibles.length === 0) return;
    const primero = visibles[0];
    const ultimo = visibles[visibles.length - 1];
    const activo = document.activeElement;
    if (event.shiftKey && (activo === primero || !raiz.contains(activo))) {
      event.preventDefault();
      ultimo.focus();
    } else if (!event.shiftKey && (activo === ultimo || !raiz.contains(activo))) {
      event.preventDefault();
      primero.focus();
    }
  };

  const vence = fechaCorta(fechaVencimiento(new Date(), meses));
  const regalo = textoRegalo(estadoRegalo);
  const hayRegalo = fundador && estadoRegalo !== 'oculto';
  const regaloListo = estadoRegalo === 'disponible' || estadoRegalo === 'activando';
  const estadoDue =
    estadoRegalo === 'activado' ? 'Regalo activado' : estadoRegalo === 'tiene-plan' ? 'Tu plan actual sigue igual' : `Empieza al activarlo · vence el ${vence}`;

  return (
    <div
      ref={raizRef}
      className="bt-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby={idTitulo}
      data-variante={variante}
      onKeyDown={alTeclear}
    >
      <h2 id={idTitulo} className="bt-sr">
        Bienvenida a {TEXTOS.marca}
      </h2>
      <p className="bt-sr" role="status" aria-live="polite">
        {anuncio}
      </p>

      <FondoCurvas />
      <div className="bt-vig" />
      <div className="bt-flood" />

      <button ref={omitirRef} type="button" className="bt-omitir" onClick={() => cerrar('omitida')}>
        Omitir
        <span className="bt-sr"> la bienvenida</span>
      </button>

      {fundador && (
        <div className="bt-bug" aria-hidden="true">
          <LogotipoTally />
        </div>
      )}

      <div className="bt-frame">
        {fundador && (
          <>
            {/* 1 · Standby */}
            <section className="bt-sc bt-sc-standby" aria-hidden="true">
              <div className="bt-glow" />
              <div className="bt-b1">
                <BalizaTally apagada />
              </div>
              <p className="bt-st">
                <i />
                Standby · Lalo Stream Suite
              </p>
              <h3 className="bt-hd">
                <Palabras texto="Algo cambia en tu set." />
              </h3>
            </section>

            {/* 2 · Revelación */}
            <section className="bt-sc bt-sc-revelacion" aria-hidden="true">
              <div className="bt-glow" />
              <p className="bt-eb">
                <s>Lalo Stream Suite</s> ahora es
              </p>
              <div className="bt-lock-clip">
                <LogotipoTally className="bt-big" />
              </div>
              <p className="bt-slogan">{TEXTOS.eslogan}</p>
              <p className="bt-es">{TEXTOS.esloganEs}</p>
            </section>

            {/* 3 · ¿Por qué tally? */}
            <section className="bt-sc bt-sc-porque" aria-hidden="true">
              <div>
                <p className="bt-eb">¿Por qué tally?</p>
                <h3 className="bt-hd">
                  <Palabras texto="La luz roja que te avisa: estás al aire." />
                </h3>
                <p className="bt-t">
                  En la televisión profesional, la tally light es la pequeña luz roja sobre la cámara. Se enciende para decirle al
                  presentador que el mundo lo está viendo.
                </p>
              </div>
              <div className="bt-sw">
                <div className="bt-row on bt-r1">
                  <span className="bt-led" />
                  <div>
                    <b>Cámara 1</b>
                    <small>Tú, en tu escritorio</small>
                  </div>
                  <span className="bt-state">Al aire</span>
                </div>
                <div className="bt-row pv bt-r2">
                  <span className="bt-led" />
                  <div>
                    <b>Cámara 2</b>
                    <small>Pantalla de juego</small>
                  </div>
                  <span className="bt-state">Vista previa</span>
                </div>
                <div className="bt-row bt-r3">
                  <span className="bt-led" />
                  <div>
                    <b>Cámara 3</b>
                    <small>Plano libre</small>
                  </div>
                  <span className="bt-state">Libre</span>
                </div>
              </div>
            </section>

            {/* 4 · Manifiesto */}
            <section className="bt-sc bt-sc-manifiesto" aria-hidden="true">
              <p className="bt-q bt-q1">
                <Palabras texto="La distancia entre tu habitación y un gran estudio de televisión ya no se mide en presupuesto. Se mide en" />{' '}
                <em>
                  <Palabras texto="herramientas." />
                </em>
              </p>
              <p className="bt-q2">
                <Palabras texto="Te damos el poder, la automatización y el calibre visual que los grandes creadores tardaron años en construir." />{' '}
                <b>
                  <Palabras texto="Tu esfuerzo es real. Tu transmisión también debe serlo." />
                </b>
              </p>
            </section>
          </>
        )}

        {/* Saludo */}
        <section className="bt-sc bt-sc-saludo bt-sc-texto" aria-hidden="true">
          <p className="bt-eyebrow">{fundador ? 'Creador fundador' : `Bienvenida a ${TEXTOS.marca}`}</p>
          <div>
            <h3 className="bt-h1">
              <Palabras texto={`Hola, ${nombre}.`} />
            </h3>
            <p className="bt-h2">
              <Palabras texto={fundador ? 'Gracias por ser de los primeros.' : 'Qué bueno tenerte aquí.'} />
            </p>
          </div>
          <p className="bt-body">
            {fundador ? (
              <>
                Confiaste en Lalo Stream Suite desde el inicio. Ahora es {TEXTOS.marca}: una suite construida para creadores,{' '}
                <span className="bt-hi">
                  por creadores<span className="bt-hi-line" />
                </span>
                , y tú ayudas a darle forma.
              </>
            ) : (
              <>
                {TEXTOS.marca} reúne lo que necesitas para tu directo: voz, asistente, capas para OBS y más. Tu canal ya está
                conectado;{' '}
                <span className="bt-hi">
                  esto es lo que tienes a mano<span className="bt-hi-line" />
                </span>
                .
              </>
            )}
          </p>
        </section>

        {/* Ventajas */}
        <section className="bt-sc bt-sc-ventajas bt-sc-texto" aria-hidden="true">
          <p className="bt-eyebrow">Lo que ya tienes</p>
          <h3 className="bt-hl3">
            <Palabras texto={TEXTOS.ventajas.titulo} />
          </h3>
          <div className="bt-feats">
            <div className="bt-feat">
              <div className="bt-feat-in">
                <div className="bt-f-top">
                  <svg className="bt-f-ic" viewBox="0 0 32 32" fill="none" stroke="#ff4a4a" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                    <g className="bt-ic-wave">
                      <line x1="6" y1="13" x2="6" y2="19" />
                      <line x1="11" y1="8" x2="11" y2="24" />
                      <line x1="16" y1="4" x2="16" y2="28" />
                      <line x1="21" y1="9" x2="21" y2="23" />
                      <line x1="26" y1="13" x2="26" y2="19" />
                    </g>
                  </svg>
                </div>
                <div className="bt-f-title">{TEXTOS.ventajas.voz.titulo}</div>
                <div className="bt-f-text">{TEXTOS.ventajas.voz.texto}</div>
              </div>
            </div>
            <div className="bt-feat hot">
              <div className="bt-feat-in">
                <div className="bt-f-top">
                  <svg className="bt-f-ic" viewBox="0 0 32 32" fill="none" stroke="#ff4a4a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="16" cy="16" r="12" />
                    <path className="bt-ic-check" d="M10 16.5l4.2 4.2 8-9.2" pathLength={1} stroke="#f5f6f8" strokeDasharray={1} strokeDashoffset={0} />
                  </svg>
                  <span className="bt-f-tag new">{TEXTOS.ventajas.done.etiqueta}</span>
                </div>
                <div className="bt-f-title">{TEXTOS.ventajas.done.titulo}</div>
                <div className="bt-f-text">{TEXTOS.ventajas.done.texto}</div>
              </div>
            </div>
            <div className="bt-feat">
              <div className="bt-feat-in">
                <div className="bt-f-top">
                  <svg className="bt-f-ic" viewBox="0 0 32 32" fill="none" stroke="#ff4a4a" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
                    <polyline className="bt-ic-layer" points="4,21 16,27 28,21" />
                    <polyline className="bt-ic-layer" points="4,16 16,22 28,16" />
                    <polygon className="bt-ic-layer" points="16,5 28,11 16,17 4,11" />
                  </svg>
                </div>
                <div className="bt-f-title">{TEXTOS.ventajas.overlays.titulo}</div>
                <div className="bt-f-text">{TEXTOS.ventajas.overlays.texto}</div>
              </div>
            </div>
            <div className="bt-feat soon">
              <div className="bt-feat-in">
                <div className="bt-f-top">
                  <svg className="bt-f-ic" viewBox="0 0 32 32" fill="none" stroke="#ffb020" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <line className="bt-ic-link" x1="12" y1="16" x2="20" y2="16" />
                    <circle className="bt-ic-node" cx="7" cy="16" r="4.5" />
                    <circle className="bt-ic-node" cx="25" cy="16" r="4.5" />
                  </svg>
                  <span className="bt-f-tag soon">{TEXTOS.ventajas.integraciones.etiqueta}</span>
                </div>
                <div className="bt-f-title">{TEXTOS.ventajas.integraciones.titulo}</div>
                <div className="bt-f-text">{TEXTOS.ventajas.integraciones.texto}</div>
              </div>
            </div>
          </div>
        </section>

        {/* Cierre: se queda hasta que el creador pulsa */}
        <section className={`bt-sc bt-sc-cierre ${fundador ? 'bt-cierre-fundador' : ''}`} aria-label="Estás al aire">
          <div className="bt-glow" />
          {fundador && numero !== null && (
            <div className="bt-emblema-col">
              <div className="bt-emblema-wrap">
                <div className="bt-emblema">
                  <InsigniaFundador numero={numero} />
                  <div className="bt-sheen" />
                </div>
              </div>
              <div className="bt-plaque">{nombreEmblema(numero)}</div>
              <p className="bt-nombre">{nombre}</p>
            </div>
          )}
          <div className="bt-cierre-copy">
            {fundador ? (
              <p className="bt-eyebrow">Por confiar en nosotros</p>
            ) : (
              <BalizaTally />
            )}
            <h3 className="bt-hl5">
              <Palabras texto="Estás al aire." />
            </h3>
            {!fundador && (
              <p className="bt-pill">
                <i />
                Tu canal, tus capas y tu plan te esperan en el panel
              </p>
            )}
            {hayRegalo && (
              <div className="bt-gift-wrap">
                <div className="bt-gift">
                  <div className="bt-gift-in">
                    <div className="bt-g-num">
                      <b>{meses}</b>
                      <span>{meses === 1 ? 'mes' : 'meses'}</span>
                    </div>
                    <div className="bt-g-mid">
                      <span className="bt-g-tag">Regalo de fundador</span>
                      <span className="bt-g-title">Plan {planNombre}</span>
                      <span className="bt-g-line">{`TTS con voces incluido: ${textoMeses(meses)} sin costo.`}</span>
                      <div className="bt-segs" aria-hidden="true">
                        {Array.from({ length: Math.min(meses, 12) }, (_, i) => (
                          <span key={i} className="bt-seg">
                            <i />
                          </span>
                        ))}
                      </div>
                      <span className="bt-g-due">{estadoDue}</span>
                    </div>
                    <div className="bt-g-voice" aria-hidden="true">
                      <div className="bt-wave">
                        <i style={{ '--h': '40%' } as React.CSSProperties} />
                        <i style={{ '--h': '85%' } as React.CSSProperties} />
                        <i style={{ '--h': '55%' } as React.CSSProperties} />
                        <i style={{ '--h': '100%' } as React.CSSProperties} />
                        <i style={{ '--h': '65%' } as React.CSSProperties} />
                      </div>
                      <span>Voces</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="bt-acciones">
              {hayRegalo && (
                <button
                  type="button"
                  className={regaloListo ? 'bt-btn p' : 'bt-btn'}
                  disabled={!regalo.habilitado}
                  onClick={onActivarRegalo}
                >
                  {regalo.boton}
                </button>
              )}
              <button type="button" className={hayRegalo && regaloListo ? 'bt-btn' : 'bt-btn p'} onClick={() => cerrar('completa')}>
                Entrar a mi panel
              </button>
            </div>
            {hayRegalo && regalo.aviso && (
              <p className="bt-aviso" role="status">
                {regalo.aviso}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
