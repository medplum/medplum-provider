// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import type { WithId } from '@medplum/core';
import { validateResource } from '@medplum/core';
import type { Bundle, Encounter, Location, Observation, Patient, Resource } from '@medplum/fhirtypes';
import { DrAliceSmith, MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, test, vi } from 'vitest';
import { AdmissionHealthScreeningWizard } from './AdmissionHealthScreeningWizard';
import { DJS_FACILITIES } from './djsFacilities';

// Duplicated from AdmissionHealthScreeningWizard.tsx — the wizard doesn't
// export it, and re-deriving it here from the same source-of-truth string
// documented in CLAUDE.md is simpler than exporting it just for tests.
const SCREENING_ID_SYSTEM = 'http://maryland.gov/djs/admission-screening';

/**
 * `Field` renders `<label>{label}</label>` as a sibling of its input, not a
 * wrapper — so testing-library's `getByLabelText` can't associate them.
 * Locate the input via the DOM instead: find the label's text, then the
 * input inside its shared `.djs-field` container.
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

/** Same lookup as `fieldInput`, for the `<textarea>` fields (comments, details). */
function fieldTextarea(label: string): HTMLTextAreaElement {
  const container = screen.getByText(label).closest('.djs-field');
  const textarea = container?.querySelector('textarea');
  if (!textarea) {
    throw new Error(`Could not find a <textarea> inside the field for label "${label}"`);
  }
  return textarea as HTMLTextAreaElement;
}

async function renderWizard(medplum: MockClient): Promise<void> {
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

/** Mounts the wizard at the patient route, so its mount-time read-back runs. */
async function renderWizardForPatient(medplum: MockClient, patientId: string): Promise<void> {
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

interface WriteCapture {
  /** Every resource the wizard tried to persist, in order. */
  written: Resource[];
  /** One entry per error/fatal issue found by validateResource, prefixed with resourceType. */
  validationErrors: string[];
}

/**
 * Wraps a MockClient's write methods so every resource the wizard persists is
 * recorded and run through `validateResource` — the same FHIR constraint check
 * (ait-1, con-3, ele-1, …) the live server applies. MockClient itself does
 * *not* validate on write (verified: it will happily store an ait-1-violating
 * AllergyIntolerance), so without this wrapper a constraint regression passes
 * the suite and only surfaces as a red error toast on a real server. This is
 * what lets the "save every section and see what FHIR rejects" manual pass run
 * offline.
 *
 * Errors are collected, not thrown: a bad write still lands in MockClient (so
 * the wizard's read-backs keep working and the whole section runs), and one
 * test run surfaces *every* invalid field at once rather than aborting at the
 * first.
 */
function captureWrites(medplum: MockClient): WriteCapture {
  const capture: WriteCapture = { written: [], validationErrors: [] };

  const record = (resource: Resource): void => {
    capture.written.push(resource);
    try {
      for (const issue of validateResource(resource) ?? []) {
        if (issue.severity === 'error' || issue.severity === 'fatal') {
          capture.validationErrors.push(`${resource.resourceType}: ${issue.details?.text ?? issue.diagnostics ?? 'error'}`);
        }
      }
    } catch (err) {
      // validateResource throws an OperationOutcomeError on constraint failure.
      capture.validationErrors.push(`${resource.resourceType}: ${(err as Error).message}`);
    }
  };

  const methods = ['createResource', 'updateResource', 'upsertResource'] as const;
  for (const method of methods) {
    const original = medplum[method].bind(medplum) as (...args: unknown[]) => Promise<unknown>;
    // `as never` bypasses the three methods' differing overloads — upsertResource
    // takes an extra query arg — which a single generic implementation can't match.
    vi.spyOn(medplum, method).mockImplementation((async (...args: unknown[]) => {
      record(args[0] as Resource);
      return original(...args);
    }) as never);
  }

  // Section saves go through executeBatch (one transaction Bundle per section),
  // so validate and record every entry's resource here too — otherwise the
  // bundled clinical resources would escape the constraint check entirely, and
  // MockClient does not validate bundle entries itself (verified).
  const originalBatch = medplum.executeBatch.bind(medplum);
  vi.spyOn(medplum, 'executeBatch').mockImplementation((async (bundle: Bundle) => {
    for (const entry of bundle.entry ?? []) {
      if (entry.resource) {
        record(entry.resource as Resource);
      }
    }
    return originalBatch(bundle);
  }) as never);

  return capture;
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

/**
 * Same as `checkbox`, but scoped to the `.djs-card` whose title matches —
 * several cards on the same page have their own "Other:" item (allergy,
 * chronic-list, appearance all sit on Current Health Status at once), so an
 * unscoped lookup by label text alone is ambiguous.
 */
function checkboxInCard(cardTitle: string, labelText: string): HTMLInputElement {
  const card = screen.getByText(cardTitle).closest('.djs-card');
  if (!card) {
    throw new Error(`Could not find .djs-card for title "${cardTitle}"`);
  }
  const label = Array.from(card.querySelectorAll('label.djs-check-chip')).find((l) =>
    l.querySelector('span')?.textContent?.startsWith(labelText)
  );
  const input = label?.querySelector('input[type="checkbox"]');
  if (!input) {
    throw new Error(`Could not find checkbox for "${labelText}" within card "${cardTitle}"`);
  }
  return input as HTMLInputElement;
}

/** The free-text `<input>` that appears inline next to an "Other:"-style checkbox, once checked. */
function inlineTextInput(checkboxEl: HTMLInputElement): HTMLInputElement {
  const input = checkboxEl.closest('label.djs-check-chip')?.querySelector('input[type="text"]');
  if (!input) {
    throw new Error('Could not find the inline text input next to this checkbox');
  }
  return input as HTMLInputElement;
}

/** The label of whichever ChipGroup option is currently active for the field with this label. */
function activeChipLabel(fieldLabel: string): string | undefined {
  const container = screen.getByText(fieldLabel).closest('.djs-field');
  return container?.querySelector('button.djs-chip.active')?.textContent ?? undefined;
}

/**
 * The vision screen's 6 acuity cells are plain `<td><input placeholder=
 * "20/__">` with no `<label>`/`.djs-field` wrapper, so they can't use
 * `fieldInput`. DOM order matches `visionFields` in
 * AdmissionHealthScreeningWizard.tsx exactly: without-glasses (left, right,
 * both), then with-glasses (left, right, both).
 */
function visionAcuityInput(index: 0 | 1 | 2 | 3 | 4 | 5): HTMLInputElement {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[placeholder="20/__"]');
  const input = inputs[index];
  if (!input) {
    throw new Error(`Could not find vision-acuity input at index ${index}`);
  }
  return input;
}

/**
 * Clicks a section's save button and waits for the save to settle.
 *
 * Waits for the pending state to clear rather than for the clicked button to
 * re-enable: since task 43 a successful save advances to the next step, so
 * that button may no longer exist — and on the last section the next button
 * has a different name entirely. Keying off "Saving…" works for both the
 * advancing and non-advancing cases.
 */
async function saveSection(user: ReturnType<typeof userEvent.setup>, buttonName: RegExp): Promise<void> {
  await user.click(screen.getByRole('button', { name: buttonName }));
  await waitFor(() => expect(screen.queryByRole('button', { name: /saving…/i })).not.toBeInTheDocument());
}

describe('AdmissionHealthScreeningWizard', () => {
  describe('save-twice idempotency', () => {
    test('saving demographics twice updates the same Patient and Observation instead of duplicating them', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);

      const createSpy = vi.spyOn(medplum, 'createResource');
      const updateSpy = vi.spyOn(medplum, 'updateResource');

      const user = userEvent.setup();

      await renderWizard(medplum);

      await user.type(fieldInput('Last name'), 'Doe');
      await user.type(fieldInput('Color of hair'), 'Brown');

      const saveButton = (): HTMLElement => screen.getByRole('button', { name: /save and next/i });

      // --- First save: creates the Patient, upserts the Hair color Observation. ---
      await user.click(saveButton());
      await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByRole('button', { name: /saving…/i })).not.toBeInTheDocument());
      // The save advanced us to the next step (task 43); return to re-save.
      await goToStep(user, 'Patient Information');

      const createdPatient = (await createSpy.mock.results[0].value) as WithId<Patient>;
      expect(createdPatient.resourceType).toBe('Patient');
      expect(createdPatient.id).toBeDefined();

      const firstObservations = await medplum.searchResources('Observation', {
        subject: `Patient/${createdPatient.id}`,
        identifier: `${SCREENING_ID_SYSTEM}|Hair color`,
      });
      expect(firstObservations).toHaveLength(1);
      const firstObservationId = firstObservations[0].id;

      // --- Second save: same section, same values, nothing edited in between. ---
      await user.click(saveButton());
      await waitFor(() =>
        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ resourceType: 'Patient', id: createdPatient.id })
        )
      );
      await waitFor(() => expect(saveButton()).not.toBeDisabled());

      // The Patient is updated in place on the second save — never a second create.
      // This is the orphaned-subject/duplicate-patient regression from task 8: a
      // stale closure over `patient` used to send `subject: undefined` here.
      expect(createSpy).toHaveBeenCalledTimes(1);

      // The Observation is upserted in place too: still exactly one, same id —
      // not a second resource sitting alongside the first.
      const secondObservations = await medplum.searchResources('Observation', {
        subject: `Patient/${createdPatient.id}`,
        identifier: `${SCREENING_ID_SYSTEM}|Hair color`,
      });
      expect(secondObservations).toHaveLength(1);
      expect(secondObservations[0].id).toBe(firstObservationId);
    });

    // A checklist item whose real-world name contains a comma —
    // "Insect allergy (bee, wasp, ant)" is on the actual form — silently broke
    // the conditional-PUT match: FHIR search treats an unescaped comma inside a
    // token value as an OR-separator, so the upsert query matched nothing and
    // created a second resource on every resave instead of updating the first.
    // Confirmed directly against MockClient.upsertResource before this test
    // existed; escapeSearchToken() is the fix.
    test('saving an allergy whose name contains a comma updates in place, not duplicates', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const user = userEvent.setup();
      await renderWizard(medplum);

      await goToStep(user, 'Current Health Status');
      await user.click(checkbox('Insect allergy (bee, wasp, ant)'));
      await saveSection(user, /save and next/i);

      // Filter client-side by exact identifier.value rather than searching by
      // it — the target key itself contains the comma under test, so a
      // FHIR-search-based lookup here would hit the very same escaping issue
      // the fix addresses and could pass for the wrong reason.
      const targetKey = 'allergy::Insect allergy (bee, wasp, ant)';
      const findByKey = async (): Promise<{ id?: string }[]> => {
        const all = await medplum.searchResources('AllergyIntolerance', {});
        return all.filter((r) => r.identifier?.some((i) => i.system === SCREENING_ID_SYSTEM && i.value === targetKey));
      };

      const afterFirst = await findByKey();
      expect(afterFirst).toHaveLength(1);
      const firstId = afterFirst[0].id;

      // Re-save the same section with nothing changed.
      // A successful save now advances to the next step (task 43), so come
      // back before saving this section again.
      await goToStep(user, 'Current Health Status');
      await saveSection(user, /save and next/i);

      const afterSecond = await findByKey();
      expect(afterSecond).toHaveLength(1);
      expect(afterSecond[0].id).toBe(firstId);
    });
  });

  describe('FHIR constraint validity', () => {
    // Fills at least one field of every resource type the wizard writes —
    // Patient, Observation, AllergyIntolerance (ait-1), Condition both as a
    // chronic condition and a nursing diagnosis (con-3), MedicationStatement
    // with a name but no dosage (ele-1), CarePlan — and asserts everything
    // persisted passes `validateResource`. This is the automated stand-in for
    // the manual "save each section and see what FHIR rejects" pass; all four
    // constraint bugs fixed in 2b3fdba would fail this test if reintroduced.
    test('every resource written across all four sections is valid FHIR', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const capture = captureWrites(medplum);
      const user = userEvent.setup();
      await renderWizard(medplum);

      // Section 1 — Patient + a couple of demographic Observations.
      await user.type(fieldInput('Last name'), 'Doe');
      await user.type(fieldInput('Color of hair'), 'Brown');
      await saveSection(user, /save and next/i);

      // Section 2 — a vital Observation, an allergy (ait-1), a chronic
      // condition (con-3), and a medication with no dosage (ele-1).
      await goToStep(user, 'Current Health Status');
      await user.type(fieldInput('Temp (°F)'), '98.6');
      await user.click(checkbox('Latex allergy'));
      await user.click(screen.getByRole('button', { name: /has one or more/i }));
      await user.click(checkbox('Asthma'));
      // The vision-screen table also carries `.djs-dyn`, so anchor to the
      // medications table via its own Add button rather than a global selector.
      const addMedication = screen.getByRole('button', { name: /add medication/i });
      await user.click(addMedication);
      const medName = addMedication.previousElementSibling?.querySelector(
        'tbody tr td input'
      ) as HTMLInputElement;
      await user.type(medName, 'Aspirin');
      await saveSection(user, /save and next/i);

      // Section 4 — a nursing-diagnosis Condition (con-3) and a CarePlan.
      await goToStep(user, 'Diagnosis & Disposition');
      await user.type(fieldInput('1.'), 'Risk for withdrawal');
      await user.click(checkbox('Cleared for general population'));
      await saveSection(user, /save diagnosis & disposition/i);

      // Sanity: the sections above actually produced the resource types whose
      // constraints we care about — otherwise "no errors" would be vacuous.
      const types = new Set(capture.written.map((r) => r.resourceType));
      expect(types).toContain('AllergyIntolerance');
      expect(types).toContain('MedicationStatement');
      expect(types).toContain('Condition');

      expect(capture.validationErrors).toEqual([]);
    });
  });

  describe('subject integrity', () => {
    // The orphaned-subject regression (task 8): subjectRef was read from
    // render-time state, so a first-time save on a patient-less route wrote
    // subject: undefined on every resource. Here the wizard is mounted with no
    // patient; ensurePatientRef must create the Patient and thread a real
    // reference into every subsequent write.
    test('a first-time save references a real patient on every resource', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const capture = captureWrites(medplum);
      const user = userEvent.setup();
      await renderWizard(medplum);

      await goToStep(user, 'Current Health Status');
      await user.type(fieldInput('Temp (°F)'), '98.6');
      await user.click(checkbox('Latex allergy'));
      await saveSection(user, /save and next/i);

      const nonPatientWrites = capture.written.filter((r) => r.resourceType !== 'Patient');
      expect(nonPatientWrites.length).toBeGreaterThan(0);

      const orphaned = nonPatientWrites.filter((r) => {
        // AllergyIntolerance references the patient via `patient`; everything
        // else here via `subject`.
        const ref = (r as { subject?: { reference?: string }; patient?: { reference?: string } });
        return !(ref.subject?.reference ?? ref.patient?.reference);
      });
      expect(orphaned).toEqual([]);
    });
  });

  describe('retraction round-trip', () => {
    // Task 11: unchecking a saved item must withdraw its resource, not leave it
    // asserted in the chart and not hard-delete it. Verified end to end against
    // MockClient, whose conditional-upsert and identifier search semantics
    // match the server (confirmed separately).
    test('unchecking an allergy marks it entered-in-error, not deleted', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      // Validate every write, including the retraction update. MockClient does
      // not enforce constraints, so without this the retracted AllergyIntolerance
      // (clinicalStatus + verificationStatus=entered-in-error) would sail through
      // here while the live server rejects it on ait-2 — exactly the gap that let
      // that bug reach the live test.
      const capture = captureWrites(medplum);
      const user = userEvent.setup();
      await renderWizard(medplum);

      await goToStep(user, 'Current Health Status');
      await user.click(checkbox('Latex allergy'));
      await saveSection(user, /save and next/i);

      // Identify the allergy by its screening identifier alone — one patient in
      // this test, so no patient filter is needed, and it avoids depending on a
      // separate Patient lookup.
      const allergyQuery = { identifier: `${SCREENING_ID_SYSTEM}|allergy::Latex allergy` };

      const afterCheck = await medplum.searchResources('AllergyIntolerance', allergyQuery);
      expect(afterCheck).toHaveLength(1);
      const retractedCodes1 =
        afterCheck[0].verificationStatus?.coding?.map((c) => c.code) ?? [];
      expect(retractedCodes1).not.toContain('entered-in-error');

      // A successful save advances to the next step (task 43); come back.
      await goToStep(user, 'Current Health Status');
      // Uncheck the same allergy and save again.
      await user.click(checkbox('Latex allergy'));
      // A successful save now advances to the next step (task 43), so come
      // back before saving this section again.
      await goToStep(user, 'Current Health Status');
      await saveSection(user, /save and next/i);

      const afterUncheck = await medplum.searchResources('AllergyIntolerance', allergyQuery);
      // Still exactly one resource — withdrawn, not deleted.
      expect(afterUncheck).toHaveLength(1);
      expect(afterUncheck[0].id).toBe(afterCheck[0].id);
      const retractedCodes2 =
        afterUncheck[0].verificationStatus?.coding?.map((c) => c.code) ?? [];
      expect(retractedCodes2).toContain('entered-in-error');

      // The retraction update must itself be valid FHIR (ait-2: no clinicalStatus
      // alongside verificationStatus=entered-in-error). This is what a real
      // server enforces; the assertion above only checks the code is present.
      expect(capture.validationErrors).toEqual([]);
    });
  });

  describe('pain score semantics', () => {
    // Task 12 / the absent-vs-zero bug: on a 0–10 scale, 0 means "no pain" — a
    // real finding. Reporting pain but never moving the slider must record a
    // coded dataAbsentReason, not a fabricated score of 0, or the chart can't
    // tell "not measured" from "measured as none".
    test('pain reported without a score saves dataAbsentReason, never valueInteger 0', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const capture = captureWrites(medplum);
      const user = userEvent.setup();
      await renderWizard(medplum);

      await goToStep(user, 'Current Health Status');
      // Report pain, but deliberately never touch the slider.
      await user.click(screen.getByRole('button', { name: /yes — has pain/i }));
      await saveSection(user, /save and next/i);

      const pain = capture.written.find(
        (r) => r.resourceType === 'Observation' && (r as { code?: { text?: string } }).code?.text?.startsWith('Pain severity')
      ) as { valueInteger?: number; dataAbsentReason?: unknown } | undefined;

      expect(pain).toBeDefined();
      expect(pain?.valueInteger).toBeUndefined();
      expect(pain?.dataAbsentReason).toBeDefined();
    });
  });

  describe('admission Encounter and facility Location (task 24)', () => {
    /** Selects a facility by its visible name in the Facility dropdown. */
    async function selectFacility(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
      const select = document.querySelector('select') as HTMLSelectElement;
      await user.selectOptions(select, screen.getByRole('option', { name }));
    }

    // admissionDate and facility were captured in the JSX and read by no save
    // handler — the same silent-data-loss class as the Epi-Pen and task-18/19
    // fields, and invisible to the field-integrity script because they are
    // useState rather than FormState keys.
    test('saves the admission date and facility that were previously discarded', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const capture = captureWrites(medplum);
      const user = userEvent.setup();
      await renderWizard(medplum);

      await user.type(fieldInput('Last name'), 'Doe');
      fireEvent.change(fieldInput('Date of admission'), { target: { value: '2026-07-20' } });
      await selectFacility(user, 'Cheltenham');
      await saveSection(user, /save and next/i);

      const encounter = capture.written.find((r) => r.resourceType === 'Encounter') as Encounter | undefined;
      expect(encounter).toBeDefined();
      expect(encounter?.period?.start).toBe('2026-07-20');
      // FHIR requires both; neither has a sensible default.
      expect(encounter?.status).toBeDefined();
      expect(encounter?.class?.code).toBe('IMP');

      const location = capture.written.find((r) => r.resourceType === 'Location') as Location | undefined;
      expect(location?.name).toBe('Cheltenham');
      expect(location?.identifier?.[0]).toEqual({
        system: 'http://maryland.gov/djs/facility',
        value: 'cheltenham',
      });

      // The Encounter must point at the Location by reference and must NOT
      // carry a copy of its name — a second copy would go stale on rename.
      expect(encounter?.location?.[0].location?.reference).toContain('Location/');
      expect(JSON.stringify(encounter)).not.toContain('Cheltenham');

      expect(capture.validationErrors).toEqual([]);
    });

    // The reason identity hangs on the code rather than the name: re-saving,
    // and two different patients admitted to the same facility, must all
    // converge on ONE Location rather than minting duplicates.
    test('re-saving and a second patient reuse the same Location, never duplicating it', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const user = userEvent.setup();
      await renderWizard(medplum);

      await user.type(fieldInput('Last name'), 'Doe');
      await selectFacility(user, 'Hickey');
      await saveSection(user, /save and next/i);
      // A successful save now advances to the next step (task 43), so come
      // back before saving this section again.
      await goToStep(user, 'Patient Information');
      await saveSection(user, /save and next/i);

      const locations = await medplum.searchResources('Location', {
        identifier: 'http://maryland.gov/djs/facility|hickey',
      });
      expect(locations).toHaveLength(1);

      // And the admission Encounter itself upserts in place rather than
      // creating a second admission on every save.
      const encounters = await medplum.searchResources('Encounter', {
        identifier: `${SCREENING_ID_SYSTEM}|admission-encounter`,
      });
      expect(encounters).toHaveLength(1);
    });

    test('populates the admission date and facility dropdown on reopen', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const patient = await medplum.createResource({ resourceType: 'Patient', name: [{ family: 'Reyes' }] });
      const location = await medplum.createResource({
        resourceType: 'Location',
        status: 'active',
        name: 'Victor Cullen',
        identifier: [{ system: 'http://maryland.gov/djs/facility', value: 'victor-cullen' }],
      } as Resource);
      await medplum.createResource({
        resourceType: 'Encounter',
        status: 'in-progress',
        class: { code: 'IMP' },
        subject: { reference: `Patient/${patient.id}` },
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'admission-encounter' }],
        period: { start: '2026-07-18' },
        location: [{ location: { reference: `Location/${location.id}` } }],
      } as Resource);

      await renderWizardForPatient(medplum, patient.id);

      await waitFor(() => expect(fieldInput('Date of admission').value).toBe('2026-07-18'));
      expect((document.querySelector('select') as HTMLSelectElement).value).toBe('victor-cullen');
    });

    test('the facility dropdown is a closed set with no free-text escape', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      await renderWizard(medplum);

      const select = document.querySelector('select') as HTMLSelectElement;
      expect(select).toBeInstanceOf(HTMLSelectElement);
      // 13 canonical facilities plus the empty placeholder.
      expect(select.options).toHaveLength(DJS_FACILITIES.length + 1);
      // An "Other"/free-text option would reintroduce the duplication problem.
      expect(screen.queryByRole('option', { name: /other/i })).not.toBeInTheDocument();
    });
  });

  describe('save and next (task 43)', () => {
    /** True when the wizard is showing Current Health Status (section 2). */
    function onHealthStatus(): boolean {
      return screen.queryByText('Temp (°F)') !== null;
    }

    test('a successful save advances to the next section', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const user = userEvent.setup();
      await renderWizard(medplum);

      await user.type(fieldInput('Last name'), 'Doe');
      expect(onHealthStatus()).toBe(false);

      await saveSection(user, /save and next/i);

      await waitFor(() => expect(onHealthStatus()).toBe(true));
    });

    // The guarantee this feature turns on. Advancing after a failed save would
    // hide the error toast behind a page change and make a lost section look
    // like a completed one — the silent-data-loss pattern this codebase keeps
    // hitting, which is exactly what the wizard must not do.
    test('a FAILED save does not advance, so the error stays in front of the nurse', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      vi.spyOn(medplum, 'createResource').mockRejectedValue(new Error('server exploded'));
      const user = userEvent.setup();
      await renderWizard(medplum);

      await user.type(fieldInput('Last name'), 'Doe');
      await saveSection(user, /save and next/i);

      // Still on section 1, with the entered value intact to retry from.
      expect(onHealthStatus()).toBe(false);
      expect(fieldInput('Last name').value).toBe('Doe');
    });

    test('the final section has no next step, so it keeps a plain Save button', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const user = userEvent.setup();
      await renderWizard(medplum);

      await goToStep(user, 'Diagnosis & Disposition');

      expect(screen.getByRole('button', { name: /save diagnosis & disposition/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /save and next/i })).not.toBeInTheDocument();
    });
  });

  describe('vital-signs coding (task 26)', () => {
    /** Saves one of each vital and returns the written Observations by code.text. */
    async function saveVitalsAndCapture(): Promise<{ capture: WriteCapture; byCode: Map<string, Observation> }> {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const capture = captureWrites(medplum);
      const user = userEvent.setup();
      await renderWizard(medplum);

      await goToStep(user, 'Current Health Status');
      await user.type(fieldInput('Temp (°F)'), '98.6');
      await user.type(fieldInput('Pulse'), '72');
      await user.type(fieldInput('Resp'), '16');
      await user.type(screen.getByLabelText('Systolic'), '118');
      await user.type(screen.getByLabelText('Diastolic'), '76');
      await user.type(fieldInput('Weight (lb)'), '150');
      await user.type(fieldInput('Height (in)'), '68');
      // Chief complaint gives us a non-vital Observation from the same save,
      // to prove the enrichment is scoped rather than blanket.
      await user.click(screen.getByRole('button', { name: /yes — has a complaint/i }));
      await user.type(fieldTextarea('Specify'), 'Sore throat');
      await saveSection(user, /save and next/i);

      const byCode = new Map<string, Observation>();
      for (const r of capture.written) {
        if (r.resourceType === 'Observation') {
          const text = (r as Observation).code?.text;
          if (text) {
            byCode.set(text, r as Observation);
          }
        }
      }
      return { capture, byCode };
    }

    test('every vital is written with its LOINC code, vital-signs category, and UCUM unit', async () => {
      const { capture, byCode } = await saveVitalsAndCapture();

      const expected: Record<string, { loinc: string; ucum?: string; value?: number }> = {
        'Body temperature': { loinc: '8310-5', ucum: '[degF]', value: 98.6 },
        'Heart rate': { loinc: '8867-4', ucum: '/min', value: 72 },
        'Respiratory rate': { loinc: '9279-1', ucum: '/min', value: 16 },
        'Body weight': { loinc: '29463-7', ucum: '[lb_av]', value: 150 },
        'Body height': { loinc: '8302-2', ucum: '[in_i]', value: 68 },
        'Body mass index (BMI)': { loinc: '39156-5', ucum: 'kg/m2' },
        // BP's reading is in components, so it has no top-level quantity —
        // but it must still be coded and categorized like any other vital.
        'Blood pressure': { loinc: '85354-9' },
      };

      for (const [code, want] of Object.entries(expected)) {
        const obs = byCode.get(code);
        expect(obs, `expected an Observation for "${code}"`).toBeDefined();
        expect(obs?.code?.coding?.[0].code, `LOINC for ${code}`).toBe(want.loinc);
        expect(obs?.code?.coding?.[0].system).toBe('http://loinc.org');
        expect(obs?.category?.[0].coding?.[0].code, `category for ${code}`).toBe('vital-signs');
        if (want.ucum) {
          expect(obs?.valueQuantity?.code, `UCUM for ${code}`).toBe(want.ucum);
          expect(obs?.valueQuantity?.system).toBe('http://unitsofmeasure.org');
        }
        if (want.value !== undefined) {
          expect(obs?.valueQuantity?.value, `value for ${code}`).toBe(want.value);
        }
      }

      expect(capture.validationErrors).toEqual([]);
    });

    test('the coding is scoped to vitals and does not leak onto other observations', async () => {
      const { byCode } = await saveVitalsAndCapture();

      const complaint = byCode.get('Chief complaint');
      expect(complaint).toBeDefined();
      expect(complaint?.category).toBeUndefined();
      expect(complaint?.code?.coding).toBeUndefined();
      expect(complaint?.valueString).toBe('Sore throat');
    });

    // code.text is what screening identifiers derive from, so adding codings
    // must not have disturbed it — a changed text would orphan every reading
    // saved before this change rather than upgrading it.
    // The vital-signs profile requires a time of measurement, so tagging these
    // with the category obliges us to record one.
    test('every vital records when the measurement was taken', async () => {
      const { byCode } = await saveVitalsAndCapture();

      for (const code of ['Body temperature', 'Heart rate', 'Blood pressure', 'Body weight']) {
        expect(byCode.get(code)?.effectiveDateTime, `effectiveDateTime for ${code}`).toBeDefined();
      }
    });

    // Resuming a partially-completed screening is this wizard's whole point, so
    // a nurse reopening it later to fix a typo must not silently re-date
    // yesterday's vitals to today.
    test('re-saving preserves the original measurement time rather than restamping it', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const user = userEvent.setup();
      await renderWizard(medplum);

      await goToStep(user, 'Current Health Status');
      await user.type(fieldInput('Temp (°F)'), '98.6');
      await saveSection(user, /save and next/i);

      const query = { identifier: `${SCREENING_ID_SYSTEM}|Body temperature` };
      const [first] = await medplum.searchResources('Observation', query);
      const firstEffective = first.effectiveDateTime;
      expect(firstEffective).toBeDefined();

      // A successful save advances to the next step (task 43); come back.
      await goToStep(user, 'Current Health Status');
      // Edit a different field and save again — the temperature reading was
      // not retaken, so its time must not move.
      await user.type(fieldInput('Pulse'), '72');
      // A successful save now advances to the next step (task 43), so come
      // back before saving this section again.
      await goToStep(user, 'Current Health Status');
      await saveSection(user, /save and next/i);

      const [second] = await medplum.searchResources('Observation', query);
      expect(second.id).toBe(first.id);
      expect(second.effectiveDateTime).toBe(firstEffective);
    });

    test('code.text is preserved so existing identifiers still resolve', async () => {
      const { byCode } = await saveVitalsAndCapture();

      expect(byCode.get('Body temperature')?.code?.text).toBe('Body temperature');
      expect(byCode.get('Body temperature')?.identifier?.[0].value).toBe('Body temperature');
    });
  });

  describe('blood pressure panel (task 25)', () => {
    test('saves systolic and diastolic as coded components, with no value string', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const capture = captureWrites(medplum);
      const user = userEvent.setup();
      await renderWizard(medplum);

      await goToStep(user, 'Current Health Status');
      await user.type(screen.getByLabelText('Systolic'), '128');
      await user.type(screen.getByLabelText('Diastolic'), '82');
      await saveSection(user, /save and next/i);

      const bp = capture.written.find(
        (r) => r.resourceType === 'Observation' && (r as Observation).code?.text === 'Blood pressure'
      ) as Observation | undefined;

      expect(bp).toBeDefined();
      // The reading lives in components; a panel has no top-level value[x].
      expect(bp?.valueString).toBeUndefined();
      expect(bp?.valueQuantity).toBeUndefined();
      expect(bp?.component).toHaveLength(2);

      const systolic = bp?.component?.find((c) => c.code?.coding?.[0].code === '8480-6');
      const diastolic = bp?.component?.find((c) => c.code?.coding?.[0].code === '8462-4');
      expect(systolic?.valueQuantity).toEqual({
        value: 128,
        unit: 'mmHg',
        system: 'http://unitsofmeasure.org',
        code: 'mm[Hg]',
      });
      expect(diastolic?.valueQuantity?.value).toBe(82);

      expect(capture.validationErrors).toEqual([]);
    });

    test('populates both BP fields on reopen', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const patient = await medplum.createResource({ resourceType: 'Patient', name: [{ family: 'Okafor' }] });
      await medplum.createResource({
        resourceType: 'Observation',
        status: 'final',
        subject: { reference: `Patient/${patient.id}` },
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'Blood pressure' }],
        code: { text: 'Blood pressure' },
        component: [
          { code: { coding: [{ code: '8480-6' }] }, valueQuantity: { value: 132, unit: 'mmHg' } },
          { code: { coding: [{ code: '8462-4' }] }, valueQuantity: { value: 86, unit: 'mmHg' } },
        ],
      } as Resource);

      const user = userEvent.setup();
      await renderWizardForPatient(medplum, patient.id);

      await goToStep(user, 'Current Health Status');
      await waitFor(() => expect((screen.getByLabelText('Systolic') as HTMLInputElement).value).toBe('132'));
      expect((screen.getByLabelText('Diastolic') as HTMLInputElement).value).toBe('86');
    });

    // Readings saved before task 25 are a "120/80" valueString; reopening one
    // must still fill the two fields rather than silently losing it.
    test('populates both BP fields from a legacy value string', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const patient = await medplum.createResource({ resourceType: 'Patient', name: [{ family: 'Prior' }] });
      await medplum.createResource({
        resourceType: 'Observation',
        status: 'final',
        subject: { reference: `Patient/${patient.id}` },
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'Blood pressure' }],
        code: { text: 'Blood pressure' },
        valueString: '110/70',
      } as Resource);

      const user = userEvent.setup();
      await renderWizardForPatient(medplum, patient.id);

      await goToStep(user, 'Current Health Status');
      await waitFor(() => expect((screen.getByLabelText('Systolic') as HTMLInputElement).value).toBe('110'));
      expect((screen.getByLabelText('Diastolic') as HTMLInputElement).value).toBe('70');
    });
  });

  describe('medication dosage (task 17 step 6 / Option A)', () => {
    // Dose and frequency were previously concatenated into one
    // `dosage[0].text` string ("5 mg, twice daily"), which is what made
    // reading them back into two separate table columns lossy. They now save
    // into Dosage's own structured fields — doseAndRate.doseQuantity for the
    // dose, timing.code for the frequency — so there's nothing to un-merge.
    test('saves dose and frequency into separate structured Dosage fields, not one merged string', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const capture = captureWrites(medplum);
      const user = userEvent.setup();
      await renderWizard(medplum);

      await goToStep(user, 'Current Health Status');
      const addMedication = screen.getByRole('button', { name: /add medication/i });
      await user.click(addMedication);
      const table = addMedication.previousElementSibling as HTMLElement;
      const inputs = table.querySelectorAll<HTMLInputElement>('tbody tr td input');
      await user.type(inputs[0], 'Albuterol');
      await user.type(inputs[1], '2 mg');
      await user.type(inputs[2], 'BID');
      await saveSection(user, /save and next/i);

      const med = capture.written.find((r) => r.resourceType === 'MedicationStatement') as
        | { dosage?: { text?: string; timing?: { code?: { text?: string } }; doseAndRate?: { doseQuantity?: { value?: number; unit?: string; system?: string; code?: string } }[] }[] }
        | undefined;

      expect(med?.dosage?.[0].text).toBeUndefined();
      expect(med?.dosage?.[0].timing?.code?.text).toBe('BID');
      expect(med?.dosage?.[0].doseAndRate?.[0].doseQuantity).toEqual({
        value: 2,
        unit: 'mg',
        system: 'http://unitsofmeasure.org',
        code: 'mg',
      });
      expect(capture.validationErrors).toEqual([]);
    });

    test('a dose typed as free text (not "<number> <unit>") still saves, as Dosage.text, alongside its own frequency', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const capture = captureWrites(medplum);
      const user = userEvent.setup();
      await renderWizard(medplum);

      await goToStep(user, 'Current Health Status');
      const addMedication = screen.getByRole('button', { name: /add medication/i });
      await user.click(addMedication);
      const table = addMedication.previousElementSibling as HTMLElement;
      const inputs = table.querySelectorAll<HTMLInputElement>('tbody tr td input');
      await user.type(inputs[0], 'Ibuprofen');
      await user.type(inputs[1], '1-2 tablets');
      await user.type(inputs[2], 'as needed');
      await saveSection(user, /save and next/i);

      const med = capture.written.find((r) => r.resourceType === 'MedicationStatement') as
        | { dosage?: { text?: string; timing?: { code?: { text?: string } }; doseAndRate?: unknown[] }[] }
        | undefined;

      expect(med?.dosage?.[0].text).toBe('1-2 tablets');
      expect(med?.dosage?.[0].timing?.code?.text).toBe('as needed');
      expect(med?.dosage?.[0].doseAndRate).toBeUndefined();
      expect(capture.validationErrors).toEqual([]);
    });
  });

  describe('form read-back on mount', () => {
    // Task 10: opening an existing patient's screening must repopulate the
    // form, not show blank fields. This mounts the wizard at the patient route
    // with resources already on file and asserts they surface in the inputs —
    // the integration counterpart to hydrateScreening.test.ts's unit coverage.
    test('populates fields from resources already saved for the patient', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const patient = await medplum.createResource({
        resourceType: 'Patient',
        name: [{ family: 'Rivera', given: ['Sam'] }],
        birthDate: '2009-03-04',
        gender: 'male',
      });
      const subject = { reference: `Patient/${patient.id}` };
      await medplum.createResource({
        resourceType: 'Observation',
        status: 'final',
        subject,
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'Body temperature' }],
        code: { text: 'Body temperature' },
        valueQuantity: { value: 99.1, unit: '°F' },
      } as Resource);
      await medplum.createResource({
        resourceType: 'AllergyIntolerance',
        patient: subject,
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'allergy::Latex allergy' }],
        clinicalStatus: { coding: [{ code: 'active' }] },
        code: { text: 'Latex allergy' },
      } as Resource);

      const user = userEvent.setup();
      await renderWizardForPatient(medplum, patient.id);

      // Section 1 shows on mount; the last name reads back from the Patient.
      await waitFor(() => expect(fieldInput('Last name').value).toBe('Rivera'));

      // Section 2: the saved vital and allergy come back too.
      await goToStep(user, 'Current Health Status');
      await waitFor(() => expect(fieldInput('Temp (°F)').value).toBe('99.1'));
      expect(checkbox('Latex allergy').checked).toBe(true);
    });

    // Task 17 step 1/2: the task-18/19 free-text fields now save correctly
    // (their own tests cover that); this confirms they also read back on
    // reopen, via hydrateScreening.ts's TEXT_CODE_TO_FIELD mapping.
    test('populates the task-18/19 free-text fields from resources already saved', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const patient = await medplum.createResource({
        resourceType: 'Patient',
        name: [{ family: 'Torres' }],
      });
      const subject = { reference: `Patient/${patient.id}` };
      await medplum.createResource({
        resourceType: 'Observation',
        status: 'final',
        subject,
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'Injuries/trauma: details' }],
        code: { text: 'Injuries/trauma: details' },
        valueString: 'Fractured wrist 2023, healed',
      } as Resource);
      await medplum.createResource({
        resourceType: 'Observation',
        status: 'final',
        subject,
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'Disposition: additional notes' }],
        code: { text: 'Disposition: additional notes' },
        valueString: 'Referred to dental',
      } as Resource);

      const user = userEvent.setup();
      await renderWizardForPatient(medplum, patient.id);

      await goToStep(user, 'Review of Systems');
      await waitFor(() => expect(fieldTextarea('Details, dates, treatment').value).toBe('Fractured wrist 2023, healed'));

      await goToStep(user, 'Diagnosis & Disposition');
      await waitFor(() =>
        expect(fieldTextarea('Additional notes on referrals, logs, or records requested').value).toBe(
          'Referred to dental'
        )
      );
    });

    // Task 17 step 3: the checkbox toggle for "Other" already restored
    // correctly before this change; what was missing was the typed-in text
    // next to it, which lives in a separate FormState bucket (checkTextMap).
    test('populates both the "Other" checkbox and its inline free text on reopen', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const patient = await medplum.createResource({
        resourceType: 'Patient',
        name: [{ family: 'Nguyen' }],
      });
      const subject = { reference: `Patient/${patient.id}` };
      await medplum.createResource({
        resourceType: 'Observation',
        status: 'final',
        subject,
        identifier: [
          { system: SCREENING_ID_SYSTEM, value: 'Appearance/mental status finding::Other' },
        ],
        code: { text: 'Appearance/mental status finding' },
        valueString: 'Flat affect',
      } as Resource);

      const user = userEvent.setup();
      await renderWizardForPatient(medplum, patient.id);

      await goToStep(user, 'Current Health Status');
      const otherCheckbox = checkboxInCard('Appearance & mental status', 'Other');
      await waitFor(() => expect(otherCheckbox.checked).toBe(true));
      expect(inlineTextInput(otherCheckbox).value).toBe('Flat affect');
    });

    // Task 17 step 4: birthplace, ethnicity, needs-interpreter, race, and hair/
    // eye colour all save correctly already; none were read back until now.
    test('populates demographics extensions and hair/eye colour on reopen', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const patient = await medplum.createResource({
        resourceType: 'Patient',
        name: [{ family: 'Osei' }],
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/patient-birthPlace',
            valueAddress: { text: 'Baltimore, MD' },
          },
          {
            url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity',
            valueCodeableConcept: { text: 'Hispanic or Latino' },
          },
          {
            url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race',
            valueCodeableConcept: { text: 'Black or African American, Cherokee' },
          },
          {
            url: 'http://example.org/fhir/StructureDefinition/needs-interpreter',
            valueBoolean: true,
          },
        ],
      });
      const subject = { reference: `Patient/${patient.id}` };
      await medplum.createResource({
        resourceType: 'Observation',
        status: 'final',
        subject,
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'Hair color' }],
        code: { text: 'Hair color' },
        valueString: 'Black',
      } as Resource);

      const user = userEvent.setup();
      await renderWizardForPatient(medplum, patient.id);

      await waitFor(() => expect(activeChipLabel('Hispanic / Latino')).toBe('Yes'));
      expect(fieldInput('Place of birth').value).toBe('Baltimore, MD');
      expect(checkbox('Needs interpreter').checked).toBe(true);
      const otherRaceCheckbox = checkboxInCard('Language & race', 'Other');
      expect(otherRaceCheckbox.checked).toBe(true);
      expect(inlineTextInput(otherRaceCheckbox).value).toBe('Cherokee');
      expect(checkbox('Black or African American').checked).toBe(true);
      expect(fieldInput('Color of hair').value).toBe('Black');
    });

    // Task 17 step 5: vision acuity (6 fields, saveVitals) and glasses
    // history (saveVitals) save correctly already; neither was read back.
    test('populates the vision-acuity table and glasses history on reopen', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const patient = await medplum.createResource({ resourceType: 'Patient', name: [{ family: 'Kim' }] });
      const subject = { reference: `Patient/${patient.id}` };
      await medplum.createResource({
        resourceType: 'Observation',
        status: 'final',
        subject,
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'Visual acuity, left eye, without correction' }],
        code: { text: 'Visual acuity, left eye, without correction' },
        valueString: '20/40',
      } as Resource);
      await medplum.createResource({
        resourceType: 'Observation',
        status: 'final',
        subject,
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'History of prescribed glasses/contacts' }],
        code: { text: 'History of prescribed glasses/contacts' },
        valueString: 'Wears reading glasses',
      } as Resource);

      const user = userEvent.setup();
      await renderWizardForPatient(medplum, patient.id);

      await goToStep(user, 'Current Health Status');
      await waitFor(() => expect(visionAcuityInput(0).value).toBe('20/40'));
      await waitFor(() => expect(activeChipLabel('Given glasses or corrective contact lenses in the past?')).toBe('Yes'));
      expect(fieldTextarea('When & where prescribed, location & condition of glasses/lenses').value).toBe(
        'Wears reading glasses'
      );
    });

    // Task 17 steps 7-8: sign-off (Nurse/Physician/health-alerts) and the
    // mandated-reporter statement + RN initials both save correctly already;
    // neither was read back.
    test('populates sign-off and mandated-reporter fields on reopen', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const patient = await medplum.createResource({ resourceType: 'Patient', name: [{ family: 'Alvarez' }] });
      const subject = { reference: `Patient/${patient.id}` };
      await medplum.createResource({
        resourceType: 'Observation',
        status: 'final',
        subject,
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'Admission health screening sign-off' }],
        code: { text: 'Admission health screening sign-off' },
        valueString: 'Nurse: J. Rivera, RN; Physician: Dr. Okafor',
        note: [{ text: 'Watch for allergic reaction' }],
      } as Resource);
      await medplum.createResource({
        resourceType: 'Observation',
        status: 'final',
        subject,
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'Mandated reporter statement read to youth' }],
        code: { text: 'Mandated reporter statement read to youth' },
        valueString: 'Statement read',
        note: [{ text: 'RN initials: JR' }],
      } as Resource);

      await renderWizardForPatient(medplum, patient.id);

      // Section 1 (mandated-reporter) shows on mount.
      await waitFor(() => expect(checkbox('Statement read to youth').checked).toBe(true));
      expect(fieldInput('RN initials').value).toBe('JR');

      // Section 4 (sign-off) needs navigating to.
      const user = userEvent.setup();
      await goToStep(user, 'Diagnosis & Disposition');
      await waitFor(() => expect(fieldInput("Nurse's signature (typed name)").value).toBe('J. Rivera, RN'));
      expect(fieldInput("Physician's signature (typed name)").value).toBe('Dr. Okafor');
      expect(
        fieldTextarea('Health status alerts (document allergies on chart cover & problem list too)').value
      ).toBe('Watch for allergic reaction');
    });

    // Task 17 step 6 (Option A): dose and frequency are read back from
    // Dosage's own structured fields (doseAndRate.doseQuantity, timing.code),
    // not un-merged from one string — see hydrateScreening.test.ts for the
    // unit-level coverage of dosageToFields itself.
    test('populates the medications table on reopen, with dose and frequency independent of each other', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const patient = await medplum.createResource({ resourceType: 'Patient', name: [{ family: 'Kim' }] });
      const subject = { reference: `Patient/${patient.id}` };
      await medplum.createResource({
        resourceType: 'MedicationStatement',
        status: 'active',
        subject,
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'medication::Albuterol' }],
        medicationCodeableConcept: { text: 'Albuterol' },
        dosage: [
          { doseAndRate: [{ doseQuantity: { value: 2, unit: 'mg' } }], timing: { code: { text: 'BID' } } },
        ],
        reasonCode: [{ text: 'Asthma' }],
        informationSource: { display: 'Dr Chen' },
        note: [{ text: 'Last taken: this morning' }],
      } as Resource);

      const user = userEvent.setup();
      await renderWizardForPatient(medplum, patient.id);

      await goToStep(user, 'Current Health Status');
      const addMedication = screen.getByRole('button', { name: /add medication/i });
      const table = addMedication.previousElementSibling as HTMLElement;
      await waitFor(() => {
        const inputs = table.querySelectorAll<HTMLInputElement>('tbody tr td input');
        expect(inputs[0].value).toBe('Albuterol');
        expect(inputs[1].value).toBe('2 mg');
        expect(inputs[2].value).toBe('BID');
        expect(inputs[3].value).toBe('Asthma');
        expect(inputs[4].value).toBe('Dr Chen');
        expect(inputs[5].value).toBe('this morning');
      });
    });
  });

  describe('free-text field persistence (task 18)', () => {
    // These four fields were rendered but read by no save handler, so the
    // nurse's input was silently discarded (epipen-class data loss). The
    // field-integrity grep cannot catch this class — a JSX `value=` read looks
    // like a read — so this drives them through the UI and asserts each one
    // actually persisted as an Observation.
    test('chronic providers/pcp/comments and injuries detail are saved', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const user = userEvent.setup();
      await renderWizard(medplum);

      // Health status → chronic "yes" reveals the three free-text fields.
      await goToStep(user, 'Current Health Status');
      await user.click(screen.getByRole('button', { name: /has one or more/i }));
      await user.type(fieldInput('Doctors / specialists managing these conditions'), 'Dr Chen (pulmonology)');
      await user.type(fieldInput('Primary care provider (if known)'), 'Dr Patel');
      await user.type(fieldTextarea('Additional comments'), 'Asthma well controlled on inhaler');
      await saveSection(user, /save and next/i);

      // Review of systems → injuries detail.
      await goToStep(user, 'Review of Systems');
      await user.type(fieldTextarea('Details, dates, treatment'), 'Fractured wrist 2023, healed');
      await saveSection(user, /save and next/i);

      // Identify each Observation by its screening identifier alone — one
      // patient in this test, so no subject filter is needed (and it avoids a
      // flaky empty-criteria Patient search).
      const byCode = async (code: string): Promise<string | undefined> => {
        const [obs] = await medplum.searchResources('Observation', {
          identifier: `${SCREENING_ID_SYSTEM}|${code}`,
        });
        return obs?.valueString;
      };

      expect(await byCode('Doctors/specialists managing chronic conditions')).toBe('Dr Chen (pulmonology)');
      expect(await byCode('Primary care provider')).toBe('Dr Patel');
      expect(await byCode('Chronic conditions: additional comments')).toBe('Asthma well controlled on inhaler');
      expect(await byCode('Injuries/trauma: details')).toBe('Fractured wrist 2023, healed');
    });
  });

  describe('free-text field persistence (task 19)', () => {
    // Same class of bug as task 18: disposition-notes, signoff-datetime, and
    // review-date were rendered in the JSX but read by no save handler, so the
    // nurse's input was silently discarded. Drives them through the UI and
    // asserts each one actually persisted as an Observation.
    test('disposition notes, signoff datetime, and review date are saved', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const user = userEvent.setup();
      await renderWizard(medplum);

      await goToStep(user, 'Diagnosis & Disposition');
      await user.type(fieldTextarea('Additional notes on referrals, logs, or records requested'), 'Referred to dental');
      // Date/datetime-local inputs are unreliable to type character-by-character
      // in jsdom, so set the value directly, same as a browser's native picker would.
      fireEvent.change(fieldInput('Date & time completed'), { target: { value: '2026-07-26T10:15' } });
      fireEvent.change(fieldInput('Review date'), { target: { value: '2026-08-15' } });
      await saveSection(user, /save diagnosis & disposition/i);

      const byCode = async (code: string): Promise<Resource | undefined> => {
        const [obs] = await medplum.searchResources('Observation', {
          identifier: `${SCREENING_ID_SYSTEM}|${code}`,
        });
        return obs;
      };

      // Note: the identifier code is 'Disposition: additional notes', not the
      // on-screen label — the label's commas would break the identifier search
      // (see escapeSearchToken's doc comment on AdmissionHealthScreeningWizard).
      const notes = await byCode('Disposition: additional notes');
      expect((notes as { valueString?: string })?.valueString).toBe('Referred to dental');

      const signoffDatetime = await byCode('Admission screening sign-off date/time');
      expect((signoffDatetime as { valueDateTime?: string })?.valueDateTime).toBe('2026-07-26T10:15');

      const reviewDate = await byCode('Admission screening review date');
      expect((reviewDate as { valueDateTime?: string })?.valueDateTime).toBe('2026-08-15');
    });
  });

  describe('free-text field persistence (task 21)', () => {
    // Found while implementing task 17 step 3: saveMentalStatus wrote
    // valueString: item instead of checkTextMap('appearance')[item] || item,
    // so "Other:"'s typed-in text on the Appearance & Mental Status grid was
    // silently discarded on save — the appearance grid was the only one of
    // the seven Other::text grids missing this read (race, allergy,
    // chronic-list, and the four ROS grids already had it).
    test('the Appearance grid\'s "Other" free text is saved, not just the checkbox', async () => {
      const medplum = new MockClient();
      medplum.mock.setProfile(DrAliceSmith);
      const user = userEvent.setup();
      await renderWizard(medplum);

      await goToStep(user, 'Current Health Status');
      const otherCheckbox = checkboxInCard('Appearance & mental status', 'Other');
      await user.click(otherCheckbox);
      await user.type(inlineTextInput(otherCheckbox), 'Flat affect');
      await saveSection(user, /save and next/i);

      const [obs] = await medplum.searchResources('Observation', {
        identifier: `${SCREENING_ID_SYSTEM}|Appearance/mental status finding::Other`,
      });
      expect((obs as { valueString?: string })?.valueString).toBe('Flat affect');
    });
  });
});
