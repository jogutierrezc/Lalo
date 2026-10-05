/**
 * src/pages/TournamentStudio.tsx
 *
 * Página «Torneos» sobre la plantilla común del panel: a la izquierda se
 * ajusta, en pestañas, y a la derecha el monitor 16:9 queda siempre a la vista.
 *
 * - Torneo: nombre, tamaño de la llave, la inscripción por enlace (la dirección
 *   #torneo/<slug> y las solicitudes que llegan por ella, con la nube) y los
 *   equipos, que también se pueden escribir a mano.
 * - En directo: la mesa de control. Quién juega, quién gana, deshacer,
 *   reiniciar y qué pantalla se ve.
 * - Marca: logo, patrocinadores, estilo y color propio.
 * - Narrador y comandos: la voz que cuenta lo que pasa y los comandos con los
 *   que el streamer y sus moderadores lo manejan desde el chat.
 *
 * Los AJUSTES se guardan solos; el ESTADO de la llave va por el almacén
 * (lib/tournamentStore.ts). Con la nube y una cuenta activa ese almacén es el
 * de lib/tournamentCloud.ts: lo que se marca aquí llega a OBS en otro equipo y
 * un comando del chat llega a esta página, en unos segundos. Sin la nube, llega
 * al momento a las fuentes de OBS abiertas en este navegador. En el monitor la
 * voz no suena.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Copy, Play, Plus, Shuffle, Undo2, X } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { Field, Range, Toggle } from '../components/studio/StudioKit';
import { MediaField, MediaValue } from '../components/recompensas/MediaField';
import { SignupPanel } from '../components/torneo/SignupPanel';
import { TournamentLayer } from '../components/torneo/TournamentLayer';
import { useCloudSession } from '../hooks/useCloudSession';
import { useTournament } from '../hooks/useTournament';
import { useTournamentSignup } from '../hooks/useTournamentSignup';
import { useVoiceCatalogue } from '../hooks/useVoiceCatalogue';
import { releaseMedia } from '../lib/mediaRef';
import { tournamentStore } from '../lib/tournamentStore';
import { ANNOUNCER_VOICE_ID } from '../types/raid';
import { loadSettings } from '../types/settings';
import {
  TOURNAMENT_LIMITS,
  TOURNAMENT_SCENES,
  TOURNAMENT_SIZES,
  TOURNAMENT_STYLES,
  type TournamentImage,
  type TournamentScene,
  type TournamentSize,
  type TournamentSponsor,
  type TournamentState,
  type TournamentTeam,
  encodeTournamentSettings,
  normalizeTournamentSettings,
  normalizeTournamentState,
} from '../types/tournament';
import { postBus } from '../utils/bus';
import {
  applyWinner,
  championOf,
  currentMatch,
  foldText,
  freshId,
  interpretTournamentCommand,
  matchName,
  matchTeams,
  narration,
  replaceTeams,
  resetTournament,
  resizeTournament,
  sceneNow,
  showScene,
  shuffleTeams,
  undoLast,
} from '../utils/tournamentLogic';
import { type TournamentEntry, teamFromEntry } from '../utils/tournamentSignup';
import { buildSuiteWidgetUrl } from '../utils/widgetUrl';
import '../styles/mascotas.css';
import '../styles/torneo.css';

type Tab = 'torneo' | 'directo' | 'marca' | 'narrador';
const TABS: { id: Tab; name: string }[] = [
  { id: 'torneo', name: 'Torneo' },
  { id: 'directo', name: 'En directo' },
  { id: 'marca', name: 'Marca' },
  { id: 'narrador', name: 'Narrador y comandos' },
];
const IMAGE_TYPES = 'image/png,image/gif,image/webp,image/svg+xml';
const TEAM_SIZES = [1, 2, 3, 4, 5].map((n) => ({ id: String(n), name: `${n} contra ${n}` }));

interface SegProps<T extends string> {
  label: string;
  value: T;
  options: readonly { id: T; name: string }[];
  onChange: (next: T) => void;
}
function Seg<T extends string>({ label, value, options, onChange }: SegProps<T>) {
  return (
    <div className="cab-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
          {option.name}
        </button>
      ))}
    </div>
  );
}

const toImage = (next: MediaValue): TournamentImage => ({ url: next.url ?? '', name: next.name ?? '', mediaId: next.mediaId ?? '' });
const toValue = (image: TournamentImage | null): MediaValue => (image ? { url: image.url, name: image.name, mediaId: image.mediaId || undefined } : {});

/** El nombre de un equipo: se escribe con libertad y se guarda en cuanto vale. */
const TeamName: React.FC<{ team: TournamentTeam; place: number; onRename: (name: string) => void }> = ({ team, place, onRename }) => {
  const [draft, setDraft] = useState(team.name);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(team.name);
  }, [team.name]);
  return (
    <input
      type="text"
      className="cab-inp"
      aria-label={`Nombre del equipo ${place}`}
      maxLength={TOURNAMENT_LIMITS.team}
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim()) onRename(e.target.value);
      }}
      onBlur={() => {
        focused.current = false;
        setDraft(team.name);
      }}
    />
  );
};

export const TournamentStudio: React.FC = () => {
  const { settings, state, saved, updateSettings, changeState } = useTournament();
  const cloud = useCloudSession();
  const voiceList = useVoiceCatalogue();
  const uid = useId();

  const [tab, setTab] = useState<Tab>('torneo');
  const [copied, setCopied] = useState<'url' | 'demo' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ label: string; yes: string; run: () => void } | null>(null);
  const [newTeam, setNewTeam] = useState('');
  const [teamNote, setTeamNote] = useState<string | null>(null);
  const [command, setCommand] = useState('');
  const [reply, setReply] = useState<string | null>(null);
  const [replay, setReplay] = useState(0);
  const [, setTick] = useState(0);

  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [voice] = useState(loadSettings);
  const channel = voice.channel;
  // El monitor usa los ajustes ya validados, igual que los recibirá OBS
  const clean = useMemo(() => normalizeTournamentSettings(settings), [settings]);
  const cloudOn = cloud.enabled && cloud.profile?.status === 'active';
  // Inscripción por enlace: solo con la nube y una cuenta activa
  const signup = useTournamentSignup(cloudOn && cloud.profile ? cloud.profile.id : null, clean);

  useEffect(
    () => () => {
      if (statusTimer.current) clearTimeout(statusTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  // La pantalla de victoria caduca sola: la mesa de control vuelve a mirar cuál se ve
  useEffect(() => {
    if (state.scene !== 'victoria') return;
    const left = state.sceneAt + clean.victorySec * 1000 - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => setTick((n) => n + 1), left + 60);
    return () => clearTimeout(timer);
  }, [state.scene, state.sceneAt, clean.victorySec]);

  // La llave del estado manda: si los ajustes guardaban otro tamaño, se igualan
  useEffect(() => {
    if (settings.size !== state.size) updateSettings({ size: state.size });
  }, [settings.size, state.size, updateSettings]);

  const say = (message: string) => {
    setStatus(message);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 7000);
  };

  // ---------- Estado de la llave ----------
  /** Todo cambio pasa por la normalización, igual que lo leerá OBS. */
  const apply = (change: (current: TournamentState) => TournamentState | null) =>
    changeState((current) => {
      const next = change(current);
      return next && next !== current ? normalizeTournamentState(next) : next;
    });
  const started = state.history.length > 0;
  /** Lo que borra resultados se pregunta antes, aquí mismo en la página. */
  const guarded = (label: string, yes: string, run: () => void) => {
    if (started) setAsk({ label, yes, run });
    else run();
  };

  const shown = sceneNow(state, clean.victorySec, Date.now());
  const match = currentMatch(state);
  const playing = match === null ? null : matchTeams(state, match);
  const champion = championOf(state);
  const teamName = (index: number) => state.teams[index]?.name ?? 'Equipo';
  const free = state.size - state.teams.length;

  const addTeam = () => {
    const name = newTeam.trim();
    if (!name) return;
    if (state.teams.length >= state.size) {
      setTeamNote(`La llave es de ${state.size} equipos y ya está completa. Elige una llave más grande o quita un equipo.`);
      return;
    }
    if (state.teams.some((team) => foldText(team.name) === foldText(name))) {
      setTeamNote('Ya hay un equipo con ese nombre. Cámbialo un poco: los comandos los distinguen por el nombre.');
      return;
    }
    const run = () => {
      apply((current) => replaceTeams(current, [...current.teams, { id: freshId('t', current.teams.map((team) => team.id)), name, captain: '', players: [] }], Date.now()));
      setNewTeam('');
      setTeamNote(null);
    };
    guarded(`La llave ya tiene resultados. Añadir a ${name} la vuelve a empezar.`, 'Añadir y reiniciar', run);
  };
  const removeTeam = (index: number) =>
    guarded(`La llave ya tiene resultados. Quitar a ${teamName(index)} la vuelve a empezar.`, 'Quitar y reiniciar', () =>
      apply((current) => replaceTeams(current, current.teams.filter((_, at) => at !== index), Date.now()))
    );
  const moveTeam = (index: number, step: -1 | 1) =>
    guarded('La llave ya tiene resultados. Cambiar el orden la vuelve a empezar.', 'Mover y reiniciar', () =>
      apply((current) => {
        const teams = current.teams.slice();
        const to = index + step;
        if (to < 0 || to >= teams.length) return null;
        [teams[index], teams[to]] = [teams[to], teams[index]];
        return replaceTeams(current, teams, Date.now());
      })
    );
  const renameTeam = (index: number, name: string) =>
    apply((current) => replaceTeams(current, current.teams.map((team, at) => (at === index ? { ...team, name } : team)), Date.now()));
  const shuffle = () =>
    guarded('La llave ya tiene resultados. Sortear el orden la vuelve a empezar.', 'Sortear y reiniciar', () => apply((current) => shuffleTeams(current, Date.now())));
  const resize = (size: TournamentSize) => {
    if (size === state.size) return;
    const over = state.teams.length - size;
    const run = () => {
      updateSettings({ size });
      apply((current) => resizeTournament(current, size, Date.now()));
    };
    if (over > 0) {
      setAsk({
        label: `En una llave de ${size} no caben los ${state.teams.length} equipos: ${over === 1 ? 'el último de la lista se quita' : `los ${over} últimos de la lista se quitan`}${started ? ' y la llave vuelve a empezar' : ''}.`,
        yes: `Pasar a ${size} equipos`,
        run,
      });
      return;
    }
    guarded(`La llave ya tiene resultados. Cambiar a ${size} equipos la vuelve a empezar.`, `Pasar a ${size} y reiniciar`, run);
  };

  /**
   * Mete en la llave al equipo de una solicitud aceptada, al final de la lista, y llama a `done`
   * cuando ya está dentro. Solo pasa el nombre: los Riot ID se quedan en la solicitud.
   */
  const admitTeam = (entry: TournamentEntry, done: () => void): string | null => {
    // Ya está dentro (se aceptó antes y falló el aviso, o se escribió a mano): no se añade dos veces
    if (state.teams.some((team) => foldText(team.name) === foldText(entry.team))) {
      done();
      return null;
    }
    if (state.teams.length >= state.size) {
      return `La llave es de ${state.size} equipos y ya está completa. Quita un equipo o elige una llave más grande, y vuelve a aceptar a ${entry.team}.`;
    }
    guarded(`La llave ya tiene resultados. Aceptar a ${entry.team} la vuelve a empezar.`, 'Aceptar y reiniciar', () => {
      apply((current) => replaceTeams(current, [...current.teams, teamFromEntry(entry, current.teams)], Date.now()));
      done();
    });
    return null;
  };

  const win = (team: number) => apply((current) => applyWinner(current, team, Date.now()));
  const undo = () => apply((current) => undoLast(current, Date.now()));
  const reset = () =>
    setAsk({
      label: 'Reiniciar borra todos los resultados de la llave. Los equipos se quedan como están.',
      yes: 'Reiniciar la llave',
      run: () => apply((current) => resetTournament(current, Date.now())),
    });
  const show = (scene: TournamentScene) => apply((current) => showScene(current, scene, clean.victorySec, Date.now()));

  // ---------- Comandos y narrador ----------
  const runCommand = (event: React.FormEvent) => {
    event.preventDefault();
    const text = command.trim();
    if (!text) return;
    const result = interpretTournamentCommand(text, clean.commands, state, { victorySec: clean.victorySec, now: Date.now() });
    if (!result) {
      setReply(`Ese comando no es del torneo. Los tuyos son ${clean.commands.winner}, ${clean.commands.undo} y ${clean.commands.main}.`);
      return;
    }
    if (result.state) apply(() => result.state);
    setReply(result.reply);
    setCommand('');
  };
  const said = narration(state, shown, clean.name);
  const sayInObs = () => {
    setReplay((n) => n + 1);
    // Las fuentes de OBS abiertas en este navegador repiten la entrada y dicen la frase
    postBus({ type: 'TOURNAMENT_TEST', say: true });
    say('Enviado a las fuentes de OBS abiertas en este navegador. En el monitor la voz no suena.');
  };

  // ---------- Marca ----------
  const release = (mediaId: string) => void releaseMedia(mediaId);
  const setSponsors = (sponsors: TournamentSponsor[]) => updateSettings({ sponsors });
  const patchSponsor = (id: string, patch: Partial<TournamentSponsor>) =>
    setSponsors(settings.sponsors.map((sponsor) => (sponsor.id === id ? { ...sponsor, ...patch } : sponsor)));
  const addSponsor = () =>
    setSponsors([...settings.sponsors, { id: freshId('s', settings.sponsors.map((sponsor) => sponsor.id)), name: `Patrocinador ${settings.sponsors.length + 1}`, image: null }]);
  const removeSponsor = (sponsor: TournamentSponsor) => {
    if (sponsor.image?.mediaId) release(sponsor.image.mediaId);
    setSponsors(settings.sponsors.filter((item) => item.id !== sponsor.id));
  };

  // ---------- URL de OBS ----------
  const copyUrl = (withDemo: boolean) => {
    const tts = loadSettings();
    // Con cuenta va la clave y, de reserva, los ajustes: si la nube no responde, la fuente usa los de la URL.
    // La llave solo viaja en la URL mientras su estado no vive en la nube (lib/tournamentCloud.ts)
    const extra: Record<string, string> = {
      ...(cloud.profile?.status === 'active' ? { k: cloud.profile.widget_key } : {}),
      ts: encodeTournamentSettings(clean, tournamentStore().cloud?.() ? null : state),
    };
    if (withDemo) extra.demo = '1';
    const url = buildSuiteWidgetUrl(window.location.origin, 'tournament', tts.channel, tts, extra);
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(withDemo ? 'demo' : 'url');
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(null), 2200);
      })
      .catch(() => say('No se pudo copiar. Usa «Fuentes de OBS» en la cabecera.'));
  };

  const voices = voiceList.catalogue.voices;
  const style = TOURNAMENT_STYLES.find((item) => item.id === settings.style) ?? TOURNAMENT_STYLES[0];
  const sceneName = TOURNAMENT_SCENES.find((item) => item.id === shown)?.name ?? '';

  return (
    <div className="cab">
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6">
        <SuiteNav currentApp="torneos" channel={channel} saved={saved} />

        <div className="grid items-start gap-5 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="grid gap-5">
            <div className="pt-tabs" role="tablist" aria-label="Secciones de Torneos">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`${uid}-tab-${item.id}`}
                  aria-selected={tab === item.id}
                  aria-controls={`${uid}-panel`}
                  onClick={() => setTab(item.id)}
                >
                  {item.name}
                  {/* Solicitudes de inscripción sin responder: a la vista desde cualquier pestaña */}
                  {item.id === 'torneo' && signup.pending.length > 0 && (
                    <b className="cab-chip tnp-badge" data-status="skipped" aria-label={signup.pending.length === 1 ? '1 solicitud pendiente' : `${signup.pending.length} solicitudes pendientes`}>
                      {signup.pending.length}
                    </b>
                  )}
                </button>
              ))}
            </div>

            <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`} className="grid gap-5">
              {/* Lo que borra resultados se confirma aquí, no en una ventana del navegador */}
              {ask && (
                <div className="cab-note" role="alertdialog" aria-label="Confirmar">
                  <p className="m-0">{ask.label}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="cab-btn cab-btn-sm"
                      autoFocus
                      onClick={() => {
                        ask.run();
                        setAsk(null);
                      }}
                    >
                      {ask.yes}
                    </button>
                    <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => setAsk(null)}>
                      Dejarlo como está
                    </button>
                  </div>
                </div>
              )}

              {/* ================= Torneo ================= */}
              {tab === 'torneo' && (
                <>
                  <section className="cab-mod">
                    <h2>Torneo</h2>
                    <div className="cab-field">
                      <Toggle label="El torneo sale en directo" checked={settings.enabled} onChange={(enabled) => updateSettings({ enabled })} />
                      <span className="cab-hint">Apagado no se ve ni atiende comandos, aunque esté en OBS. El monitor de esta página sigue funcionando.</span>
                    </div>
                    <div className="grid gap-x-8 gap-y-[18px] sm:grid-cols-2">
                      <Field label="Nombre del torneo" htmlFor={`${uid}-name`}>
                        <input
                          id={`${uid}-name`}
                          type="text"
                          className="cab-inp"
                          maxLength={TOURNAMENT_LIMITS.name}
                          value={settings.name}
                          onChange={(e) => updateSettings({ name: e.target.value })}
                          onBlur={() => updateSettings({ name: clean.name })}
                        />
                      </Field>
                      <Field label="Juego" htmlFor={`${uid}-game`} hint="Sale escrito bajo el nombre, en todas las pantallas.">
                        <input
                          id={`${uid}-game`}
                          type="text"
                          className="cab-inp"
                          maxLength={TOURNAMENT_LIMITS.game}
                          value={settings.game}
                          onChange={(e) => updateSettings({ game: e.target.value })}
                          onBlur={() => updateSettings({ game: clean.game })}
                        />
                      </Field>
                    </div>
                    <Field label="Tamaño de la llave" hint="Eliminación directa: quien pierde queda fuera.">
                      <Seg
                        label="Tamaño de la llave"
                        value={String(state.size)}
                        options={TOURNAMENT_SIZES.map((item) => ({ id: String(item.id), name: item.name }))}
                        onChange={(next) => resize(Number(next) as TournamentSize)}
                      />
                    </Field>
                    <Field label="Jugadores por equipo">
                      <Seg label="Jugadores por equipo" value={String(clean.teamSize)} options={TEAM_SIZES} onChange={(next) => updateSettings({ teamSize: Number(next) })} />
                    </Field>
                    <div className="cab-field">
                      <Toggle label="Mostrar también en «Todo en uno»" checked={settings.inAll} onChange={(inAll) => updateSettings({ inAll })} />
                      <span className="cab-hint">La fuente «Torneo» lo muestra siempre. No actives las dos a la vez en OBS o el narrador hablará dos veces.</span>
                    </div>
                  </section>

                  <SignupPanel
                    signup={signup}
                    name={clean.name}
                    free={free}
                    admit={admitTeam}
                    confirm={(label, yes, run) => setAsk({ label, yes, run })}
                  />

                  <section className="cab-mod">
                    <h2>Equipos</h2>
                    <p className="cab-hint">
                      {state.teams.length} de {state.size} en la llave. El orden de la lista es el de la llave: el 1 juega contra el 2, el 3 contra el 4…
                      {free > 0 && state.teams.length > 1 && ` Con ${free === 1 ? 'un hueco libre, el primero de la lista pasa directo' : `${free} huecos libres, los primeros de la lista pasan directos`} a la siguiente ronda.`}
                    </p>
                    {state.teams.length > 0 && (
                      <ol className="tnp-teams">
                        {state.teams.map((team, index) => (
                          <li key={team.id}>
                            <span>{index + 1}</span>
                            <TeamName team={team} place={index + 1} onRename={(name) => renameTeam(index, name)} />
                            <div className="tnp-acts">
                              <button type="button" className="cab-btn2" aria-label={`Subir a ${team.name}`} disabled={index === 0} onClick={() => moveTeam(index, -1)}>
                                <ArrowUp className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                className="cab-btn2"
                                aria-label={`Bajar a ${team.name}`}
                                disabled={index === state.teams.length - 1}
                                onClick={() => moveTeam(index, 1)}
                              >
                                <ArrowDown className="h-4 w-4" />
                              </button>
                              <button type="button" className="cab-btn2" aria-label={`Quitar a ${team.name}`} onClick={() => removeTeam(index)}>
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                    <form
                      className="tnp-add"
                      onSubmit={(e) => {
                        e.preventDefault();
                        addTeam();
                      }}
                    >
                      <input
                        type="text"
                        className="cab-inp"
                        aria-label="Nombre del equipo nuevo"
                        placeholder={state.teams.length === 0 ? 'Nombre del primer equipo' : 'Nombre del equipo'}
                        maxLength={TOURNAMENT_LIMITS.team}
                        value={newTeam}
                        onChange={(e) => {
                          setNewTeam(e.target.value);
                          setTeamNote(null);
                        }}
                      />
                      <button type="submit" className="cab-btn" disabled={!newTeam.trim()}>
                        <Plus className="h-4 w-4" />
                        <span>Añadir equipo</span>
                      </button>
                      <button type="button" className="cab-btn2" disabled={state.teams.length < 2} onClick={shuffle}>
                        <Shuffle className="h-4 w-4" />
                        <span>Sortear el orden</span>
                      </button>
                    </form>
                    {teamNote && (
                      <p className="cab-hint" role="alert">
                        {teamNote}
                      </p>
                    )}
                    {signup.own && (
                      <p className="cab-hint">Los equipos que aceptes en «Solicitudes» entran al final de esta lista. También puedes escribirlos a mano.</p>
                    )}
                  </section>
                </>
              )}

              {/* ================= En directo ================= */}
              {tab === 'directo' && (
                <>
                  <section className="cab-mod">
                    <h2>Mesa de control</h2>
                    <div className="tnp-now">
                      {playing && match !== null ? (
                        <>
                          <span className="cab-label">En juego · {matchName(match, state.size)}</span>
                          <b>
                            {teamName(playing[0])} contra {teamName(playing[1])}
                          </b>
                          <div className="tnp-row">
                            {playing.map((team) => (
                              <button key={team} type="button" className="cab-btn" onClick={() => win(team)}>
                                <span>Gana {teamName(team)}</span>
                              </button>
                            ))}
                          </div>
                        </>
                      ) : champion !== null ? (
                        <>
                          <span className="cab-label">Torneo terminado</span>
                          <b>Campeón: {teamName(champion)}</b>
                          <div className="tnp-row">
                            <button type="button" className="cab-btn" onClick={() => show('campeon')}>
                              <span>Celebrar al campeón</span>
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="cab-label">Sin partida</span>
                          <b>Faltan equipos</b>
                          <p className="cab-hint">Añade al menos dos en la pestaña «Torneo» para que haya una partida que jugar.</p>
                        </>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="cab-btn2 cab-btn-sm" disabled={!started} onClick={undo}>
                          <Undo2 className="h-4 w-4" />
                          <span>Deshacer el último resultado</span>
                        </button>
                        <button type="button" className="cab-btn2 cab-btn-sm" disabled={!started} onClick={reset}>
                          Reiniciar la llave
                        </button>
                      </div>
                    </div>
                    <Field label="Pantalla" hint="Lo que se ve ahora en OBS. «Victoria» repite el último resultado; «Oculto» no enseña nada.">
                      <Seg label="Pantalla" value={shown} options={TOURNAMENT_SCENES} onChange={show} />
                    </Field>
                    <Field label="Lo que dura la pantalla de victoria" hint="Después vuelve sola a la llave, con el ganador entrando en su casilla.">
                      <Range
                        label="Lo que dura la pantalla de victoria"
                        min={TOURNAMENT_LIMITS.victorySec.min}
                        max={TOURNAMENT_LIMITS.victorySec.max}
                        value={clean.victorySec}
                        format={(value) => `${value} s`}
                        onChange={(victorySec) => updateSettings({ victorySec })}
                      />
                    </Field>
                  </section>
                  <p className="cab-note">
                    {cloudOn
                      ? 'Con tu cuenta, lo que marques aquí llega a OBS en unos segundos, esté en este equipo o en otro, y lo que un moderador escriba en el chat llega a esta página igual de rápido. Si los dos cambiáis algo a la vez, se queda el primero que llegó y aquí verás la llave como quedó.'
                      : 'Lo que marques aquí llega al momento a las fuentes de OBS abiertas en este navegador. Un comando escrito en el chat lo atiende la fuente de OBS: si OBS está en otro equipo, esta página no lo ve. Con la nube y tu cuenta, sí.'}
                  </p>
                </>
              )}

              {/* ================= Marca ================= */}
              {tab === 'marca' && (
                <>
                  <section className="cab-mod">
                    <h2>Estilo</h2>
                    <div className="cab-field">
                      <Seg label="Estilo" value={settings.style} options={TOURNAMENT_STYLES} onChange={(next) => updateSettings({ style: next })} />
                      <span className="cab-hint">{style.about}</span>
                    </div>
                    <div className="cab-field">
                      <div className="flex flex-wrap items-center gap-4">
                        <Toggle label="Color propio" checked={settings.customColor} onChange={(customColor) => updateSettings({ customColor })} />
                        <input
                          type="color"
                          className="studio-color"
                          aria-label="Color propio"
                          value={clean.color}
                          onChange={(e) => updateSettings({ color: e.target.value, customColor: true })}
                        />
                      </div>
                      <span className="cab-hint">Sustituye al color de acento del estilo. El texto que va encima se aclara u oscurece solo para leerse bien.</span>
                    </div>
                  </section>

                  <section className="cab-mod">
                    <h2>Logo</h2>
                    <Field label="Logo del canal" hint="Sale arriba a la izquierda en todas las pantallas. PNG, GIF, WebP o SVG; mejor con fondo transparente.">
                      <MediaField
                        id={`${uid}-logo`}
                        accept={IMAGE_TYPES}
                        value={toValue(settings.logo)}
                        cloudOn={cloudOn}
                        emptyHint="Sin logo: en OBS ese hueco no sale."
                        onChange={(next) => updateSettings({ logo: next?.url ? toImage(next) : null })}
                        onRelease={release}
                      />
                    </Field>
                  </section>

                  <section className="cab-mod">
                    <h2>Patrocinadores</h2>
                    <p className="cab-hint">
                      Salen abajo, tras «Con el apoyo de». Con imagen se ve el logo; sin ella, el nombre. Hasta {TOURNAMENT_LIMITS.sponsors}.
                    </p>
                    {settings.sponsors.map((sponsor, index) => (
                      <div key={sponsor.id} className="tnp-sp">
                        <div className="tnp-sp-h">
                          <input
                            type="text"
                            className="cab-inp"
                            aria-label={`Nombre del patrocinador ${index + 1}`}
                            maxLength={TOURNAMENT_LIMITS.sponsor}
                            value={sponsor.name}
                            onChange={(e) => patchSponsor(sponsor.id, { name: e.target.value })}
                          />
                          <button type="button" className="cab-btn2 cab-btn-sm" onClick={() => removeSponsor(sponsor)}>
                            Quitar
                          </button>
                        </div>
                        <MediaField
                          id={`${uid}-sp-${sponsor.id}`}
                          accept={IMAGE_TYPES}
                          value={toValue(sponsor.image)}
                          cloudOn={cloudOn}
                          emptyHint="Sin imagen: sale el nombre."
                          onChange={(next) => patchSponsor(sponsor.id, { image: next?.url ? toImage(next) : null })}
                          onRelease={release}
                        />
                      </div>
                    ))}
                    <div>
                      <button type="button" className="cab-btn2" disabled={settings.sponsors.length >= TOURNAMENT_LIMITS.sponsors} onClick={addSponsor}>
                        <Plus className="h-4 w-4" />
                        <span>Añadir patrocinador</span>
                      </button>
                    </div>
                  </section>
                </>
              )}

              {/* ================= Narrador y comandos ================= */}
              {tab === 'narrador' && (
                <>
                  <section className="cab-mod">
                    <h2>Narrador</h2>
                    <div className="cab-field">
                      <Toggle label="Una voz cuenta lo que pasa" checked={settings.narrator} onChange={(narrator) => updateSettings({ narrator })} />
                      <span className="cab-hint">
                        Narra cada cambio de pantalla y cada resultado, con la emoción que toca. Espera su turno en la misma cola que la Voz del chat.
                      </span>
                    </div>
                    <Field label="Voz" htmlFor={`${uid}-voice`} hint="De serie, Brisa. Usa el mismo motor que la Voz del chat.">
                      <select id={`${uid}-voice`} className="cab-inp" value={clean.voiceId} onChange={(e) => updateSettings({ voiceId: e.target.value })}>
                        {voices.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                        {!voices.some((item) => item.id === clean.voiceId) && (
                          <option value={clean.voiceId}>{clean.voiceId === ANNOUNCER_VOICE_ID ? 'Brisa' : 'Voz personalizada'}</option>
                        )}
                      </select>
                    </Field>
                    <div className="cab-field">
                      <span className="cab-label">Lo que diría ahora</span>
                      <div className="tnp-narr">
                        {said ? (
                          <>
                            <span>
                              <span className="cab-chip">{said.emotion}</span>
                            </span>
                            <p>{said.text}</p>
                          </>
                        ) : (
                          <p>Con el torneo oculto no dice nada.</p>
                        )}
                      </div>
                      <div>
                        <button type="button" className="cab-btn2 cab-btn-sm" disabled={!said || !settings.narrator} onClick={sayInObs}>
                          <Play className="h-4 w-4" />
                          <span>Decirlo en OBS</span>
                        </button>
                      </div>
                    </div>
                  </section>

                  <section className="cab-mod">
                    <h2>Comandos</h2>
                    <p className="cab-hint">Solo los atiende si los escribe el streamer o un moderador. Puedes cambiarles el nombre.</p>
                    <div className="grid gap-x-6 gap-y-[18px] sm:grid-cols-3">
                      {(
                        [
                          ['winner', 'Marcar ganador'],
                          ['undo', 'Deshacer'],
                          ['main', 'Pantallas y reinicio'],
                        ] as const
                      ).map(([key, label]) => (
                        <Field key={key} label={label} htmlFor={`${uid}-cmd-${key}`}>
                          <input
                            id={`${uid}-cmd-${key}`}
                            type="text"
                            className="cab-inp cab-mono"
                            maxLength={16}
                            spellCheck={false}
                            autoComplete="off"
                            value={settings.commands[key]}
                            onChange={(e) => updateSettings({ commands: { ...settings.commands, [key]: e.target.value } })}
                            onBlur={() => updateSettings({ commands: clean.commands })}
                          />
                        </Field>
                      ))}
                    </div>
                    <ul className="cab-cmds">
                      <li>
                        <code>{clean.commands.winner} equipo</code> — da la partida en juego a ese equipo. Vale el principio del nombre, o 1 y 2.
                      </li>
                      <li>
                        <code>{clean.commands.undo}</code> — borra el último resultado.
                      </li>
                      <li>
                        <code>{clean.commands.main} llave</code>, <code>sigue</code>, <code>tabla</code>, <code>campeon</code> — cambia de pantalla.
                      </li>
                      <li>
                        <code>{clean.commands.main} ocultar</code> — quita el torneo de la pantalla.
                      </li>
                      <li>
                        <code>{clean.commands.main} reiniciar</code> — vuelve a empezar la llave.
                      </li>
                    </ul>
                    <Field label="Pruébalo aquí, como en el chat" htmlFor={`${uid}-try`}>
                      <form className="tnp-add" onSubmit={runCommand}>
                        <input
                          id={`${uid}-try`}
                          type="text"
                          className="cab-inp cab-mono"
                          placeholder={`${clean.commands.winner} ${playing ? teamName(playing[0]).split(' ')[0] : 'Lobos'}`}
                          spellCheck={false}
                          autoComplete="off"
                          value={command}
                          onChange={(e) => setCommand(e.target.value)}
                        />
                        <button type="submit" className="cab-btn" disabled={!command.trim()}>
                          Enviar
                        </button>
                      </form>
                      <span className="cab-hint" role="status">
                        {reply ?? 'Hace lo mismo que el comando en el chat, sobre la llave de esta página.'}
                      </span>
                    </Field>
                  </section>
                </>
              )}
            </div>
          </div>

          {/* ---------- Monitor ---------- */}
          <section className="cab-mod max-[1099px]:order-first min-[1100px]:sticky min-[1100px]:top-4">
            <div className="flex items-center justify-between gap-3">
              <h2>Monitor</h2>
              <b className="cab-chip">{sceneName}</b>
            </div>
            <div className="cab-stage">
              <TournamentLayer settings={clean} state={state} isStudio replay={replay} />
            </div>

            <div className="cab-field">
              <span className="cab-label">Pantalla</span>
              <Seg label="Pantalla" value={shown} options={TOURNAMENT_SCENES} onChange={show} />
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="cab-btn flex-1" onClick={() => copyUrl(false)}>
                {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied === 'url' ? 'URL copiada' : 'Copiar URL para OBS'}</span>
              </button>
              <button type="button" className="cab-btn2 flex-1" onClick={() => copyUrl(true)}>
                {copied === 'demo' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied === 'demo' ? 'URL copiada' : 'Copiar URL con pantallas de muestra'}</span>
              </button>
            </div>
            <p className="cab-hint" role="status">
              {status ||
                (channel
                  ? 'El monitor enseña tu llave tal como saldrá en OBS. La voz del narrador solo se oye en la fuente de OBS.'
                  : 'Falta tu canal: escríbelo en Inicio antes de copiar la URL.')}
            </p>
            <p className="cab-note">
              La fuente ocupa la pantalla entera (1920 × 1080) y es transparente: ponla encima de tu partida. Si copiaste la URL sin cuenta en la nube,
              vuelve a copiarla cuando cambies los equipos.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
