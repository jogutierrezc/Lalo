/**
 * src/pages/admin/MigrarSection.tsx
 *
 * Migrar datos entre proyectos de Supabase: exportar todo a un archivo .sql e importarlo
 * en el proyecto nuevo. La lógica está en src/lib/migrationApi.ts (navegador) y
 * server/migration/ (servidor, con las claves).
 *
 * Orden recomendado: 1) aplicar supabase/baseline/0001_lalo_baseline.sql en el proyecto
 * nuevo, 2) exportar aquí, 3) importar aquí con el token del proyecto nuevo.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  MigrationApiError,
  checkImportTarget,
  downloadText,
  exportData,
  fetchMigrationPlan,
  importData,
  readDump,
  type ExportProgress,
  type ImportProgress,
  type MigrationPlan,
} from '../../lib/migrationApi';

const errText = (err: unknown, fallback: string) => (err instanceof MigrationApiError ? err.message : fallback);

const ExportCard: React.FC = () => {
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [includeAuth, setIncludeAuth] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMigrationPlan()
      .then((p) => {
        if (!alive) return;
        setPlan(p);
        setPicked(new Set(p.tables.map((t) => t.name)));
      })
      .catch((err) => alive && setPlanError(errText(err, 'No se pudo leer la lista de tablas.')));
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, []);

  const toggle = (name: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const run = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    setDone(null);
    abort.current = new AbortController();
    try {
      const result = await exportData({
        source: plan.source,
        tables: plan.tables.map((t) => t.name).filter((n) => picked.has(n)),
        includeAuth,
        signal: abort.current.signal,
        onProgress: setProgress,
      });
      downloadText(result.filename, result.text);
      setDone(`${result.filename}: ${result.statements.toLocaleString('es')} filas de ${result.tables} tablas${includeAuth ? ' y las cuentas de acceso' : ''}.`);
    } catch (err) {
      setError(errText(err, 'No se pudo exportar.'));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const total = plan?.tables.filter((t) => picked.has(t.name)).reduce((sum, t) => sum + (t.rows ?? 0), 0) ?? 0;

  return (
    <section className="cab-mod">
      <h2>Exportar datos</h2>
      <p className="cab-hint">
        Genera un archivo <span className="cab-mono">.sql</span> con los datos de este proyecto. Los archivos de medios no
        van dentro: siguen en tu bucket de R2 y los registros apuntan a ellos.
      </p>
      {planError && (
        <p className="cab-error" role="alert">
          {planError}
        </p>
      )}
      {!plan && !planError && <p className="cab-hint">Leyendo las tablas.</p>}
      {plan && (
        <>
          <p className="cab-hint">
            Origen: <span className="cab-mono">{plan.source}</span>
          </p>
          <ul className="cab-rows adm-list">
            <li className="adm-list-row">
              <span>
                <label>
                  <input type="checkbox" className="cab-tog" checked={includeAuth} onChange={(e) => setIncludeAuth(e.target.checked)} disabled={busy} />{' '}
                  <b>Cuentas de acceso</b> (inicio de sesión con Twitch y correo)
                </label>
              </span>
              <span className="cab-mono">{plan.authUsers ?? '?'}</span>
            </li>
            {plan.tables.map((t) => (
              <li className="adm-list-row" key={t.name}>
                <span>
                  <label>
                    <input type="checkbox" className="cab-tog" checked={picked.has(t.name)} onChange={() => toggle(t.name)} disabled={busy} />{' '}
                    <span className="cab-mono">{t.name}</span>
                  </label>
                </span>
                <span className="cab-mono">{t.rows ?? '?'}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={() => setPicked(new Set(plan.tables.map((t) => t.name)))}>
              Marcar todas
            </button>
            <button type="button" className="cab-btn2 cab-btn-sm" disabled={busy} onClick={() => setPicked(new Set())}>
              Quitar todas
            </button>
          </div>
          <p className="cab-hint">
            Seleccionado: {picked.size} de {plan.tables.length} tablas, unas {total.toLocaleString('es')} filas.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="cab-btn" onClick={run} disabled={busy || (picked.size === 0 && !includeAuth)}>
              {busy ? 'Exportando' : 'Exportar a .sql'}
            </button>
            {busy && (
              <button type="button" className="cab-btn2" onClick={() => abort.current?.abort()}>
                Cancelar
              </button>
            )}
          </div>
          {progress && (
            <p className="cab-hint" role="status">
              Leyendo {progress.step} ({progress.doneSteps} de {progress.totalSteps}). Filas recogidas: {progress.statements.toLocaleString('es')}.
            </p>
          )}
          {error && (
            <p className="cab-error" role="alert">
              {error}
            </p>
          )}
          {done && (
            <p className="cab-note adm-note-ok" role="status">
              Listo: {done}
            </p>
          )}
          <p className="cab-hint">
            El archivo contiene datos privados y secretos cifrados (claves de integraciones, tokens). Guárdalo como una
            contraseña y bórralo al terminar. Las contraseñas de quien entra con correo y clave no se pueden exportar:
            tendrá que restablecerlas.
          </p>
        </>
      )}
    </section>
  );
};

const REF_HELP = 'La referencia son 20 letras en la dirección del panel: supabase.com/dashboard/project/<referencia>.';

const ImportCard: React.FC = () => {
  const [fileName, setFileName] = useState<string | null>(null);
  const [statements, setStatements] = useState<string[]>([]);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [ref, setRef] = useState('');
  const [token, setToken] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const pick = async (file: File | undefined) => {
    setStatements([]);
    setFileProblem(null);
    setDone(null);
    setFileName(file?.name ?? null);
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) {
      setFileProblem('El archivo pesa más de 200 MB.');
      return;
    }
    const parsed = readDump(await file.text());
    if (parsed.problem) setFileProblem(parsed.problem);
    else setStatements(parsed.statements);
  };

  const target = { ref: ref.trim().toLowerCase(), token: token.trim() };
  const ready = statements.length > 0 && target.ref.length > 0 && target.token.length > 0;

  const test = async () => {
    setChecking(true);
    setError(null);
    setChecked(false);
    try {
      await checkImportTarget(target);
      setChecked(true);
    } catch (err) {
      setError(errText(err, 'No se pudo comprobar el proyecto destino.'));
    } finally {
      setChecking(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    abort.current = new AbortController();
    try {
      const result = await importData({ statements, target, signal: abort.current.signal, onProgress: setProgress });
      setDone(`${result.applied.toLocaleString('es')} sentencias aplicadas en el proyecto ${target.ref}.`);
      setToken('');
      setConfirmed(false);
    } catch (err) {
      setError(errText(err, 'No se pudo importar.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cab-mod">
      <h2>Importar datos</h2>
      <ol className="cab-hint">
        <li>
          En el proyecto nuevo, aplica primero <span className="cab-mono">supabase/baseline/0001_lalo_baseline.sql</span> (crea las tablas).
        </li>
        <li>Elige aquí el archivo .sql que exportaste.</li>
        <li>
          Pon la referencia del proyecto nuevo y un token de acceso personal (se crea en supabase.com/dashboard/account/tokens). El
          token se usa solo para esta importación: no se guarda.
        </li>
      </ol>

      <div className="cab-field">
        <label className="cab-label" htmlFor="mig-file">
          Archivo de exportación
        </label>
        <input id="mig-file" type="file" accept=".sql,text/plain" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
        {fileName && !fileProblem && statements.length > 0 && (
          <span className="cab-hint">
            {fileName}: {statements.length.toLocaleString('es')} sentencias, todas con el formato esperado.
          </span>
        )}
        {fileProblem && (
          <p className="cab-error" role="alert">
            {fileProblem}
          </p>
        )}
      </div>

      <div className="cab-field">
        <label className="cab-label" htmlFor="mig-ref">
          Referencia del proyecto destino
        </label>
        <input id="mig-ref" className="cab-inp cab-mono" value={ref} onChange={(e) => { setRef(e.target.value); setChecked(false); }} maxLength={20} autoComplete="off" spellCheck={false} disabled={busy} />
        <span className="cab-hint">{REF_HELP}</span>
      </div>

      <div className="cab-field">
        <label className="cab-label" htmlFor="mig-token">
          Token de acceso de Supabase
        </label>
        <input id="mig-token" type="password" className="cab-inp cab-mono" value={token} onChange={(e) => { setToken(e.target.value); setChecked(false); }} autoComplete="off" spellCheck={false} disabled={busy} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="cab-btn2" onClick={test} disabled={checking || busy || !target.ref || !target.token}>
          {checking ? 'Comprobando' : 'Comprobar conexión'}
        </button>
        {checked && (
          <span className="cab-chip" data-status="read">
            El proyecto responde
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <input id="mig-ok" type="checkbox" className="cab-tog" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} />
        <label htmlFor="mig-ok">
          Entiendo que se escribirá en el proyecto <span className="cab-mono">{target.ref || '(sin elegir)'}</span> y que las tablas del archivo
          quedan como en el origen: se borra lo que tuvieran (por ejemplo los planes de ejemplo) y se carga lo exportado.
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="cab-btn" onClick={run} disabled={busy || !ready || !confirmed}>
          {busy ? 'Importando' : 'Importar'}
        </button>
        {busy && (
          <button type="button" className="cab-btn2" onClick={() => abort.current?.abort()}>
            Cancelar
          </button>
        )}
      </div>

      {progress && busy && (
        <p className="cab-hint" role="status">
          Lote {progress.batch} de {progress.totalBatches}: {progress.applied.toLocaleString('es')} de {progress.totalStatements.toLocaleString('es')} sentencias.
        </p>
      )}
      {error && (
        <p className="cab-error" role="alert">
          {error} Cada lote es todo o nada: si falla, los lotes anteriores ya quedaron aplicados y se puede repetir la importación.
        </p>
      )}
      {done && (
        <p className="cab-note adm-note-ok" role="status">
          Listo: {done}
        </p>
      )}
      <p className="cab-hint">
        Después: configura en el proyecto nuevo el inicio de sesión con Twitch y las variables del servidor. Las claves cifradas de
        integraciones solo funcionan si el servidor conserva la misma clave de cifrado (INTEGRATIONS_ENC_KEY) que tenía.
      </p>
    </section>
  );
};

export const MigrarSection: React.FC = () => (
  <>
    <ExportCard />
    <ImportCard />
  </>
);
