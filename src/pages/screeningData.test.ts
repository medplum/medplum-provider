// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { WithId } from '@medplum/core';
import type { Patient, Resource } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeEach, describe, expect, test } from 'vitest';
import { loadScreeningResources, SCREENING_ID_SYSTEM } from './screeningData';

function screeningId(value: string): { system: string; value: string }[] {
  return [{ system: SCREENING_ID_SYSTEM, value }];
}

describe('loadScreeningResources', () => {
  let medplum: MockClient;
  let patient: WithId<Patient>;
  let subject: { reference: string };

  beforeEach(async () => {
    medplum = new MockClient();
    patient = await medplum.createResource({ resourceType: 'Patient', name: [{ family: 'Doe' }] });
    subject = { reference: `Patient/${patient.id}` };
  });

  test('groups live screening resources by type', async () => {
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
    } as Resource);

    const data = await loadScreeningResources(medplum, patient.id);

    expect(data.observations).toHaveLength(1);
    expect(data.allergies).toHaveLength(1);
    expect(data.medications).toHaveLength(1);
    expect(data.byKey.get('Body temperature')?.resourceType).toBe('Observation');
    expect(data.byKey.get('allergy::Latex allergy')?.resourceType).toBe('AllergyIntolerance');
  });

  test('excludes retracted resources — a withdrawn finding must not surface', async () => {
    // Observation withdrawn via status.
    await medplum.createResource({
      resourceType: 'Observation',
      status: 'entered-in-error',
      subject,
      identifier: screeningId('Heart rate'),
      code: { text: 'Heart rate' },
      valueQuantity: { value: 70, unit: '/min' },
    } as Resource);
    // AllergyIntolerance withdrawn via verificationStatus.
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

    const data = await loadScreeningResources(medplum, patient.id);

    expect(data.observations).toHaveLength(0);
    expect(data.allergies).toHaveLength(0);
    expect(data.byKey.size).toBe(0);
  });

  test('collapses legacy duplicates to the most recently updated', async () => {
    // Two Observations under one key, as the pre-0e8f04b duplicate bug produced.
    await medplum.createResource({
      resourceType: 'Observation',
      status: 'final',
      subject,
      identifier: screeningId('Body weight'),
      code: { text: 'Body weight' },
      valueQuantity: { value: 100, unit: 'lb' },
      meta: { lastUpdated: '2026-07-01T00:00:00.000Z' },
    } as Resource);
    await medplum.createResource({
      resourceType: 'Observation',
      status: 'final',
      subject,
      identifier: screeningId('Body weight'),
      code: { text: 'Body weight' },
      valueQuantity: { value: 150, unit: 'lb' },
      meta: { lastUpdated: '2026-07-24T00:00:00.000Z' },
    } as Resource);

    const data = await loadScreeningResources(medplum, patient.id);

    expect(data.observations).toHaveLength(1);
    expect(data.observations[0].valueQuantity?.value).toBe(150);
  });

  test('ignores resources without a screening identifier', async () => {
    // A plain clinical Observation on the same patient, not from the wizard.
    await medplum.createResource({
      resourceType: 'Observation',
      status: 'final',
      subject,
      code: { text: 'Some unrelated observation' },
      valueString: 'x',
    } as Resource);

    const data = await loadScreeningResources(medplum, patient.id);

    expect(data.observations).toHaveLength(0);
  });

  test('returns empty groups for a patient with no screening on file', async () => {
    const data = await loadScreeningResources(medplum, patient.id);

    expect(data.observations).toEqual([]);
    expect(data.conditions).toEqual([]);
    expect(data.allergies).toEqual([]);
    expect(data.medications).toEqual([]);
    expect(data.carePlans).toEqual([]);
    expect(data.byKey.size).toBe(0);
  });
});
