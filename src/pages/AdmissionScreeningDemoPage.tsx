// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import type { JSX } from 'react';
import { useMemo } from 'react';
import { AdmissionHealthScreeningWizard } from './AdmissionHealthScreeningWizard';

/**
 * Task 38: replaces `preview.html`, a hand-maintained static mirror that
 * drifted out of sync with the real wizard (missed the blood-pressure split
 * and the facility dropdown becoming a closed dropdown) and never loaded
 * `tokens.css`, so it wasn't even a valid styling reference.
 *
 * Renders the REAL wizard component against an in-memory `MockClient`
 * instead — real components, real `tokens.css`, and it can't drift out of
 * sync because it *is* the app, not a copy of it. No Medplum credentials
 * needed: every write here goes to the in-memory client, never a real
 * server. This is the exact pattern the test suite already uses
 * (`renderWizard(new MockClient())` in `AdmissionHealthScreeningWizard.test.tsx`),
 * just rendered as a real page instead of inside a test harness.
 *
 * Routed in `App.tsx` outside the authenticated-`profile` branch, and gated
 * by `import.meta.env.DEV` there — this is a tool for people working on the
 * wizard (design/product review without credentials), not an end-user
 * feature, so it's excluded from the production route table.
 */
export function AdmissionScreeningDemoPage(): JSX.Element {
  // useMemo, not module scope: a fresh MockClient per mount, so leaving this
  // page and coming back starts clean instead of carrying over demo data
  // typed in an earlier visit.
  const demoMedplum = useMemo(() => new MockClient(), []);

  return (
    <div>
      <div
        role="status"
        style={{
          background: '#7a1f1f',
          color: '#fff',
          padding: '10px 20px',
          fontWeight: 700,
          fontSize: 14,
          textAlign: 'center',
          position: 'sticky',
          top: 0,
          zIndex: 1000,
        }}
      >
        DEMO MODE — an in-memory preview, not connected to any real Medplum
        project. Nothing entered here is saved to a real patient record, and
        nothing persists once you leave this page.
      </div>
      {/*
        Shadows the outer, real MedplumProvider from main.tsx for this
        subtree only — everything the wizard writes below goes to this
        in-memory MockClient instead of whatever server main.tsx configured.
      */}
      <MedplumProvider medplum={demoMedplum}>
        <AdmissionHealthScreeningWizard />
      </MedplumProvider>
    </div>
  );
}
