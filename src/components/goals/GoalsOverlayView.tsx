/**
 * src/components/goals/GoalsOverlayView.tsx
 *
 * Componente unificado de visualización de Metas Comunitarias & Marcadores.
 * Se utiliza tanto en el monitor de simulación de GoalsStudio como en la
 * fuente de navegador de OBS (Widget.tsx).
 *
 * Características de diseño (impeccable + emil-design-eng + gsap):
 * - Hasta 4 metas en fila con compresión visual armónica automática.
 * - Con 5 o más metas: reducción y transición automática a Slideshow / Carrusel rotativo.
 * - Transiciones de diapositivas con GSAP (y: 8 -> 0, opacity: 0 -> 1, subtle blur).
 * - Barra de temporizador en vivo para cada ciclo del carrusel.
 * - Estilos cabina, neon, cyberpunk y minimal.
 * - Sin escalado desde scale(0), estados active:scale-[0.97], transiciones < 250ms.
 */

import React, { useState, useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { Target, ChevronLeft, ChevronRight, Layers, Trophy } from 'lucide-react';
import {
  CommunityGoalItem,
  GoalsDisplayMode,
  calculateGoalProgress,
  shouldDisplayAsSlideshow,
} from '../../types/goals';

interface GoalsOverlayViewProps {
  goals: CommunityGoalItem[];
  activeGoalId: string;
  displayMode: GoalsDisplayMode;
  slideshowIntervalSec: number;
  recentProgressGoalId?: string | null;
  onSelectGoal?: (goalId: string) => void;
  isStudio?: boolean;
}

export const GoalsOverlayView: React.FC<GoalsOverlayViewProps> = ({
  goals,
  activeGoalId,
  displayMode,
  slideshowIntervalSec,
  recentProgressGoalId,
  onSelectGoal,
  isStudio = false,
}) => {
  const enabledGoals = goals.filter((g) => g.enabled);
  const totalEnabled = enabledGoals.length;

  // Determinar si debemos renderizar como slideshow o en fila
  const isSlideshow = shouldDisplayAsSlideshow(totalEnabled, displayMode);

  // Estado del slideshow
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const slideCardRef = useRef<HTMLDivElement>(null);
  const timerBarRef = useRef<HTMLDivElement>(null);
  const cycleTweenRef = useRef<gsap.core.Tween | null>(null);

  // Mantener el slideIndex dentro del rango si cambia el total de metas
  useEffect(() => {
    if (totalEnabled > 0 && currentSlideIndex >= totalEnabled) {
      setCurrentSlideIndex(0);
    }
  }, [totalEnabled, currentSlideIndex]);

  // Si hay una meta con progreso reciente y estamos en modo reactivo, enfocarla
  useEffect(() => {
    if (recentProgressGoalId) {
      const idx = enabledGoals.findIndex((g) => g.id === recentProgressGoalId);
      if (idx !== -1) {
        setCurrentSlideIndex(idx);
      }
    }
  }, [recentProgressGoalId, enabledGoals]);

  // Efecto del Slideshow automático con GSAP
  useEffect(() => {
    if (!isSlideshow || totalEnabled <= 1) {
      if (cycleTweenRef.current) {
        cycleTweenRef.current.kill();
      }
      return;
    }

    const duration = Math.max(3, slideshowIntervalSec);

    // Animación de entrada de la tarjeta actual (Emil Kowalski: y: 8 -> 0, scale 0.96 -> 1, blur sutil)
    if (slideCardRef.current) {
      gsap.fromTo(
        slideCardRef.current,
        {
          opacity: 0,
          y: 8,
          scale: 0.98,
          filter: 'blur(2px)',
        },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          filter: 'blur(0px)',
          duration: 0.4,
          ease: 'cubic-bezier(0.23, 1, 0.32, 1)',
        }
      );
    }

    // Animación de la barra de temporizador del ciclo
    if (timerBarRef.current) {
      gsap.set(timerBarRef.current, { width: '0%' });
      cycleTweenRef.current = gsap.to(timerBarRef.current, {
        width: '100%',
        duration: duration,
        ease: 'none',
        onComplete: () => {
          setCurrentSlideIndex((prev) => (prev + 1) % totalEnabled);
        },
      });
    }

    return () => {
      if (cycleTweenRef.current) {
        cycleTweenRef.current.kill();
      }
    };
  }, [isSlideshow, currentSlideIndex, totalEnabled, slideshowIntervalSec]);

  if (totalEnabled === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-center text-xs text-neutral-400">
        <span>No hay metas comunitarias activas. Habilita una en el panel.</span>
      </div>
    );
  }

  // Si el modo es solo la meta activa seleccionada
  if (displayMode === 'single_active') {
    const singleGoal = enabledGoals.find((g) => g.id === activeGoalId) || enabledGoals[0];
    return (
      <div className="w-full max-w-xl mx-auto px-4">
        <GoalCardItem
          goal={singleGoal}
          compactLevel={1}
          isSelected={singleGoal.id === activeGoalId}
          isRecent={singleGoal.id === recentProgressGoalId}
          onSelect={onSelectGoal}
          isStudio={isStudio}
        />
      </div>
    );
  }

  // ==========================================
  // MODO 1: SLIDESHOW / CARRUSEL ROTATIVO (≥ 5 metas o forzado)
  // ==========================================
  if (isSlideshow) {
    const activeSlideGoal = enabledGoals[currentSlideIndex] || enabledGoals[0];

    return (
      <div className="w-full max-w-2xl mx-auto px-4">
        {/* Cabecera del Carrusel con indicador broadcast y temporizador */}
        <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-black uppercase tracking-wider text-neutral-400">
          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
            <span className="text-white">CARRUSEL ROTATIVO</span>
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[9px] text-amber-300 font-mono">
              META {currentSlideIndex + 1} DE {totalEnabled}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Controles de navegación manual rápida */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Meta anterior"
                onClick={() =>
                  setCurrentSlideIndex((prev) => (prev - 1 + totalEnabled) % totalEnabled)
                }
                className="flex h-5 w-5 items-center justify-center rounded bg-neutral-800/80 text-white hover:bg-neutral-700 active:scale-[0.97] transition-transform"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Meta siguiente"
                onClick={() => setCurrentSlideIndex((prev) => (prev + 1) % totalEnabled)}
                className="flex h-5 w-5 items-center justify-center rounded bg-neutral-800/80 text-white hover:bg-neutral-700 active:scale-[0.97] transition-transform"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            <span className="font-mono text-[10px] text-neutral-400">
              {slideshowIntervalSec}s
            </span>
          </div>
        </div>

        {/* Tarjeta del Slide Activo con ref para GSAP */}
        <div ref={slideCardRef} className="relative">
          <GoalCardItem
            goal={activeSlideGoal}
            compactLevel={1}
            isSelected={activeSlideGoal.id === activeGoalId}
            isRecent={activeSlideGoal.id === recentProgressGoalId}
            onSelect={onSelectGoal}
            isStudio={isStudio}
          />

          {/* Barra de progreso de tiempo del ciclo (Timer Bar) */}
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-black/40">
            <div
              ref={timerBarRef}
              className="h-full rounded-full transition-colors"
              style={{
                backgroundColor: activeSlideGoal.accentColor || '#f59e0b',
                boxShadow: `0 0 8px ${activeSlideGoal.accentColor || '#f59e0b'}88`,
              }}
            />
          </div>
        </div>

        {/* Indicadores Pills en la base del carrusel */}
        <div className="mt-2.5 flex items-center justify-center gap-1.5">
          {enabledGoals.map((g, idx) => {
            const isActive = idx === currentSlideIndex;
            return (
              <button
                key={g.id}
                type="button"
                aria-label={`Ver ${g.title}`}
                onClick={() => setCurrentSlideIndex(idx)}
                className="h-1.5 rounded-full transition-all duration-300 active:scale-[0.97]"
                style={{
                  width: isActive ? '24px' : '6px',
                  backgroundColor: isActive ? (g.accentColor || '#f59e0b') : 'rgba(255,255,255,0.2)',
                  boxShadow: isActive ? `0 0 8px ${g.accentColor || '#f59e0b'}88` : 'none',
                }}
              />
            );
          })}
        </div>
      </div>
    );
  }

  // ==========================================
  // MODO 2: HASTA 4 EN FILA CON COMPRESIÓN INTELIGENTE
  // ==========================================
  // Nivel de compresión según la cantidad de metas:
  // 1: Normal (1 columna grande)
  // 2: Moderado (2 columnas)
  // 3: Compacto (3 columnas, texto ajustado)
  // 4: Ultra-compacto (4 columnas, badges minimalistas)
  const compactLevel = Math.min(4, Math.max(1, totalEnabled));

  const gridClasses = {
    1: 'max-w-xl mx-auto grid grid-cols-1 gap-3',
    2: 'max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-3.5',
    3: 'max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-2.5',
    4: 'max-w-6xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-2',
  }[compactLevel as 1 | 2 | 3 | 4] || 'grid grid-cols-1 gap-3';

  return (
    <div className="w-full px-3">
      <div className={gridClasses}>
        {enabledGoals.slice(0, 4).map((goal) => (
          <GoalCardItem
            key={goal.id}
            goal={goal}
            compactLevel={compactLevel}
            isSelected={goal.id === activeGoalId}
            isRecent={goal.id === recentProgressGoalId}
            onSelect={onSelectGoal}
            isStudio={isStudio}
          />
        ))}
      </div>
    </div>
  );
};

// ==============================================================
// ITEM INDIVIDUAL DE META CON SOPORTE DE COMPRESIÓN Y ESTILOS
// ==============================================================
interface GoalCardItemProps {
  goal: CommunityGoalItem;
  compactLevel: number;
  isSelected?: boolean;
  isRecent?: boolean;
  onSelect?: (id: string) => void;
  isStudio?: boolean;
}

const GoalCardItem: React.FC<GoalCardItemProps> = ({
  goal,
  compactLevel,
  isSelected,
  isRecent,
  onSelect,
  isStudio,
}) => {
  const pct = calculateGoalProgress(goal.current, goal.target);
  const isCompleted = goal.current >= goal.target;

  const handleClick = () => {
    if (onSelect) {
      onSelect(goal.id);
    }
  };

  // Ajustes proporcionales según el nivel de compresión (1 a 4)
  const isUltraCompact = compactLevel >= 4;
  const isMidCompact = compactLevel === 3;

  const paddingClass = isUltraCompact
    ? 'p-2.5'
    : isMidCompact
    ? 'p-3'
    : compactLevel === 2
    ? 'p-3.5'
    : 'p-4';

  const titleSizeClass = isUltraCompact
    ? 'text-[11px] leading-tight line-clamp-1'
    : isMidCompact
    ? 'text-xs leading-snug line-clamp-1'
    : 'text-sm font-black line-clamp-1';

  const barHeightClass = isUltraCompact ? 'h-3.5' : isMidCompact ? 'h-4' : 'h-5';

  return (
    <div
      onClick={handleClick}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      className={`relative w-full transition-all duration-200 select-none ${
        onSelect ? 'cursor-pointer active:scale-[0.98]' : ''
      } ${
        isSelected && isStudio
          ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-black rounded-lg'
          : ''
      } ${
        isRecent
          ? 'animate-pulse'
          : ''
      }`}
    >
      {/* Estilo 1: Cabina Broadcast */}
      {goal.style === 'cabina' && (
        <div
          className={`rounded-lg border-2 border-[#3f4148] bg-[#111216]/95 ${paddingClass} shadow-xl backdrop-blur-md transition-colors`}
          style={{
            borderColor: isSelected ? goal.accentColor : '#3f4148',
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <Target
                className="h-3.5 w-3.5 flex-none"
                style={{ color: goal.accentColor }}
              />
              <span
                className={`cab-caps font-extrabold text-white truncate ${titleSizeClass}`}
                title={goal.title}
              >
                {goal.title}
              </span>
            </div>

            {goal.showNumbers && (
              <span className="cab-mono flex-none text-[10px] font-bold text-neutral-300">
                {goal.current}/{goal.target} {isUltraCompact ? '' : goal.unit}
              </span>
            )}
          </div>

          {/* Canal de la barra */}
          <div
            className={`relative ${barHeightClass} w-full overflow-hidden rounded bg-black/70 p-0.5 border border-[#3f4148]`}
          >
            <div
              className="h-full rounded transition-all duration-500 ease-out"
              style={{
                backgroundColor: goal.accentColor,
                boxShadow: `0 0 14px ${goal.accentColor}99`,
                width: `${pct}%`,
              }}
            />
            {goal.showPercentage && (
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black text-white drop-shadow">
                {pct}%
              </span>
            )}
          </div>

          {isCompleted && (
            <div className="mt-1 flex items-center justify-end gap-1">
              <Trophy className="h-2.5 w-2.5 text-amber-400" />
              <span className="text-[9px] font-black uppercase text-amber-400">
                ¡Completada!
              </span>
            </div>
          )}
        </div>
      )}

      {/* Estilo 2: Neón Glow */}
      {goal.style === 'neon' && (
        <div
          className={`rounded-xl border border-white/15 bg-black/85 ${paddingClass} backdrop-blur-md`}
          style={{
            boxShadow: `0 0 20px ${goal.accentColor}30`,
            borderColor: isSelected ? goal.accentColor : 'rgba(255,255,255,0.15)',
          }}
        >
          <div className="mb-1.5 flex items-center justify-between gap-1.5 text-white font-bold">
            <span
              className={`truncate ${titleSizeClass}`}
              style={{ textShadow: `0 0 8px ${goal.accentColor}` }}
              title={goal.title}
            >
              {goal.title}
            </span>
            <span className="font-mono text-[10px] flex-none text-neutral-300">
              {goal.current} / {goal.target}
            </span>
          </div>

          <div
            className={`relative ${barHeightClass} w-full overflow-hidden rounded-full bg-white/10 p-0.5`}
          >
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                backgroundColor: goal.accentColor,
                boxShadow: `0 0 16px ${goal.accentColor}, inset 0 0 4px #ffffff`,
                width: `${pct}%`,
              }}
            />
            {goal.showPercentage && (
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black text-white drop-shadow">
                {pct}%
              </span>
            )}
          </div>
        </div>
      )}

      {/* Estilo 3: Cyberpunk */}
      {goal.style === 'cyber' && (
        <div
          className={`relative border-l-4 bg-[#0a0d14]/95 ${paddingClass} text-white shadow-xl backdrop-blur-md`}
          style={{ borderColor: goal.accentColor }}
        >
          <div className="mb-1.5 flex items-center justify-between gap-1.5 font-mono">
            <span
              className={`font-black uppercase tracking-wider truncate ${titleSizeClass}`}
              style={{ color: goal.accentColor }}
              title={goal.title}
            >
              {goal.title}
            </span>
            <span className="text-[10px] flex-none text-amber-400 font-bold">
              {goal.current} // {goal.target}
            </span>
          </div>

          <div className={`relative ${barHeightClass} w-full bg-[#161c28]`}>
            <div
              className="h-full transition-all duration-500 ease-out"
              style={{
                backgroundColor: goal.accentColor,
                width: `${pct}%`,
              }}
            />
            {goal.showPercentage && (
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black text-black mix-blend-difference drop-shadow">
                {pct}%
              </span>
            )}
          </div>
        </div>
      )}

      {/* Estilo 4: Minimal */}
      {goal.style === 'minimal' && (
        <div
          className={`rounded-full border border-white/20 bg-neutral-950/90 ${
            isUltraCompact ? 'px-3 py-1.5' : 'px-4 py-2'
          } shadow-xl backdrop-blur-md`}
          style={{
            borderColor: isSelected ? goal.accentColor : 'rgba(255,255,255,0.2)',
          }}
        >
          <div className="mb-1 flex items-center justify-between gap-1.5 text-white font-bold">
            <span className={`truncate ${titleSizeClass}`} title={goal.title}>
              {goal.title}
            </span>
            <span className="font-mono text-[10px] flex-none">{pct}%</span>
          </div>

          <div
            className={`relative ${
              isUltraCompact ? 'h-1.5' : 'h-2'
            } w-full overflow-hidden rounded-full bg-neutral-800`}
          >
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                backgroundColor: goal.accentColor,
                width: `${pct}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
