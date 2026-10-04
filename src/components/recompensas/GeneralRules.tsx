/**
 * src/components/recompensas/GeneralRules.tsx
 *
 * Reglas comunes a todas las recompensas: si la capa está encendida, qué pasa
 * cuando llegan varias a la vez, los frenos contra el abuso y el estilo de
 * placa de partida.
 */

import React from 'react';
import { CustomPlate, PLATE_STYLES, REWARD_LIMITS, RewardsSettings } from '../../types/rewards';
import { Field, Range, Toggle } from '../studio/StudioKit';
import { CustomPlateFields, PlateStylePicker } from './PlateFields';

interface GeneralRulesProps {
  settings: RewardsSettings;
  cloudOn: boolean;
  update: (value: Partial<RewardsSettings>) => void;
  onRelease: (mediaId: string) => void;
  /** Algún uso de la placa «Personalizado» (de partida o en una recompensa). */
  customInUse: boolean;
}

const QUEUE_HINT = {
  queue: 'Cada recompensa espera a que termine la anterior. Ninguna se pierde y los sonidos no se pisan.',
  overlap: 'Suenan a la vez hasta el máximo y las placas se apilan. Lo que pase del máximo espera en cola.',
};

export const GeneralRules: React.FC<GeneralRulesProps> = ({ settings, cloudOn, update, onRelease, customInUse }) => {
  const updatePlate = (value: Partial<CustomPlate>) => update({ customPlate: { ...settings.customPlate, ...value } });
  const overlap = settings.queueMode === 'overlap';

  return (
    <>
      <div className="cab-field">
        <Toggle label="Reaccionar a los canjes y a los cheers del chat" checked={settings.enabled} onChange={(enabled) => update({ enabled })} />
        <span className="cab-hint">Apagado, la capa no hace nada aunque esté en OBS. Las pruebas de esta página siguen funcionando.</span>
      </div>
      <div className="cab-field">
        <Toggle label="Mostrar también en «Todo en uno»" checked={settings.inAll} onChange={(inAll) => update({ inAll })} />
        <span className="cab-hint">La fuente «Recompensas» las muestra siempre.</span>
      </div>

      <Field label="Si llegan varias a la vez" hint={QUEUE_HINT[settings.queueMode]}>
        <div className="cab-seg" role="group" aria-label="Si llegan varias a la vez">
          <button type="button" aria-pressed={!overlap} onClick={() => update({ queueMode: 'queue', allowOverlappingVideos: false })}>
            En cola, una tras otra
          </button>
          <button type="button" aria-pressed={overlap} onClick={() => update({ queueMode: 'overlap', allowOverlappingVideos: true })}>
            Se solapan
          </button>
        </div>
      </Field>

      <div className="rw-two">
        {overlap && (
          <Field label="Máximo sonando a la vez">
            <Range
              label="Máximo sonando a la vez"
              min={REWARD_LIMITS.overlap.min}
              max={REWARD_LIMITS.overlap.max}
              value={settings.overlapLimit}
              format={(value) => String(value)}
              onChange={(overlapLimit) => update({ overlapLimit })}
            />
          </Field>
        )}
        <Field label="Cuántas pueden esperar turno" hint="Con la cola llena, las siguientes se descartan.">
          <Range
            label="Cuántas pueden esperar turno"
            min={REWARD_LIMITS.queueMax.min}
            max={20}
            value={Math.min(20, settings.queueMax)}
            format={(value) => String(value)}
            onChange={(queueMax) => update({ queueMax })}
          />
        </Field>
        <Field label="Espera general" hint="Tiempo mínimo entre dos recompensas cualesquiera.">
          <Range
            label="Espera general"
            min={REWARD_LIMITS.globalCooldown.min}
            max={60}
            value={Math.min(60, settings.globalCooldownSeconds)}
            format={(value) => (value ? `${value} s` : 'Sin espera')}
            onChange={(globalCooldownSeconds) => update({ globalCooldownSeconds })}
          />
        </Field>
        <Field label="Límite por espectador" hint="Usos de una misma persona en un minuto.">
          <Range
            label="Límite por espectador"
            min={REWARD_LIMITS.perViewer.min}
            max={10}
            value={Math.min(10, settings.perViewerPerMinute)}
            format={(value) => (value ? `${value} por minuto` : 'Sin límite')}
            onChange={(perViewerPerMinute) => update({ perViewerPerMinute })}
          />
        </Field>
        <Field label="Tiempo mínimo de la placa" hint="Aunque el sonido dure menos de un segundo. Un clip largo la mantiene hasta que acaba, con tope de 30 s.">
          <Range
            label="Tiempo mínimo de la placa"
            min={REWARD_LIMITS.minPlate.min}
            max={REWARD_LIMITS.minPlate.max}
            step={0.5}
            value={settings.minPlateSeconds}
            format={(value) => `${String(value).replace('.', ',')} s`}
            onChange={(minPlateSeconds) => update({ minPlateSeconds })}
          />
        </Field>
      </div>
      <p className="cab-note">
        Un uso que llega antes de tiempo, que supera el límite de su espectador o que encuentra la cola llena se descarta
        y queda anotado en el registro del monitor. Los cheers anónimos comparten un mismo límite entre todos.
      </p>

      <Field
        label="Estilo de placa para todas"
        hint={`${PLATE_STYLES.find((style) => style.id === settings.defaultPlateStyle)?.hint ?? ''} Cada recompensa puede elegir otro.`}
      >
        <PlateStylePicker
          label="Estilo de placa para todas"
          value={settings.defaultPlateStyle}
          accent="#9146ff"
          custom={settings.customPlate}
          onPick={(defaultPlateStyle) => update({ defaultPlateStyle })}
        />
      </Field>

      {customInUse && (
        <details className="studio-details" open>
          <summary>Placa «Personalizado»</summary>
          <div>
            <CustomPlateFields plate={settings.customPlate} cloudOn={cloudOn} onChange={updatePlate} onRelease={onRelease} />
          </div>
        </details>
      )}
    </>
  );
};
