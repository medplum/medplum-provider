// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { WithId } from '@medplum/core';
import type { Observation, Patient, Resource } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  bloodPressureFromObservation,
  bloodPressureText,
  buildBloodPressureComponents,
  buildDosage,
  dosageToFields,
  loadScreeningResources,
  parseDoseQuantity,
  SCREENING_ID_SYSTEM,
} from './screeningData';

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

describe('buildBloodPressureComponents (task 25)', () => {
  test('builds both components with LOINC codes and UCUM mm[Hg]', () => {
    const components = buildBloodPressureComponents('120', '80');
    expect(components).toEqual([
      {
        code: {
          coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic blood pressure' }],
          text: 'Systolic blood pressure',
        },
        valueQuantity: { value: 120, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
      },
      {
        code: {
          coding: [{ system: 'http://loinc.org', code: '8462-4', display: 'Diastolic blood pressure' }],
          text: 'Diastolic blood pressure',
        },
        valueQuantity: { value: 80, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' },
      },
    ]);
  });

  test('records a half-filled reading rather than discarding it', () => {
    expect(buildBloodPressureComponents('118', '')).toHaveLength(1);
    expect(buildBloodPressureComponents('', '76')).toHaveLength(1);
  });

  test('returns undefined when neither field has a number, so no empty Observation is written (ele-1)', () => {
    expect(buildBloodPressureComponents('', '')).toBeUndefined();
    expect(buildBloodPressureComponents(undefined, undefined)).toBeUndefined();
    expect(buildBloodPressureComponents('abc', 'def')).toBeUndefined();
  });
});

describe('bloodPressureFromObservation (task 25)', () => {
  test('round-trips what buildBloodPressureComponents wrote', () => {
    const component = buildBloodPressureComponents('120', '80');
    expect(bloodPressureFromObservation({ resourceType: 'Observation', status: 'final', component } as Observation)).toEqual(
      { systolic: '120', diastolic: '80' }
    );
  });

  test('parses a legacy "120/80" valueString, including odd spacing', () => {
    const legacy = (valueString: string): Observation =>
      ({ resourceType: 'Observation', status: 'final', valueString }) as Observation;
    expect(bloodPressureFromObservation(legacy('120/80'))).toEqual({ systolic: '120', diastolic: '80' });
    expect(bloodPressureFromObservation(legacy(' 118 / 76 '))).toEqual({ systolic: '118', diastolic: '76' });
  });

  test('returns empty for an unparseable string or a missing Observation', () => {
    expect(
      bloodPressureFromObservation({ resourceType: 'Observation', status: 'final', valueString: 'n/a' } as Observation)
    ).toEqual({});
    expect(bloodPressureFromObservation(undefined)).toEqual({});
  });
});

describe('bloodPressureText (task 25)', () => {
  test('formats a full reading and marks a missing half rather than faking it', () => {
    const full = { resourceType: 'Observation', status: 'final', component: buildBloodPressureComponents('120', '80') };
    expect(bloodPressureText(full as Observation)).toBe('120/80');

    const half = { resourceType: 'Observation', status: 'final', component: buildBloodPressureComponents('120', '') };
    expect(bloodPressureText(half as Observation)).toBe('120/—');
  });

  test('is empty when there is nothing recorded', () => {
    expect(bloodPressureText(undefined)).toBe('');
  });
});

describe('parseDoseQuantity', () => {
  test('splits a bare "<number> <unit>" dose', () => {
    expect(parseDoseQuantity('5 mg')).toEqual({ value: 5, unit: 'mg' });
    expect(parseDoseQuantity('2.5mg')).toEqual({ value: 2.5, unit: 'mg' });
  });

  test('returns undefined for shapes that are not a bare number+unit', () => {
    expect(parseDoseQuantity('1-2 tablets')).toBeUndefined();
    expect(parseDoseQuantity('as directed')).toBeUndefined();
    expect(parseDoseQuantity('')).toBeUndefined();
  });
});

describe('buildDosage (task 17 step 6 / Option A: structured dose + frequency, not one merged string)', () => {
  test('a recognized unit gets a coded doseQuantity (UCUM) plus separate timing', () => {
    const dosage = buildDosage('5 mg', 'twice daily');
    expect(dosage).toEqual({
      timing: { code: { text: 'twice daily' } },
      doseAndRate: [
        { doseQuantity: { value: 5, unit: 'mg', system: 'http://unitsofmeasure.org', code: 'mg' } },
      ],
    });
  });

  test('an unrecognized unit still saves as a Quantity, just without a coded system/code', () => {
    const dosage = buildDosage('2 puffs', undefined);
    expect(dosage).toEqual({ doseAndRate: [{ doseQuantity: { value: 2, unit: 'puffs' } }] });
  });

  test('a dose that is not "<number> <unit>" falls back to Dosage.text, independent of frequency', () => {
    const dosage = buildDosage('1-2 tablets', 'as needed');
    expect(dosage).toEqual({ text: '1-2 tablets', timing: { code: { text: 'as needed' } } });
  });

  test('frequency alone (no dose) is still recorded', () => {
    expect(buildDosage(undefined, 'nightly')).toEqual({ timing: { code: { text: 'nightly' } } });
  });

  test('nothing entered returns undefined rather than an empty Dosage (ele-1)', () => {
    expect(buildDosage(undefined, undefined)).toBeUndefined();
    expect(buildDosage('', '')).toBeUndefined();
  });
});

describe('dosageToFields (inverse of buildDosage)', () => {
  test('round-trips a coded dose + frequency', () => {
    expect(dosageToFields(buildDosage('5 mg', 'twice daily'))).toEqual({ dose: '5 mg', frequency: 'twice daily' });
  });

  test('round-trips an unrecognized-unit dose', () => {
    expect(dosageToFields(buildDosage('2 puffs', undefined))).toEqual({ dose: '2 puffs', frequency: undefined });
  });

  test('round-trips a fallback-text dose alongside its own separate frequency', () => {
    expect(dosageToFields(buildDosage('1-2 tablets', 'as needed'))).toEqual({
      dose: '1-2 tablets',
      frequency: 'as needed',
    });
  });

  test('returns an empty object for an undefined Dosage', () => {
    expect(dosageToFields(undefined)).toEqual({});
  });
});
