/**
 * src/components/MediaLibraryModal.tsx
 *
 * Modal selector y administrador de la Biblioteca Multimedia (Media Vault).
 * Permite buscar sonidos y videos precargados, escuchar vistas previas y subir
 * nuevos audios (.mp3, .wav, .ogg, etc.) con validación estricta de hasta 30 segundos.
 */

import React, { useState } from 'react';
import {
  Check,
  Film,
  Music,
  Play,
  Search,
  Square,
  Trash2,
  Upload,
  Video,
  Volume2,
  X,
  AlertCircle,
} from 'lucide-react';
import { useMediaLibrary } from '../hooks/useMediaLibrary';
import {
  MediaCategory,
  MediaItem,
  MediaType,
  MAX_AUDIO_DURATION_SECONDS,
} from '../types/mediaLibrary';

interface MediaLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (item: MediaItem) => void;
  allowedTypes?: MediaType[]; // ['audio'] o ['video'] o ambos
  title?: string;
}

export const MediaLibraryModal: React.FC<MediaLibraryModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  allowedTypes = ['audio', 'video'],
  title = 'Biblioteca de Medios & Vault Sonoro',
}) => {
  const {
    items,
    playingId,
    uploadAudioFile,
    uploadVideoFile,
    deleteItem,
    playPreview,
    stopPreview,
  } = useMediaLibrary();

  const [activeTab, setActiveTab] = useState<MediaType>(
    allowedTypes.includes('audio') ? 'audio' : 'video'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<MediaCategory | 'todas'>('todas');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  if (!isOpen) return null;

  const filteredItems = items.filter((item) => {
    if (!allowedTypes.includes(item.type)) return false;
    if (allowedTypes.length > 1 && item.type !== activeTab) return false;
    if (selectedCategory !== 'todas' && item.category !== selectedCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return item.name.toLowerCase().includes(q) || item.format.toLowerCase().includes(q);
    }
    return true;
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    setIsUploading(true);

    try {
      const isVideo = file.type.startsWith('video/') || file.name.endsWith('.webm') || file.name.endsWith('.mp4');

      if (isVideo) {
        const item = await uploadVideoFile(file);
        onSelect(item);
      } else {
        const item = await uploadAudioFile(file, undefined, 'personalizado');
        onSelect(item);
      }
    } catch (err) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Error al procesar el archivo multimedia.');
      }
    } finally {
      setIsUploading(false);
      // Reset input
      e.target.value = '';
    }
  };

  const categories: { id: MediaCategory | 'todas'; label: string }[] = [
    { id: 'todas', label: 'Todos' },
    { id: 'alerta', label: 'Alertas' },
    { id: 'victoria', label: 'Victoria' },
    { id: 'meme', label: 'Memes' },
    { id: 'sfx', label: 'SFX & Chimes' },
    { id: 'personalizado', label: 'Mis Audios' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-[color:var(--cb-line)] bg-[#111216] shadow-2xl text-[color:var(--cb-fg)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera del Modal */}
        <div className="flex items-center justify-between border-b border-[color:var(--cb-line)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-[color:var(--ui,#9146ff)]/20 text-[color:var(--ui,#9146ff)]">
              <Volume2 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="cab-caps text-base font-extrabold">{title}</h2>
              <span className="text-[11px] text-[color:var(--cb-mut)]">
                Límite de audio: hasta {MAX_AUDIO_DURATION_SECONDS} segundos · MP3, WAV, OGG, WebM
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              stopPreview();
              onClose();
            }}
            className="rounded p-1 text-[color:var(--cb-mut)] hover:bg-[color:var(--cb-surface)] hover:text-[color:var(--cb-fg)] transition-colors"
            title="Cerrar ventana"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mensaje de error / advertencia de duración */}
        {errorMessage && (
          <div className="mx-5 mt-4 flex items-center gap-2 rounded border border-rose-500/50 bg-rose-950/40 p-3 text-xs text-rose-300">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Controles de búsqueda y filtros */}
        <div className="border-b border-[color:var(--cb-line)] px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Pestañas de tipo (Audio / Video) */}
            {allowedTypes.length > 1 && (
              <div className="flex rounded border border-[color:var(--cb-line)] bg-[color:var(--cb-panel)] p-0.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('audio')}
                  className={`flex items-center gap-1.5 rounded px-3 py-1 text-xs font-bold transition-all active:scale-[0.97] ${
                    activeTab === 'audio'
                      ? 'bg-[color:var(--cb-fg)] text-[color:var(--cb-panel)]'
                      : 'text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
                  }`}
                >
                  <Music className="h-3.5 w-3.5" />
                  <span>Audios</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('video')}
                  className={`flex items-center gap-1.5 rounded px-3 py-1 text-xs font-bold transition-all active:scale-[0.97] ${
                    activeTab === 'video'
                      ? 'bg-[color:var(--cb-fg)] text-[color:var(--cb-panel)]'
                      : 'text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
                  }`}
                >
                  <Video className="h-3.5 w-3.5" />
                  <span>Videos Alfa</span>
                </button>
              </div>
            )}

            {/* Input de Búsqueda */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[color:var(--cb-mut)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por nombre o formato..."
                className="cab-inp !pl-8 text-xs font-bold w-full"
              />
            </div>

            {/* Botón de subida rápida al Vault */}
            <label className="cab-btn !h-8 !px-3 !text-xs font-bold cursor-pointer transition-transform active:scale-[0.97]">
              <Upload className="h-3.5 w-3.5" />
              <span>{isUploading ? 'Validando...' : 'Subir Nuevo'}</span>
              <input
                type="file"
                accept={
                  activeTab === 'audio'
                    ? 'audio/mp3,audio/wav,audio/ogg,audio/mpeg,audio/webm,audio/m4a'
                    : 'video/webm,video/mp4'
                }
                onChange={handleFileUpload}
                disabled={isUploading}
                className="hidden"
              />
            </label>
          </div>

          {/* Chips de categorías */}
          {activeTab === 'audio' && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-all active:scale-[0.97] ${
                    selectedCategory === cat.id
                      ? 'bg-[color:var(--ui,#9146ff)] text-white'
                      : 'border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] text-[color:var(--cb-mut)] hover:text-[color:var(--cb-fg)]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Lista de Elementos Multimedia */}
        <div className="flex-1 overflow-y-auto p-5">
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-[color:var(--cb-mut)]">
              <Volume2 className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-xs font-bold">No se encontraron elementos coincidentes.</p>
              <p className="text-[11px] mt-1">
                Puedes subir un clip nuevo en formato MP3 o WAV de hasta 30 segundos.
              </p>
            </div>
          ) : (
            <div className="grid gap-2.5">
              {filteredItems.map((item) => {
                const isPlaying = playingId === item.id;

                return (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--cb-line)] bg-[color:var(--cb-surface)] p-3 transition-colors hover:border-[color:var(--cb-fg)]"
                  >
                    <div className="flex items-center gap-3">
                      {/* Botón de reproducción de prueba */}
                      {item.type === 'audio' ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (isPlaying) stopPreview();
                            else playPreview(item);
                          }}
                          className={`flex h-8 w-8 items-center justify-center rounded-full transition-transform active:scale-[0.97] ${
                            isPlaying
                              ? 'bg-rose-500 text-white'
                              : 'bg-[color:var(--cb-panel)] text-[color:var(--cb-fg)] border border-[color:var(--cb-line)] hover:border-[color:var(--cb-fg)]'
                          }`}
                          title={isPlaying ? 'Detener' : 'Escuchar vista previa'}
                        >
                          {isPlaying ? (
                            <Square className="h-3 w-3 fill-current" />
                          ) : (
                            <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                          )}
                        </button>
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded bg-amber-500/20 text-amber-300">
                          <Film className="h-4 w-4" />
                        </div>
                      )}

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-extrabold text-[color:var(--cb-fg)]">
                            {item.name}
                          </span>
                          <span className="cab-mono rounded bg-[color:var(--cb-bg)] px-1.5 py-0.2 text-[10px] text-[color:var(--cb-mut)] uppercase">
                            {item.format}
                          </span>
                          {item.isPreset && (
                            <span className="rounded bg-purple-500/20 px-1.5 py-0.2 text-[9px] font-black text-purple-300">
                              PRESET
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-[color:var(--cb-mut)]">
                          <span>Duración: {item.duration}s</span>
                          <span>·</span>
                          <span className="capitalize">{item.category}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {!item.isPreset && (
                        <button
                          type="button"
                          onClick={() => deleteItem(item.id)}
                          className="rounded p-1.5 text-rose-400 hover:bg-rose-950/30 transition-colors"
                          title="Eliminar de la biblioteca"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          stopPreview();
                          onSelect(item);
                          onClose();
                        }}
                        className="cab-btn2 !h-7 !px-3 !text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-transform active:scale-[0.97]"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Seleccionar</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pie del modal */}
        <div className="flex items-center justify-between border-t border-[color:var(--cb-line)] px-5 py-3 text-xs text-[color:var(--cb-mut)] bg-[color:var(--cb-panel)]/50 rounded-b-lg">
          <span>{items.length} elementos en el Vault</span>
          <button
            type="button"
            onClick={() => {
              stopPreview();
              onClose();
            }}
            className="cab-btn2 !h-7 !px-3 text-xs font-bold transition-transform active:scale-[0.97]"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
