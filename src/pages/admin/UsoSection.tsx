/**
 * src/pages/admin/UsoSection.tsx
 *
 * Telemetría operativa de Lalo: cuántos streamers tienen sus fuentes abiertas
 * en OBS, qué módulos se usan de verdad en la plataforma, cuánto consume cada
 * motor de voz (Fish Audio y ElevenLabs) y el estado de los topes diarios.
 */

import React, { useMemo, useState } from 'react';
import { UsageMeter } from '../../components/UsageMeter';
import {
  adminHref,
  isActiveInObs,
  isElevenNearlyFull,
  moduleAdoptionRows,
  profileName,
  relativeDay,
} from '../../lib/adminLogic';
import { rpc } from '../../lib/cloud';
import type { AdminData } from './useAdminData';

const fmtInt = (n: number) => n.toLocaleString('es-ES');

const DAILY_LIMIT_OPTIONS: { value: number; label: string }[] = [
  { value: 5000, label: '5 000 car. / día' },
  { value: 15000, label: '15 000 car. / día (estándar)' },
  { value: 30000, label: '30 000 car. / día' },
  { value: 50000, label: '50 000 car. / día' },
  { value: 0, label: 'Sin tope diario' },
];

export const UsoSection: React.FC<{ data: AdminData; ownId: string | null }> = ({ data, ownId }) => {
  const { overview, usage, usageByProfile, meta, reload, setError } = data;
  const [busyId, setBusyId] = useState<string | null>(null);
  const now = Date.now();

  const streamerProfiles = useMemo(
    () => (overview?.profiles ?? []).filter((row) => row.profile_id !== ownId && row.role !== 'admin'),
    [overview, ownId]
  );
  const activeStreamers = useMemo(
    () => streamerProfiles.filter((row) => row.status === 'active'),
    [streamerProfiles]
  );

  const adoption = useMemo(
    () => moduleAdoptionRows(usage, activeStreamers.length),
    [usage, activeStreamers.length]
  );

  if (!overview) return null;

  const totals = usage?.totals;
  const fullTelemetry = usage?.full_telemetry ?? false;

  const handleLimitChange = async (profileId: string, chars: number) => {
    setBusyId(profileId);
    try {
      await rpc('admin_set_elevenlabs_limit', { p_profile: profileId, p_daily_chars: chars });
      setError(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el tope diario de ElevenLabs.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {usage && !fullTelemetry && (
        <section className="cab-mod">
          <h2>Telemetría parcial</h2>
          <p className="cab-note">
            La adopción de módulos ya se muestra en tiempo real desde la nube. Para activar el pulso de OBS, el contador diario de caracteres de voz y el historial de acciones administrativas, aplica la migración{' '}
            <code className="cab-mono">0019_admin_usage_and_audit.sql</code> en el editor SQL de Supabase.
          </p>
        </section>
      )}

      <dl className="cab-stats">
        <div>
          <dt>En OBS (24 h)</dt>
          <dd>{fullTelemetry && totals ? fmtInt(totals.obs_active_24h) : '—'}</dd>
        </div>
        <div>
          <dt>En OBS (7 días)</dt>
          <dd>{fullTelemetry && totals ? fmtInt(totals.obs_active_7d) : '—'}</dd>
        </div>
        <div>
          <dt>En el panel (7 días)</dt>
          <dd>{totals ? fmtInt(totals.panel_active_7d) : '—'}</dd>
        </div>
        <div>
          <dt>Con módulos guardados</dt>
          <dd>
            {totals ? fmtInt(totals.configured_streamers) : 0} de {fmtInt(activeStreamers.length)}
          </dd>
        </div>
        <div>
          <dt>Locuciones (7 días)</dt>
          <dd>{fullTelemetry && totals ? fmtInt(totals.tts_7d_requests) : '—'}</dd>
        </div>
        <div>
          <dt>ElevenLabs hoy / 7 d</dt>
          <dd>
            {fullTelemetry && totals
              ? `${fmtInt(totals.eleven_today_chars)} / ${fmtInt(totals.eleven_7d_chars)}`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Fish Audio (7 días)</dt>
          <dd>
            {fullTelemetry && totals
              ? `${fmtInt(Math.max(0, totals.tts_7d_chars - totals.eleven_7d_chars))} car.`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Torneos abiertos</dt>
          <dd>
            {totals
              ? `${fmtInt(totals.active_tournaments)} (${fmtInt(totals.total_tournament_entries)} inscr.)`
              : '0'}
          </dd>
        </div>
      </dl>

      <section className="cab-mod">
        <div className="adm-head-row">
          <h2>Adopción de herramientas</h2>
          <span className="cab-hint">
            Calculado sobre {activeStreamers.length === 1 ? '1 cuenta activa' : `${activeStreamers.length} cuentas activas`}
          </span>
        </div>
        <div className="adm-table">
          <table>
            <thead>
              <tr>
                <th>Herramienta</th>
                <th>Área</th>
                <th>Streamers que la usan</th>
                <th>Adopción</th>
                <th>Último cambio</th>
              </tr>
            </thead>
            <tbody>
              {adoption.map((item) => (
                <tr key={item.module}>
                  <td>
                    <b>{item.label}</b>
                  </td>
                  <td>
                    <span className="cab-chip">{item.group}</span>
                  </td>
                  <td className="cab-mono">
                    {item.streamers} de {activeStreamers.length} ({item.percent}%)
                  </td>
                  <td className="adm-meter-cell">
                    <UsageMeter
                      used={item.streamers}
                      limit={Math.max(1, activeStreamers.length)}
                      label={`Adopción de ${item.label}`}
                    />
                  </td>
                  <td className="cab-mono">{relativeDay(item.lastUpdatedAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cab-hint">
          Un módulo cuenta como adoptado cuando el streamer ha guardado cambios propios en esa herramienta desde su panel.
        </p>
      </section>

      <section className="cab-mod">
        <div className="adm-head-row">
          <h2>Pulso en OBS y consumo de voz por streamer</h2>
          <a className="cab-btn2 cab-btn-sm" href={adminHref('streamers')}>
            Gestionar cuentas
          </a>
        </div>
        {streamerProfiles.length === 0 ? (
          <p className="cab-note">Todavía no hay cuentas de streamer registradas.</p>
        ) : (
          <div className="adm-table">
            <table>
              <thead>
                <tr>
                  <th>Streamer</th>
                  <th>Pulso OBS</th>
                  <th>Módulos</th>
                  <th>Fish Audio (7 d)</th>
                  <th>ElevenLabs (7 d)</th>
                  <th>Cuota ElevenLabs hoy</th>
                </tr>
              </thead>
              <tbody>
                {streamerProfiles.map((row) => {
                  const who = profileName(row);
                  const detail = usageByProfile.get(row.profile_id);
                  const rowMeta = meta.get(row.profile_id);
                  const elevenEnabled = Boolean(rowMeta?.elevenlabs_enabled);
                  const obsLive = isActiveInObs(detail, now, 1);
                  const obsWeek = isActiveInObs(detail, now, 7);
                  const todayEleven = detail?.tts_today.eleven_chars ?? 0;
                  const limitEleven = detail?.elevenlabs_daily_chars ?? 15000;
                  const nearlyFull = isElevenNearlyFull(detail, elevenEnabled);

                  return (
                    <tr key={row.profile_id}>
                      <td>
                        <b>{who}</b>
                        {row.twitch_login && <div className="cab-hint cab-mono">#{row.twitch_login}</div>}
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="cab-chip"
                            data-status={obsLive ? 'read' : obsWeek ? 'skipped' : undefined}
                          >
                            {obsLive ? 'Activo 24h' : obsWeek ? 'Esta semana' : relativeDay(detail?.last_widget_at, now)}
                          </span>
                        </div>
                      </td>
                      <td className="cab-mono">{detail?.modules.length ?? 0} / 18</td>
                      <td className="cab-mono">
                        {detail && detail.tts_7d.fish_requests > 0
                          ? `${fmtInt(detail.tts_7d.fish_chars)} car. (${fmtInt(detail.tts_7d.fish_requests)})`
                          : '0'}
                      </td>
                      <td className="cab-mono">
                        {detail && detail.tts_7d.eleven_requests > 0
                          ? `${fmtInt(detail.tts_7d.eleven_chars)} car. (${fmtInt(detail.tts_7d.eleven_requests)})`
                          : elevenEnabled
                            ? '0'
                            : 'Desactivado'}
                      </td>
                      <td>
                        {!elevenEnabled ? (
                          <span className="cab-hint">Usa solo Fish Audio</span>
                        ) : (
                          <div className="grid gap-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="cab-mono">
                                {fmtInt(todayEleven)}{' '}
                                {limitEleven > 0 ? `de ${fmtInt(limitEleven)} car.` : 'car. (sin tope)'}
                              </span>
                              {nearlyFull && (
                                <span
                                  className="cab-chip"
                                  data-status={todayEleven >= limitEleven ? 'rejected' : 'skipped'}
                                >
                                  {todayEleven >= limitEleven ? 'En respaldo Fish' : '≥85% hoy'}
                                </span>
                              )}
                            </div>
                            {limitEleven > 0 && (
                              <UsageMeter
                                used={todayEleven}
                                limit={limitEleven}
                                label={`Cuota diaria ElevenLabs de ${who}`}
                              />
                            )}
                            {fullTelemetry && (
                              <select
                                className="cab-inp adm-select-sm"
                                aria-label={`Tope diario de ElevenLabs para ${who}`}
                                value={limitEleven}
                                disabled={busyId === row.profile_id}
                                onChange={(e) => handleLimitChange(row.profile_id, Number(e.target.value))}
                              >
                                {DAILY_LIMIT_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="cab-hint">
          Protección automática: si una cuenta con ElevenLabs supera su tope diario, el servidor desvía la locución a Fish Audio automáticamente para que sus alertas en OBS nunca queden mudas ni consuman créditos extra.
        </p>
      </section>
    </>
  );
};
