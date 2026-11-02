/**
 * src/pages/admin/InvitacionesSwitch.tsx
 *
 * Interruptor de invitaciones: con él encendido, quien llega nuevo necesita un
 * código para entrar; apagado, cualquiera entra con Twitch y recibe el plan por
 * defecto. Lee invites_required() y lo cambia con admin_set_invites_required().
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { rpc } from '../../lib/cloud';
import { rpcErrorMessage } from '../../lib/invitesLogic';

export const InvitacionesSwitch: React.FC = () => {
  const [required, setRequired] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const value = await rpc('invites_required', {});
      if (!aliveRef.current) return;
      setRequired(value !== false);
      setProblem(null);
    } catch (err) {
      if (aliveRef.current) setProblem(rpcErrorMessage(err, 'No se pudo leer si la entrada pide invitación.'));
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  const toggle = async () => {
    if (required === null || saving) return;
    const next = !required;
    setSaving(true);
    setProblem(null);
    setSaved(null);
    try {
      const value = await rpc('admin_set_invites_required', { p_required: next });
      if (!aliveRef.current) return;
      const now = value !== false;
      setRequired(now);
      setSaved(now ? 'Listo: ahora se pide código para entrar.' : 'Listo: la entrada está abierta.');
    } catch (err) {
      if (aliveRef.current) setProblem(rpcErrorMessage(err, 'No se pudo cambiar la entrada.'));
    }
    if (aliveRef.current) setSaving(false);
  };

  const on = required === true;

  return (
    <section className="cab-mod" aria-labelledby="adm-inv-titulo">
      <div className="adm-sw-row">
        <div className="grid gap-1">
          <span className="cab-label">Entrada de streamers</span>
          <h2 id="adm-inv-titulo">Invitaciones</h2>
        </div>
        {required !== null && (
          <span className="cab-chip" data-status={on ? 'skipped' : 'read'}>
            {on ? 'Solo con invitación' : 'Entrada abierta'}
          </span>
        )}
      </div>

      {required === null ? (
        problem ? (
          <div className="grid gap-3">
            <p className="cab-error" role="alert">
              {problem}
            </p>
            <div>
              <button type="button" className="cab-btn2" onClick={load}>
                Reintentar
              </button>
            </div>
          </div>
        ) : (
          <p className="cab-hint" role="status">
            Leyendo cómo se entra.
          </p>
        )
      ) : (
        <>
          <div className="adm-sw-row">
            <p className="cab-hint" id="adm-inv-lead">
              {on ? 'Quien llega nuevo necesita un código para entrar.' : 'Cualquiera puede entrar con Twitch sin código.'}
            </p>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label="Pedir código de invitación para entrar"
              aria-describedby="adm-inv-lead"
              className="adm-sw"
              aria-disabled={saving}
              onClick={toggle}
            >
              <span className="adm-sw-knob" aria-hidden="true" />
            </button>
          </div>

          <div className="adm-efecto" key={String(on)}>
            {on ? (
              <>
                <span>
                  <b>Hoy:</b> sin código no se entra. Los códigos dan acceso y un plan.
                </span>
                <span className="cab-hint">Para abrir la entrada, apaga el interruptor.</span>
              </>
            ) : (
              <>
                <span>
                  <b>Hoy:</b> quien llega nuevo entra con el plan gratis. Para tener más, se suscribe con PayPal o canjea un código.
                </span>
                <span className="cab-hint">Los códigos ya creados siguen funcionando y los streamers actuales no cambian.</span>
              </>
            )}
          </div>

          {/* Siempre montado: los lectores de pantalla solo anuncian los cambios de una región que ya existía */}
          <p className="cab-hint" role="status" aria-live="polite">
            {saving ? 'Guardando.' : saved && !problem ? saved : ''}
          </p>
          {problem && (
            <p className="cab-error" role="alert">
              {problem}
            </p>
          )}
        </>
      )}
    </section>
  );
};
