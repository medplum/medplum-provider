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

/** The sidebar step buttons share a name with the section header / save button, so match by class. */
async function goToStep(user: ReturnType<typeof userEvent.setup>, title: string): Promise<void> {
  const step = Array.from(document.querySelectorAll<HTMLButtonElement>('button.djs-step')).find((b) =>
    b.textContent?.includes(title)
  );
  if (!step) {
    throw new Error(`Could not find sidebar step "${title}"`);
  }
  await user.click(step);
}

/** Finds a `.djs-check-chip` checkbox by the visible label text of its `<span>`. */
function checkbox(labelText: string): HTMLInputElement {
  const label = Array.from(document.querySelectorAll('label.djs-check-chip')).find((l) =>
    l.querySelector('span')?.textContent?.startsWith(labelText)
  );
  const input = label?.querySelector('input[type="checkbox"]');
  if (!input) {
    throw new Error(`Could not find checkbox for "${labelText}"`);
  }
  return input as HTMLInputElement;
}

/** A fresh, collision-proof family name per test — searched with `:exact` so no test's Patient matches another's. */
function uniqueFamily(): string {
  return `DjsLive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe.skipIf(!CLIENT_ID || !CLIENT_SECRET)('AdmissionHealthScreeningWizard (live server)', () => {
  // Unique per run so repeated `npm run test:live` invocations don't collide
  // with Patients left over by earlier runs — the local server's Postgres
  // volume persists across restarts unless you `docker compose down -v`.
  const runTag = `DjsLiveTest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let medplum: MedplumClient;
  const createdPatientIds: string[] = [];

  beforeAll(async () => {
    medplum = new MedplumClient({ baseUrl: BASE_URL });
    await medplum.startClientLogin(CLIENT_ID as string, CLIENT_SECRET as string);
  }, 30_000);

  afterAll(async () => {
    // Best-effort cleanup, not a correctness assertion: the tests' own
    // expectations already ran and passed or failed above. A leftover test
    // Patient on a local dev server is clutter, not a bug — so a failed
    // delete here shouldn't turn a passing test red.
    for (const id of createdPatientIds) {
      try {
        await medplum.deleteResource('Patient', id);
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
      createdPatientIds.push(createdPatient.id);

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

  test(
    'the real server accepts the constraint-bearing resources every section writes',
    async () => {
      // The reason a live server was needed at all: MockClient does not validate
      // on write, so ait-1 / con-3 / ele-1 were only ever caught by the unit
      // suite's validateResource proxy. This drives the sections that produce
      // those resource types and asserts each one actually persisted — which it
      // can only do if the server accepted it. Demographics alone (the
      // idempotency test above) exercises none of them.
      const family = uniqueFamily();
      const user = userEvent.setup();
      await renderWizard(medplum);

      // Section 1 — establish the Patient (found later by its unique family).
      await user.type(fieldInput('Last name'), family);
      await saveSection(user, /save demographics/i);
      const [patient] = (await medplum.searchResources('Patient', { 'family:exact': family })) as WithId<Patient>[];
      expect(patient).toBeDefined();
      createdPatientIds.push(patient.id);
      const subjectRef = `Patient/${patient.id}`;

      // Section 2 — an allergy (ait-1), a chronic condition (con-3), and a
      // medication with a name but no dosage (ele-1).
      await goToStep(user, 'Current Health Status');
      await user.click(checkbox('Latex allergy'));
      await user.click(screen.getByRole('button', { name: /has one or more/i }));
      await user.click(checkbox('Asthma'));
      const addMedication = screen.getByRole('button', { name: /add medication/i });
      await user.click(addMedication);
      const medName = addMedication.previousElementSibling?.querySelector('tbody tr td input') as HTMLInputElement;
      await user.type(medName, 'Aspirin');
      await saveSection(user, /save health status/i);

      // Section 4 — a nursing-diagnosis Condition (con-3).
      await goToStep(user, 'Diagnosis & Disposition');
      await user.type(fieldInput('1.'), 'Risk for withdrawal');
      await saveSection(user, /save diagnosis & disposition/i);

      // Existence on the server == the server accepted it. A rejected ait-1 /
      // con-3 / ele-1 write would surface as an error toast and no resource.
      const allergies = await medplum.searchResources('AllergyIntolerance', {
        patient: subjectRef,
        identifier: `${SCREENING_ID_SYSTEM}|allergy::Latex allergy`,
      });
      expect(allergies).toHaveLength(1); // ait-1: clinicalStatus present

      const chronic = await medplum.searchResources('Condition', {
        subject: subjectRef,
        identifier: `${SCREENING_ID_SYSTEM}|chronic::Asthma`,
      });
      expect(chronic).toHaveLength(1); // con-3: chronic condition

      const nursingDx = await medplum.searchResources('Condition', {
        subject: subjectRef,
        identifier: `${SCREENING_ID_SYSTEM}|nursing-diagnosis::dx1`,
      });
      expect(nursingDx).toHaveLength(1); // con-3: nursing diagnosis

      const meds = await medplum.searchResources('MedicationStatement', {
        subject: subjectRef,
        identifier: `${SCREENING_ID_SYSTEM}|medication::Aspirin`,
      });
      expect(meds).toHaveLength(1); // ele-1: dosage omitted, not an empty element
      expect(meds[0].dosage).toBeUndefined();
    },
    60_000
  );

  test(
    'unchecking an allergy retracts it on the real server (entered-in-error, not deleted)',
    async () => {
      // The retraction round-trip is the behavior MockClient handled
      // inconsistently (it could not find a bundle-created resource in a later
      // search), which is why task 9 was deferred. Proving it against the real
      // server is the highest-value live check after constraint acceptance.
      const family = uniqueFamily();
      const user = userEvent.setup();
      await renderWizard(medplum);

      await user.type(fieldInput('Last name'), family);
      await saveSection(user, /save demographics/i);
      const [patient] = (await medplum.searchResources('Patient', { 'family:exact': family })) as WithId<Patient>[];
      expect(patient).toBeDefined();
      createdPatientIds.push(patient.id);
      const subjectRef = `Patient/${patient.id}`;
      const allergyQuery = {
        patient: subjectRef,
        identifier: `${SCREENING_ID_SYSTEM}|allergy::Latex allergy`,
      };

      // Check the allergy and save — it should exist and be active.
      await goToStep(user, 'Current Health Status');
      await user.click(checkbox('Latex allergy'));
      await saveSection(user, /save health status/i);

      const afterCheck = await medplum.searchResources('AllergyIntolerance', allergyQuery);
      expect(afterCheck).toHaveLength(1);
      const codesAfterCheck = afterCheck[0].verificationStatus?.coding?.map((c) => c.code) ?? [];
      expect(codesAfterCheck).not.toContain('entered-in-error');

      // Uncheck it and save again — it must be withdrawn, not deleted.
      await user.click(checkbox('Latex allergy'));
      await saveSection(user, /save health status/i);

      const afterUncheck = await medplum.searchResources('AllergyIntolerance', allergyQuery);
      expect(afterUncheck).toHaveLength(1);
      expect(afterUncheck[0].id).toBe(afterCheck[0].id);
      const codesAfterUncheck = afterUncheck[0].verificationStatus?.coding?.map((c) => c.code) ?? [];
      expect(codesAfterUncheck).toContain('entered-in-error');
    },
    60_000
  );

  test(
    'a transaction bundle is atomic — one invalid entry rolls the whole thing back',
    async () => {
      // Task 9's whole point: a section save is one transaction Bundle, so a
      // failure part-way leaves the section wholly unwritten, not half-saved.
      // MockClient does NOT enforce this (it partial-commits), so it can only be
      // verified against a real server. We submit a bundle with one valid
      // Observation and one ait-1-violating AllergyIntolerance and assert the
      // server rejects the whole bundle and persists neither.
      const family = uniqueFamily();
      const patient = (await medplum.createResource({
        resourceType: 'Patient',
        name: [{ family }],
      })) as WithId<Patient>;
      createdPatientIds.push(patient.id);
      const subjectRef = `Patient/${patient.id}`;
      const goodId = `atomicity-good::${family}`;

      const bundle = {
        resourceType: 'Bundle' as const,
        type: 'transaction' as const,
        entry: [
          {
            request: { method: 'PUT' as const, url: `Observation?identifier=${SCREENING_ID_SYSTEM}|${goodId}&subject=${subjectRef}` },
            resource: {
              resourceType: 'Observation',
              status: 'final',
              subject: { reference: subjectRef },
              identifier: [{ system: SCREENING_ID_SYSTEM, value: goodId }],
              code: { text: 'Atomicity probe (valid)' },
              valueString: 'ok',
            },
          },
          {
            // ait-1 violation: AllergyIntolerance with no clinicalStatus.
            request: { method: 'POST' as const, url: 'AllergyIntolerance' },
            resource: {
              resourceType: 'AllergyIntolerance',
              patient: { reference: subjectRef },
              code: { text: 'Atomicity probe (invalid)' },
            },
          },
        ],
      };

      await expect(medplum.executeBatch(bundle as never)).rejects.toBeDefined();

      // The valid entry must NOT have persisted — the whole transaction rolled back.
      const good = await medplum.searchResources('Observation', {
        subject: subjectRef,
        identifier: `${SCREENING_ID_SYSTEM}|${goodId}`,
      });
      expect(good).toHaveLength(0);
    },
    60_000
  );
});
