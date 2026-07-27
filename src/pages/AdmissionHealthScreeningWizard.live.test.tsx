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
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { AdmissionHealthScreeningWizard } from './AdmissionHealthScreeningWizard';
import { DJS_FACILITY_SYSTEM } from './djsFacilities';
import { ADMISSION_ENCOUNTER_KEY } from './screeningData';

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

/** Mounts the wizard at an existing patient's route, so the read-back effect runs. */
async function renderWizardForPatient(medplum: MedplumClient, patientId: string): Promise<void> {
  await act(async () => {
    render(
      <MantineProvider>
        <Notifications />
        <MedplumProvider medplum={medplum}>
          <MemoryRouter initialEntries={[`/admission-screening/${patientId}`]}>
            <Routes>
              <Route path="/admission-screening/:patientId" element={<AdmissionHealthScreeningWizard />} />
            </Routes>
          </MemoryRouter>
        </MedplumProvider>
      </MantineProvider>
    );
  });
}

/** Selects a facility in the closed-set Facility dropdown by its visible name. */
async function selectFacility(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  const select = document.querySelector('select') as HTMLSelectElement;
  await user.selectOptions(select, screen.getByRole('option', { name }));
}

/**
 * Clicks a section's save button and waits for the save to settle.
 *
 * Waits for the pending state to clear rather than for the clicked button to
 * re-enable: since task 43 a successful save advances to the next step, so
 * that button may no longer exist. A real network round-trip is slower than
 * MockClient, hence the generous timeout rather than testing-library's 1s
 * default.
 */
async function saveSection(user: ReturnType<typeof userEvent.setup>, buttonName: RegExp): Promise<void> {
  await user.click(screen.getByRole('button', { name: buttonName }));
  await waitFor(() => expect(screen.queryByRole('button', { name: /saving…/i })).not.toBeInTheDocument(), {
    timeout: 15_000,
  });
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
  /**
   * Only throwaway test Locations (the rename test's `zz-live-test-*` code).
   * The **canonical facility Locations are deliberately left behind** — they
   * are shared reference data, exactly as in production, and leaving them
   * means a repeat run exercises the reuse-an-existing-Location path rather
   * than always creating fresh. The "converge on one Location" assertion holds
   * either way, which is the point.
   */
  const createdLocationIds: string[] = [];

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
    for (const id of createdLocationIds) {
      try {
        await medplum.deleteResource('Location', id);
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
      await saveSection(user, /save and next/i);

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
      await saveSection(user, /save and next/i);

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
      await saveSection(user, /save and next/i);
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
      await saveSection(user, /save and next/i);

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
      await saveSection(user, /save and next/i);
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
      await saveSection(user, /save and next/i);

      const afterCheck = await medplum.searchResources('AllergyIntolerance', allergyQuery);
      expect(afterCheck).toHaveLength(1);
      const codesAfterCheck = afterCheck[0].verificationStatus?.coding?.map((c) => c.code) ?? [];
      expect(codesAfterCheck).not.toContain('entered-in-error');

      // Uncheck it and save again — it must be withdrawn, not deleted.
      await user.click(checkbox('Latex allergy'));
      await saveSection(user, /save and next/i);

      const afterUncheck = await medplum.searchResources('AllergyIntolerance', allergyQuery);
      expect(afterUncheck).toHaveLength(1);
      expect(afterUncheck[0].id).toBe(afterCheck[0].id);
      const codesAfterUncheck = afterUncheck[0].verificationStatus?.coding?.map((c) => c.code) ?? [];
      expect(codesAfterUncheck).toContain('entered-in-error');
    },
    60_000
  );

  // ---- Task 24: admission Encounter + facility Location ----
  //
  // What these prove that the MockClient suite cannot:
  //
  //  - The server ACCEPTS an Encounter at all. `status` and `class` are
  //    required by FHIR and MockClient validates nothing, so the unit suite
  //    would stay green even if `class` were malformed or ActCode `IMP` were
  //    rejected. Only a real write proves it.
  //  - The Location conditional upsert actually converges on THIS server.
  //    The whole no-duplicate-facilities design rests on
  //    `identifier=<system>|<code>` matching on a conditional PUT, and
  //    MockClient's identifier-search semantics have already been caught
  //    diverging from the server once (the bare `identifier=system|` case
  //    documented in CLAUDE.md). If that diverges here, every admission mints
  //    a fresh facility and nothing in the offline suite would notice.
  //  - Read-back resolves a Location through a real `readResource`, which is
  //    a code path `loadScreeningResources` only gained in task 24.

  test(
    'the real server accepts the admission Encounter and its facility Location',
    async () => {
      const family = uniqueFamily();
      const user = userEvent.setup();
      await renderWizard(medplum);

      await user.type(fieldInput('Last name'), family);
      fireEvent.change(fieldInput('Date of admission'), { target: { value: '2026-07-20' } });
      await selectFacility(user, 'Cheltenham');
      await saveSection(user, /save and next/i);

      const [patient] = (await medplum.searchResources('Patient', { 'family:exact': family })) as WithId<Patient>[];
      expect(patient).toBeDefined();
      createdPatientIds.push(patient.id);

      // Existence == the server accepted it, including the required
      // status/class and the v3 ActCode `IMP` value.
      const encounters = await medplum.searchResources('Encounter', {
        subject: `Patient/${patient.id}`,
        identifier: `${SCREENING_ID_SYSTEM}|${ADMISSION_ENCOUNTER_KEY}`,
      });
      expect(encounters).toHaveLength(1);
      expect(encounters[0].period?.start).toBe('2026-07-20');
      expect(encounters[0].class?.code).toBe('IMP');

      // The facility is a real referenced Location, not a string on the
      // Encounter — and the Encounter carries no cached copy of its name.
      const locationRef = encounters[0].location?.[0].location?.reference;
      expect(locationRef).toMatch(/^Location\//);
      expect(encounters[0].location?.[0].location?.display).toBeUndefined();

      const location = await medplum.readReference({ reference: locationRef as string });
      expect(location.resourceType).toBe('Location');
      expect((location as { name?: string }).name).toBe('Cheltenham');
      expect((location as { identifier?: { system?: string; value?: string }[] }).identifier).toContainEqual({
        system: DJS_FACILITY_SYSTEM,
        value: 'cheltenham',
      });

      // Re-saving must update the admission in place, not open a second one.
      await saveSection(user, /save and next/i);
      const afterResave = await medplum.searchResources('Encounter', {
        subject: `Patient/${patient.id}`,
        identifier: `${SCREENING_ID_SYSTEM}|${ADMISSION_ENCOUNTER_KEY}`,
      });
      expect(afterResave).toHaveLength(1);
      expect(afterResave[0].id).toBe(encounters[0].id);
    },
    60_000
  );

  test(
    'two patients admitted to the same facility converge on one Location',
    async () => {
      // The core duplication risk, and the one MockClient is least able to
      // speak to. Note this assertion holds across repeated `npm run test:live`
      // runs too: the canonical facility Locations are deliberately NOT cleaned
      // up (see afterAll), so a later run exercises the reuse-existing path
      // rather than the create path — and the count must still be exactly 1.
      const facilityQuery = { identifier: `${DJS_FACILITY_SYSTEM}|hickey` };

      for (const family of [uniqueFamily(), uniqueFamily()]) {
        const user = userEvent.setup();
        await renderWizard(medplum);
        await user.type(fieldInput('Last name'), family);
        await selectFacility(user, 'Hickey');
        await saveSection(user, /save and next/i);

        const [patient] = (await medplum.searchResources('Patient', { 'family:exact': family })) as WithId<Patient>[];
        expect(patient).toBeDefined();
        createdPatientIds.push(patient.id);

        // Unmount before the next iteration renders a second wizard into the
        // same document — otherwise the field/dropdown lookups above would
        // match two elements.
        cleanup();
      }

      const locations = await medplum.searchResources('Location', facilityQuery);
      expect(locations).toHaveLength(1);
    },
    90_000
  );

  test(
    'renaming a facility updates the same Location in place rather than minting a second',
    async () => {
      // Tests the PLATFORM behavior the "codes are permanent, display names are
      // free to change" design depends on: does a conditional upsert keyed on
      // identifier update in place when a non-identifier field changes?
      //
      // Driven through `upsertResource` directly with a throwaway code rather
      // than through the UI, deliberately: renaming a real facility would
      // mutate state shared with every other test and with any real data on the
      // server. The mechanism under test is identical either way.
      const code = `zz-live-test-${Date.now()}`;
      const query = { identifier: `${DJS_FACILITY_SYSTEM}|${code}` };
      const base = {
        resourceType: 'Location' as const,
        status: 'active' as const,
        identifier: [{ system: DJS_FACILITY_SYSTEM, value: code }],
      };

      const first = await medplum.upsertResource({ ...base, name: 'Short Name' }, query);
      createdLocationIds.push(first.id);

      // Same code, different display name — as a production rename would be.
      const second = await medplum.upsertResource({ ...base, name: 'Official Long-Form Name' }, query);

      expect(second.id).toBe(first.id);
      const all = await medplum.searchResources('Location', query);
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('Official Long-Form Name');
    },
    30_000
  );

  test(
    'reopening a screening reads the admission date and facility back from the server',
    async () => {
      const family = uniqueFamily();
      const user = userEvent.setup();
      await renderWizard(medplum);

      await user.type(fieldInput('Last name'), family);
      fireEvent.change(fieldInput('Date of admission'), { target: { value: '2026-07-18' } });
      await selectFacility(user, 'Victor Cullen');
      await saveSection(user, /save and next/i);

      const [patient] = (await medplum.searchResources('Patient', { 'family:exact': family })) as WithId<Patient>[];
      expect(patient).toBeDefined();
      createdPatientIds.push(patient.id);

      // Reopen from scratch — this exercises loadScreeningResources' Encounter
      // search AND its readResource('Location', ...) resolution against the
      // real server, then hydrateScreeningForm recovering the facility from the
      // Location's identifier rather than its name.
      cleanup();
      await renderWizardForPatient(medplum, patient.id);

      await waitFor(() => expect(fieldInput('Date of admission').value).toBe('2026-07-18'), { timeout: 15_000 });
      expect((document.querySelector('select') as HTMLSelectElement).value).toBe('victor-cullen');
    },
    60_000
  );

  test(
    'the real server accepts and round-trips the blood-pressure component panel (task 25)',
    async () => {
      // An Observation carrying its value in `component` with NO top-level
      // value[x] is a shape this codebase had never written before task 25.
      // MockClient stores anything, so only a real write proves the server
      // accepts it — and that the components survive a round-trip with their
      // LOINC codes and UCUM units intact rather than being silently dropped.
      const family = uniqueFamily();
      const user = userEvent.setup();
      await renderWizard(medplum);

      await user.type(fieldInput('Last name'), family);
      await saveSection(user, /save and next/i);
      const [patient] = (await medplum.searchResources('Patient', { 'family:exact': family })) as WithId<Patient>[];
      expect(patient).toBeDefined();
      createdPatientIds.push(patient.id);

      await goToStep(user, 'Current Health Status');
      await user.type(screen.getByLabelText('Systolic'), '128');
      await user.type(screen.getByLabelText('Diastolic'), '82');
      await saveSection(user, /save and next/i);

      const [bp] = await medplum.searchResources('Observation', {
        subject: `Patient/${patient.id}`,
        identifier: `${SCREENING_ID_SYSTEM}|Blood pressure`,
      });
      expect(bp).toBeDefined();
      expect(bp.valueString).toBeUndefined();
      expect(bp.component).toHaveLength(2);

      const systolic = bp.component?.find((c) => c.code?.coding?.some((cd) => cd.code === '8480-6'));
      const diastolic = bp.component?.find((c) => c.code?.coding?.some((cd) => cd.code === '8462-4'));
      expect(systolic?.valueQuantity?.value).toBe(128);
      expect(systolic?.valueQuantity?.code).toBe('mm[Hg]');
      expect(diastolic?.valueQuantity?.value).toBe(82);

      // Reopen and confirm both fields repopulate from the server's copy.
      cleanup();
      await renderWizardForPatient(medplum, patient.id);
      await goToStep(user, 'Current Health Status');
      await waitFor(() => expect((screen.getByLabelText('Systolic') as HTMLInputElement).value).toBe('128'), {
        timeout: 15_000,
      });
      expect((screen.getByLabelText('Diastolic') as HTMLInputElement).value).toBe('82');
    },
    90_000
  );

  test(
    'the real server accepts vitals carrying LOINC codes, the vital-signs category and UCUM units (task 26)',
    async () => {
      // Two things only a real server can answer. First, whether tagging these
      // `category: vital-signs` triggers validation against the FHIR
      // vital-signs profile — which mandates a time of measurement, a LOINC
      // code and a UCUM unit. MockClient validates nothing, so an
      // almost-conformant vital passes offline and is rejected here.
      // Second, whether the codings and UCUM codes survive a round-trip rather
      // than being silently dropped or rewritten.
      const family = uniqueFamily();
      const user = userEvent.setup();
      await renderWizard(medplum);

      await user.type(fieldInput('Last name'), family);
      await saveSection(user, /save and next/i);
      const [patient] = (await medplum.searchResources('Patient', { 'family:exact': family })) as WithId<Patient>[];
      expect(patient).toBeDefined();
      createdPatientIds.push(patient.id);

      await goToStep(user, 'Current Health Status');
      await user.type(fieldInput('Temp (°F)'), '98.6');
      await user.type(fieldInput('Weight (lb)'), '150');
      await saveSection(user, /save and next/i);

      const expected: Record<string, { loinc: string; ucum: string; value: number }> = {
        'Body temperature': { loinc: '8310-5', ucum: '[degF]', value: 98.6 },
        'Body weight': { loinc: '29463-7', ucum: '[lb_av]', value: 150 },
      };

      for (const [code, want] of Object.entries(expected)) {
        const [vital] = await medplum.searchResources('Observation', {
          subject: `Patient/${patient.id}`,
          identifier: `${SCREENING_ID_SYSTEM}|${code}`,
        });
        expect(vital, `expected the server to have stored "${code}"`).toBeDefined();
        expect(vital.code?.coding?.[0].code).toBe(want.loinc);
        expect(vital.category?.[0].coding?.[0].code).toBe('vital-signs');
        expect(vital.valueQuantity?.value).toBe(want.value);
        expect(vital.valueQuantity?.code).toBe(want.ucum);
        expect(vital.valueQuantity?.system).toBe('http://unitsofmeasure.org');
        // Required by the vital-signs profile.
        expect(vital.effectiveDateTime, `effectiveDateTime for ${code}`).toBeDefined();
      }

      // Re-saving must not re-date a measurement that wasn't retaken.
      const tempQuery = {
        subject: `Patient/${patient.id}`,
        identifier: `${SCREENING_ID_SYSTEM}|Body temperature`,
      };
      const [before] = await medplum.searchResources('Observation', tempQuery);
      await user.type(fieldInput('Pulse'), '72');
      await saveSection(user, /save and next/i);
      const [after] = await medplum.searchResources('Observation', tempQuery);
      expect(after.id).toBe(before.id);
      expect(after.effectiveDateTime).toBe(before.effectiveDateTime);
    },
    90_000
  );
});
