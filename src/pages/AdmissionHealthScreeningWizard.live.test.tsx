// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
//
// Runs the save-twice idempotency scenario against a REAL Medplum server
// instead of MockClient. TASKS.md's "What still needs a live server" note
// calls out exactly this: MockClient's conditional-upsert and identifier
// search semantics were *confirmed* to match the server by hand, once —
// nothing in the suite proves it on every run. This does.
//
// Requires:
//   1. The local Medplum stack running — see
//      https://www.medplum.com/docs/self-hosting/running-full-medplum-stack-in-docker
//      (curl the docker-compose.full-stack.yml, then `docker compose up -d`).
//   2. A ClientApplication created via Project Admin at
//      http://localhost:3000 (sign in as admin@example.com / medplum_admin
//      — the stack's seeded default user), with its id/secret set as:
//        MEDPLUM_LIVE_CLIENT_ID
//        MEDPLUM_LIVE_CLIENT_SECRET
//      Optionally override the server with MEDPLUM_LIVE_BASE_URL
//      (defaults to http://localhost:8103/).
//
// Run with: npm run test:live
// This never runs as part of `npm test` / plain `vitest run` — see the
// "unit" vs "live" project split in vite.config.ts. Without the two env
// vars above, the whole suite below is skipped rather than failing, so
// `npm run test:live` is still safe to run without the stack up — it just
// reports 0 tests.
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import type { WithId } from '@medplum/core';
import { MedplumClient } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { MedplumProvider } from '@medplum/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { AdmissionHealthScreeningWizard } from './AdmissionHealthScreeningWizard';

// Duplicated from AdmissionHealthScreeningWizard.tsx (and from
// AdmissionHealthScreeningWizard.test.tsx / .fieldIntegrity.test.ts) rather
// than shared — matches this codebase's existing convention of duplicating
// small test constants/helpers per file instead of a shared test-utils import.
const SCREENING_ID_SYSTEM = 'http://maryland.gov/djs/admission-screening';

const BASE_URL = process.env.MEDPLUM_LIVE_BASE_URL ?? 'http://localhost:8103/';
const CLIENT_ID = process.env.MEDPLUM_LIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.MEDPLUM_LIVE_CLIENT_SECRET;

/**
 * `Field` renders `<label>{label}</label>` as a sibling of its input, not a
 * wrapper — so testing-library's `getByLabelText` can't associate them.
 * Same lookup as the MockClient version of this test.
 */
function fieldInput(label: string): HTMLInputElement {
  const container = screen.getByText(label).closest('.djs-field');
  if (!container) {
    throw new Error(`Could not find .djs-field container for label "${label}"`);
  }
  const input = container.querySelector('input');
  if (!input) {
    throw new Error(`Could not find an <input> inside the field for label "${label}"`);
  }
  return input as HTMLInputElement;
}

async function renderWizard(medplum: MedplumClient): Promise<void> {
  await act(async () => {
    render(
      <MantineProvider>
        <Notifications />
        <MedplumProvider medplum={medplum}>
          <MemoryRouter initialEntries={['/admission-screening']}>
            <Routes>
              <Route path="/admission-screening" element={<AdmissionHealthScreeningWizard />} />
            </Routes>
          </MemoryRouter>
        </MedplumProvider>
      </MantineProvider>
    );
  });
}

/** Clicks a section's save button and waits for the save to settle (button re-enabled). */
async function saveSection(user: ReturnType<typeof userEvent.setup>, buttonName: RegExp): Promise<void> {
  const button = (): HTMLElement => screen.getByRole('button', { name: buttonName });
  await user.click(button());
  // A real network round-trip is slower than MockClient — give it real room
  // rather than testing-library's 1s default waitFor timeout.
  await waitFor(() => expect(button()).not.toBeDisabled(), { timeout: 15_000 });
}

describe.skipIf(!CLIENT_ID || !CLIENT_SECRET)('AdmissionHealthScreeningWizard (live server)', () => {
  // Unique per run so repeated `npm run test:live` invocations don't collide
  // with Patients left over by earlier runs — the local server's Postgres
  // volume persists across restarts unless you `docker compose down -v`.
  const runTag = `DjsLiveTest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let medplum: MedplumClient;
  let createdPatientId: string | undefined;

  beforeAll(async () => {
    medplum = new MedplumClient({ baseUrl: BASE_URL });
    await medplum.startClientLogin(CLIENT_ID as string, CLIENT_SECRET as string);
  }, 30_000);

  afterAll(async () => {
    // Best-effort cleanup, not a correctness assertion: the test's own
    // expectations already ran and passed or failed above. A leftover test
    // Patient on a local dev server is clutter, not a bug — so a failed
    // delete here shouldn't turn a passing test red.
    if (createdPatientId) {
      try {
        await medplum.deleteResource('Patient', createdPatientId);
      } catch {
        // ignore — best-effort only, see comment above.
      }
    }
  }, 30_000);

  test(
    'saving demographics twice against a real server updates the same Patient and Observation instead of duplicating them',
    async () => {
      const user = userEvent.setup();
      await renderWizard(medplum);

      await user.type(fieldInput('Last name'), runTag);
      await user.type(fieldInput('Color of hair'), 'Brown');

      // --- First save: creates the Patient, upserts the Hair color Observation. ---
      await saveSection(user, /save demographics/i);

      const [createdPatient] = (await medplum.searchResources('Patient', { family: runTag })) as WithId<Patient>[];
      expect(createdPatient).toBeDefined();
      createdPatientId = createdPatient.id;

      const firstObservations = await medplum.searchResources('Observation', {
        subject: `Patient/${createdPatient.id}`,
        identifier: `${SCREENING_ID_SYSTEM}|Hair color`,
      });
      expect(firstObservations).toHaveLength(1);
      const firstObservationId = firstObservations[0].id;

      // --- Second save: same section, same values, nothing edited in between. ---
      await saveSection(user, /save demographics/i);

      // Real proof of idempotency against the real server: not a spy on which
      // client method got called, but the actual resulting resource count.
      const patientsAfterSecondSave = await medplum.searchResources('Patient', { family: runTag });
      expect(patientsAfterSecondSave).toHaveLength(1);

      const secondObservations = await medplum.searchResources('Observation', {
        subject: `Patient/${createdPatient.id}`,
        identifier: `${SCREENING_ID_SYSTEM}|Hair color`,
      });
      expect(secondObservations).toHaveLength(1);
      expect(secondObservations[0].id).toBe(firstObservationId);
    },
    30_000
  );
});
