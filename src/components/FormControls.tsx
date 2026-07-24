import { ChipGroup, ChipOption, Reveal } from './ChipGroup';
import { CheckGrid } from './CheckGrid';
import { FormState, parseItems } from '../pages/formState';

/** ChipGroup bound to FormState under `track`, with optional yes/no reveal content. */
export function TrackedChip({
  form,
  track,
  options,
  children,
}: {
  form: FormState;
  track: string;
  options: ChipOption[];
  /** rendered in a Reveal, shown when the tracked value equals 'yes' */
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <div>
      <ChipGroup options={options} value={form.chip(track)} onChange={(v) => form.setChip(track, v)} />
      {children && <Reveal show={form.chip(track) === 'yes'}>{children}</Reveal>}
    </div>
  );
}

/** Shorthand for the common No/Yes tracked chip pair. */
export function YesNoChip({
  form,
  track,
  yesLabel = 'Yes',
  noLabel = 'No',
  danger,
  children,
}: {
  form: FormState;
  track: string;
  yesLabel?: string;
  noLabel?: string;
  danger?: boolean;
  children?: React.ReactNode;
}): JSX.Element {
  return (
    <TrackedChip
      form={form}
      track={track}
      options={[
        { value: 'no', label: noLabel },
        { value: 'yes', label: yesLabel, danger },
      ]}
    >
      {children}
    </TrackedChip>
  );
}

/** CheckGrid bound to FormState under `grid`, items given as the mockup's own "A|B::text" spec string. */
export function Grid({ form, grid, items }: { form: FormState; grid: string; items: string }): JSX.Element {
  return (
    <CheckGrid
      items={parseItems(items)}
      checked={form.checkedMap(grid)}
      textValues={form.checkTextMap(grid)}
      onToggle={(item, checked) => form.toggleCheck(grid, item, checked)}
      onTextChange={(item, text) => form.setCheckText(grid, item, text)}
    />
  );
}
