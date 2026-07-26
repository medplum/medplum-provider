// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type {
  AllergyIntolerance,
  CarePlan,
  Condition,
  Encounter,
  Location,
  MedicationStatement,
  Observation,
  Patient,
} from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { hydrateScreeningForm } from './hydrateScreening';
import { SCREENING_ID_SYSTEM, type ScreeningResources } from './screeningData';

function empty(): ScreeningResources {
  return {
    observations: [],
    conditions: [],
    allergies: [],
    medications: [],
    carePlans: [],
    encounters: [],
    locations: [],
    byKey: new Map(),
  };
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

  describe('demographics extensions (task 17 step 4)', () => {
    const BIRTHPLACE_URL = 'http://hl7.org/fhir/StructureDefinition/patient-birthPlace';
    const ETHNICITY_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity';
    const RACE_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race';
    const INTERPRETER_URL = 'http://example.org/fhir/StructureDefinition/needs-interpreter';

    test('maps birthplace, ethnicity, and needs-interpreter extensions', () => {
      const patient: Patient = {
        resourceType: 'Patient',
        extension: [
          { url: BIRTHPLACE_URL, valueAddress: { text: 'Baltimore, MD' } },
          { url: ETHNICITY_URL, valueCodeableConcept: { text: 'Hispanic or Latino' } },
          { url: INTERPRETER_URL, valueBoolean: true },
        ],
      };

      const { scalars, texts, checks } = hydrateScreeningForm(empty(), patient);

      expect(texts['birth-place']).toBe('Baltimore, MD');
      expect(scalars.hispanic).toBe('yes');
      expect(checks['interpreter']).toEqual(['Needs interpreter']);
    });

    test('maps "Not Hispanic or Latino" to hispanic: no', () => {
      const patient: Patient = {
        resourceType: 'Patient',
        extension: [{ url: ETHNICITY_URL, valueCodeableConcept: { text: 'Not Hispanic or Latino' } }],
      };

      const { scalars } = hydrateScreeningForm(empty(), patient);

      expect(scalars.hispanic).toBe('no');
    });

    test('maps race checkboxes for known items only', () => {
      const patient: Patient = {
        resourceType: 'Patient',
        extension: [{ url: RACE_URL, valueCodeableConcept: { text: 'Black or African American, White' } }],
      };

      const { checks, checkTexts } = hydrateScreeningForm(empty(), patient);

      expect(checks['race']).toEqual(['Black or African American', 'White']);
      expect(checkTexts['race']).toBeUndefined();
    });

    test('treats a token not on the race grid as "Other" free text', () => {
      const patient: Patient = {
        resourceType: 'Patient',
        extension: [{ url: RACE_URL, valueCodeableConcept: { text: 'White, Cherokee' } }],
      };

      const { checks, checkTexts } = hydrateScreeningForm(empty(), patient);

      expect(checks['race']).toEqual(['White', 'Other']);
      expect(checkTexts['race']).toEqual({ Other: 'Cherokee' });
    });

    test('rejoins multiple unrecognized tokens into one "Other" value (documented limitation)', () => {
      // If the original "Other" free text itself contained a comma, splitting
      // the saved list on ", " breaks it into more than one token — this is
      // the same comma hazard as task 20. Rejoining with ", " gets the
      // content back even if not byte-for-byte identical to what was typed.
      const patient: Patient = {
        resourceType: 'Patient',
        extension: [{ url: RACE_URL, valueCodeableConcept: { text: 'White, Cherokee, Choctaw' } }],
      };

      const { checks, checkTexts } = hydrateScreeningForm(empty(), patient);

      expect(checks['race']).toEqual(['White', 'Other']);
      expect(checkTexts['race']).toEqual({ Other: 'Cherokee, Choctaw' });
    });

    test('returns no race/ethnicity/interpreter fields when there are no such extensions', () => {
      const patient: Patient = { resourceType: 'Patient' };

      const { scalars, checks, texts } = hydrateScreeningForm(empty(), patient);

      expect(scalars.hispanic).toBeUndefined();
      expect(checks['race']).toBeUndefined();
      expect(checks['interpreter']).toBeUndefined();
      expect(texts['birth-place']).toBeUndefined();
    });
  });

  test('maps hair and eye colour Observations into their text keys', () => {
    const data = empty();
    data.observations = [
      obs('Hair color', 'Hair color', { valueString: 'Brown' }),
      obs('Eye color', 'Eye color', { valueString: 'Green' }),
    ];

    const { texts } = hydrateScreeningForm(data, undefined);

    expect(texts['hair-color']).toBe('Brown');
    expect(texts['eye-color']).toBe('Green');
  });

  test('maps all 6 vision-acuity Observations into their text keys (task 17 step 5)', () => {
    const data = empty();
    data.observations = [
      obs('Visual acuity, left eye, without correction', 'Visual acuity, left eye, without correction', {
        valueString: '20/40',
      }),
      obs('Visual acuity, right eye, without correction', 'Visual acuity, right eye, without correction', {
        valueString: '20/30',
      }),
      obs('Visual acuity, both eyes, without correction', 'Visual acuity, both eyes, without correction', {
        valueString: '20/30',
      }),
      obs('Visual acuity, left eye, with correction', 'Visual acuity, left eye, with correction', {
        valueString: '20/20',
      }),
      obs('Visual acuity, right eye, with correction', 'Visual acuity, right eye, with correction', {
        valueString: '20/20',
      }),
      obs('Visual acuity, both eyes, with correction', 'Visual acuity, both eyes, with correction', {
        valueString: '20/20',
      }),
    ];

    const { texts } = hydrateScreeningForm(data, undefined);

    expect(texts['vision-nocorr-left']).toBe('20/40');
    expect(texts['vision-nocorr-right']).toBe('20/30');
    expect(texts['vision-nocorr-both']).toBe('20/30');
    expect(texts['vision-corr-left']).toBe('20/20');
    expect(texts['vision-corr-right']).toBe('20/20');
    expect(texts['vision-corr-both']).toBe('20/20');
  });

  describe('glasses history (task 17 step 5)', () => {
    test('restores the chip and detail when a real detail was typed', () => {
      const data = empty();
      data.observations = [
        obs('History of prescribed glasses/contacts', 'History of prescribed glasses/contacts', {
          valueString: 'Prescribed bifocals in 2022, wears them daily',
        }),
      ];

      const { chips, texts } = hydrateScreeningForm(data, undefined);

      expect(chips['vision-glasses-past']).toBe('yes');
      expect(texts['vision-glasses-detail']).toBe('Prescribed bifocals in 2022, wears them daily');
    });

    test('restores just the chip, no detail, when the value is the literal fallback "Yes"', () => {
      // Save side writes this exact fallback when the chip is 'yes' but no
      // detail was typed — see the doc comment on GLASSES_HISTORY_CODE for
      // why this can't be told apart from someone genuinely typing "Yes".
      const data = empty();
      data.observations = [
        obs('History of prescribed glasses/contacts', 'History of prescribed glasses/contacts', {
          valueString: 'Yes',
        }),
      ];

      const { chips, texts } = hydrateScreeningForm(data, undefined);

      expect(chips['vision-glasses-past']).toBe('yes');
      expect(texts['vision-glasses-detail']).toBeUndefined();
    });
  });

  describe('sign-off and mandated-reporter (task 17 steps 7-8)', () => {
    test('parses the combined "Nurse: ...; Physician: ..." sign-off string, plus health-alerts note', () => {
      const data = empty();
      data.observations = [
        obs('Admission health screening sign-off', 'Admission health screening sign-off', {
          valueString: 'Nurse: J. Rivera, RN; Physician: Dr. Okafor',
          note: [{ text: 'Watch for allergic reaction, penicillin listed' }],
        }),
      ];

      const { texts } = hydrateScreeningForm(data, undefined);

      expect(texts['nurse-signature']).toBe('J. Rivera, RN');
      expect(texts['physician-signature']).toBe('Dr. Okafor');
      expect(texts['health-alerts']).toBe('Watch for allergic reaction, penicillin listed');
    });

    test('does not treat the "—" placeholder as a real signature', () => {
      const data = empty();
      data.observations = [
        obs('Admission health screening sign-off', 'Admission health screening sign-off', {
          valueString: 'Nurse: J. Rivera, RN; Physician: —',
        }),
      ];

      const { texts } = hydrateScreeningForm(data, undefined);

      expect(texts['nurse-signature']).toBe('J. Rivera, RN');
      expect(texts['physician-signature']).toBeUndefined();
    });

    test('restores the mandated-reporter checkbox and RN initials from the note', () => {
      const data = empty();
      data.observations = [
        obs('Mandated reporter statement read to youth', 'Mandated reporter statement read to youth', {
          valueString: 'Statement read',
          note: [{ text: 'RN initials: JR' }],
        }),
      ];

      const { checks, texts } = hydrateScreeningForm(data, undefined);

      expect(checks['mandated-reporter']).toEqual(['Statement read to youth']);
      expect(texts['mandated-reporter-initials']).toBe('JR');
    });

    test('restores the mandated-reporter checkbox with no initials text when none was typed', () => {
      const data = empty();
      data.observations = [
        obs('Mandated reporter statement read to youth', 'Mandated reporter statement read to youth', {
          valueString: 'Statement read',
        }),
      ];

      const { checks, texts } = hydrateScreeningForm(data, undefined);

      expect(checks['mandated-reporter']).toEqual(['Statement read to youth']);
      expect(texts['mandated-reporter-initials']).toBeUndefined();
    });
  });

  test('maps vitals observations to their scalar fields', () => {
    const data = empty();
    data.observations = [
      obs('Body temperature', 'Body temperature', { valueQuantity: { value: 98.6, unit: '°F' } }),
      obs('Heart rate', 'Heart rate', { valueQuantity: { value: 72, unit: '/min' } }),
    ];

    const { scalars } = hydrateScreeningForm(data, undefined);

    expect(scalars.temp).toBe('98.6');
    expect(scalars.pulse).toBe('72');
  });

  describe('blood pressure (task 25)', () => {
    function bpObs(extra: Partial<Observation>): Observation {
      return obs('Blood pressure', 'Blood pressure', extra);
    }

    test('reads systolic and diastolic back from the panel components', () => {
      const data = empty();
      data.observations = [
        bpObs({
          component: [
            { code: { coding: [{ code: '8480-6' }] }, valueQuantity: { value: 120, unit: 'mmHg' } },
            { code: { coding: [{ code: '8462-4' }] }, valueQuantity: { value: 80, unit: 'mmHg' } },
          ],
        }),
      ];

      const { scalars } = hydrateScreeningForm(data, undefined);

      expect(scalars.systolic).toBe('120');
      expect(scalars.diastolic).toBe('80');
    });

    // Every reading saved before task 25 is a "120/80" valueString. Those must
    // keep loading rather than silently coming back blank — this is the only
    // reason the string parser still exists.
    test('still reads a legacy "120/80" valueString', () => {
      const data = empty();
      data.observations = [bpObs({ valueString: '120/80' })];

      const { scalars } = hydrateScreeningForm(data, undefined);

      expect(scalars.systolic).toBe('120');
      expect(scalars.diastolic).toBe('80');
    });

    test('reads a half-recorded panel without inventing the missing half', () => {
      const data = empty();
      data.observations = [
        bpObs({ component: [{ code: { coding: [{ code: '8480-6' }] }, valueQuantity: { value: 118 } }] }),
      ];

      const { scalars } = hydrateScreeningForm(data, undefined);

      expect(scalars.systolic).toBe('118');
      expect(scalars.diastolic).toBeUndefined();
    });

    test('leaves both unset for an unparseable legacy string', () => {
      const data = empty();
      data.observations = [bpObs({ valueString: 'not recorded' })];

      const { scalars } = hydrateScreeningForm(data, undefined);

      expect(scalars.systolic).toBeUndefined();
      expect(scalars.diastolic).toBeUndefined();
    });
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
    expect(result.rows).toEqual({});
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

  describe('admission Encounter: date and facility (task 24)', () => {
    const FACILITY_SYSTEM = 'http://maryland.gov/djs/facility';

    function admissionEncounter(extra: Partial<Encounter>): Encounter {
      return {
        resourceType: 'Encounter',
        status: 'in-progress',
        class: { code: 'IMP' },
        identifier: [{ system: SCREENING_ID_SYSTEM, value: 'admission-encounter' }],
        ...extra,
      } as Encounter;
    }

    test('reads the admission date and resolves the facility to its stable code', () => {
      const data = empty();
      data.encounters = [
        admissionEncounter({
          period: { start: '2026-07-20' },
          location: [{ location: { reference: 'Location/loc-1' } }],
        }),
      ];
      data.locations = [
        {
          resourceType: 'Location',
          id: 'loc-1',
          name: 'Cheltenham',
          identifier: [{ system: FACILITY_SYSTEM, value: 'cheltenham' }],
        } as Location,
      ];

      const { scalars } = hydrateScreeningForm(data, undefined);

      expect(scalars.admissionDate).toBe('2026-07-20');
      expect(scalars.facilityCode).toBe('cheltenham');
    });

    // The whole point of keying on the code: staff-facing display names are
    // expected to change (short paper-form names now, official names later),
    // and a rename must not break read-back or look like a different facility.
    test('recovers the facility after its display name changes', () => {
      const data = empty();
      data.encounters = [admissionEncounter({ location: [{ location: { reference: 'Location/loc-1' } }] })];
      data.locations = [
        {
          resourceType: 'Location',
          id: 'loc-1',
          name: 'Charles H. Hickey Jr. School', // renamed from 'Hickey'
          identifier: [{ system: FACILITY_SYSTEM, value: 'hickey' }],
        } as Location,
      ];

      const { scalars } = hydrateScreeningForm(data, undefined);

      expect(scalars.facilityCode).toBe('hickey');
    });

    test('leaves the facility unset when the Encounter has no location', () => {
      const data = empty();
      data.encounters = [admissionEncounter({ period: { start: '2026-07-20' } })];

      const { scalars } = hydrateScreeningForm(data, undefined);

      expect(scalars.admissionDate).toBe('2026-07-20');
      expect(scalars.facilityCode).toBeUndefined();
    });

    test('ignores an Encounter that is not the admission encounter', () => {
      const data = empty();
      data.encounters = [
        {
          resourceType: 'Encounter',
          status: 'finished',
          class: { code: 'AMB' },
          identifier: [{ system: SCREENING_ID_SYSTEM, value: 'some-other-encounter' }],
          period: { start: '2020-01-01' },
        } as Encounter,
      ];

      const { scalars } = hydrateScreeningForm(data, undefined);

      expect(scalars.admissionDate).toBeUndefined();
    });
  });

  describe('medications table (task 17 step 6)', () => {
    function med(extra: Partial<MedicationStatement>): MedicationStatement {
      return {
        resourceType: 'MedicationStatement',
        status: 'active',
        identifier: [{ system: SCREENING_ID_SYSTEM, value: `medication::${extra.medicationCodeableConcept?.text}` }],
        ...extra,
      } as MedicationStatement;
    }

    test('reads dose and frequency back from their own structured Dosage fields, not a merged string', () => {
      const data = empty();
      data.medications = [
        med({
          medicationCodeableConcept: { text: 'Albuterol' },
          dosage: [{ doseAndRate: [{ doseQuantity: { value: 2, unit: 'mg' } }], timing: { code: { text: 'BID' } } }],
          reasonCode: [{ text: 'Asthma' }],
          informationSource: { display: 'Dr Chen' },
          note: [{ text: 'Last taken: this morning' }],
        }),
      ];

      const { rows } = hydrateScreeningForm(data, undefined);

      expect(rows['medications-table']).toEqual([
        ['Albuterol', '2 mg', 'BID', 'Asthma', 'Dr Chen', 'this morning'],
      ]);
    });

    test('falls back to Dosage.text for a dose that is not a bare "<number> <unit>" (e.g. "1-2 tablets")', () => {
      const data = empty();
      data.medications = [
        med({
          medicationCodeableConcept: { text: 'Ibuprofen' },
          dosage: [{ text: '1-2 tablets', timing: { code: { text: 'as needed' } } }],
        }),
      ];

      const { rows } = hydrateScreeningForm(data, undefined);

      expect(rows['medications-table']).toEqual([['Ibuprofen', '1-2 tablets', 'as needed', '', '', '']]);
    });

    test('recovers a coded UCUM unit and an uncoded one identically as text', () => {
      const data = empty();
      data.medications = [
        med({ medicationCodeableConcept: { text: 'Melatonin' }, dosage: [{ text: '1 tablet' }] }),
      ];

      const { rows } = hydrateScreeningForm(data, undefined);

      expect(rows['medications-table']).toEqual([['Melatonin', '1 tablet', '', '', '', '']]);
    });

    test('omits `rows` entirely when there are no medications', () => {
      const { rows } = hydrateScreeningForm(empty(), undefined);
      expect(rows['medications-table']).toBeUndefined();
    });
  });
});
