/**
 * src/components/done/DoneOverlayLayer.tsx
 *
 * La capa «Done» de la fuente única de OBS (app=done o app=all). Sondea /api/done/speech con la
 * clave de OBS (k) y el último id visto (after), como Lux, cada 1,5 s y en pausa con la pestaña
 * oculta; cada frase nueva va a DoneOverlayView, que la dice con la voz de «Voz del chat»
 * (POST /api/tts) respetando el volumen de Done.
 *
 * Con «demo=1» no hay red: la capa repite un guion de ejemplo para poder verla y probarla.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doneRelease, doneSpeech, isDoneDemo, type DoneVoice } from '../../lib/doneClient';
import { DONE_DEFAULTS, type DoneSettings } from '../../lib/doneTypes';
import { DoneOverlayView, type DoneOverlayHandle } from './DoneOverlayView';
import { buildCatalog, glbEntry, resolveEntry, type CharacterSpec } from './doneLogic';
import { demoScript } from './doneDemo';

export const POLL_MS = 1500;
const RELEASE_MS = 60000;
const DEMO_GAP_MS = 9000;

interface Props {
  /** Clave de OBS (k). */
  widgetKey: string;
  /** Canal de Twitch, para los textos de ejemplo. */
  channel?: string;
}

/** Ajustes visibles que se pueden fijar desde la URL (útil para ver la capa suelta): size, pos, style. */
function urlOverrides(): Partial<DoneSettings> {
  const out: Partial<DoneSettings> = {};
  if (typeof window === 'undefined') return out;
  const read = (key: string): string | null => {
    const fromSearch = new URLSearchParams(window.location.search).get(key);
    if (fromSearch) return fromSearch;
    const hash = window.location.hash;
    const at = hash.indexOf('?');
    return at === -1 ? null : new URLSearchParams(hash.slice(at)).get(key);
  };
  const size = Number(read('size'));
  if (Number.isFinite(size) && size > 0) out.obsSize = size;
  const pos = read('pos');
  if (pos === 'left' || pos === 'center' || pos === 'right') out.position = pos;
  const style = read('style');
  if (style) out.textStyle = style;
  return out;
}

export const DoneOverlayLayer: React.FC<Props> = ({ widgetKey, channel }) => {
  const demo = isDoneDemo();
  const overrides = useMemo(urlOverrides, []);
  const [settings, setSettings] = useState<DoneSettings>({ ...DONE_DEFAULTS, ...overrides });
  const [voice, setVoice] = useState<DoneVoice | null>(null);
  const [license, setLicense] = useState<string | null>(null);
  const [gestures, setGestures] = useState<CharacterSpec['allowedGestures']>(null);
  const overlay = useRef<DoneOverlayHandle>(null);
  const after = useRef<string | null>(null);

  // Sondeo de frases: pausa con la pestaña oculta y se pone al día al volver.
  useEffect(() => {
    if (demo || !widgetKey) return;
    let stopped = false;
    let busy = false;
    const poll = async () => {
      if (stopped || busy || document.visibilityState === 'hidden') return;
      busy = true;
      const res = await doneSpeech(widgetKey, after.current);
      busy = false;
      if (stopped || !res.ok) return;
      const first = after.current === null;
      after.current = res.data.last;
      if (res.data.settings) setSettings((s) => ({ ...s, ...res.data.settings, ...overrides }));
      if (res.data.voice) setVoice(res.data.voice);
      setLicense(res.data.licenseNotice);
      setGestures(res.data.gestures);
      // La primera respuesta solo fija el punto de partida: lo anterior no se vuelve a decir.
      if (!first) for (const item of res.data.items) overlay.current?.push(item);
    };
    void poll();
    const timer = window.setInterval(poll, POLL_MS);
    const onVisible = () => void poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [demo, widgetKey, overrides]);

  // Se recarga sola cuando se publica una versión nueva (como el overlay de Lux).
  useEffect(() => {
    if (demo) return;
    let known: number | null = null;
    const check = async () => {
      const res = await doneRelease();
      if (!res.ok) return;
      if (known === null) known = res.data.version;
      else if (res.data.version !== known) window.location.reload();
    };
    void check();
    const timer = window.setInterval(check, RELEASE_MS);
    return () => window.clearInterval(timer);
  }, [demo]);

  // Modo demo: un guion de ejemplo en rueda, sin red ni voz.
  useEffect(() => {
    if (!demo) return;
    let step = 0;
    const run = () => {
      const { speeches, ask } = demoScript(step++, { banter: false, channel: channel || 'tu_canal', memory: ['Le gusta el café'], replyMax: settings.replyMax });
      speeches.forEach((speech, i) => overlay.current?.push(speech, { ask: i === 0 ? ask : undefined, thinkMs: i === 0 && ask ? 900 : 0 }));
    };
    const first = window.setTimeout(run, 800);
    const timer = window.setInterval(run, DEMO_GAP_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, channel]);

  const spec = useMemo<CharacterSpec>(() => {
    const catalog = buildCatalog(null);
    if (settings.modelId) {
      const entry = glbEntry(
        { id: settings.modelId, name: 'Modelo 3D', source: 'creador', ownerProfileId: null, fileName: null, bytes: null, uploadedAt: null, reviewStatus: 'aprobado', licenseConfirmed: true, licenseNotice: license },
        false
      );
      return { ...entry, allowedGestures: gestures };
    }
    const entry = resolveEntry(catalog, settings);
    return { ...entry, allowedGestures: gestures ?? entry.allowedGestures };
  }, [settings, gestures, license]);

  if (!settings.enabled) return null;

  return (
    <div className="done-layer" aria-live="polite">
      <DoneOverlayView
        ref={overlay}
        settings={settings}
        spec={spec}
        mode="live"
        widgetKey={widgetKey}
        voice={voice}
        audio={!demo}
        background="clear"
        licenseNotice={license}
      />
    </div>
  );
};
