/**
 * src/pages/Access.tsx
 *
 * Pantalla de acceso y primera parte de la bienvenida de streamers: los pasos
 * que ocurren antes de ir a Twitch. Los streamers no tienen contraseña en Lalo.
 *
 * Hay dos caminos con los mismos pasos en distinto orden (ver src/lib/recorrido.ts):
 *   - Empezar con Twitch: Entrar, Conectar Twitch (qué pedimos) y a Twitch.
 *   - Empezar con el código: Entrar, Código de invitación, Conectar Twitch y a Twitch.
 * El código se comprueba antes de ir a Twitch y se canjea al volver. Un enlace
 * de invitación (?codigo=LALO-...) abre el paso del código ya escrito. Lo que
 * pasa después de Twitch está en src/pages/Bienvenida.tsx.
 *
 * Fuera del recorrido siguen igual la recuperación de cuenta y la entrada del
 * administrador, con correo y clave de administración (usuario de Supabase con
 * contraseña). Si esa cuenta aún no tiene el rol, se le explica cómo conseguirlo.
 *
 * Todos los pasos comparten el mismo fondo (aurora y foco de luz) y el panel de
 * cristal; los estilos están en src/styles/acceso.css y src/styles/recorrido.css.
 */

import React, { useEffect, useId, useState } from 'react';
import { useCloudSession } from '../hooks/useCloudSession';
import { rpc, setCaminoElegido, setPendingCode, signInAdmin, signInWithTwitch } from '../lib/cloud';
import { hasTwitchIdentity, readInviteCode } from '../lib/access';
import { INVITE_PROBLEM, outcomeMessage } from '../lib/accesoMensajes';
import { pasoAnterior, pasoSiguiente, type Camino } from '../lib/recorrido';
import type { InviteStatus } from '../lib/cloudTypes';
import { LateralRecorrido, MarcoRecorrido, TarjetaPlan, TituloPaso, usePasoAnimado } from '../components/recorrido/piezas';

type Step = 'entrar' | 'permisos' | 'codigo' | 'recover' | 'recovery-code' | 'admin';
const DEL_RECORRIDO: Step[] = ['entrar', 'permisos', 'codigo'];

interface AccessProps {
  /** Paso con el que se abre. Lo usa la bienvenida para llevar a la recuperación de cuenta. */
  inicio?: 'recovery-code';
  /** Con él, «Volver» en la recuperación regresa a la bienvenida. */
  onVolver?: () => void;
}

export const Access: React.FC<AccessProps> = ({ inicio, onVolver }) => {
  const { session, profile, outcome, error, redeem, refresh, signOut, loading } = useCloudSession();
  const uid = useId();
  // Código que llega en un enlace de invitación (?codigo=)
  const [invited] = useState(() => readInviteCode(window.location.search));
  const [camino, setCamino] = useState<Camino>(invited ? 'co' : 'tw');
  const [step, setStep] = useState<Step>(inicio ?? (invited ? 'codigo' : 'entrar'));
  const [code, setCode] = useState(invited ?? '');
  const [email, setEmail] = useState('');
  const [adminKey, setAdminKey] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [validPlan, setValidPlan] = useState<string | null>(null);

  const signedIn = Boolean(session);
  const withTwitch = hasTwitchIdentity(session?.user);
  const suspended = signedIn && profile?.status === 'suspended';
  // Cuenta con correo y clave que todavía no es administradora: no es un streamer
  const adminWaiting = signedIn && !withTwitch && !suspended && profile?.status !== 'active';
  const pending = signedIn && withTwitch && profile?.status === 'pending';
  const who = profile?.display_name || profile?.twitch_login || session?.user.email || 'tu cuenta de Twitch';
  const comprobando = loading || (signedIn && !profile && busy);

  const clave = `${step}|${suspended}|${adminWaiting}|${comprobando}`;
  const { ref: stepRef, salir } = usePasoAnimado(clave);

  // La entrada del administrador queda en espera hasta que llega su perfil
  // (o unos segundos, si el perfil no existe), para no enseñar antes de tiempo
  // el aviso de que falta el rol
  useEffect(() => {
    if (profile) setBusy(false);
  }, [profile]);
  useEffect(() => {
    if (!signedIn) return;
    const timer = setTimeout(() => setBusy(false), 4000);
    return () => clearTimeout(timer);
  }, [signedIn]);

  /** Cambia de paso: el contenido sale y entra el nuevo. El código escrito solo se conserva dentro del recorrido. */
  const go = (next: Step, nextCamino: Camino = camino) =>
    salir(() => {
      const sigueEnRecorrido = next === 'permisos' || next === 'codigo';
      setCamino(nextCamino);
      setStep(next);
      setProblem(null);
      setAdminKey('');
      if (!sigueEnRecorrido) {
        setCode('');
        setValidPlan(null);
      }
    });

  const atras = () => go((pasoAnterior(camino, step as 'permisos' | 'codigo') as Step | null) ?? 'entrar');

  const enterAsAdmin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !adminKey) return;
    setBusy(true);
    setProblem(null);
    const failure = await signInAdmin(email, adminKey);
    if (failure) {
      setProblem(failure);
      setBusy(false);
      return;
    }
    setAdminKey('');
  };

  const recheckRole = async () => {
    setBusy(true);
    setChecked(false);
    await refresh();
    setChecked(true);
    setBusy(false);
  };

  const enter = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await signInWithTwitch();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'No se pudo abrir Twitch. Inténtalo de nuevo.');
      setBusy(false);
    }
  };

  /** Paso «Conectar Twitch»: recuerda el camino y, si empezó por el código, lo deja listo para canjearlo al volver. */
  const continueToTwitch = () => {
    setCaminoElegido(camino);
    setPendingCode(camino === 'co' && code.trim() ? { kind: 'invite', code: code.trim() } : null);
    enter();
  };

  const checkInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    const clean = code.trim();
    if (!clean) {
      setProblem('Escribe tu código para continuar.');
      return;
    }
    setBusy(true);
    setProblem(null);
    setValidPlan(null);
    try {
      const [row] = await rpc('check_invite', { p_code: clean });
      if (!row || row.status !== 'valid') setProblem(INVITE_PROBLEM[(row?.status as Exclude<InviteStatus, 'valid'>) || 'not_found']);
      else setValidPlan(row.plan_name || 'Tu plan');
    } catch (err) {
      setProblem(err instanceof Error ? `No se pudo comprobar el código: ${err.message}` : 'No se pudo comprobar el código.');
    }
    setBusy(false);
  };

  const submitRecovery = async (event: React.FormEvent) => {
    event.preventDefault();
    const clean = code.trim();
    if (!clean) return;
    if (!signedIn) {
      setPendingCode({ kind: 'recovery', code: clean });
      enter();
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await redeem('recovery', clean);
    if (result.kind === 'error' || result.result !== 'ok') setProblem(outcomeMessage(result));
    setBusy(false);
  };

  const notice = problem || outcomeMessage(outcome) || error;
  const enRecorrido = !comprobando && !suspended && !adminWaiting && DEL_RECORRIDO.includes(step);

  const lateral = enRecorrido ? (
    <LateralRecorrido camino={camino} paso={step as 'entrar' | 'permisos' | 'codigo'} />
  ) : (
    <>
      <div>
        <p className="cab-label">Lalo Stream Suite</p>
        <h1>Tu directo, tu mesa de control</h1>
      </div>
      <ul>
        <li>
          <b>Sin contraseña nueva.</b> Entras con tu cuenta de Twitch.
        </li>
        <li>
          <b>Solo con invitación.</b> El registro pide un código de invitación.
        </li>
        <li>
          <b>Tu configuración te sigue.</b> Se guarda en tu cuenta y llega a OBS.
        </li>
      </ul>
    </>
  );

  return (
    <MarcoRecorrido pulso={clave} lateral={lateral}>
      <div key={clave} ref={stepRef} className="acc-step">
        {comprobando ? (
          <p className="cab-hint" role="status">
            Comprobando tu sesión.
          </p>
        ) : suspended ? (
          <>
            <h2>Cuenta suspendida</h2>
            <p className="cab-error" role="alert">
              La cuenta de {who} está suspendida. Habla con quien administra Lalo.
            </p>
            <button type="button" className="cab-btn2" onClick={signOut}>
              Cerrar sesión
            </button>
          </>
        ) : adminWaiting ? (
          <>
            <h2>Falta el rol de administrador</h2>
            <p className="cab-hint">
              Has entrado como {session?.user.email || 'una cuenta con correo'}, pero esta cuenta todavía no es
              administradora de Lalo. No necesita código de invitación: eso es solo para streamers.
            </p>
            <div className="acc-case">
              <b>Cómo darle el rol</b>
              <p className="cab-hint">
                En el panel de Supabase abre SQL Editor y ejecuta esta línea con tu correo. Es el paso 5 de la guía{' '}
                <span className="cab-mono">supabase/README.md</span>.
              </p>
              <span className="cab-url cab-mono">select public.promote_admin_by_email('tu@correo.com');</span>
            </div>
            {error && (
              <p className="cab-error" role="alert">
                {error}
              </p>
            )}
            {checked && (
              <p className="cab-note" role="status">
                Comprobado ahora: la cuenta sigue sin el rol de administrador.
              </p>
            )}
            <button type="button" className="cab-btn" disabled={busy} onClick={recheckRole}>
              {busy ? 'Comprobando' : 'Ya lo hice, comprobar de nuevo'}
            </button>
            <button type="button" className="cab-btn2" onClick={signOut}>
              Cerrar sesión
            </button>
          </>
        ) : step === 'admin' ? (
          <form onSubmit={enterAsAdmin}>
            <h2>Administración</h2>
            <p className="cab-hint">
              Solo para quien administra Lalo. Los streamers entran con Twitch y no tienen clave aquí.
            </p>
            <div className="cab-field">
              <label className="cab-label" htmlFor={`${uid}-mail`}>
                Correo
              </label>
              <input
                id={`${uid}-mail`}
                type="email"
                className="cab-inp"
                value={email}
                autoComplete="username"
                spellCheck={false}
                required
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="cab-field">
              <label className="cab-label" htmlFor={`${uid}-key`}>
                Clave de administración
              </label>
              <input
                id={`${uid}-key`}
                type="password"
                className="cab-inp"
                value={adminKey}
                autoComplete="current-password"
                required
                onChange={(e) => setAdminKey(e.target.value)}
              />
            </div>
            {notice && (
              <p className="cab-error" role="alert">
                {notice}
              </p>
            )}
            <button type="submit" className="cab-btn" disabled={busy || !email.trim() || !adminKey}>
              {busy ? 'Entrando' : 'Entrar como administrador'}
            </button>
            <div className="acc-links">
              <button type="button" className="studio-link" onClick={() => go('entrar')}>
                Volver
              </button>
            </div>
          </form>
        ) : step === 'entrar' ? (
          <>
            <TituloPaso>Tu directo, tu mesa de control</TituloPaso>
            <p className="cab-hint">Lalo no guarda contraseñas: Twitch confirma que eres tú.</p>
            {notice && (
              <p className="cab-error" role="alert">
                {notice}
              </p>
            )}
            <div className="rec-fila">
              <button type="button" className="cab-btn acc-twitch" onClick={() => go('permisos', 'tw')}>
                Entrar con Twitch
              </button>
            </div>
            <p>
              <button type="button" className="studio-link" onClick={() => go('codigo', 'co')}>
                Prefiero empezar con mi código de invitación
              </button>
            </p>
            <div className="acc-links">
              <button type="button" className="studio-link" onClick={() => go('recover')}>
                No puedo entrar
              </button>
              <button type="button" className="studio-link" onClick={() => go('admin')}>
                Soy administrador
              </button>
            </div>
          </>
        ) : step === 'permisos' ? (
          <>
            <TituloPaso>Qué le pide Lalo a Twitch</TituloPaso>
            <div className="rec-caja">
              <b>Lalo pide</b>
              <ul className="rec-pide">
                <li>
                  <span>
                    <b>Tu identidad pública</b>
                    <span>Nombre de canal, nombre visible y foto.</span>
                  </span>
                </li>
                <li>
                  <span>
                    <b>Tu correo de Twitch</b>
                    <span>La entrada con Twitch lo pide siempre. Queda en tu cuenta y no se comparte con otros streamers.</span>
                  </span>
                </li>
                <li>
                  <span>
                    <b>Tu lista de seguidores nuevos</b>
                    <span>Para avisar en pantalla cuando alguien te sigue.</span>
                  </span>
                </li>
                <li>
                  <span>
                    <b>Escribir en tu chat</b>
                    <span>
                      Lalo puede escribir en tu chat con el bot y con las herramientas de LSS AI, que están en beta y
                      siguen en desarrollo.
                    </span>
                  </span>
                </li>
                <li>
                  <span>
                    <b>Leer tu chat</b>
                    <span>No necesita permiso: el chat es público.</span>
                  </span>
                </li>
              </ul>
            </div>
            <div className="rec-caja">
              <b>Lalo no pide</b>
              <ul className="rec-pide" data-tipo="no">
                <li>
                  <span>
                    <span>Moderar en tu nombre, cambiar los ajustes de tu directo ni ver tus ingresos.</span>
                  </span>
                </li>
              </ul>
            </div>
            {notice && (
              <p className="cab-error" role="alert">
                {notice}
              </p>
            )}
            <div className="rec-fila">
              <button type="button" className="cab-btn acc-twitch" disabled={busy} onClick={continueToTwitch}>
                {busy ? 'Abriendo Twitch' : 'Continuar a Twitch'}
              </button>
              <button type="button" className="studio-link" onClick={atras}>
                Atrás
              </button>
            </div>
          </>
        ) : step === 'codigo' ? (
          <form onSubmit={checkInvite}>
            <TituloPaso>Tu código de invitación</TituloPaso>
            <p className="cab-hint">
              {invited && code === invited
                ? 'Este código venía en tu enlace de invitación. Compruébalo y sigue con Twitch.'
                : 'Te lo da quien administra Lalo. Empieza por LALO-.'}
            </p>
            <div className="cab-field">
              <label className="cab-label" htmlFor={`${uid}-code`}>
                Código
              </label>
              <input
                id={`${uid}-code`}
                className="cab-inp cab-mono acc-code"
                value={code}
                autoComplete="off"
                spellCheck={false}
                placeholder="LALO-"
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setValidPlan(null);
                }}
              />
            </div>
            {notice && (
              <p className="cab-error" role="alert">
                {notice}
              </p>
            )}
            {validPlan && (
              <div role="status">
                <TarjetaPlan rotulo="Código válido. Tu plan" nombre={validPlan} />
                <p className="cab-hint mt-2">Verás los límites de tu plan en cuanto conectes tu cuenta de Twitch.</p>
              </div>
            )}
            <div className="rec-fila">
              {validPlan ? (
                <button
                  type="button"
                  className="cab-btn acc-twitch"
                  onClick={() => go((pasoSiguiente('co', 'codigo') as Step | null) ?? 'permisos', 'co')}
                >
                  Seguir
                </button>
              ) : (
                <button type="submit" className="cab-btn" disabled={busy}>
                  {busy ? 'Comprobando' : 'Comprobar código'}
                </button>
              )}
              <button type="button" className="studio-link" onClick={() => go('entrar', 'tw')}>
                Atrás
              </button>
            </div>
          </form>
        ) : step === 'recover' ? (
          <>
            <h2>No puedo entrar</h2>
            <div className="acc-case">
              <b>Olvidé mi contraseña de Twitch</b>
              <p className="cab-hint">
                Se recupera en Twitch, no aquí. Cuando vuelvas a entrar en Twitch, entrarás en Lalo.
              </p>
            </div>
            <div className="acc-case">
              <b>Perdí esa cuenta de Twitch o cambié de canal</b>
              <p className="cab-hint">
                Pide un código de recuperación a quien administra Lalo. Con él tu configuración y tus archivos pasan
                a tu cuenta nueva.
              </p>
              <button type="button" className="cab-btn2" onClick={() => go('recovery-code')}>
                Tengo un código de recuperación
              </button>
            </div>
            <div className="acc-case">
              <b>Alguien tiene mi URL de OBS</b>
              <p className="cab-hint">Entra y genera una clave nueva en Mi cuenta. La anterior deja de funcionar.</p>
            </div>
            <div className="acc-links">
              <button type="button" className="studio-link" onClick={() => go('entrar')}>
                Volver
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submitRecovery}>
            <h2>Recuperar cuenta</h2>
            <p className="cab-hint">
              {pending
                ? `Has entrado como ${who}. Escribe el código de recuperación para traer aquí tu cuenta anterior. Es de un solo uso.`
                : 'Escribe el código de recuperación y entra con tu cuenta nueva de Twitch. Es de un solo uso.'}
            </p>
            <div className="cab-field">
              <label className="cab-label" htmlFor={`${uid}-rec`}>
                Código de recuperación
              </label>
              <input
                id={`${uid}-rec`}
                className="cab-inp cab-mono acc-code"
                value={code}
                autoComplete="off"
                spellCheck={false}
                placeholder="REC-"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>
            {notice && (
              <p className="cab-error" role="alert">
                {notice}
              </p>
            )}
            <button type="submit" className="cab-btn acc-twitch" disabled={busy || !code.trim()}>
              {signedIn ? 'Recuperar mi cuenta' : 'Recuperar y entrar con Twitch'}
            </button>
            <div className="acc-links">
              <button type="button" className="studio-link" onClick={() => (onVolver ? onVolver() : go('recover'))}>
                Volver
              </button>
            </div>
          </form>
        )}
      </div>
    </MarcoRecorrido>
  );
};
