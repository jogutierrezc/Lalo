/**
 * src/components/integraciones/KofiEventFields.tsx
 *
 * Ajustes de un tipo de aviso de Ko-fi (donación, nueva membresía, renovación,
 * tienda o comisión): si lanza alerta, su texto, su sonido, la cantidad mínima,
 * si la voz lee el mensaje y si suma a la meta. La donación tiene además el
 * umbral de «alerta grande»; las membresías, el filtro por nivel.
 */

import React, { useId } from 'react';
import {
  DEFAULT_KOFI_RULES,
  KOFI_SOUNDS,
  KOFI_TEMPLATE_MAX,
  type KofiEventRule,
  type KofiKind,
  type KofiSound,
} from '../../../server/integrations/kofiRules';
import { releaseMedia } from '../../lib/mediaRef';
import { MediaField } from '../recompensas/MediaField';
import { Field, Toggle } from '../studio/StudioKit';

interface KofiEventFieldsProps {
  kind: KofiKind;
  rule: KofiEventRule;
  /** Regla ya saneada, para reponer un campo al salir de él. */
  clean: KofiEventRule;
  cloudOn: boolean;
  onChange: (patch: Partial<KofiEventRule>) => void;
}

const VARIABLES = ['{nombre}', '{cantidad}', '{moneda}', '{mensaje}', '{nivel}'];

export const KofiEventFields: React.FC<KofiEventFieldsProps> = ({ kind, rule, clean, cloudOn, onChange }) => {
  const uid = useId();
  const number = (value: string): number => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <>
      <Toggle label="Alerta activada" checked={rule.on} onChange={(on) => onChange({ on })} />
      <Field
        label="Texto"
        htmlFor={`${uid}-tpl`}
        hint={
          <>
            Variables:{' '}
            {VARIABLES.map((item) => (
              <code key={item} className="cab-mono">
                {item}{' '}
              </code>
            ))}
          </>
        }
      >
        <input
          id={`${uid}-tpl`}
          type="text"
          className="cab-inp"
          maxLength={KOFI_TEMPLATE_MAX}
          placeholder={DEFAULT_KOFI_RULES[kind].tpl}
          value={rule.tpl}
          onChange={(e) => onChange({ tpl: e.target.value })}
        />
      </Field>

      <div className="itg-two">
        <Field label="Sonido" htmlFor={`${uid}-snd`}>
          <select id={`${uid}-snd`} className="cab-inp" value={rule.snd} onChange={(e) => onChange({ snd: e.target.value as KofiSound })}>
            {KOFI_SOUNDS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cantidad mínima" htmlFor={`${uid}-min`}>
          <input
            id={`${uid}-min`}
            type="number"
            className="cab-inp"
            min={0}
            max={10000}
            step={1}
            value={rule.min}
            onChange={(e) => onChange({ min: number(e.target.value) })}
            onBlur={() => onChange({ min: clean.min })}
          />
        </Field>
        {kind === 'don' && (
          <Field label="Alerta grande desde" htmlFor={`${uid}-big`}>
            <input
              id={`${uid}-big`}
              type="number"
              className="cab-inp"
              min={1}
              max={10000}
              step={1}
              value={rule.big}
              onChange={(e) => onChange({ big: number(e.target.value) })}
              onBlur={() => onChange({ big: clean.big })}
            />
          </Field>
        )}
        {(kind === 'mem' || kind === 'ren') && (
          <Field label="Solo este nivel" htmlFor={`${uid}-tier`}>
            <input
              id={`${uid}-tier`}
              type="text"
              className="cab-inp"
              maxLength={40}
              placeholder="vacío: todos"
              value={rule.tier}
              onChange={(e) => onChange({ tier: e.target.value })}
            />
          </Field>
        )}
      </div>

      {rule.snd === 'custom' && (
        <Field label="Tu archivo de sonido">
          <MediaField
            id={`${uid}-file`}
            accept="audio/mpeg,audio/wav,audio/ogg,audio/*"
            cloudOn={cloudOn}
            value={{ url: rule.sndUrl || undefined, name: rule.sndName || undefined, mediaId: rule.sndId || undefined }}
            emptyHint="Sin archivo: la alerta sale sin sonido. MP3, WAV u OGG."
            onChange={(next) => onChange({ sndUrl: next?.url ?? '', sndName: next?.name ?? '', sndId: next?.mediaId ?? '' })}
            onRelease={(mediaId) => void releaseMedia(mediaId)}
          />
        </Field>
      )}

      <Toggle label="La voz lee el mensaje" checked={rule.voz} onChange={(voz) => onChange({ voz })} />
      <Toggle label="Sumar a la meta" checked={rule.meta} onChange={(meta) => onChange({ meta })} />
      <p className="cab-hint">
        Si el apoyo es privado, la alerta dice «Alguien», no enseña el mensaje y la voz no lo lee. El correo y la dirección de envío no se guardan ni se
        muestran nunca. El mensaje pasa por las mismas palabras bloqueadas que la voz del chat antes de verse o leerse. La voz es la de «Voz del chat» y
        habla en la fuente «Alertas de Ko-fi» o en «Todo en uno».
      </p>
    </>
  );
};
