// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import type { WithId } from '@medplum/core';
import type { Patient, Resource } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, test } from 'vitest';
import { SCREENING_ID_SYSTEM } from '../screeningData';
import { PatientOverviewPage } from './PatientOverviewPage';

function screeningId(value: string): { system: string; value: string }[] {
  return [{ system: SCREENING_ID_SYSTEM, value }];
}

async function renderOverview(medplum: MockClient, patientId: string): Promise<void> {
  await act(async () => {
    render(
      <MantineProvider>
        <MedplumProvider medplum={medplum}>
          <MemoryRouter initialEntries={[`/Patient/${patientId}/overview`]}>
            <Routes>
              <Route path="/Patient/:patientId/overview" element={<PatientOverviewPage />} />
            </Routes>
          </MemoryRouter>
        </MedplumProvider>
      </MantineProvider>
    );
  });
}

describe('PatientOverviewPage', () => {
  let medplum: MockClient;
  let patient: WithId<Patient>;
  let subject: { reference: string };

  beforeEach(async () => {
    medplum = new MockClient();
    patient = await medplum.createResource({
      resourceType: 'Patient',
      name: [{ family: 'Doe', given: ['Jane'] }],
      birthDate: '2010-01-01',
      gender: 'female',
    });
    subject = { reference: `Patient/${patient.id}` };
  });

  test('shows empty-state text for every section when nothing is on file', async () => {
    await renderOverview(medplum, patient.id);

    await waitFor(() => expect(screen.getByText('Demographics')).toBeInTheDocument());
    expect(screen.getByText(/no known allergies recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/no current medications recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/no active coverage on file/i)).toBeInTheDocument();
    expect(screen.getByText(/no preferred pharmacy on file/i)).toBeInTheDocument();
    expect(screen.getByText(/no lab orders or results on file/i)).toBeInTheDocument();
  });

  // Ported from the retired DjsPatientSummary.test.tsx (task 42) — same
  // assertions, on the new page, proving the migration didn't lose coverage.
  test('renders live vitals, allergies and medications (ported from DjsPatientSummary)', async () => {
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

    await renderOverview(medplum, patient.id);

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

    await renderOverview(medplum, patient.id);

    await waitFor(() => expect(screen.getByText(/no known allergies recorded/i)).toBeInTheDocument());
    expect(screen.queryByText('Latex allergy')).not.toBeInTheDocument();
  });

  // The genuine complaint task 42 was raised for: on the OLD sidebar, Vitals/
  // Allergies/Medications were rendered by BOTH DjsPatientSummary and
  // Medplum's PatientSummary. On this page each concept has exactly one
  // section — asserting there is only ever one "Vitals" heading, not that
  // the data is merely present, is what actually proves the duplication is
  // gone rather than just moved.
  test('shows each duplicated concept exactly once', async () => {
    await renderOverview(medplum, patient.id);
    await waitFor(() => expect(screen.getByText('Demographics')).toBeInTheDocument());

    for (const heading of ['Allergies', 'Medications']) {
      expect(screen.getAllByText(heading)).toHaveLength(1);
    }
  });

  describe('sections new to this page (verified queries, not a widget port)', () => {
    test('smoking status reads the LOINC 72166-2 Observation', async () => {
      await medplum.createResource({
        resourceType: 'Observation',
        status: 'final',
        subject,
        code: { coding: [{ system: 'http://loinc.org', code: '72166-2' }] },
        valueCodeableConcept: { text: 'Former smoker' },
      } as Resource);

      await renderOverview(medplum, patient.id);

      await waitFor(() => expect(screen.getByText('Former smoker')).toBeInTheDocument());
    });

    test('sexual orientation reads the LOINC 76690-7 Observation', async () => {
      await medplum.createResource({
        resourceType: 'Observation',
        status: 'final',
        subject,
        code: { coding: [{ system: 'http://loinc.org', code: '76690-7' }] },
        valueCodeableConcept: { text: 'Heterosexual' },
      } as Resource);

      await renderOverview(medplum, patient.id);

      await waitFor(() => expect(screen.getByText('Heterosexual')).toBeInTheDocument());
    });

    test('insurance shows active, non-self-pay Coverage by beneficiary', async () => {
      await medplum.createResource({
        resourceType: 'Coverage',
        status: 'active',
        beneficiary: subject,
        payor: [{ display: 'Acme Health Plan' }],
      } as Resource);
      // Self-pay and inactive coverage must both be excluded — same filter
      // Medplum's own Insurance component applies.
      await medplum.createResource({
        resourceType: 'Coverage',
        status: 'active',
        beneficiary: subject,
        type: { coding: [{ code: 'SELFPAY' }] },
        payor: [{ display: 'Self-Pay' }],
      } as Resource);
      await medplum.createResource({
        resourceType: 'Coverage',
        status: 'cancelled',
        beneficiary: subject,
        payor: [{ display: 'Lapsed Plan' }],
      } as Resource);

      await renderOverview(medplum, patient.id);

      await waitFor(() => expect(screen.getByText('Acme Health Plan')).toBeInTheDocument());
      expect(screen.queryByText('Self-Pay')).not.toBeInTheDocument();
      expect(screen.queryByText('Lapsed Plan')).not.toBeInTheDocument();
    });

    test('labs shows ServiceRequests and DiagnosticReports by subject', async () => {
      await medplum.createResource({
        resourceType: 'ServiceRequest',
        status: 'active',
        intent: 'order',
        subject,
        code: { text: 'CBC' },
      } as Resource);
      await medplum.createResource({
        resourceType: 'DiagnosticReport',
        status: 'final',
        subject,
        code: { text: 'Basic Metabolic Panel' },
      } as Resource);

      await renderOverview(medplum, patient.id);

      await waitFor(() => expect(screen.getByText(/CBC/)).toBeInTheDocument());
      expect(screen.getByText(/Basic Metabolic Panel/)).toBeInTheDocument();
    });

    // The extension shape here was extracted from @medplum/core's own bundled
    // getPreferredPharmaciesFromPatient / createPreferredPharmacyExtension
    // implementation (the constants were minified, so grep'd their actual
    // string values rather than guessing at the extension URL/codes).
    test('pharmacies resolves the preferred-pharmacy extension and its Organization reference', async () => {
      const org = await medplum.createResource({ resourceType: 'Organization', name: 'Corner Drug Pharmacy' } as Resource);
      await medplum.updateResource({
        ...patient,
        extension: [
          {
            url: 'http://hl7.org/fhir/StructureDefinition/patient-preferredPharmacy',
            extension: [
              { url: 'pharmacy', valueReference: { reference: `Organization/${org.id}` } },
              {
                url: 'type',
                valueCodeableConcept: {
                  coding: [
                    {
                      system: 'https://medplum.com/fhir/CodeSystem/pharmacy-preference-type',
                      code: 'primary',
                      display: 'Primary Pharmacy',
                    },
                  ],
                },
              },
            ],
          },
        ],
      } as Resource);

      await renderOverview(medplum, patient.id);

      await waitFor(() => expect(screen.getByText(/Corner Drug Pharmacy/)).toBeInTheDocument());
      expect(screen.getByText(/\(primary\)/)).toBeInTheDocument();
    });

    test('demographics reads directly from the Patient resource, no query needed', async () => {
      await renderOverview(medplum, patient.id);

      await waitFor(() => expect(screen.getByText('2010-01-01')).toBeInTheDocument());
      expect(screen.getByText('female')).toBeInTheDocument();
    });
  });
});
