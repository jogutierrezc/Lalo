/**
 * src/pages/TournamentSignup.tsx
 *
 * Inscripción de un torneo: `#torneo/<slug>`. Página pública, se abre sin
 * iniciar sesión (como `#legal`). Es lo primero que ve gente que no conoce
 * Lalo: arriba el torneo (logo, nombre, quién organiza y sus datos), a un lado
 * el formulario y al otro las plazas de la llave con los equipos que ya están
 * dentro, y debajo los patrocinadores.
 *
 * Estados: cargando, torneo no encontrado, sin la nube, sin respuesta,
 * inscripción cerrada, torneo completo, enviando, recibida, nombre repetido y
 * demasiadas solicitudes. Los textos de cada respuesta están en
 * utils/tournamentSignup.ts.
 *
 * - Aquí solo llega lo público (tournament_public): de los equipos, el nombre.
 * - Lo que escriben los inscritos se pinta con React, nunca como HTML.
 * - El juego se nombra en texto: no hay logos de nadie más que del torneo y de
 *   sus patrocinadores.
 * - El formulario avisa pronto, pero quien valida es la base (0017).
 *
 * `?demo=` pinta datos de ejemplo SOLO en desarrollo (`npm run dev`), para ver
 * la página sin base de datos: `1` (abierta), `cerrada`, `completa`, `recibida`.
 * En producción se ignora.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Check } from 'lucide-react';
import { fetchPublicTournament, registerTeam, type PublicResult } from '../lib/tournamentSignupApi';
import { reduced } from '../utils/alertMotion';
import { inkFor } from '../utils/tournamentLogic';
import {
  REGISTER_MESSAGES,
  SIGNUP_LIMITS,
  type PublicTournament,
  type RegisterCode,
  type SignupErrors,
  type SignupRoute,
  parseSignupRoute,
  validateSignup,
} from '../utils/tournamentSignup';
import '../styles/inscripcion.css';

gsap.registerPlugin(useGSAP);

type Load = { kind: 'loading' } | PublicResult;

const readRoute = (): SignupRoute => parseSignupRoute(window.location.hash) ?? { slug: '', demo: null };

// ---------- Muestra (solo desarrollo) ----------

const DEMO: PublicTournament = {
  name: 'Copa Lalo',
  game: 'League of Legends',
  organizer: 'laloplay_',
  teamSize: 5,
  slots: 8,
  open: true,
  logo: null,
  sponsors: [
    { name: 'Café Nexo', logo: null },
    { name: 'Teclados Andes', logo: null },
  ],
  style: 'grieta',
  color: '#3ddcff',
  teams: ['Lobos del Sur', 'Dragones Rojos', 'Nexo Roto', 'Tormenta LAN', 'Furia Andina'],
  left: 3,
};

function demoTournament(mode: string): PublicTournament {
  if (mode === 'cerrada') return { ...DEMO, open: false };
  if (mode === 'completa') return { ...DEMO, teams: [...DEMO.teams, 'Cóndor Gaming', 'Kraken Norte', 'Barón Dormido'], left: 0 };
  return DEMO;
}

// ---------- Piezas ----------

/** Página entera para cuando no hay torneo que enseñar. */
const Stop: React.FC<{ title: string; children: React.ReactNode; action?: React.ReactNode }> = ({ title, children, action }) => (
  <main className="ins-stop">
    <h1>{title}</h1>
    <p>{children}</p>
    {action}
  </main>
);

const Foot: React.FC = () => (
  <footer className="ins-foot">
    <p>
      Inscripción hecha con <a href="#dashboard">Lalo Stream Suite</a>, que no está respaldada por Riot Games. <a href="#legal/privacidad">Privacidad</a>
    </p>
  </footer>
);

/** Las plazas de la llave: las ocupadas con su equipo y las libres, en su sitio. */
const Slots: React.FC<{ tournament: PublicTournament }> = ({ tournament }) => (
  <ol className="ins-slots" data-wide={tournament.slots > 8 ? '' : undefined}>
    {Array.from({ length: tournament.slots }, (_, index) => {
      const team = tournament.teams[index];
      return (
        <li key={index} data-in="slot" data-free={team ? undefined : ''}>
          <span aria-hidden="true">{index + 1}</span>
          {team ? <b>{team}</b> : <em>Plaza libre</em>}
        </li>
      );
    })}
  </ol>
);

interface FormProps {
  tournament: PublicTournament;
  slug: string;
  demo: boolean;
  onReceived: (team: string) => void;
  /** La base dijo que ya no se puede: hay que volver a leer el torneo. */
  onStale: () => void;
}

const SignupForm: React.FC<FormProps> = ({ tournament, slug, demo, onReceived, onStale }) => {
  const uid = useId();
  const others = Math.max(0, tournament.teamSize - 1);
  const [team, setTeam] = useState('');
  const [captain, setCaptain] = useState('');
  const [players, setPlayers] = useState<string[]>(() => Array.from({ length: others }, () => ''));
  const [errors, setErrors] = useState<SignupErrors>({ players: [] });
  const [notice, setNotice] = useState<RegisterCode | null>(null);
  const [sending, setSending] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  // Si el organizador cambia el tamaño de equipo mientras la página está abierta, sobran o faltan huecos
  useEffect(() => {
    setPlayers((prev) => Array.from({ length: others }, (_, index) => prev[index] ?? ''));
  }, [others]);

  /** El foco va al primer dato que hay que arreglar. */
  const focusFirstError = () => requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) return;
    setNotice(null);
    const check = validateSignup({ team, captain, players }, tournament.teamSize, tournament.teams);
    if (!check.ok) {
      setErrors(check.errors);
      focusFirstError();
      return;
    }
    setErrors({ players: [] });
    setSending(true);
    const code: RegisterCode = demo ? await new Promise<RegisterCode>((resolve) => setTimeout(() => resolve('ok'), 700)) : await registerTeam(slug, check.value);
    setSending(false);
    if (code === 'ok') {
      onReceived(check.value.team);
      return;
    }
    if (code === 'duplicate') {
      setErrors({ team: REGISTER_MESSAGES.duplicate.text, players: [] });
      focusFirstError();
      return;
    }
    setNotice(code);
    // Cerrada, completa o desaparecida: la página se pone al día y lo explica ella
    if (code === 'closed' || code === 'full' || code === 'not_found') onStale();
  };

  const setPlayer = (index: number, value: string) => setPlayers((prev) => prev.map((item, at) => (at === index ? value : item)));

  return (
    <form ref={formRef} className="ins-form" onSubmit={submit} noValidate aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`}>Inscribe a tu equipo</h2>

      <div className="cab-field">
        <label className="cab-label" htmlFor={`${uid}-team`}>
          Nombre del equipo
        </label>
        <input
          id={`${uid}-team`}
          type="text"
          className="cab-inp"
          maxLength={SIGNUP_LIMITS.team.max}
          autoComplete="off"
          enterKeyHint="next"
          value={team}
          disabled={sending}
          aria-invalid={errors.team ? 'true' : undefined}
          aria-describedby={errors.team ? `${uid}-team-err` : undefined}
          onChange={(e) => {
            setTeam(e.target.value);
            if (errors.team) setErrors((prev) => ({ ...prev, team: undefined }));
          }}
        />
        {errors.team && (
          <span id={`${uid}-team-err`} className="cab-error" role="alert">
            {errors.team}
          </span>
        )}
      </div>

      <div className="cab-field">
        <label className="cab-label" htmlFor={`${uid}-cap`}>
          Riot ID del capitán
        </label>
        <input
          id={`${uid}-cap`}
          type="text"
          className="cab-inp"
          placeholder="nombre#etiqueta"
          maxLength={SIGNUP_LIMITS.riotId + 4}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="next"
          value={captain}
          disabled={sending}
          aria-invalid={errors.captain ? 'true' : undefined}
          aria-describedby={`${uid}-cap-note`}
          onChange={(e) => {
            setCaptain(e.target.value);
            if (errors.captain) setErrors((prev) => ({ ...prev, captain: undefined }));
          }}
        />
        {errors.captain ? (
          <span id={`${uid}-cap-note`} className="cab-error" role="alert">
            {errors.captain}
          </span>
        ) : (
          <span id={`${uid}-cap-note`} className="cab-hint">
            Como sale en el cliente de {tournament.game || 'juego'}: el nombre, una almohadilla y la etiqueta.
          </span>
        )}
      </div>

      {others > 0 && (
        <fieldset className="ins-players" disabled={sending}>
          <legend className="cab-label">{others === 1 ? 'El otro jugador' : `Los otros ${others} jugadores`}</legend>
          <div className="ins-grid">
            {players.map((value, index) => {
              const problem = errors.players[index] ?? null;
              return (
                <div key={index} className="cab-field">
                  <input
                    type="text"
                    className="cab-inp"
                    aria-label={`Riot ID del jugador ${index + 2}`}
                    placeholder={`Jugador ${index + 2}: nombre#etiqueta`}
                    maxLength={SIGNUP_LIMITS.riotId + 4}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={value}
                    aria-invalid={problem ? 'true' : undefined}
                    aria-describedby={problem ? `${uid}-p${index}-err` : undefined}
                    onChange={(e) => {
                      setPlayer(index, e.target.value);
                      if (problem) setErrors((prev) => ({ ...prev, players: prev.players.map((item, at) => (at === index ? null : item)) }));
                    }}
                  />
                  {problem && (
                    <span id={`${uid}-p${index}-err`} className="cab-error" role="alert">
                      {problem}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <span className="cab-hint">Deja en blanco a quien aún no sepas: el organizador te lo pedirá más adelante.</span>
        </fieldset>
      )}

      {notice && (
        <div className="ins-alert" role="alert">
          <b>{REGISTER_MESSAGES[notice].title}</b>
          <span>{REGISTER_MESSAGES[notice].text}</span>
        </div>
      )}

      <button type="submit" className="cab-btn ins-send" disabled={sending} aria-busy={sending}>
        {sending ? 'Enviando…' : 'Inscribir equipo'}
      </button>

      <p className="ins-privacy">
        Guardamos el nombre del equipo y los Riot ID que escribas para que quien organiza pueda llevar el torneo. En público solo sale el nombre del
        equipo. <a href="#legal/privacidad">Política de privacidad</a>
      </p>
    </form>
  );
};

// ---------- Página ----------

export const TournamentSignup: React.FC = () => {
  const [route, setRoute] = useState<SignupRoute>(readRoute);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [received, setReceived] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const doneRef = useRef<HTMLHeadingElement | null>(null);

  // Datos de ejemplo: solo con el servidor de desarrollo
  const demo = import.meta.env.DEV && route.demo ? route.demo : null;

  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);

  const fetchNow = useCallback(async (): Promise<Load> => {
    if (demo) return { kind: 'ok', tournament: demoTournament(demo) };
    return fetchPublicTournament(route.slug);
  }, [demo, route.slug]);

  // Otro torneo (o la primera vez): se empieza de cero
  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'loading' });
    setReceived(demo === 'recibida' ? 'Zorros Grises' : null);
    void fetchNow().then((next) => {
      if (alive) setLoad(next);
    });
    return () => {
      alive = false;
    };
  }, [fetchNow, demo]);

  /** Vuelve a leer el torneo sin borrar lo que hay en pantalla. */
  const refresh = useCallback(() => {
    void fetchNow().then((next) => {
      // Un fallo al refrescar no tira la página que ya se estaba viendo
      setLoad((prev) => (next.kind === 'error' && prev.kind === 'ok' ? prev : next));
    });
  }, [fetchNow]);

  const tournament = load.kind === 'ok' ? load.tournament : null;

  useEffect(() => {
    const previous = document.title;
    document.title = tournament ? `${tournament.name}: inscripción | Lalo Stream Suite` : 'Inscripción | Lalo Stream Suite';
    return () => {
      document.title = previous;
    };
  }, [tournament]);

  // Al recibir la solicitud, el foco va a la confirmación para que un lector de pantalla la lea
  useEffect(() => {
    if (received) doneRef.current?.focus({ preventScroll: false });
  }, [received]);

  // Entrada: primero el torneo, luego sus plazas, una a una. Con «reducir movimiento», nada se mueve
  useGSAP(
    () => {
      if (!pageRef.current || load.kind !== 'ok' || reduced()) return;
      const q = gsap.utils.selector(pageRef);
      const tl = gsap
        .timeline({ defaults: { ease: 'expo.out', clearProps: 'transform,opacity' } })
        .fromTo(q('[data-in="block"]'), { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.42, stagger: 0.06 })
        .fromTo(q('[data-in="slot"]'), { x: -8, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, stagger: 0.025 }, 0.18);
      // Si el navegador frena la animación (pestaña en segundo plano), la página queda entera igual
      const settle = window.setTimeout(() => tl.progress(1), 1500);
      return () => window.clearTimeout(settle);
    },
    { dependencies: [load.kind, route.slug], scope: pageRef, revertOnUpdate: true }
  );

  // La confirmación entra (el formulario se va sin esperar a nadie); el visto bueno, con un pequeño rebote
  useGSAP(
    () => {
      if (!pageRef.current || !received || reduced()) return;
      const q = gsap.utils.selector(pageRef);
      const tl = gsap
        .timeline({ defaults: { clearProps: 'transform,opacity' } })
        .fromTo(q('.ins-done'), { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.32, ease: 'expo.out' })
        .fromTo(q('.ins-tick'), { scale: 0.6 }, { scale: 1, duration: 0.4, ease: 'back.out(2)' }, 0.06);
      const settle = window.setTimeout(() => tl.progress(1), 900);
      return () => window.clearTimeout(settle);
    },
    { dependencies: [received, load.kind], scope: pageRef, revertOnUpdate: true }
  );

  if (load.kind === 'loading') {
    return (
      <div className="cab ins">
        <main className="ins-stop" aria-busy="true">
          <p role="status">Cargando el torneo…</p>
        </main>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="cab ins">
        {load.kind === 'not_found' && <Stop title={REGISTER_MESSAGES.not_found.title}>{REGISTER_MESSAGES.not_found.text}</Stop>}
        {load.kind === 'no_cloud' && (
          <Stop title="La inscripción no está disponible aquí">
            Esta instalación de Lalo no tiene la nube encendida, y la inscripción por enlace la necesita. Avisa a quien te pasó el enlace.
          </Stop>
        )}
        {load.kind === 'error' && (
          <Stop
            title="No se pudo cargar el torneo"
            action={
              <button
                type="button"
                className="cab-btn"
                onClick={() => {
                  setLoad({ kind: 'loading' });
                  void fetchNow().then(setLoad);
                }}
              >
                Volver a intentar
              </button>
            }
          >
            No hubo respuesta del servidor. Comprueba tu conexión y vuelve a intentarlo.
          </Stop>
        )}
        <Foot />
      </div>
    );
  }

  const inside = tournament.teams.length;
  const full = tournament.left === 0;
  const accent = tournament.color;
  const blocked = !tournament.open ? 'closed' : full ? 'full' : null;

  return (
    <div
      className="cab ins"
      ref={pageRef}
      style={accent ? ({ '--ins-acc': accent, '--ins-acc-ink': inkFor(accent) } as React.CSSProperties) : undefined}
    >
      <div className="ins-page">
        <header className="ins-head" data-in="block">
          {tournament.logo && (
            <div className="ins-logo">
              <img src={tournament.logo} alt="" />
            </div>
          )}
          <div className="ins-id">
            <h1>{tournament.name}</h1>
            <p className="ins-org">
              {tournament.game}
              {tournament.organizer && (
                <>
                  {' '}
                  · Organiza <b>{tournament.organizer}</b>
                </>
              )}
            </p>
            <ul className="ins-facts" aria-label="Datos del torneo">
              <li className="cab-chip">
                {tournament.teamSize} contra {tournament.teamSize}
              </li>
              <li className="cab-chip">Eliminación directa</li>
              <li className="cab-chip">{tournament.slots} equipos</li>
              <li className="cab-chip" data-status={blocked ? 'skipped' : 'read'}>
                {!tournament.open ? 'Inscripción cerrada' : full ? 'Completo' : tournament.left === 1 ? 'Queda 1 plaza' : `Quedan ${tournament.left} plazas`}
              </li>
            </ul>
          </div>
        </header>

        <main className="ins-body">
          <section className="cab-mod ins-main" data-in="block">
            {received ? (
              <div className="ins-done">
                <span className="ins-tick" aria-hidden="true">
                  <Check className="h-5 w-5" />
                </span>
                <h2 ref={doneRef} tabIndex={-1}>
                  {REGISTER_MESSAGES.ok.title}
                </h2>
                <p>
                  <b>{received}</b>: tu equipo queda pendiente de que el organizador lo acepte. Cuando lo haga, su nombre aparecerá en la lista de
                  equipos de esta página.
                </p>
                <p className="cab-hint">No hace falta que vuelvas a enviarla. Si te equivocaste en algún dato, díselo al organizador.</p>
                <div>
                  <button type="button" className="cab-btn2" onClick={() => setReceived(null)}>
                    Inscribir otro equipo
                  </button>
                </div>
              </div>
            ) : blocked ? (
              <div className="ins-closed">
                <h2>{REGISTER_MESSAGES[blocked].title}</h2>
                <p>{REGISTER_MESSAGES[blocked].text}</p>
              </div>
            ) : (
              <SignupForm
                tournament={tournament}
                slug={route.slug}
                demo={demo !== null}
                onReceived={(team) => {
                  setReceived(team);
                  refresh();
                }}
                onStale={refresh}
              />
            )}
          </section>

          <aside className="ins-side" data-in="block" aria-labelledby="ins-teams">
            <div className="ins-side-h">
              <h2 id="ins-teams">Equipos</h2>
              <span className="ins-count">
                {inside} de {tournament.slots}
              </span>
            </div>
            <Slots tournament={tournament} />
            {inside === 0 && <p className="cab-hint">Todavía no hay ningún equipo dentro. Los que el organizador acepte irán saliendo aquí.</p>}

            {tournament.sponsors.length > 0 && (
              <div className="ins-sp">
                <span>Con el apoyo de</span>
                <ul>
                  {tournament.sponsors.map((sponsor, index) => (
                    <li key={index}>{sponsor.logo ? <img src={sponsor.logo} alt={sponsor.name || 'Patrocinador'} /> : <b>{sponsor.name}</b>}</li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </main>

        <Foot />
      </div>
    </div>
  );
};
