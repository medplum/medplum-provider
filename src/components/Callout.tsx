import { ReactNode } from 'react';

interface CalloutProps {
  variant: 'amber' | 'red' | 'critical';
  icon?: string;
  children: ReactNode;
}

const ICONS: Record<CalloutProps['variant'], string> = {
  amber: '⚠',
  red: '📋',
  critical: '🚨',
};

/** Warning / protocol-reminder banner — amber for caution, red for policy notes, critical for active-risk alerts. */
export function Callout({ variant, icon, children }: CalloutProps): JSX.Element {
  return (
    <div className={`djs-callout ${variant}`}>
      <span className="ic">{icon ?? ICONS[variant]}</span>
      <span>{children}</span>
    </div>
  );
}
