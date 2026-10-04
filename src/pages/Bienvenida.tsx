/**
 * src/pages/Bienvenida.tsx
 *
 * Segunda parte de la bienvenida de streamers: los pasos que ocurren con la
 * sesión de Twitch ya abierta. La primera parte está en src/pages/Access.tsx.
 *
 *   - Lo que tomamos: los datos reales que entregó Twitch. «No es mi canal» cierra la sesión.
 *   - Código de invitación: solo si la cuenta aún no está activa. Al canjearlo se descubre el plan.
 *   - Tu canal: voz, estilo de los mensajes, comando !s y avisos. El canal viene de Twitch.
 *   - Bienvenida: saludo, plan y las tres primeras tareas.
 *
 * El orden depende del camino elegido antes de ir a Twitch (src/lib/recorrido.ts).
 * Al terminar se guarda en la cuenta (migración 0006). Si eso falla, se recuerda
 * en este navegador y se deja pasar: nadie se queda atrapado en la bienvenida.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { useCloudSession } from '../hooks/useCloudSession';
import { completeOnboarding, fetchOwnPlan, getCaminoElegido, getPendingCode } from '../lib/cloud';
import { outcomeMessage } from '../lib/accesoMensajes';
import { claveBienvenida, lineasDelPlan, pasoConSesion, type PasoId, type PasoNarrado } from '../lib/recorrido';
import { alertasActivas, guardarCanal, limpiarCanal } from '../lib/recorridoCanal';
import { loadSettings, PRESET_VOICES } from '../types/settings';
import { ALERT_STYLES, type AlertStyle } from '../utils/appearance';
import { LateralRecorrido, MarcoRecorrido, TarjetaPlan, TituloPaso, usePasoAnimado } from '../components/recorrido/piezas';
import { PrimerosPasos, anotarTarea } from '../components/recorrido/PrimerosPasos';

type Plan = { nombre: string; lineas: string[] };
type EstadoPlan = 'sin-pedir' | 'cargando' | 'listo' | 'fallo';

// Lo ya confirmado en esta pestaña, por cuenta: una recarga no devuelve al primer paso
const claveAvance = (perfilId: string) => `lalo_recorrido_avance_${perfilId}`;
type Avance = { datos?: boolean; canal?: boolean };

function leerAvance(perfilId: string): Avance {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(claveAvance(perfilId)) || '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Avance) : {};
  } catch {
    return {};
  }
}

function guardarAvance(perfilId: string, avance: Avance): void {
  try {
    sessionStorage.setItem(claveAvance(perfilId), JSON.stringify(avance));
  } catch {
    // Sin almacenamiento de sesión: una recarga vuelve al primer paso
  }
}

/** Recuerdo en este navegador de que la bienvenida ya se terminó (por si la cuenta no pudo guardarlo). */
export function bienvenidaHechaAqui(perfilId: string): boolean {
  try {
    return localStorage.getItem(claveBienvenida(perfilId)) === '1';
  } catch {
    return false;
  }
}

interface BienvenidaProps {
  /** La bienvenida terminó: se abre el panel. */
  onTerminar: (perfilId: string) => void;
  /** El streamer tiene un código de recuperación en vez de uno de invitación. */
  onRecuperar: () => void;
}

export const Bienvenida: React.FC<BienvenidaProps> = ({ onTerminar, onRecuperar }) => {
  const { session, profile, outcome, error, redeem, refresh, signOut, loading } = useCloudSession();
  const uid = useId();
  const perfilId = profile?.id ?? '';
  const activo = profile?.status === 'active';
  const login = limpiarCanal(profile?.twitch_login);
  const nombre = profile?.display_name || profile?.twitch_login || 'streamer';
  const correo = session?.user.email || null;

  const [camino] = useState(getCaminoElegido);
  const [avance, setAvance] = useState<Avance>(() => leerAvance(perfilId));
  const [paso, setPaso] = useState<PasoId>(() =>
    pasoConSesion(camino, { activo, datosConfirmados: Boolean(avance.datos), canalListo: Boolean(avance.canal) })
  );
  // Al volver de Twitch con un código escrito antes, la sesión lo canjea sola: se espera el resultado
  const [canjeAutomatico, setCanjeAutomatico] = useState(() => !activo && getPendingCode() !== null);
  // El código se canjeó en este paso: se enseña el plan antes de seguir
  const canjeadoAqui = useRef(false);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [estadoPlan, setEstadoPlan] = useState<EstadoPlan>('sin-pedir');
  const [cierre, setCierre] = useState<string | null>(null);

  // Elecciones de «Tu canal». Parten de lo guardado; en una cuenta nueva, la voz es Teemo
  const [voz, setVoz] = useState(() => loadSettings().referenceId);
  const [estilo, setEstilo] = useState<AlertStyle>(() => loadSettings().alertStyle);
  const [comando, setComando] = useState(true);
  const [avisos, setAvisos] = useState(true);

  const { ref: pasoRef, salir } = usePasoAnimado(paso);

  const siguiente = (extra: Partial<{ datos: boolean; canal: boolean }> = {}) => {
    const nuevo = { ...avance, ...extra };
    return pasoConSesion(camino, { activo, datosConfirmados: Boolean(nuevo.datos), canalListo: Boolean(nuevo.canal) });
  };

  const avanzar = (extra: Avance = {}) =>
    salir(() => {
      const nuevo = { ...avance, ...extra };
      setAvance(nuevo);
      guardarAvance(perfilId, nuevo);
      setProblem(null);
      setPaso(siguiente(extra));
    });

  // El plan y sus límites reales, en cuanto la cuenta está activa
  useEffect(() => {
    if (!activo) return;
    let alive = true;
    setEstadoPlan('cargando');
    fetchOwnPlan().then((own) => {
      if (!alive) return;
      if (!own) {
        setEstadoPlan('fallo');
        return;
      }
      setPlan({ nombre: own.name, lineas: lineasDelPlan(own.limits) });
      setEstadoPlan('listo');
    });
    return () => {
      alive = false;
    };
  }, [activo, perfilId]);

  // Fin de la espera del canje automático: llegó el resultado o la cuenta ya está activa
  useEffect(() => {
    if (!canjeAutomatico) return;
    if (outcome || activo) {
      setCanjeAutomatico(false);
      return;
    }
    const timer = setTimeout(() => setCanjeAutomatico(false), 8000);
    return () => clearTimeout(timer);
  }, [canjeAutomatico, outcome, activo]);

  // Si la cuenta se activó sin pasar por el formulario de este paso, el código ya no hace falta
  useEffect(() => {
    if (paso !== 'codigo' || !activo || canjeadoAqui.current) return;
    setPaso(pasoConSesion(camino, { activo: true, datosConfirmados: Boolean(avance.datos), canalListo: Boolean(avance.canal) }));
  }, [paso, activo, camino, avance]);

  const canjear = async (event: React.FormEvent) => {
    event.preventDefault();
    const clean = code.trim();
    if (!clean) {
      setProblem('Escribe tu código para continuar.');
      return;
    }
    setBusy(true);
    setProblem(null);
    canjeadoAqui.current = true;
    const result = await redeem('invite', clean);
    if (result.kind === 'error' || result.result !== 'ok') {
      canjeadoAqui.current = false;
      setProblem(outcomeMessage(result));
    }
    setBusy(false);
  };

  const guardarYSeguir = (configurar: boolean) => {
    if (login) {
      guardarCanal(login, configurar ? { voz, estilo, comando, avisos } : undefined);
      if (configurar && avisos && alertasActivas()) anotarTarea(perfilId, 'alertas', 'hecha');
    }
    avanzar({ canal: true });
  };

  const terminar = async () => {
    // Segundo intento tras un fallo: ya está recordado en este navegador
    if (cierre) {
      onTerminar(perfilId);
      return;
    }
    setBusy(true);
    const fallo = await completeOnboarding();
    if (!fallo) {
      await refresh();
      onTerminar(perfilId);
      return;
    }
    try {
      localStorage.setItem(claveBienvenida(perfilId), '1');
    } catch {
      // Sin almacenamiento: vale para esta visita
    }
    setCierre(
      'No se pudo guardar en tu cuenta que terminaste la bienvenida. Lo recordamos en este navegador, pero puede volver a salir en otro. Avisa a quien administra Lalo: falta aplicar una actualización de la base de datos.'
    );
    setBusy(false);
  };

  const notice = problem || (paso === 'codigo' ? outcomeMessage(outcome) : null) || error;
  const vozConocida = PRESET_VOICES.some((preset) => preset.id === voz);
  // Mientras se trae la configuración de la cuenta no se guarda nada encima
  const preparando = loading;

  return (
    <MarcoRecorrido pulso={paso} lateral={<LateralRecorrido camino={camino} paso={paso as PasoNarrado} />}>
      <div key={paso} ref={pasoRef} className="acc-step">
        {paso === 'datos' ? (
          <>
            <TituloPaso>Esto tomamos de tu Twitch</TituloPaso>
            <div className="rec-caja">
              <dl className="rec-datos">
                <div>
                  <dt>Canal</dt>
                  <dd>{login ? `twitch.tv/${login}` : 'Twitch no lo entregó'}</dd>
                </div>
                <div>
                  <dt>Nombre visible</dt>
                  <dd>{profile?.display_name || 'Twitch no lo entregó'}</dd>
                </div>
                <div>
                  <dt>Foto</dt>
                  <dd>
                    {profile?.avatar_url ? (
                      <>
                        <img className="rec-avatar" src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />
                        <span>La de tu perfil de Twitch</span>
                      </>
                    ) : (
                      'Twitch no la entregó'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Identificador</dt>
                  <dd className="cab-mono">{profile?.twitch_user_id || 'Twitch no lo entregó'}</dd>
                </div>
                {correo && (
                  <div>
                    <dt>Correo</dt>
                    <dd>
                      <span>
                        {correo}
                        <small>Lo entregó Twitch al entrar. Queda en tu cuenta.</small>
                      </span>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
            <p className="cab-hint">
              Si cambias tu nombre o tu foto en Twitch, Lalo los actualiza la próxima vez que entres.{' '}
              <b>Nada de esto se comparte con otros streamers.</b>
            </p>
            {notice && (
              <p className="cab-error" role="alert">
                {notice}
              </p>
            )}
            <div className="rec-fila">
              <button type="button" className="cab-btn" onClick={() => avanzar({ datos: true })}>
                Es correcto, seguir
              </button>
              <button type="button" className="studio-link" onClick={signOut}>
                No es mi canal
              </button>
            </div>
          </>
        ) : paso === 'codigo' ? (
          canjeAutomatico ? (
            <>
              <TituloPaso>Tu código de invitación</TituloPaso>
              <p className="cab-hint" role="status">
                Comprobando el código que escribiste antes de ir a Twitch.
              </p>
            </>
          ) : activo ? (
            <>
              <TituloPaso>Tu código de invitación</TituloPaso>
              <div role="status">
                {plan ? (
                  <TarjetaPlan rotulo="Código válido. Tu plan" nombre={plan.nombre} lineas={plan.lineas} />
                ) : (
                  <p className="cab-note acc-ok">
                    {estadoPlan === 'fallo'
                      ? 'Código válido. Tu cuenta ya está activa; los límites de tu plan no se pudieron leer ahora y los verás en Mi cuenta.'
                      : 'Código válido. Leyendo tu plan.'}
                  </p>
                )}
              </div>
              <div className="rec-fila">
                <button
                  type="button"
                  className="cab-btn acc-twitch"
                  onClick={() => {
                    canjeadoAqui.current = false;
                    avanzar();
                  }}
                >
                  Seguir
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={canjear}>
              <TituloPaso>Tu código de invitación</TituloPaso>
              <p className="cab-hint">
                La cuenta de {nombre} aún no está registrada en Lalo. Escribe el código que te dio quien administra
                Lalo. Empieza por LALO-.
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
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </div>
              {notice && (
                <p className="cab-error" role="alert">
                  {notice}
                </p>
              )}
              <div className="rec-fila">
                <button type="submit" className="cab-btn" disabled={busy}>
                  {busy ? 'Comprobando' : 'Comprobar código'}
                </button>
              </div>
              <div className="acc-links">
                <button type="button" className="studio-link" onClick={onRecuperar}>
                  Tengo un código de recuperación
                </button>
                <button type="button" className="studio-link" onClick={signOut}>
                  Entrar con otra cuenta
                </button>
              </div>
            </form>
          )
        ) : paso === 'canal' ? (
          <>
            <TituloPaso>Deja listo tu canal</TituloPaso>
            {login ? (
              <p className="cab-hint">
                Tu canal es <b className="cab-mono">twitch.tv/{login}</b>. No hace falta escribirlo: viene de Twitch.
              </p>
            ) : (
              <p className="cab-error" role="alert">
                Twitch no entregó el nombre de tu canal. Podrás escribirlo en Inicio.
              </p>
            )}
            <div className="cab-field" role="group" aria-labelledby={`${uid}-voz`}>
              <span id={`${uid}-voz`} className="cab-label">
                Voz que lee el chat
              </span>
              <div className="cab-seg">
                {PRESET_VOICES.map((preset) => (
                  <button key={preset.id} type="button" aria-pressed={voz === preset.id} onClick={() => setVoz(preset.id)}>
                    {preset.name}
                  </button>
                ))}
              </div>
              {!vozConocida && <span className="cab-hint">Ahora tienes una voz propia. Si no eliges otra, se queda esa.</span>}
            </div>
            <div className="cab-field" role="group" aria-labelledby={`${uid}-estilo`}>
              <span id={`${uid}-estilo`} className="cab-label">
                Cómo se ven los mensajes
              </span>
              <div className="cab-seg">
                {ALERT_STYLES.map((style) => (
                  <button key={style.id} type="button" aria-pressed={estilo === style.id} onClick={() => setEstilo(style.id)}>
                    {style.name}
                  </button>
                ))}
              </div>
              <span className="cab-hint">{ALERT_STYLES.find((style) => style.id === estilo)?.description}</span>
            </div>
            <div className="rec-tog">
              <input
                id={`${uid}-cmd`}
                type="checkbox"
                className="cab-tog"
                checked={comando}
                onChange={(e) => setComando(e.target.checked)}
              />
              <label htmlFor={`${uid}-cmd`}>
                Leer los mensajes que empiecen por <span className="cab-mono">!s</span>
              </label>
            </div>
            <div className="rec-tog">
              <input
                id={`${uid}-avisos`}
                type="checkbox"
                className="cab-tog"
                checked={avisos}
                onChange={(e) => setAvisos(e.target.checked)}
              />
              <label htmlFor={`${uid}-avisos`}>Avisar de suscripciones, bits y raids</label>
            </div>
            {preparando && (
              <p className="cab-hint" role="status">
                Preparando tu cuenta. En un momento podrás guardar.
              </p>
            )}
            <div className="rec-fila">
              <button type="button" className="cab-btn" disabled={preparando} onClick={() => guardarYSeguir(true)}>
                Guardar y seguir
              </button>
              <button type="button" className="studio-link" disabled={preparando} onClick={() => guardarYSeguir(false)}>
                Lo configuro después
              </button>
            </div>
          </>
        ) : (
          <>
            <TituloPaso>{`Bienvenida, ${nombre}`}</TituloPaso>
            {plan ? (
              <TarjetaPlan rotulo="Tu plan" nombre={plan.nombre} lineas={plan.lineas} />
            ) : (
              <p className="cab-note" role="status">
                {estadoPlan === 'fallo'
                  ? 'Los límites de tu plan no se pudieron leer ahora. Los verás en Mi cuenta.'
                  : 'Leyendo tu plan.'}
              </p>
            )}
            <PrimerosPasos perfilId={perfilId} variante="recorrido" />
            <p className="cab-hint">Estas tres tareas te esperan también en Inicio, hasta que las hagas o las quites.</p>
            {cierre && (
              <p className="cab-error" role="alert">
                {cierre}
              </p>
            )}
            <div className="rec-fila">
              <button type="button" className="cab-btn acc-twitch" disabled={busy} onClick={terminar}>
                {busy ? 'Guardando' : cierre ? 'Entrar a mi panel' : 'Ir a mi panel'}
              </button>
            </div>
          </>
        )}
      </div>
    </MarcoRecorrido>
  );
};
