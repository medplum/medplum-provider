// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type {
  AllergyIntolerance,
  CarePlan,
  Condition,
  Observation,
  Patient,
} from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { hydrateScreeningForm } from './hydrateScreening';
import { SCREENING_ID_SYSTEM, type ScreeningResources } from './screeningData';

function empty(): ScreeningResources {
  return { observations: [], conditions: [], allergies: [], medications: [], carePlans: [], byKey: new Map() };
}

function obs(code: string, key: string, extra: Partial<Observation>): Observation {
  return {
    resourceType: 'Observation',
    status: 'final',
    code: { text: code },
    identifier: [{ system: SCREENING_ID_SYSTEM, value: key }],
    ...extra,
  } as Observation;
}

describe('hydrateScreeningForm', () => {
  test('maps core Patient fields into section-1 scalars', () => {
    const patient: Patient = {
      resourceType: 'Patient',
      name: [{ family: 'Doe', given: ['Jane', 'Q'] }],
      birthDate: '2008-05-01',
      gender: 'female',
    };

    const { scalars } = hydrateScreeningForm(empty(), patient);

    expect(scalars.lastName).toBe('Doe');
    expect(scalars.firstName).toBe('Jane');
    expect(scalars.middleInitial).toBe('Q');
    expect(scalars.dob).toBe('2008-05-01');
    expect(scalars.sex).toBe('female');
  });

  test('maps vitals observations to their scalar fields', () => {
    const data = empty();
    data.observations = [
      obs('Body temperature', 'Body temperature', { valueQuantity: { value: 98.6, unit: '°F' } }),
      obs('Heart rate', 'Heart rate', { valueQuantity: { value: 72, unit: '/min' } }),
      obs('Blood pressure', 'Blood pressure', { valueString: '120/80' }),
    ];

    const { scalars } = hydrateScreeningForm(data, undefined);

    expect(scalars.temp).toBe('98.6');
    expect(scalars.pulse).toBe('72');
    expect(scalars.bp).toBe('120/80');
  });

  test('maps pain with a score, and pain reported without one', () => {
    const scored = empty();
    scored.observations = [obs(
      'Pain severity - 0-10 verbal numeric rating',
      'Pain severity - 0-10 verbal numeric rating',
      { valueInteger: 4, note: [{ text: 'left knee' }] }
    )];
    const s1 = hydrateScreeningForm(scored, undefined).scalars;
    expect(s1.hasPain).toBe('yes');
    expect(s1.painScale).toBe(4);
    expect(s1.painDetail).toBe('left knee');

    const unscored = empty();
    unscored.observations = [obs(
      'Pain severity - 0-10 verbal numeric rating',
      'Pain severity - 0-10 verbal numeric rating',
      { dataAbsentReason: { text: 'Pain reported but no score recorded' } }
    )];
    const s2 = hydrateScreeningForm(unscored, undefined).scalars;
    // Reported, but painScale stays undefined — never coerced to 0.
    expect(s2.hasPain).toBe('yes');
    expect(s2.painScale).toBeUndefined();
  });

  test('maps checklist observations back into their grids by identifier suffix', () => {
    const data = empty();
    data.observations = [
      obs('Appearance/mental status finding', 'Appearance/mental status finding::Alert', { valueString: 'Alert' }),
      obs('Appearance/mental status finding', 'Appearance/mental status finding::Cooperative', {
        valueString: 'Cooperative',
      }),
      obs('Review of systems: Oral/dental', 'Review of systems: Oral/dental::Braces / retainer', {
        valueString: 'Braces / retainer',
      }),
    ];

    const { checks } = hydrateScreeningForm(data, undefined);

    expect(checks['appearance']).toEqual(['Alert', 'Cooperative']);
    expect(checks['dental']).toEqual(['Braces / retainer']);
  });

  test('maps allergies, chronic conditions and nursing diagnoses', () => {
    const data = empty();
    data.allergies = [
      {
        resourceType: 'AllergyIntolerance',
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'allergy::Latex allergy' }],
        code: { text: 'Latex allergy' },
        reaction: [{ description: 'hives' }],
      } as AllergyIntolerance,
    ];
    data.conditions = [
      {
        resourceType: 'Condition',
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'chronic::Asthma' }],
        code: { text: 'Asthma' },
      } as Condition,
      {
        resourceType: 'Condition',
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'nursing-diagnosis::dx1' }],
        code: { text: 'Risk for withdrawal' },
      } as Condition,
    ];

    const { checks, chips, texts } = hydrateScreeningForm(data, undefined);

    expect(checks['allergy']).toEqual(['Latex allergy']);
    expect(texts['allergy-reaction']).toBe('hives');
    expect(chips['chronic']).toBe('yes');
    expect(checks['chronic-list']).toEqual(['Asthma']);
    expect(texts['dx1']).toBe('Risk for withdrawal');
  });

  test('splits a CarePlan description back into nursing-plan checklist items', () => {
    const data = empty();
    data.carePlans = [
      {
        resourceType: 'CarePlan',
        status: 'active',
        intent: 'plan',
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'nursing-plan' }],
        description: 'DJS TB Screening Form initiated; Cleared for general population',
      } as CarePlan,
    ];

    const { checks } = hydrateScreeningForm(data, undefined);

    expect(checks['nursing-plan']).toEqual([
      'DJS TB Screening Form initiated',
      'Cleared for general population',
    ]);
  });

  test('parses the combined "Last vision exam" string back into its two fields', () => {
    const data = empty();
    data.observations = [
      obs('Last vision exam', 'Last vision exam', { valueString: 'Date: 2025-01-02, provider: Dr Smith' }),
    ];

    const { texts } = hydrateScreeningForm(data, undefined);

    expect(texts['vision-exam-date']).toBe('2025-01-02');
    expect(texts['vision-provider']).toBe('Dr Smith');
  });

  test('maps the task-18/19 single-value free-text fields into their text keys', () => {
    const data = empty();
    data.observations = [
      obs(
        'Doctors/specialists managing chronic conditions',
        'Doctors/specialists managing chronic conditions',
        { valueString: 'Dr Chen (pulmonology)' }
      ),
      obs('Primary care provider', 'Primary care provider', { valueString: 'Dr Patel' }),
      obs('Chronic conditions: additional comments', 'Chronic conditions: additional comments', {
        valueString: 'Asthma well controlled on inhaler',
      }),
      obs('Injuries/trauma: details', 'Injuries/trauma: details', {
        valueString: 'Fractured wrist 2023, healed',
      }),
      obs('Disposition: additional notes', 'Disposition: additional notes', {
        valueString: 'Referred to dental',
      }),
      // These two use valueDateTime, not valueString — textOrDateTime must read
      // the right one without the mapping needing to know which per field.
      obs('Admission screening sign-off date/time', 'Admission screening sign-off date/time', {
        valueDateTime: '2026-07-26T10:15',
      }),
      obs('Admission screening review date', 'Admission screening review date', {
        valueDateTime: '2026-08-15',
      }),
    ];

    const { texts } = hydrateScreeningForm(data, undefined);

    expect(texts['chronic-providers']).toBe('Dr Chen (pulmonology)');
    expect(texts['chronic-pcp']).toBe('Dr Patel');
    expect(texts['chronic-comments']).toBe('Asthma well controlled on inhaler');
    expect(texts['injuries-detail']).toBe('Fractured wrist 2023, healed');
    expect(texts['disposition-notes']).toBe('Referred to dental');
    expect(texts['signoff-datetime']).toBe('2026-07-26T10:15');
    expect(texts['review-date']).toBe('2026-08-15');
  });

  test('returns empty structures for a patient with nothing on file', () => {
    const result = hydrateScreeningForm(empty(), undefined);
    expect(result.scalars).toEqual({});
    expect(result.texts).toEqual({});
    expect(result.chips).toEqual({});
    expect(result.checks).toEqual({});
    expect(result.checkTexts).toEqual({});
  });

  describe('"Other:" free text (task 17 step 3)', () => {
    // The save side writes valueString/code.text as checkTextMap(grid)[item]
    // || item — the typed free text if there is one, else the item's own
    // name unchanged. So a stored value that differs from the item name IS
    // the free text; equal to it means none was typed. Covers all four grids
    // that carry this convention through an Observation (appearance + the
    // three ROS grids share one code path in hydrateScreening.ts) plus the
    // two that carry it through a resource's own `code.text` instead
    // (allergy, chronic-list).
    test('recovers free text on a checklist Observation ("Other" on appearance)', () => {
      const data = empty();
      data.observations = [
        obs('Appearance/mental status finding', 'Appearance/mental status finding::Other', {
          valueString: 'Flat affect',
        }),
      ];

      const { checks, checkTexts } = hydrateScreeningForm(data, undefined);

      expect(checks['appearance']).toEqual(['Other']);
      expect(checkTexts['appearance']).toEqual({ Other: 'Flat affect' });
    });

    test('does not record free text when the stored value equals the item name (nothing was typed)', () => {
      const data = empty();
      data.observations = [
        obs('Appearance/mental status finding', 'Appearance/mental status finding::Alert', {
          valueString: 'Alert',
        }),
      ];

      const { checkTexts } = hydrateScreeningForm(data, undefined);

      expect(checkTexts['appearance']).toBeUndefined();
    });

    test('recovers free text on an allergy ("Other" via AllergyIntolerance.code.text)', () => {
      const data = empty();
      data.allergies = [
        {
          resourceType: 'AllergyIntolerance',
          identifier: [{ system: SCREENING_ID_SYSTEM, value: 'allergy::Other' }],
          code: { text: 'Bee stings' },
        } as AllergyIntolerance,
      ];

      const { checks, checkTexts } = hydrateScreeningForm(data, undefined);

      expect(checks['allergy']).toEqual(['Other']);
      expect(checkTexts['allergy']).toEqual({ Other: 'Bee stings' });
    });

    test('recovers free text on a chronic condition ("Other" via Condition.code.text)', () => {
      const data = empty();
      data.conditions = [
        {
          resourceType: 'Condition',
          identifier: [{ system: SCREENING_ID_SYSTEM, value: 'chronic::Other' }],
          code: { text: 'Ehlers-Danlos syndrome' },
        } as Condition,
      ];

      const { checks, checkTexts } = hydrateScreeningForm(data, undefined);

      expect(checks['chronic-list']).toEqual(['Other']);
      expect(checkTexts['chronic-list']).toEqual({ Other: 'Ehlers-Danlos syndrome' });
    });
  });
});
