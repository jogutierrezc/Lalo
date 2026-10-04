/**
 * src/components/recompensas/PlateFields.tsx
 *
 * La placa de una recompensa (o ninguna: solo sonido), el estilo de cada una y
 * los ajustes de la placa «Personalizado», que es una sola para todo el canal.
 */

import React, { useId } from 'react';
import {
  CustomPlate,
  CustomRewardItem,
  PLATE_STYLES,
  PlateStyleId,
  REWARD_LIMITS,
  RewardsSettings,
  plateStyleFor,
} from '../../types/rewards';
import { Field, Range, Toggle } from '../studio/StudioKit';
import { MediaField } from './MediaField';
import { NineGrid } from './MediaFields';
import { RewardPlate } from './RewardPlate';

const TEXT_COLORS = [
  { color: '#ffffff', name: 'Blanco' },
  { color: '#1b1c1f', name: 'Negro' },
  { color: '#ffd84a', name: 'Amarillo' },
  { color: '#22c7e0', name: 'Cian' },
];

/** Miniaturas de los seis estilos. `value` es el estilo elegido. */
export const PlateStylePicker: React.FC<{
  label: string;
  value: PlateStyleId;
  accent: string;
  custom: CustomPlate;
  onPick: (style: PlateStyleId) => void;
}> = ({ label, value, accent, custom, onPick }) => (
  <div className="rw-styles" role="group" aria-label={label}>
    {PLATE_STYLES.map((style) => (
      <button key={style.id} type="button" className="rw-style" aria-pressed={value === style.id} title={style.hint} onClick={() => onPick(style.id)}>
        <span className="rw-thumb" aria-hidden="true">
          <RewardPlate
            still
            plateStyle={style.id}
            accent={accent}
            custom={custom}
            tag="100 bits"
            name="Bocina"
            user="mar_ia"
            amount="100"
            unit="bits"
          />
        </span>
        {style.name}
      </button>
    ))}
  </div>
);

interface PlateFieldsProps {
  reward: CustomRewardItem;
  settings: RewardsSettings;
  patch: (value: Partial<CustomRewardItem>) => void;
}

export const PlateFields: React.FC<PlateFieldsProps> = ({ reward, settings, patch }) => {
  const uid = useId();
  const own = reward.plateStyle !== 'default';
  const active = plateStyleFor(reward, settings);
  const defaultName = PLATE_STYLES.find((style) => style.id === settings.defaultPlateStyle)?.name ?? '';

  return (
    <>
      <div className="cab-field">
        <Toggle
          label="Mostrar una placa mientras suena (quién y qué sonido)"
          checked={reward.showPlate}
          onChange={(next) => patch({ showPlate: next })}
        />
        <span className="cab-hint">
          Apagado, es solo sonido: no aparece ninguna placa. Si la recompensa tiene vídeo, el vídeo sale igual.
        </span>
      </div>

      {reward.showPlate && (
        <>
          <div className="cab-field">
            <Toggle
              label={`Usar el estilo de todas (${defaultName})`}
              checked={!own}
              onChange={(next) => patch({ plateStyle: next ? 'default' : active })}
            />
          </div>
          {own && (
            <Field label="Estilo de esta recompensa" hint={PLATE_STYLES.find((style) => style.id === active)?.hint}>
              <PlateStylePicker
                label="Estilo de esta recompensa"
                value={active}
                accent={reward.accentColor}
                custom={settings.customPlate}
                onPick={(style) => patch({ plateStyle: style })}
              />
            </Field>
          )}
          <div className="cab-field">
            <Toggle
              label="Escribir una frase en lugar del nombre del espectador"
              checked={reward.showNoticeText}
              onChange={(next) => patch({ showNoticeText: next })}
            />
          </div>
          {reward.showNoticeText && (
            <Field
              label="Frase"
              htmlFor={`${uid}-template`}
              hint={
                <>
                  Variables: <span className="cab-mono">{'{user}, {reward}, {message}'}</span>
                </>
              }
            >
              <input
                id={`${uid}-template`}
                className="cab-inp"
                maxLength={120}
                value={reward.noticeTemplate}
                onChange={(e) => patch({ noticeTemplate: e.target.value })}
              />
            </Field>
          )}
        </>
      )}
    </>
  );
};

interface CustomPlateFieldsProps {
  plate: CustomPlate;
  cloudOn: boolean;
  onChange: (value: Partial<CustomPlate>) => void;
  onRelease: (mediaId: string) => void;
}

/** Ajustes de la placa «Personalizado»: el archivo del creador y dónde va cada texto. */
export const CustomPlateFields: React.FC<CustomPlateFieldsProps> = ({ plate, cloudOn, onChange, onRelease }) => {
  const uid = useId();
  return (
    <>
      <Field label="Imagen o vídeo de la placa">
        <MediaField
          id={`${uid}-plate-file`}
          accept="image/png,image/gif,image/webp,image/svg+xml,video/webm,video/mp4"
          cloudOn={cloudOn}
          value={{ url: plate.mediaUrl || undefined, name: plate.mediaName, mediaId: plate.mediaId }}
          emptyHint="Sin archivo. PNG, GIF, WebP o SVG; o un vídeo WebM o MP4, que se repite sin sonido. La placa toma la proporción de tu archivo."
          onRelease={onRelease}
          onChange={(next, mime) =>
            onChange({
              mediaUrl: next?.url ?? '',
              mediaName: next?.name,
              mediaId: next?.mediaId,
              ...(next && mime ? { mediaKind: mime.startsWith('video/') ? 'video' : 'image' } : {}),
            })
          }
        />
      </Field>
      <Field label="Ancho de la placa">
        <Range
          label="Ancho de la placa"
          min={REWARD_LIMITS.plateWidth.min}
          max={REWARD_LIMITS.plateWidth.max}
          value={plate.width}
          format={(value) => `${Math.round((value / 60) * 100)}% del ancho`}
          onChange={(value) => onChange({ width: value })}
        />
      </Field>
      <div className="cab-field">
        <Toggle label="Mostrar los textos sobre la placa" checked={plate.showText} onChange={(next) => onChange({ showText: next })} />
        <span className="cab-hint">Apagado, sale solo tu imagen o tu vídeo.</span>
      </div>
      {plate.showText && (
        <>
          <div className="rw-two">
            <Field label="Dónde va el nombre del sonido">
              <NineGrid label="Dónde va el nombre del sonido" value={plate.nameCell} onPick={(cell) => onChange({ nameCell: cell })} />
            </Field>
            <Field label="Dónde va el nombre del espectador" hint="En la misma celda, van uno debajo del otro.">
              <NineGrid label="Dónde va el nombre del espectador" value={plate.userCell} onPick={(cell) => onChange({ userCell: cell })} />
            </Field>
          </div>
          <Field label="Color del texto">
            <div className="cab-sw">
              {TEXT_COLORS.map((item) => (
                <button
                  key={item.color}
                  type="button"
                  style={{ background: item.color }}
                  aria-label={item.name}
                  aria-pressed={plate.textColor.toLowerCase() === item.color}
                  onClick={() => onChange({ textColor: item.color })}
                />
              ))}
              <input type="color" value={plate.textColor} aria-label="Otro color" onChange={(e) => onChange({ textColor: e.target.value })} />
            </div>
          </Field>
        </>
      )}
    </>
  );
};
