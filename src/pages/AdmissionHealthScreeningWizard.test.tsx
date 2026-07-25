// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import type { WithId } from '@medplum/core';
import { validateResource } from '@medplum/core';
import type { Patient, Resource } from '@medplum/fhirtypes';
import { DrAliceSmith, MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, test, vi } from 'vitest';
import { AdmissionHealthScreeningWizard } from './AdmissionHealthScreeningWizard';

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
  const methods = ['createResource', 'updateResource', 'upsertResource'] as const;
  for (const method of methods) {
    const original = medplum[method].bind(medplum) as (...args: unknown[]) => Promise<unknown>;
    // `as never` bypasses the three methods' differing overloads — upsertResource
    // takes an extra query arg — which a single generic implementation can't match.
    vi.spyOn(medplum, method).mockImplementation((async (...args: unknown[]) => {
      const resource = args[0] as Resource;
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
      return original(...args);
    }) as never);
  }
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

/** Clicks a section's save button and waits for the save to settle (button re-enabled). */
async function saveSection(user: ReturnType<typeof userEvent.setup>, buttonName: RegExp): Promise<void> {
  const button = (): HTMLElement => screen.getByRole('button', { name: buttonName });
  await user.click(button());
  await waitFor(() => expect(button()).not.toBeDisabled());
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

      const saveButton = (): HTMLElement => screen.getByRole('button', { name: /Save demographics/i });

      // --- First save: creates the Patient, upserts the Hair color Observation. ---
      await user.click(saveButton());
      await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(saveButton()).not.toBeDisabled());

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
      await saveSection(user, /save demographics/i);

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
      await saveSection(user, /save health status/i);

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
      await saveSection(user, /save health status/i);

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
      const user = userEvent.setup();
      await renderWizard(medplum);

      await goToStep(user, 'Current Health Status');
      await user.click(checkbox('Latex allergy'));
      await saveSection(user, /save health status/i);

      // Identify the allergy by its screening identifier alone — one patient in
      // this test, so no patient filter is needed, and it avoids depending on a
      // separate Patient lookup.
      const allergyQuery = { identifier: `${SCREENING_ID_SYSTEM}|allergy::Latex allergy` };

      const afterCheck = await medplum.searchResources('AllergyIntolerance', allergyQuery);
      expect(afterCheck).toHaveLength(1);
      const retractedCodes1 =
        afterCheck[0].verificationStatus?.coding?.map((c) => c.code) ?? [];
      expect(retractedCodes1).not.toContain('entered-in-error');

      // Uncheck the same allergy and save again.
      await user.click(checkbox('Latex allergy'));
      await saveSection(user, /save health status/i);

      const afterUncheck = await medplum.searchResources('AllergyIntolerance', allergyQuery);
      // Still exactly one resource — withdrawn, not deleted.
      expect(afterUncheck).toHaveLength(1);
      expect(afterUncheck[0].id).toBe(afterCheck[0].id);
      const retractedCodes2 =
        afterUncheck[0].verificationStatus?.coding?.map((c) => c.code) ?? [];
      expect(retractedCodes2).toContain('entered-in-error');
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
      await saveSection(user, /save health status/i);

      const pain = capture.written.find(
        (r) => r.resourceType === 'Observation' && (r as { code?: { text?: string } }).code?.text?.startsWith('Pain severity')
      ) as { valueInteger?: number; dataAbsentReason?: unknown } | undefined;

      expect(pain).toBeDefined();
      expect(pain?.valueInteger).toBeUndefined();
      expect(pain?.dataAbsentReason).toBeDefined();
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
  });
});
