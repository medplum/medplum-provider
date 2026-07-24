import { ReactNode } from 'react';

export interface ChipOption {
  value: string;
  label: string;
  danger?: boolean;
}

interface ChipGroupProps {
  options: ChipOption[];
  value?: string;
  onChange: (value: string) => void;
}

/** Segmented single-select toggle — the mockup's primary yes/no & multi-choice control. */
export function ChipGroup({ options, value, onChange }: ChipGroupProps): JSX.Element {
  return (
    <div className="djs-chip-group">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`djs-chip ${opt.danger ? 'danger' : ''} ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Wraps content that should only render once a tracked ChipGroup equals `when`. */
export function Reveal({
  show,
  children,
}: {
  show: boolean;
  children: ReactNode;
}): JSX.Element | null {
  if (!show) return null;
  return <div className="djs-reveal">{children}</div>;
}
