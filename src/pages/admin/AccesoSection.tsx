/**
 * src/pages/admin/AccesoSection.tsx
 *
 * Mi acceso: con qué correo entra el administrador, su rol, el cambio de clave
 * y el cierre de sesión.
 */

import React, { useId, useState } from 'react';
import { useCloudSession } from '../../hooks/useCloudSession';
import { PASSWORD_MIN, passwordChangeProblem, passwordProblem } from '../../lib/adminLogic';
import { updateOwnPassword } from '../../lib/cloud';

export const AccesoSection: React.FC = () => {
  const { session, profile, signOut } = useCloudSession();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [show, setShow] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const close = () => {
    setOpen(false);
    setPassword('');
    setRepeat('');
    setProblem(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const invalid = passwordProblem(password, repeat);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    setSaving(true);
    setProblem(null);
    const error = await updateOwnPassword(password);
    setSaving(false);
    if (error) {
      setProblem(passwordChangeProblem(error));
      return;
    }
    close();
    setDone(true);
  };

  return (
    <section className="cab-mod adm-narrow">
      <h2>Mi acceso</h2>
      <dl className="adm-kv">
        <dt>Correo</dt>
        <dd>{session?.user.email || 'Sin correo'}</dd>
        <dt>Rol</dt>
        <dd>Administrador</dd>
        <dt>Canal de Twitch</dt>
        <dd>{profile?.twitch_login ? `#${profile.twitch_login}` : 'Ninguno: esta cuenta no emite'}</dd>
      </dl>

      {done && (
        <p className="cab-note adm-note-ok" role="status">
          Clave cambiada. La próxima vez entra con la nueva.
        </p>
      )}

      {open ? (
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <div className="cab-field">
            <label className="cab-label" htmlFor={`${uid}-new`}>
              Clave nueva
            </label>
            <input
              id={`${uid}-new`}
              type={show ? 'text' : 'password'}
              className="cab-inp"
              value={password}
              autoComplete="new-password"
              autoFocus
              aria-describedby={`${uid}-hint`}
              aria-invalid={problem ? true : undefined}
              onChange={(e) => setPassword(e.target.value)}
            />
            <span id={`${uid}-hint`} className="cab-hint">
              Al menos {PASSWORD_MIN} caracteres. Guárdala en un gestor de contraseñas: Lalo no tiene «olvidé mi clave»
              para el administrador.
            </span>
          </div>
          <div className="cab-field">
            <label className="cab-label" htmlFor={`${uid}-repeat`}>
              Repite la clave
            </label>
            <input
              id={`${uid}-repeat`}
              type={show ? 'text' : 'password'}
              className="cab-inp"
              value={repeat}
              autoComplete="new-password"
              aria-invalid={problem ? true : undefined}
              onChange={(e) => setRepeat(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <input id={`${uid}-show`} type="checkbox" className="cab-tog" checked={show} onChange={(e) => setShow(e.target.checked)} />
            <label htmlFor={`${uid}-show`}>Ver lo que escribo</label>
          </div>
          {problem && (
            <p className="cab-error" role="alert">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="cab-btn" disabled={saving}>
              {saving ? 'Guardando' : 'Guardar clave nueva'}
            </button>
            <button type="button" className="cab-btn2" onClick={close} disabled={saving}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="cab-btn2"
            onClick={() => {
              setOpen(true);
              setDone(false);
            }}
          >
            Cambiar clave
          </button>
          <button type="button" className="cab-btn2" onClick={signOut}>
            Cerrar sesión
          </button>
        </div>
      )}

      <p className="cab-hint">
        Si algún día quieres usar Lalo en tu propio canal, entra con Twitch como un streamer más: será otra cuenta, con su
        propio plan.
      </p>
    </section>
  );
};
