import type { JSX } from 'react';
import { ReactNode } from 'react';

export interface WizardStep {
  n: number;
  title: string;
  icon?: ReactNode;
}

interface SidebarStepperProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  steps: WizardStep[];
  activeStep: number;
  touchedSteps: Set<number>;
  onSelect: (n: number) => void;
  /** 0-100 */
  progressPct: number;
  progressLabel: string;
  progressFraction: string;
}

/**
 * The dark left-hand wizard nav from the mockup: numbered steps, a
 * "touched" dot indicator, and a progress ring in the footer.
 */
export function SidebarStepper({
  eyebrow,
  title,
  subtitle,
  steps,
  activeStep,
  touchedSteps,
  onSelect,
  progressPct,
  progressLabel,
  progressFraction,
}: SidebarStepperProps): JSX.Element {
  return (
    <aside className="djs-sidebar">
      <div className="djs-sidebar-head">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="sub">{subtitle}</p>
      </div>

      <ul className="djs-steps">
        {steps.map((step) => {
          const isActive = step.n === activeStep;
          const isTouched = touchedSteps.has(step.n);
          return (
            <li key={step.n}>
              <button
                type="button"
                className={`djs-step ${isActive ? 'active' : ''} ${isTouched ? 'touched' : ''}`}
                onClick={() => onSelect(step.n)}
              >
                <span className="num">{step.n}</span>
                <span>{step.title}</span>
                <span className="dot-done" />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="djs-sidebar-foot">
        <div className="djs-ring-wrap">
          <div className="djs-ring" style={{ ['--pct' as string]: progressPct }}>
            <span>{progressPct}%</span>
          </div>
          <div className="djs-ring-label">
            {progressLabel}
            <br />
            <b>{progressFraction}</b> answered
          </div>
        </div>
      </div>
    </aside>
  );
}
