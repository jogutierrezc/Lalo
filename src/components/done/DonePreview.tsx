/**
 * src/components/done/DonePreview.tsx
 *
 * Vista previa en vivo de Done: el mismo DoneOverlayView que usa OBS, en modo «preview» (sin voz ni
 * chat real), con un chat simulado, las 10 emociones, los 11 gestos y los eventos de ejemplo.
 */

import React, { useCallback, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Boton, Segmented } from '../tally-ui';
import type { DoneSettings, DoneSpeech } from '../../lib/doneTypes';
import { DoneOverlayView, type DoneOverlayHandle, type OverlayStep } from './DoneOverlayView';
import {
  DONE_EMOTIONS,
  DONE_EMOTION_LABEL,
  DONE_GESTURES,
  DONE_GESTURE_LABEL,
  gestureAllowed,
  matchDoneCommand,
  viewerColor,
  type CharacterSpec,
} from './doneLogic';
import { DEMO_EVENT_LABEL, DEMO_VIEWERS, QUICK_MESSAGES, simulateEvent, simulateReply, toSpeeches, type DemoEvent } from './doneDemo';

interface ChatLine {
  id: number;
  name: string;
  color: string;
  text: string;
  badge?: string;
  sys?: boolean;
}

type PanelTab = 'chat' | 'emo' | 'ges' | 'evt';
const PANEL_TABS: { id: PanelTab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'emo', label: 'Emociones' },
  { id: 'ges', label: 'Gestos' },
  { id: 'evt', label: 'Eventos' },
];
const STEPS = [
  { n: 1, title: 'Mensaje', text: 'Un espectador escribe el comando' },
  { n: 2, title: 'Piensa', text: 'Done prepara la respuesta' },
  { n: 3, title: 'Chat de Twitch', text: 'Responde por escrito' },
  { n: 4, title: 'Overlay', text: 'Habla, escribe y hace gestos' },
];

interface Props {
  settings: DoneSettings;
  spec: CharacterSpec;
  widgetKey?: string;
  channel: string;
  memory?: string[];
  licenseNotice?: string | null;
  onFallback?: (reason: string) => void;
}

export const DonePreview: React.FC<Props> = ({ settings, spec, widgetKey, channel, memory = [], licenseNotice, onFallback }) => {
  const overlay = useRef<DoneOverlayHandle>(null);
  const [tab, setTab] = useState<PanelTab>('chat');
  const [bg, setBg] = useState<'game' | 'clear'>('game');
  const [debug, setDebug] = useState(false);
  const [open, setOpen] = useState(false);
  const accId = useId();
  const [step, setStep] = useState<OverlayStep>(0);
  const [queued, setQueued] = useState(0);
  const [who, setWho] = useState('lunaplay');
  const [msg, setMsg] = useState('');
  const seq = useRef(1);
  const cooldown = useRef<Record<string, number>>({});
  const [lines, setLines] = useState<ChatLine[]>(() => [
    { id: 0, name: 'nova_sky', color: viewerColor('nova_sky'), text: '¡hola a todos!' },
    { id: -1, name: '', color: '', text: `Done está conectado a ${channel} y escucha !${settings.commandWord}`, sys: true },
  ]);

  const addLine = useCallback((line: Omit<ChatLine, 'id'>) => setLines((prev) => [...prev.slice(-39), { ...line, id: seq.current++ }]), []);
  const botName = settings.writeAs === 'creator' ? channel : 'Done';
  const badge = settings.writeAs === 'creator' ? 'Done' : 'Bot';

  const submit = (viewer: string, text: string) => {
    const clean = text.trim();
    if (!clean) return;
    addLine({ name: viewer, color: viewerColor(viewer), text: clean });
    const hit = matchDoneCommand(clean, settings.commandWord, settings.keepAlias);
    if (!hit) return;
    const now = Date.now();
    if (cooldown.current[viewer] && now - cooldown.current[viewer] < 5000) {
      addLine({ name: '', color: '', text: `Done espera 5 s entre mensajes de ${viewer}.`, sys: true });
      return;
    }
    cooldown.current[viewer] = now;
    const segs = simulateReply(hit.rest, viewer, { banter: settings.banter === 'pique', channel, memory, replyMax: settings.replyMax });
    toSpeeches(segs, viewer, 'chat').forEach((speech, i) => overlay.current?.push(speech, { ask: i === 0 ? hit.rest : undefined, thinkMs: i === 0 ? 1100 : 0 }));
  };

  const event = (kind: DemoEvent) => {
    const who2 = DEMO_VIEWERS[Math.floor(Math.random() * DEMO_VIEWERS.length)];
    const e = simulateEvent(kind, kind === 'start' || kind === 'free' ? channel : who2);
    const speeches = toSpeeches([e], kind === 'free' ? null : who2, kind === 'free' ? 'spontaneous' : 'event');
    overlay.current?.push(speeches[0]);
  };

  const enabledEvent = (k: DemoEvent): boolean =>
    k === 'follow' ? settings.eventFollow : k === 'sub' ? settings.eventSub : k === 'raid' ? settings.eventRaid : k === 'start' ? settings.eventStart : settings.spontaneousEveryMin > 0;

  const onSpeechStart = useCallback(
    (speech: DoneSpeech) => addLine({ name: botName, color: '#ff9f7a', badge, text: speech.text }),
    [addLine, botName, badge]
  );

  return (
    <>
      <DoneOverlayView
        ref={overlay}
        settings={settings}
        spec={spec}
        mode="preview"
        widgetKey={widgetKey}
        audio={false}
        background={bg}
        showDebug={debug}
        licenseNotice={licenseNotice}
        onStep={setStep}
        onQueue={setQueued}
        onSpeechStart={onSpeechStart}
        onFallback={onFallback}
      />
      <div className="done-acc">
        <button type="button" className="done-acc-btn" aria-expanded={open} aria-controls={`${accId}-body`} id={`${accId}-btn`} onClick={() => setOpen((v) => !v)}>
          <span>Probar a Done</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {/* Cerrado, el contenido no recibe foco ni lo leen los lectores de pantalla */}
        <div className="done-acc-body" id={`${accId}-body`} role="region" aria-labelledby={`${accId}-btn`} data-open={open ? '1' : '0'} inert={!open}>
          <div>
            <div className="done-acc-in">
      <div className="done-pipe" aria-label="Flujo de una respuesta">
        {STEPS.map((s) => (
          <div key={s.n} className="done-pstep" data-on={step === s.n || (step === 4 && s.n === 3) ? '1' : '0'} data-done={step > s.n ? '1' : '0'}>
            <b>{s.title}</b>
            <span>{s.text}</span>
          </div>
        ))}
      </div>
      <div className="done-row">
        <Segmented label="Fondo de la vista previa" value={bg} options={[{ value: 'game', label: 'Partida' }, { value: 'clear', label: 'Transparente' }]} onChange={setBg} />
        <Boton pequeno aria-pressed={debug} onClick={() => setDebug((d) => !d)}>{debug ? 'Ocultar emoción y gesto' : 'Mostrar emoción y gesto'}</Boton>
      </div>
      <div className="done-chips" role="tablist" aria-label="Probar">
        {PANEL_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" className="done-pill-btn" aria-selected={tab === t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="done-panel">
        {tab === 'chat' && (
          <>
            <div className="done-feed" aria-live="polite">
              {lines.map((l) => (
                <div key={l.id} className="done-msg" data-sys={l.sys ? '1' : '0'}>
                  {l.sys ? (
                    l.text
                  ) : (
                    <>
                      <b style={{ color: l.color }}>{l.name}</b>
                      {l.badge && <span className={`bd${l.badge === 'Done' ? ' d' : ''}`}>{l.badge}</span>}
                      <span>{l.text}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="done-chips">
              {QUICK_MESSAGES.map((q) => (
                <button key={q} type="button" className="done-pill-btn" onClick={() => setMsg(`!${settings.commandWord} ${q}`)}>{q}</button>
              ))}
            </div>
            <form
              className="done-send"
              onSubmit={(e) => {
                e.preventDefault();
                submit(who.trim() || 'espectador', msg);
                setMsg('');
              }}
            >
              <input className="done-input" value={who} maxLength={20} aria-label="Nombre del espectador" onChange={(e) => setWho(e.target.value)} />
              <input className="done-input" value={msg} placeholder={`Escribe !${settings.commandWord} y tu pregunta`} aria-label="Mensaje" autoComplete="off" onChange={(e) => setMsg(e.target.value)} />
              <Boton type="submit" variante="principal">Enviar</Boton>
            </form>
            <p className="done-hint">
              Done solo responde a mensajes que empiezan con <code>!{settings.commandWord}</code>. {queued > 0 ? `En cola: ${queued}` : ''}
            </p>
          </>
        )}
        {tab === 'emo' && (
          <>
            <div className="done-chips">
              {DONE_EMOTIONS.map((e) => (
                <button key={e} type="button" className="done-pill-btn" onClick={() => overlay.current?.emote(e)}>{DONE_EMOTION_LABEL[e]}</button>
              ))}
            </div>
            <p className="done-hint">Las 10 emociones de Lux. Cada una cambia el rostro del personaje.</p>
          </>
        )}
        {tab === 'ges' && (
          <>
            <div className="done-chips">
              {DONE_GESTURES.map((g) => (
                <button key={g} type="button" className="done-pill-btn" disabled={!gestureAllowed(spec, g)} onClick={() => overlay.current?.gesture(g)}>{DONE_GESTURE_LABEL[g]}</button>
              ))}
            </div>
            <p className="done-hint">Los 11 gestos. Cada personaje define cuáles permite.</p>
          </>
        )}
        {tab === 'evt' && (
          <>
            <div className="done-chips">
              {(Object.keys(DEMO_EVENT_LABEL) as DemoEvent[]).map((k) => (
                <button key={k} type="button" className="done-pill-btn" disabled={!enabledEvent(k)} title={enabledEvent(k) ? undefined : 'Desactivado en Eventos'} onClick={() => event(k)}>
                  {DEMO_EVENT_LABEL[k]}
                </button>
              ))}
            </div>
            <p className="done-hint">Los eventos desactivados en la pestaña Eventos no se disparan.</p>
          </>
        )}
      </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
