import { Field, RangeField, Segmented } from '../../components/ui/controls';
import { IMAGE_FORMATS, isLossy, type ImageFormat } from '../../lib/image/types';

/** Format + quality controls shared by every image tool. */
export function OutputControls({
  format,
  onFormat,
  quality,
  onQuality,
  supported,
  ready,
}: {
  format: ImageFormat;
  onFormat: (format: ImageFormat) => void;
  quality: number;
  onQuality: (quality: number) => void;
  supported: ImageFormat[];
  ready: boolean;
}) {
  return (
    <>
      <Field label="Output format">
        <Segmented
          label="Output format"
          value={format}
          onChange={onFormat}
          options={IMAGE_FORMATS.map((f) => ({
            value: f.value,
            label: f.label,
            disabled: ready && !supported.includes(f.value),
            title: ready && !supported.includes(f.value) ? 'This browser cannot encode this format' : undefined,
          }))}
        />
      </Field>

      {isLossy(format) ? (
        <RangeField
          label="Quality"
          min={30}
          max={100}
          value={quality}
          onChange={onQuality}
          format={(v) => `${v}`}
        />
      ) : null}
    </>
  );
}
