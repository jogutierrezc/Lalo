/**
 * src/pages/Legal.tsx
 *
 * Términos y políticas: página pública, se lee sin iniciar sesión y con la nube
 * apagada. Índice de documentos a la izquierda (una fila que se desliza en
 * pantallas estrechas) y el documento a la derecha, con su versión y su fecha.
 *
 * Direcciones: #legal, #legal/voces, #legal/paises/mexico (documento y sección).
 * Los textos viven en src/legal; los datos del operador, en src/legal/datos.ts.
 * Mientras falte alguno, arriba sale el aviso «Borrador: faltan datos».
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { reduced } from '../utils/alertMotion';
import { DOCUMENTOS, documento } from '../legal';
import { DATOS_LEGALES, ESTADO_LEGAL } from '../legal/datos';
import { datosFaltantes, hrefLegal, parseRutaLegal, partirTexto, type RutaLegal } from '../legal/logica';
import type { Bloque } from '../legal/tipos';
import '../styles/legal.css';

gsap.registerPlugin(useGSAP);

const leerRuta = (): RutaLegal => parseRutaLegal(window.location.hash) ?? { doc: DOCUMENTOS[0].id, seccion: null };

const fechaLarga = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });

/** Texto con negritas y enlaces. */
const Texto: React.FC<{ children: string }> = ({ children }) => (
  <>
    {partirTexto(children).map((trozo, i) =>
      trozo.tipo === 'negrita' ? (
        <b key={i}>{trozo.texto}</b>
      ) : trozo.tipo === 'enlace' ? (
        <a key={i} href={trozo.href} {...(trozo.externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {trozo.texto}
        </a>
      ) : (
        <React.Fragment key={i}>{trozo.texto}</React.Fragment>
      )
    )}
  </>
);

const Pieza: React.FC<{ bloque: Bloque }> = ({ bloque }) => {
  if (bloque.tipo === 'p') {
    return (
      <p>
        <Texto>{bloque.texto}</Texto>
      </p>
    );
  }
  if (bloque.tipo === 'h3') return <h3>{bloque.texto}</h3>;
  const Lista = bloque.tipo;
  return (
    <Lista>
      {bloque.items.map((item, i) => (
        <li key={i}>
          <Texto>{item}</Texto>
        </li>
      ))}
    </Lista>
  );
};

export const Legal: React.FC = () => {
  const [ruta, setRuta] = useState<RutaLegal>(leerRuta);
  const docRef = useRef<HTMLElement | null>(null);
  const tituloRef = useRef<HTMLHeadingElement | null>(null);
  // El foco solo se mueve cuando la persona cambia de documento, no al abrir la página
  const ultima = useRef<string | null>(null);

  useEffect(() => {
    const onChange = () => setRuta(leerRuta());
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);

  const doc = documento(ruta.doc);
  const secciones = useMemo(() => doc.secciones(DATOS_LEGALES), [doc]);
  const faltan = useMemo(() => datosFaltantes(DATOS_LEGALES), []);

  useEffect(() => {
    const previo = document.title;
    document.title = `${doc.titulo} | Lalo Stream Suite`;
    return () => {
      document.title = previo;
    };
  }, [doc.titulo]);

  // Al cambiar de documento o de sección: arriba del todo o a la sección pedida
  useEffect(() => {
    const clave = `${ruta.doc}/${ruta.seccion ?? ''}`;
    if (ultima.current === clave) return;
    const alAbrir = ultima.current === null;
    ultima.current = clave;
    const destino = ruta.seccion ? document.getElementById(`lg-${ruta.seccion}`) : null;
    if (destino) {
      destino.scrollIntoView({ behavior: alAbrir || reduced() ? 'auto' : 'smooth', block: 'start' });
      if (!alAbrir) destino.focus({ preventScroll: true });
    } else if (!alAbrir) {
      docRef.current?.scrollIntoView({ block: 'start' });
      tituloRef.current?.focus({ preventScroll: true });
    }
  }, [ruta.doc, ruta.seccion]);

  useGSAP(
    () => {
      // Con «reducir movimiento» el documento aparece sin transición
      if (!docRef.current || reduced()) return;
      gsap.fromTo(
        docRef.current.children,
        { y: 8, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.3, ease: 'expo.out', stagger: 0.02, clearProps: 'transform,opacity' }
      );
    },
    { dependencies: [ruta.doc], scope: docRef, revertOnUpdate: true }
  );

  return (
    <div className="cab lg">
      <div className="lg-page">
        <header className="lg-top">
          <div>
            <p className="cab-label">Lalo Stream Suite</p>
            <p className="lg-marca">Términos y políticas</p>
          </div>
          <div className="lg-top-actions">
            <ThemeSwitch />
            <a className="cab-btn2 cab-btn-sm" href="#dashboard">
              Ir a Lalo
            </a>
          </div>
        </header>

        {faltan.length > 0 && (
          <div className="lg-aviso" role="note">
            <b>Borrador: faltan datos</b>
            <p>Estos documentos todavía no están completos. Falta que el operador indique:</p>
            <ul>
              {faltan.map((dato) => (
                <li key={dato}>{dato}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="lg-legal">
          <nav className="lg-toc" aria-label="Documentos">
            <p className="cab-caps">Documentos</p>
            {DOCUMENTOS.map((item) => (
              <a key={item.id} href={hrefLegal(item.id)} aria-current={item.id === doc.id ? 'page' : undefined}>
                {item.titulo}
              </a>
            ))}
          </nav>

          <article ref={docRef} className="lg-doc" aria-labelledby="lg-titulo">
            <h1 id="lg-titulo" ref={tituloRef} tabIndex={-1}>
              {doc.titulo}
            </h1>
            <p className="lg-meta">
              Versión {doc.version}
              {ESTADO_LEGAL === 'borrador' ? ' · borrador' : ''} · Actualizado el {fechaLarga(doc.updatedAt)} · {DATOS_LEGALES.operador}
            </p>
            {secciones.map((seccion) => (
              <section key={seccion.id} id={`lg-${seccion.id}`} tabIndex={-1} aria-label={seccion.titulo ?? undefined}>
                {seccion.titulo && <h2>{seccion.titulo}</h2>}
                {seccion.bloques.map((bloque, i) => (
                  <Pieza key={i} bloque={bloque} />
                ))}
              </section>
            ))}
          </article>
        </div>
      </div>
    </div>
  );
};
