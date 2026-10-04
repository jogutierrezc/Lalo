/**
 * src/components/estudio/editorPrefs.ts
 *
 * Preferencias del editor de Studio: fondo de vista previa, cuadrícula, imanes,
 * zona segura y zoom. Son de este navegador: no viajan a la nube ni a OBS.
 */

export type StageBg = 'game' | 'check' | 'green' | 'image';
export type StageZoom = 'fit' | '50' | '100';

export interface EditorPrefs {
  bg: StageBg;
  /** Imagen de vista previa elegida por el streamer. Solo se usa en el editor. */
  bgImage: string;
  grid: boolean;
  gridSize: number;
  snapGrid: boolean;
  snapLayers: boolean;
  safe: boolean;
  zoom: StageZoom;
  sceneId: string;
}

export const GRID_SIZES = [10, 20, 40, 80, 120];
export const BG_OPTIONS: { id: StageBg; name: string }[] = [
  { id: 'game', name: 'Juego' },
  { id: 'check', name: 'Transparente' },
  { id: 'green', name: 'Verde' },
  { id: 'image', name: 'Imagen' },
];
export const ZOOM_OPTIONS: { id: StageZoom; name: string }[] = [
  { id: 'fit', name: 'Ajustar' },
  { id: '50', name: '50%' },
  { id: '100', name: '100%' },
];

export const DEFAULT_PREFS: EditorPrefs = {
  bg: 'game',
  bgImage: '',
  grid: false,
  gridSize: 40,
  snapGrid: false,
  snapLayers: true,
  safe: true,
  zoom: 'fit',
  sceneId: '',
};

const KEY = 'lalo_studio_editor';
/** Tope de la imagen de vista previa que se guarda entre visitas. */
export const BG_IMAGE_MAX_CHARS = 1_500_000;

export function normalizePrefs(raw: unknown): EditorPrefs {
  const s = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_PREFS;
  const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  const bgImage = typeof s.bgImage === 'string' && s.bgImage.startsWith('data:image/') ? s.bgImage : '';
  const bg = BG_OPTIONS.some((item) => item.id === s.bg) ? (s.bg as StageBg) : d.bg;
  return {
    bg: bg === 'image' && !bgImage ? d.bg : bg,
    bgImage,
    grid: flag(s.grid, d.grid),
    gridSize: GRID_SIZES.includes(s.gridSize as number) ? (s.gridSize as number) : d.gridSize,
    snapGrid: flag(s.snapGrid, d.snapGrid),
    snapLayers: flag(s.snapLayers, d.snapLayers),
    safe: flag(s.safe, d.safe),
    zoom: ZOOM_OPTIONS.some((item) => item.id === s.zoom) ? (s.zoom as StageZoom) : d.zoom,
    sceneId: typeof s.sceneId === 'string' ? s.sceneId : '',
  };
}

export function loadPrefs(): EditorPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizePrefs(JSON.parse(raw)) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: EditorPrefs): void {
  const small = prefs.bgImage.length > BG_IMAGE_MAX_CHARS ? { ...prefs, bgImage: '' } : prefs;
  try {
    localStorage.setItem(KEY, JSON.stringify(small));
  } catch {
    try {
      // Sin sitio para la imagen: se guarda el resto y la imagen dura lo que dure la visita
      localStorage.setItem(KEY, JSON.stringify({ ...prefs, bgImage: '' }));
    } catch {
      // Sin almacenamiento: las preferencias duran lo que dure la visita
    }
  }
}
