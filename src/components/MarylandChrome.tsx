import { ReactNode, useState } from 'react';

/** Required "official government website" ID banner, collapsed by default. */
export function GovBanner(): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="md-gov-banner">
      <div className="md-gov-banner__inner">
        <p className="md-gov-banner__text">An official website of the State of Maryland.</p>
        <button type="button" className="md-gov-banner__toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          Here&rsquo;s how you know
          <span className={`md-gov-banner__chevron ${expanded ? 'is-open' : ''}`} aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div className="md-gov-banner__details">
          <div className="md-gov-banner__detail">
            <div className="md-gov-banner__icon md-gov-banner__icon--dot-gov" aria-hidden="true" />
            <div>
              <strong>Official websites use .gov</strong>
              <p>A <strong>.gov</strong> website belongs to an official government organization in the United States.</p>
            </div>
          </div>
          <div className="md-gov-banner__detail">
            <div className="md-gov-banner__icon md-gov-banner__icon--https" aria-hidden="true" />
            <div>
              <strong>Secure .gov websites use HTTPS</strong>
              <p>A <strong>lock</strong> or <strong>https://</strong> means you&rsquo;ve safely connected. Share sensitive information only on official, secure websites.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Slim Maryland-branded header. Sits above the DJS wizard's own sidebar/patient-band. */
export function AppHeader({ agencyName, actions }: { agencyName: string; actions?: ReactNode }): JSX.Element {
  return (
    <header className="md-app-header">
      <div className="md-app-header__row">
        <a href="/" className="md-app-header__brand">
          <span className="md-app-header__mark">Maryland</span>
          <span className="md-app-header__agency">{agencyName}</span>
        </a>
        <div className="md-app-header__actions">{actions}</div>
      </div>
    </header>
  );
}

/** Statewide footer pattern. */
export function AppFooter(): JSX.Element {
  return (
    <footer className="md-app-footer">
      <div className="md-app-footer__inner">
        <div className="md-app-footer__col">
          <strong>Contact us</strong>
          <p>An official application of the State of Maryland</p>
        </div>
        <div className="md-app-footer__col">
          <strong>Policies</strong>
          <ul>
            <li><a href="https://www.maryland.gov/accessibility-policy">Accessibility</a></li>
            <li><a href="https://www.maryland.gov/privacy-and-security-policy">Privacy and Security</a></li>
            <li><a href="https://www.maryland.gov/terms-use">Terms of Use</a></li>
          </ul>
        </div>
      </div>
      <div className="md-app-footer__bottom">© {new Date().getFullYear()} State of Maryland. All rights reserved.</div>
    </footer>
  );
}
