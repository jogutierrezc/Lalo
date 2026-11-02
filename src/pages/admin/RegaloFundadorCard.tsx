/**
 * src/pages/admin/RegaloFundadorCard.tsx
 *
 * Tarjeta de Límites: plan y meses del regalo que reciben los Creadores Fundadores
 * al activarlo en su bienvenida (migración 0052, tabla founder_settings).
 * Si la migración aún no está aplicada, la lectura cae a los valores de respaldo
 * y el guardado muestra el error legible de la nube.
 */

import React, { useEffect, useId, useState } from 'react';
import { REGALO_POR_DEFECTO, textoMeses } from '../../lib/fundadores';
import { guardarConfigRegalo, traerConfigRegalo } from '../../lib/fundadoresApi';
import type { PlanRow } from '../../lib/cloudTypes';

export const RegaloFundadorCard: React.FC<{ plans: PlanRow[] }> = ({ plans }) => {
  const planId = useId();
  const mesesId = useId();
  const [plan, setPlan] = useState<string>(REGALO_POR_DEFECTO.planId);
  const [meses, setMeses] = useState<string>(String(REGALO_POR_DEFECTO.meses));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let viva = true;
    traerConfigRegalo().then((cfg) => {
      if (!viva) return;
      setPlan(cfg.planId);
      setMeses(String(cfg.meses));
    });
    return () => {
      viva = false;
    };
  }, []);

  // Planes elegibles: los no archivados, más el actual aunque se haya archivado después
  const opciones = plans.filter((p) => !p.archived || p.id === plan);
  const valor = Math.round(Number(meses));
  const valido = Number.isInteger(valor) && valor >= 1 && valor <= 36;

  const guardar = async () => {
    if (!valido || saving) return;
    setSaving(true);
    setNotice(null);
    setProblem(null);
    try {
      await guardarConfigRegalo(plan, valor);
      setNotice(`Regalo guardado: ${textoMeses(valor)} de ${plans.find((p) => p.id === plan)?.name ?? plan}.`);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'No se pudo guardar el regalo.');
    }
    setSaving(false);
  };

  return (
    <section className="cab-mod adm-narrow">
      <h2>Regalo de fundadores</h2>
      <div className="flex items-center justify-between gap-4">
        <label className="cab-label" htmlFor={planId}>
          Plan del regalo
        </label>
        <select id={planId} className="cab-inp" value={plan} onChange={(e) => setPlan(e.target.value)}>
          {opciones.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between gap-4">
        <label className="cab-label" htmlFor={mesesId}>
          Meses de regalo (1 a 36)
        </label>
        <input
          id={mesesId}
          type="number"
          min={1}
          max={36}
          className="cab-inp cab-mono w-28"
          value={meses}
          onChange={(e) => setMeses(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="cab-btn2" disabled={!valido || saving} onClick={guardar}>
          {saving ? 'Guardando' : 'Guardar regalo'}
        </button>
      </div>
      <p className="cab-hint">
        Cada fundador lo activa una sola vez desde su bienvenida. Al vencer, la cuenta vuelve al plan por defecto. No se
        aplica a quien ya tiene un plan de pago o un plan asignado.
      </p>
      {notice && (
        <p className="cab-hint" role="status">
          {notice}
        </p>
      )}
      {problem && (
        <p className="cab-error" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
};
