// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import type { WithId } from '@medplum/core';
import type { Patient, Resource } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test } from 'vitest';
import { SCREENING_ID_SYSTEM } from '../pages/screeningData';
import { DjsPatientSummary } from './DjsPatientSummary';

function screeningId(value: string): { system: string; value: string }[] {
  return [{ system: SCREENING_ID_SYSTEM, value }];
}

async function renderSummary(medplum: MockClient, patient: WithId<Patient>): Promise<void> {
  await act(async () => {
    render(
      <MantineProvider>
        <MedplumProvider medplum={medplum}>
          <DjsPatientSummary patient={patient} />
        </MedplumProvider>
      </MantineProvider>
    );
  });
}

describe('DjsPatientSummary', () => {
  let medplum: MockClient;
  let patient: WithId<Patient>;
  let subject: { reference: string };

  beforeEach(async () => {
    medplum = new MockClient();
    patient = await medplum.createResource({ resourceType: 'Patient', name: [{ family: 'Doe' }] });
    subject = { reference: `Patient/${patient.id}` };
  });

  test('shows the empty state when the patient has no screening', async () => {
    await renderSummary(medplum, patient);
    await waitFor(() => expect(screen.getByText(/no admission screening on file/i)).toBeInTheDocument());
  });

  test('renders live vitals, allergies and medications', async () => {
    await medplum.createResource({
      resourceType: 'Observation',
      status: 'final',
      subject,
      identifier: screeningId('Body temperature'),
      code: { text: 'Body temperature' },
      valueQuantity: { value: 98.6, unit: '°F' },
    } as Resource);
    await medplum.createResource({
      resourceType: 'AllergyIntolerance',
      patient: subject,
      identifier: screeningId('allergy::Latex allergy'),
      clinicalStatus: { coding: [{ code: 'active' }] },
      code: { text: 'Latex allergy' },
    } as Resource);
    await medplum.createResource({
      resourceType: 'MedicationStatement',
      status: 'active',
      subject,
      identifier: screeningId('medication::Aspirin'),
      medicationCodeableConcept: { text: 'Aspirin' },
      dosage: [{ text: '81 mg daily' }],
    } as Resource);

    await renderSummary(medplum, patient);

    await waitFor(() => expect(screen.getByText(/98.6/)).toBeInTheDocument());
    expect(screen.getByText('Latex allergy')).toBeInTheDocument();
    expect(screen.getByText(/Aspirin — 81 mg daily/)).toBeInTheDocument();
  });

  test('does not show a retracted finding', async () => {
    await medplum.createResource({
      resourceType: 'AllergyIntolerance',
      patient: subject,
      identifier: screeningId('allergy::Latex allergy'),
      clinicalStatus: { coding: [{ code: 'active' }] },
      verificationStatus: {
        coding: [
          { system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: 'entered-in-error' },
        ],
      },
      code: { text: 'Latex allergy' },
    } as Resource);

    await renderSummary(medplum, patient);

    // The only screening resource is retracted, so the empty state stands and
    // the withdrawn allergy is nowhere on screen.
    await waitFor(() => expect(screen.getByText(/no admission screening on file/i)).toBeInTheDocument());
    expect(screen.queryByText('Latex allergy')).not.toBeInTheDocument();
  });
});
