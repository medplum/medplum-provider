// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import type { WithId } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
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
});
