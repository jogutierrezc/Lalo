/**
 * src/components/torneo/SignupPanel.tsx
 *
 * La inscripción por enlace dentro de la pestaña «Torneo» del panel. Dos
 * módulos:
 *
 * - Inscripción por enlace: la dirección `#torneo/<slug>` con el slug editable
 *   (se propone uno a partir del nombre y se avisa si ya es de otro torneo),
 *   copiar, abrir y el interruptor «Inscripción abierta».
 * - Solicitudes: las inscripciones pendientes, con el equipo, el Riot ID del
 *   capitán y los jugadores, y Aceptar, Rechazar y Quitar. Debajo, las ya
 *   respondidas, para consultar sus datos o quitarlas.
 *
 * Aceptar mete al equipo en la llave: eso lo hace la página (`admit`), que es
 * quien sabe si la llave ya empezó y hay que confirmarlo. A la llave solo pasa
 * el nombre del equipo; los Riot ID se quedan en la solicitud.
 *
 * Sin nube o sin cuenta activa se explica en una línea. Lo que escriben los
 * inscritos se pinta con React, nunca como HTML.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { Toggle } from '../studio/StudioKit';
import type { useTournamentSignup } from '../../hooks/useTournamentSignup';
import { type TournamentEntry, SLUG_LIMITS, draftSlug, proposeSlug, signupHash, signupUrl, slugProblem } from '../../utils/tournamentSignup';

interface SignupPanelProps {
  signup: ReturnType<typeof useTournamentSignup>;
  /** Nombre del torneo: de él sale el slug propuesto. */
  name: string;
  /** Plazas libres en la llave. */
  free: number;
  /**
   * Mete en la llave al equipo de una solicitud y llama a `done` cuando ya está
   * dentro (si la llave había empezado, tras confirmarlo). Devuelve por qué no
   * se puede, o null.
   */
  admit: (entry: TournamentEntry, done: () => void) => string | null;
  /** Pide confirmación dentro de la página antes de algo que no se puede deshacer. */
  confirm: (label: string, yes: string, run: () => void) => void;
}

const when = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const STATUS_NAMES = { pending: 'Pendiente', accepted: 'Aceptada', rejected: 'Rechazada' } as const;

const EntryText: React.FC<{ entry: TournamentEntry }> = ({ entry }) => (
  <div className="tnp-req-t">
    <b>{entry.team}</b>
    <span>
      <span className="cab-label">Capitán</span> <code>{entry.captain}</code>
    </span>
    {entry.players.length > 0 && (
      <span>
        <span className="cab-label">Jugadores</span>{' '}
        {entry.players.map((player, index) => (
          <React.Fragment key={index}>
            {index > 0 && ', '}
            <code>{player}</code>
          </React.Fragment>
        ))}
      </span>
    )}
    {when(entry.createdAt) && <span className="cab-hint">Enviada el {when(entry.createdAt)}</span>}
  </div>
);

export const SignupPanel: React.FC<SignupPanelProps> = ({ signup, name, free, admit, confirm }) => {
  const uid = useId();
  const { status, own, pending, answered } = signup;
  const [draft, setDraft] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkNote, setLinkNote] = useState<{ bad: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState<number | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // El campo enseña el slug guardado; sin enlace todavía, el propuesto a partir del nombre (hasta que se toque)
  useEffect(() => {
    if (touched) return;
    setDraft(own?.slug ?? proposeSlug(name));
  }, [own?.slug, name, touched]);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  if (status === 'off') {
    return (
      <p className="cab-note">
        La inscripción por enlace necesita la nube: con tu cuenta de Lalo abierta, cada capitán apunta a su equipo desde una dirección que tú compartes.
        Sin ella, los equipos se escriben aquí debajo, como siempre.
      </p>
    );
  }
  if (status === 'loading') return <p className="cab-hint">Cargando tu enlace de inscripción…</p>;
  if (status === 'error') {
    return (
      <p className="cab-note" role="status">
        No se pudo leer tu enlace de inscripción. Comprueba tu conexión y recarga la página; si acabas de actualizar Lalo, puede faltar aplicar en
        Supabase la migración 0017. Mientras tanto, los equipos se escriben aquí debajo.
      </p>
    );
  }

  const problem = slugProblem(draft);
  const changed = draft !== (own?.slug ?? '');
  const url = own ? signupUrl(window.location.origin, own.slug) : '';

  const saveLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (problem || saving) return;
    setSaving(true);
    const result = await signup.saveLink(draft);
    setSaving(false);
    if (result === 'ok') {
      setTouched(false);
      setLinkNote({ bad: false, text: own ? 'Dirección cambiada. El enlace anterior ya no funciona: comparte el nuevo.' : 'Enlace creado. Ya puedes compartirlo.' });
    } else if (result === 'taken') {
      setLinkNote({ bad: true, text: `«${draft}» ya es la dirección de otro torneo. Cámbiala un poco, por ejemplo «${`${draft}-2`.slice(0, SLUG_LIMITS.max)}».` });
    } else {
      setLinkNote({ bad: true, text: 'No se pudo guardar el enlace. Comprueba tu conexión y vuelve a intentarlo.' });
    }
  };

  const copy = () => {
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 2200);
      })
      .catch(() => setLinkNote({ bad: true, text: 'No se pudo copiar. Selecciona la dirección y cópiala a mano.' }));
  };

  const toggleOpen = async (open: boolean) => {
    const ok = await signup.setOpen(open);
    setLinkNote(ok ? null : { bad: true, text: 'No se pudo guardar el cambio. Comprueba tu conexión y vuelve a intentarlo.' });
  };

  const removeLink = () =>
    confirm(
      'Borrar el enlace cierra la página de inscripción y borra todas las solicitudes con sus Riot ID. Los equipos que ya están en la llave se quedan.',
      'Borrar el enlace y las solicitudes',
      () => {
        void signup.removeLink().then((ok) => {
          setTouched(false);
          setLinkNote(ok ? { bad: false, text: 'Enlace y solicitudes borrados.' } : { bad: true, text: 'No se pudo borrar. Comprueba tu conexión y vuelve a intentarlo.' });
        });
      }
    );

  const run = async (entry: TournamentEntry, action: () => Promise<boolean>, failed: string) => {
    setWorking(entry.id);
    const ok = await action();
    setWorking(null);
    setNote(ok ? null : failed);
  };
  const accept = (entry: TournamentEntry) => {
    const reason = admit(entry, () => {
      void run(
        entry,
        () => signup.mark(entry.id, 'accepted'),
        `${entry.team} ya está en la llave, pero la solicitud no se pudo marcar como aceptada. Vuelve a pulsar Aceptar: no se añadirá dos veces.`
      );
    });
    setNote(reason);
  };
  const reject = (entry: TournamentEntry) => void run(entry, () => signup.mark(entry.id, 'rejected'), 'No se pudo rechazar la solicitud. Vuelve a intentarlo.');
  const remove = (entry: TournamentEntry) => void run(entry, () => signup.remove(entry.id), 'No se pudo quitar la solicitud. Vuelve a intentarlo.');

  return (
    <>
      <section className="cab-mod">
        <h2>Inscripción por enlace</h2>
        <form className="cab-field" onSubmit={saveLink}>
          <label className="cab-label" htmlFor={`${uid}-slug`}>
            Dirección de la inscripción
          </label>
          <div className="tnp-link">
            <div className="tnp-slug">
              <span aria-hidden="true">#torneo/</span>
              <input
                id={`${uid}-slug`}
                type="text"
                className="cab-inp cab-mono"
                maxLength={SLUG_LIMITS.max}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="none"
                value={draft}
                aria-invalid={linkNote?.bad ? 'true' : undefined}
                aria-describedby={`${uid}-slug-note`}
                onChange={(e) => {
                  setTouched(true);
                  setDraft(draftSlug(e.target.value));
                  setLinkNote(null);
                }}
              />
            </div>
            <button type="submit" className={own && !changed ? 'cab-btn2' : 'cab-btn'} disabled={saving || Boolean(problem) || (Boolean(own) && !changed)}>
              {saving ? 'Guardando…' : own ? 'Cambiar dirección' : 'Crear enlace'}
            </button>
          </div>
          <span id={`${uid}-slug-note`} className={linkNote?.bad ? 'cab-error' : 'cab-hint'} role="status">
            {linkNote?.text ??
              (changed && problem
                ? problem
                : own
                  ? 'Quien abra esa dirección ve tu torneo y puede inscribir a su equipo, sin cuenta.'
                  : 'Te proponemos una a partir del nombre. Al crear el enlace se publican el nombre, el juego, el logo y los patrocinadores del torneo.')}
          </span>
        </form>

        {own && (
          <>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="cab-btn" onClick={copy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied ? 'Enlace copiado' : 'Copiar enlace'}</span>
              </button>
              <a className="cab-btn2" href={signupHash(own.slug)} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                <span>Ver la página</span>
              </a>
            </div>
            <div className="cab-field">
              <Toggle label="Inscripción abierta" checked={own.open} onChange={(open) => void toggleOpen(open)} />
              <span className="cab-hint">
                {own.open
                  ? free > 0
                    ? `La página admite solicitudes. ${free === 1 ? 'Queda 1 plaza' : `Quedan ${free} plazas`} en la llave.`
                    : 'La llave está completa: la página lo dice y no admite más solicitudes hasta que quites un equipo o agrandes la llave.'
                  : 'Cerrada: la página enseña el torneo y sus equipos, pero no el formulario.'}
              </span>
            </div>
            {signup.publishFailed && (
              <p className="cab-error" role="alert">
                Los últimos cambios del torneo no se pudieron publicar en la página de inscripción. Se reintenta con el siguiente cambio.
              </p>
            )}
            <div>
              <button type="button" className="cab-btn2 cab-btn-sm" onClick={removeLink}>
                Borrar el enlace y sus solicitudes
              </button>
            </div>
          </>
        )}
      </section>

      {own && (
        <section className="cab-mod">
          <div className="flex items-center justify-between gap-3">
            <h2>
              Solicitudes
              {pending.length > 0 && <b className="cab-chip" data-status="skipped">{pending.length === 1 ? '1 pendiente' : `${pending.length} pendientes`}</b>}
            </h2>
            <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => void signup.refresh()}>
              <RefreshCw className="h-4 w-4" />
              <span>Actualizar</span>
            </button>
          </div>

          {pending.length === 0 ? (
            <p className="cab-hint">
              No hay solicitudes pendientes. Las nuevas aparecen aquí solas en unos segundos{own.open ? '' : '; ahora la inscripción está cerrada'}.
            </p>
          ) : (
            <ul className="tnp-reqs">
              {pending.map((entry) => (
                <li key={entry.id} className="tnp-req">
                  <EntryText entry={entry} />
                  <div className="tnp-req-a">
                    <button type="button" className="cab-btn cab-btn-sm" disabled={working === entry.id} onClick={() => accept(entry)}>
                      Aceptar
                    </button>
                    <button type="button" className="cab-btn2 cab-btn-sm" disabled={working === entry.id} onClick={() => reject(entry)}>
                      Rechazar
                    </button>
                    <button type="button" className="cab-btn2 cab-btn-sm" disabled={working === entry.id} aria-label={`Quitar la solicitud de ${entry.team}`} onClick={() => remove(entry)}>
                      Quitar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {note && (
            <p className="cab-error" role="alert">
              {note}
            </p>
          )}
          <p className="cab-hint">
            Aceptar mete al equipo en la llave, al final de la lista. Rechazar guarda la solicitud como rechazada 30 días; Quitar la borra ya, con sus
            Riot ID. A la llave pasa solo el nombre del equipo.
          </p>

          {answered.length > 0 && (
            <details className="tnp-done">
              <summary>Respondidas ({answered.length})</summary>
              <ul className="tnp-reqs">
                {answered.map((entry) => (
                  <li key={entry.id} className="tnp-req">
                    <EntryText entry={entry} />
                    <div className="tnp-req-a">
                      <span className="cab-chip" data-status={entry.status === 'accepted' ? 'read' : 'rejected'}>
                        {STATUS_NAMES[entry.status]}
                      </span>
                      {entry.status === 'rejected' && (
                        <button type="button" className="cab-btn2 cab-btn-sm" disabled={working === entry.id} onClick={() => accept(entry)}>
                          Aceptar
                        </button>
                      )}
                      <button type="button" className="cab-btn2 cab-btn-sm" disabled={working === entry.id} aria-label={`Quitar la solicitud de ${entry.team}`} onClick={() => remove(entry)}>
                        Quitar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="cab-hint">Quitar una solicitud aceptada borra sus datos, pero no saca al equipo de la llave: eso se hace en «Equipos».</p>
            </details>
          )}
        </section>
      )}
    </>
  );
};
