import { ReactNode } from 'react';

export function SectionHeader({
  index,
  total,
  title,
  description,
}: {
  index: number;
  total: number;
  title: string;
  description?: string;
}): JSX.Element {
  return (
    <>
      <p className="djs-section-desc">Section {index} of {total}</p>
      <h2 className="djs-section-title">{title}</h2>
      {description && <p className="djs-section-desc">{description}</p>}
    </>
  );
}

export function Card({
  index,
  title,
  hint,
  children,
}: {
  index?: string;
  title: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="djs-card">
      <h3>
        {index && <span className="idx">{index}</span>}
        {title}
      </h3>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </div>
  );
}

export function FieldGrid({ children, style }: { children: ReactNode; style?: React.CSSProperties }): JSX.Element {
  return <div className="djs-field-grid" style={style}>{children}</div>;
}

export function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={`djs-field ${wide ? 'wide' : ''}`}>
      <label>{label}</label>
      {children}
    </div>
  );
}
