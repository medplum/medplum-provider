export interface CheckGridItem {
  value: string;
  label: string;
  /** renders a free-text input alongside the checkbox, e.g. "Other:" */
  hasText?: boolean;
}

interface CheckGridProps {
  items: CheckGridItem[];
  checked: Record<string, boolean>;
  textValues?: Record<string, string>;
  onToggle: (value: string, checked: boolean) => void;
  onTextChange?: (value: string, text: string) => void;
}

/** Multi-select checkbox grid — used for allergy lists, findings, substances, etc. */
export function CheckGrid({ items, checked, textValues, onToggle, onTextChange }: CheckGridProps): JSX.Element {
  return (
    <div className="djs-check-grid">
      {items.map((item) => (
        <label key={item.value} className={`djs-check-chip ${item.hasText ? 'other-item' : ''}`}>
          <input
            type="checkbox"
            checked={!!checked[item.value]}
            onChange={(e) => onToggle(item.value, e.target.checked)}
          />
          <span>{item.label}{item.hasText ? ':' : ''}</span>
          {item.hasText && (
            <input
              type="text"
              style={{ maxWidth: 140 }}
              value={textValues?.[item.value] ?? ''}
              onChange={(e) => onTextChange?.(item.value, e.target.value)}
            />
          )}
        </label>
      ))}
    </div>
  );
}
