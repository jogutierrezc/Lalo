/**
 * src/pages/Studio.tsx
 *
 * Studio: el editor de escenas. Arriba, las escenas y las acciones; a la
 * izquierda, la paleta y la lista de capas; en el centro, el lienzo de
 * 1920 × 1080; a la derecha, los ajustes de la capa elegida.
 *
 * - Cada escena tiene su URL para OBS. Las fuentes sueltas y «Todo en uno»
 *   siguen funcionando igual: Studio es una opción más.
 * - Todo cambio se guarda solo y se puede deshacer (Ctrl+Z) y rehacer
 *   (Ctrl+Mayús+Z o Ctrl+Y).
 * - `#studio?scene=<id>&sel=<n>&probar=1` abre una escena con la capa n elegida
 *   y lanza su prueba: sirve para revisar el editor sin tocar nada.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Play, Redo2, Undo2 } from 'lucide-react';
import { SuiteNav } from '../components/SuiteNav';
import { UndoNote, useUndo } from '../components/studio/StudioKit';
import { EditorCanvas } from '../components/estudio/EditorCanvas';
import { Inspector } from '../components/estudio/Inspector';
import { SidePanel, SOON } from '../components/estudio/SidePanel';
import type { SceneData, SceneHandle } from '../components/estudio/SceneView';
import { BG_IMAGE_MAX_CHARS, BG_OPTIONS, EditorPrefs, GRID_SIZES, ZOOM_OPTIONS, loadPrefs, savePrefs } from '../components/estudio/editorPrefs';
import { useStudioSettings } from '../hooks/useStudioSettings';
import { useCloudSession } from '../hooks/useCloudSession';
import { loadAlertsSettings } from '../types/alerts';
import { encodeChatSettings, loadChatSettings } from '../types/chat';
import { loadGoalsSettings } from '../types/goals';
import { encodeRaidSettings, loadRaidSettings } from '../types/raid';
import { loadSettings } from '../types/settings';
import {
  LayerType,
  MAX_SCENES,
  SCENE_TEMPLATES,
  STAGE_H,
  STAGE_W,
  SceneTemplateId,
  StudioLayer,
  StudioScene,
  StudioSettings,
  buildTemplateScene,
  createLayer,
  makeId,
} from '../types/studio';
import { AlignTo, Rect, alignRect, roundRect } from '../utils/studioGeometry';
import {
  ZMove,
  addLayer,
  addScene,
  buildSceneUrl,
  duplicateLayer,
  duplicateScene,
  findScene,
  moveLayer,
  moveScene,
  pasteLayer,
  removeLayer,
  removeScene,
  renameScene,
  replaceScene,
  uniqueName,
  updateLayer,
} from '../utils/studioScenes';

function hashParams(): URLSearchParams {
  const hash = window.location.hash;
  const at = hash.indexOf('?');
  return new URLSearchParams(at === -1 ? '' : hash.slice(at + 1));
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export const Studio: React.FC = () => {
  const { settings, saved, change, endStep, undo, redo, canUndo, canRedo } = useStudioSettings();
  const cloud = useCloudSession();
  const uid = useId();
  const params = useMemo(hashParams, []);
  const [prefs, setPrefs] = useState<EditorPrefs>(loadPrefs);
  const [sceneId, setSceneId] = useState(() => params.get('scene') || prefs.sceneId);
  const scene = findScene(settings, sceneId) || settings.scenes[0];
  const sceneIndex = settings.scenes.indexOf(scene);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const n = parseInt(params.get('sel') || '', 10);
    return Number.isFinite(n) ? scene.layers[n - 1]?.id || null : null;
  });
  const selected = scene.layers.find((layer) => layer.id === selectedId) || null;
  const [clipboard, setClipboard] = useState<StudioLayer | null>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const deleted = useUndo<{ settings: StudioSettings; sceneId: string }>();
  const channel = loadSettings().channel;

  // Los ajustes de las capas de Lalo se leen de sus módulos: aquí solo se colocan
  const data = useMemo<SceneData>(
    () => ({ chat: loadChatSettings(), raid: loadRaidSettings(), goals: loadGoalsSettings(), alerts: loadAlertsSettings() }),
    []
  );

  const patchPrefs = (patch: Partial<EditorPrefs>) => setPrefs((prev) => ({ ...prev, ...patch }));
  useEffect(() => {
    savePrefs({ ...prefs, sceneId: scene.id });
  }, [prefs, scene.id]);

  // ---------- Cambios ----------
  const editScene = useCallback(
    (fn: (scene: StudioScene) => StudioScene, tag?: string) => {
      const id = scene.id;
      change((current) => {
        const target = findScene(current, id);
        return target ? replaceScene(current, fn(target)) : current;
      }, tag);
    },
    [change, scene.id]
  );

  const patchLayer = useCallback(
    (id: string, patch: Partial<StudioLayer>, tag?: string) => editScene((s) => updateLayer(s, id, patch), tag ? `${tag}-${id}` : undefined),
    [editScene]
  );

  const setRect = useCallback((id: string, rect: Rect, tag: string) => patchLayer(id, rect, tag), [patchLayer]);

  const openScene = (id: string) => {
    endStep();
    setSceneId(id);
    setSelectedId(null);
  };

  const addNew = (type: LayerType) => {
    if (SOON[type]) return;
    const layer = createLayer(type, makeId('l'));
    layer.name = uniqueName(layer.name, scene.layers.map((item) => item.name));
    editScene((s) => addLayer(s, layer));
    setSelectedId(layer.id);
  };

  const removeSelected = () => {
    if (!selected) return;
    editScene((s) => removeLayer(s, selected.id));
    setSelectedId(null);
  };

  const duplicateSelected = () => {
    if (!selected) return;
    const id = makeId('l');
    editScene((s) => duplicateLayer(s, selected.id, id));
    setSelectedId(id);
  };

  const copySelected = () => {
    if (!selected) return;
    setClipboard(selected);
    setNote(`«${selected.name}» copiada. Pégala en esta escena o en otra con Ctrl+V.`);
  };

  const paste = () => {
    if (!clipboard) return;
    const id = makeId('l');
    editScene((s) => pasteLayer(s, clipboard, id));
    setSelectedId(id);
  };

  const align = (to: AlignTo) => {
    if (!selected) return;
    patchLayer(selected.id, roundRect(alignRect(selected, to, STAGE_W, STAGE_H)));
  };

  const order = (id: string, move: ZMove) => editScene((s) => moveLayer(s, id, move));

  // ---------- Escenas ----------
  const addFromTemplate = (template: SceneTemplateId) => {
    const id = makeId('s');
    change((current) => addScene(current, buildTemplateScene(template, id, () => makeId('l'))));
    setSceneId(id);
    setSelectedId(null);
  };

  const duplicateCurrent = () => {
    const id = makeId('s');
    change((current) => duplicateScene(current, scene.id, id, () => makeId('l')));
    setSceneId(id);
    setSelectedId(null);
  };

  const removeCurrent = () => {
    if (settings.scenes.length <= 1) return;
    deleted.offer(`Escena «${scene.name}» borrada.`, { settings, sceneId: scene.id });
    const next = settings.scenes[sceneIndex === 0 ? 1 : sceneIndex - 1];
    change((current) => removeScene(current, scene.id));
    setSceneId(next.id);
    setSelectedId(null);
  };

  const restoreDeleted = () => {
    if (!deleted.pending) return;
    const { settings: before, sceneId: id } = deleted.pending.snapshot;
    change(() => before);
    setSceneId(id);
    deleted.clear();
  };

  // ---------- Deshacer y rehacer con el teclado ----------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // `probar=1` en la dirección: lanza la prueba de la capa elegida al abrir
  useEffect(() => {
    if (params.get('probar') !== '1' || !selectedId) return;
    const timer = setTimeout(() => sceneRef.current?.test(selectedId), 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- URL para OBS ----------
  const key = cloud.profile?.status === 'active' ? cloud.profile.widget_key : undefined;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const sceneUrl = buildSceneUrl(
    origin,
    channel,
    scene,
    key ? { key } : { chat: encodeChatSettings(data.chat), raid: encodeRaidSettings(data.raid) }
  );
  const copyUrl = () => {
    navigator.clipboard
      ?.writeText(sceneUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      })
      .catch(() => setNote('No se pudo copiar. Selecciona la URL de abajo y cópiala a mano.'));
  };

  const pickBackground = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = typeof reader.result === 'string' ? reader.result : '';
      if (!image) return;
      patchPrefs({ bg: 'image', bgImage: image });
      if (image.length > BG_IMAGE_MAX_CHARS) setNote('La imagen de fondo es grande: se usará hasta que cierres esta página.');
    };
    reader.readAsDataURL(file);
  };

  const status = selected
    ? `${selected.name} · x ${selected.x}  y ${selected.y} · ${selected.w} × ${selected.h}`
    : `${scene.layers.length} ${scene.layers.length === 1 ? 'capa' : 'capas'} en «${scene.name}»`;

  return (
    <div className="cab">
      <div className="mx-auto grid max-w-[1760px] gap-5 px-5 py-6">
        <SuiteNav currentApp="studio" channel={channel} saved={saved} />

        <div className="st-ed">
          <div className="st-bar">
            <div className="st-row">
              <div className="cab-seg" role="group" aria-label="Escenas">
                {settings.scenes.map((item) => (
                  <button key={item.id} type="button" aria-pressed={item.id === scene.id} onClick={() => openScene(item.id)}>
                    {item.name || 'Sin nombre'}
                  </button>
                ))}
              </div>
              <select
                className="cab-inp st-inp"
                style={{ width: 'auto' }}
                aria-label="Añadir una escena desde una plantilla"
                value=""
                disabled={settings.scenes.length >= MAX_SCENES}
                onChange={(e) => e.target.value && addFromTemplate(e.target.value as SceneTemplateId)}
              >
                <option value="">+ Escena nueva</option>
                {SCENE_TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="st-row">
              <button type="button" className="cab-btn2 st-btn" disabled={!canUndo} onClick={undo} title="Ctrl+Z">
                <Undo2 />
                Deshacer
              </button>
              <button type="button" className="cab-btn2 st-btn" disabled={!canRedo} onClick={redo} title="Ctrl+Mayús+Z o Ctrl+Y">
                <Redo2 />
                Rehacer
              </button>
              <button type="button" className="cab-btn2 st-btn" onClick={() => sceneRef.current?.playAll()}>
                <Play />
                Reproducir entradas
              </button>
              <a className="cab-btn2 st-btn" href={sceneUrl} target="_blank" rel="noreferrer" title="Abrir la escena en una pestaña">
                <ExternalLink />
                Abrir
              </a>
              <button type="button" className="cab-btn st-btn" onClick={copyUrl}>
                {copied ? <Check /> : <Copy />}
                {copied ? 'URL copiada' : 'Copiar URL para OBS'}
              </button>
            </div>
          </div>

          <div className="st-body">
            <aside className="st-left" aria-label="Escena y capas">
              <SidePanel
                scene={scene}
                sceneIndex={sceneIndex}
                sceneCount={settings.scenes.length}
                selectedId={selectedId}
                clipboard={clipboard}
                onRenameScene={(name) => change((current) => renameScene(current, scene.id, name), `escena-${scene.id}`)}
                onRenameDone={() => {
                  if (!scene.name.trim()) change((current) => renameScene(current, scene.id, `Escena ${sceneIndex + 1}`), `escena-${scene.id}`);
                  endStep();
                }}
                onMoveScene={(step) => change((current) => moveScene(current, scene.id, step))}
                onDuplicateScene={duplicateCurrent}
                onRemoveScene={removeCurrent}
                onAdd={addNew}
                onPaste={paste}
                onSelect={setSelectedId}
                onOrder={order}
                onToggle={(id, flag) => {
                  const layer = scene.layers.find((item) => item.id === id);
                  if (layer) patchLayer(id, { [flag]: !layer[flag] });
                }}
              />
              {deleted.pending && <UndoNote label={deleted.pending.label} onUndo={restoreDeleted} />}
            </aside>

            <div className="st-mid">
              <EditorCanvas
                key={scene.id}
                scene={scene}
                selectedId={selectedId}
                prefs={prefs}
                data={data}
                sceneRef={sceneRef}
                onSelect={setSelectedId}
                onRect={setRect}
                onStepEnd={endStep}
                onRemove={removeSelected}
                onDuplicate={duplicateSelected}
                onCopy={copySelected}
                onPaste={paste}
              />
              <div className="st-status" role="status">
                <span>{status}</span>
                <span>1920 × 1080</span>
              </div>

              <div className="st-tools">
                <div>
                  <span>Fondo</span>
                  <div className="cab-seg" role="group" aria-label="Fondo de la vista previa">
                    {BG_OPTIONS.filter((item) => item.id !== 'image' || prefs.bgImage).map((item) => (
                      <button key={item.id} type="button" aria-pressed={prefs.bg === item.id} onClick={() => patchPrefs({ bg: item.id })}>
                        {item.name}
                      </button>
                    ))}
                  </div>
                  <label className="cab-btn2 st-btn" htmlFor={`${uid}-bg`}>
                    Elegir imagen
                  </label>
                  <input
                    id={`${uid}-bg`}
                    className="studio-file"
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      pickBackground(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </div>
                <div>
                  <span>Zoom</span>
                  <div className="cab-seg" role="group" aria-label="Zoom del lienzo">
                    {ZOOM_OPTIONS.map((item) => (
                      <button key={item.id} type="button" aria-pressed={prefs.zoom === item.id} onClick={() => patchPrefs({ zoom: item.id })}>
                        {item.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <button type="button" className="cab-btn2 st-btn" aria-pressed={prefs.safe} onClick={() => patchPrefs({ safe: !prefs.safe })}>
                    Zona segura
                  </button>
                  <button type="button" className="cab-btn2 st-btn" aria-pressed={prefs.grid} onClick={() => patchPrefs({ grid: !prefs.grid })}>
                    Cuadrícula
                  </button>
                  <select
                    className="cab-inp st-inp"
                    style={{ width: 'auto' }}
                    aria-label="Tamaño de la cuadrícula"
                    value={prefs.gridSize}
                    onChange={(e) => patchPrefs({ gridSize: Number(e.target.value) })}
                  >
                    {GRID_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size} px
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span>Imán</span>
                  <button type="button" className="cab-btn2 st-btn" aria-pressed={prefs.snapLayers} onClick={() => patchPrefs({ snapLayers: !prefs.snapLayers })}>
                    A otras capas
                  </button>
                  <button type="button" className="cab-btn2 st-btn" aria-pressed={prefs.snapGrid} onClick={() => patchPrefs({ snapGrid: !prefs.snapGrid })}>
                    A la cuadrícula
                  </button>
                </div>
              </div>

              <p className="cab-hint">
                Flechas: mover 1 px (con Mayús, 10). Supr: borrar. Ctrl+D: duplicar. Ctrl+C y Ctrl+V: copiar y pegar, también entre
                escenas. Ctrl+Z: deshacer. Ctrl+Mayús+Z: rehacer. Mayús al estirar mantiene la proporción y Alt apaga el imán. El
                lienzo siempre se pega a sus bordes y a su centro.
              </p>
              {note && (
                <p className="cab-hint" role="status">
                  {note}
                </p>
              )}
              <div className="st-grp">
                <span className="cab-label">URL de «{scene.name}» para OBS</span>
                <code className="cab-url cab-mono st-url">{sceneUrl}</code>
                <p className="cab-hint">
                  En OBS, añade una fuente de navegador de 1920 × 1080 con esta URL.{' '}
                  {key
                    ? 'Los cambios llegan solos a OBS en menos de un minuto.'
                    : 'Sin cuenta en la nube, la escena viaja dentro de la URL: si la cambias, vuelve a copiarla en OBS.'}
                </p>
              </div>
            </div>

            <aside className="st-right" aria-label="Ajustes de la capa">
              <Inspector
                key={selected?.id || "nada"}
                layer={selected}
                index={selected ? scene.layers.indexOf(selected) : -1}
                total={scene.layers.length}
                onChange={(patch, tag) => selected && patchLayer(selected.id, patch, tag)}
                onDone={endStep}
                onAlign={align}
                onOrder={(move) => selected && order(selected.id, move)}
                onPlay={(kind) => selected && sceneRef.current?.play(selected.id, kind)}
                onTest={() => selected && sceneRef.current?.test(selected.id)}
                onDuplicate={duplicateSelected}
                onCopy={copySelected}
                onRemove={removeSelected}
              />
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
};
