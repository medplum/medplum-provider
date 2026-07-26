// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type {
  AllergyIntolerance,
  CarePlan,
  Condition,
  MedicationStatement,
  Observation,
  Patient,
} from '@medplum/fhirtypes';
import { DJS_FACILITY_SYSTEM } from './djsFacilities';
import { ADMISSION_ENCOUNTER_KEY, dosageToFields, screeningKey, type ScreeningResources } from './screeningData';

/**
 * The wizard's dedicated `useState` fields (sections 1–2) that read-back can
 * repopulate. Kept as a flat bag the component applies with its own setters —
 * a pure value here, no React, so the reverse mapping is unit-testable in
 * isolation. That matters: read-back doubles the "field wired in the JSX but
 * never handled" surface, and that class of bug is invisible to the
 * field-integrity grep (it only sees the FormState symmetry, not a
 * resource → field mapping). Testing the mapping directly is the guard.
 */
export interface HydratedScalars {
  lastName?: string;
  firstName?: string;
  middleInitial?: string;
  dob?: string;
  admissionDate?: string;
  /**
   * The facility's stable `code`, never its display name — the dropdown binds
   * to codes, and a name is only a mutable label (see `djsFacilities.ts`).
   */
  facilityCode?: string;
  sex?: string;
  hispanic?: string;
  temp?: string;
  pulse?: string;
  resp?: string;
  bp?: string;
  weight?: string;
  height?: string;
  hasComplaint?: string;
  complaintDetail?: string;
  hasPain?: string;
  painScale?: number;
  painDetail?: string;
}

/** Everything read-back applies: scalar `useState` fields plus FormState buckets. */
export interface HydratedForm {
  scalars: HydratedScalars;
  /** FormState text fields: key → value. */
  texts: Record<string, string>;
  /** FormState single-select chips: track → value. */
  chips: Record<string, string>;
  /** FormState checklists: grid → checked item values. */
  checks: Record<string, string[]>;
  /** FormState "Other:"-style inline free text: grid → item → typed text. */
  checkTexts: Record<string, Record<string, string>>;
  /** FormState tables: table name → rows. */
  rows: Record<string, string[][]>;
}

/** Observation code → the scalar vital field it fills. */
const VITAL_CODE_TO_FIELD: Record<string, keyof HydratedScalars> = {
  'Body temperature': 'temp',
  'Heart rate': 'pulse',
  'Respiratory rate': 'resp',
  'Blood pressure': 'bp',
  'Body weight': 'weight',
  'Body height': 'height',
};

/** Observation code → the checklist grid its items belong to. Item comes from the identifier suffix. */
const CHECKLIST_CODE_TO_GRID: Record<string, string> = {
  'Appearance/mental status finding': 'appearance',
  'Review of systems: Injuries/trauma': 'injuries',
  'Review of systems: Injury prevention': 'firearm-safety',
  'Review of systems: Oral/dental': 'dental',
  'Review of systems: Infectious disease history': 'infectious',
};

const PAIN_CODE = 'Pain severity - 0-10 verbal numeric rating';
const COMPLAINT_CODE = 'Chief complaint';
const DENTAL_EXAM_CODE = 'Last dental exam';
const VISION_EXAM_CODE = 'Last vision exam';
const GLASSES_HISTORY_CODE = 'History of prescribed glasses/contacts';
const ROS_COMMENTS_CODE = 'Review of systems: additional comments';
const SIGNOFF_CODE = 'Admission health screening sign-off';
const MANDATED_REPORTER_CODE = 'Mandated reporter statement read to youth';
const MANDATED_REPORTER_ITEM = 'Statement read to youth';

/**
 * Observation code → the plain FormState text field it fills, for the
 * single-value free-text fields added in tasks 18 and 19 (chronic-conditions
 * card, injuries detail, disposition notes/sign-off timing). All are a bare
 * `valueString` or `valueDateTime` with nothing else to parse, unlike
 * `VISION_EXAM_CODE`'s combined "Date: ..., provider: ..." string below.
 */
const TEXT_CODE_TO_FIELD: Record<string, string> = {
  'Doctors/specialists managing chronic conditions': 'chronic-providers',
  'Primary care provider': 'chronic-pcp',
  'Chronic conditions: additional comments': 'chronic-comments',
  'Injuries/trauma: details': 'injuries-detail',
  'Disposition: additional notes': 'disposition-notes',
  // Note: 'review-date' stores a date-only string in valueDateTime, not
  // valueDate — see AdmissionHealthScreeningWizard.tsx's task-19 comment on
  // why (Observation.value[x] has no valueDate variant). textOrDateTime
  // below reads either, so this mapping doesn't need to know which.
  'Admission screening sign-off date/time': 'signoff-datetime',
  'Admission screening review date': 'review-date',
  'Hair color': 'hair-color',
  'Eye color': 'eye-color',
  // The vision-acuity grid (saveVitals's visionFields loop) — 6 fields, each
  // a bare valueString, no parsing needed.
  'Visual acuity, left eye, without correction': 'vision-nocorr-left',
  'Visual acuity, right eye, without correction': 'vision-nocorr-right',
  'Visual acuity, both eyes, without correction': 'vision-nocorr-both',
  'Visual acuity, left eye, with correction': 'vision-corr-left',
  'Visual acuity, right eye, with correction': 'vision-corr-right',
  'Visual acuity, both eyes, with correction': 'vision-corr-both',
};

// Patient.extension URLs written by savePatientRecord — must match exactly.
const BIRTHPLACE_EXT_URL = 'http://hl7.org/fhir/StructureDefinition/patient-birthPlace';
const ETHNICITY_EXT_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity';
const RACE_EXT_URL = 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race';
const INTERPRETER_EXT_URL = 'http://example.org/fhir/StructureDefinition/needs-interpreter';

/** The race grid's own checklist items (excluding "Other"), so an unrecognized token in the saved list must be free text. */
const KNOWN_RACE_ITEMS = [
  'Black or African American',
  'White',
  'Asian',
  'American Indian or Alaska Native',
  'Native Hawaiian or Pacific Islander',
];

function findExtension(patient: Patient | undefined, url: string): NonNullable<Patient['extension']>[number] | undefined {
  return patient?.extension?.find((e) => e.url === url);
}

/** The item value a checklist Observation stands for — the part of its key after `::`. */
function itemFromKey(res: Observation): string | undefined {
  const key = screeningKey(res);
  if (!key) {
    return undefined;
  }
  const idx = key.indexOf('::');
  return idx >= 0 ? key.slice(idx + 2) : undefined;
}

function quantityValue(obs: Observation): string | undefined {
  const value = obs.valueQuantity?.value;
  return value === undefined ? undefined : String(value);
}

/** The single scalar value on a plain text/datetime Observation, whichever of the two it used. */
function textOrDateTime(obs: Observation): string | undefined {
  return obs.valueString ?? obs.valueDateTime;
}

/**
 * Reverse of the wizard's save handlers: turns a patient's live screening
 * resources back into form values, so reopening a partially-completed
 * screening shows what was entered instead of blank fields.
 *
 * Only fields the wizard actually persists can be repopulated. Medications
 * (TASKS.md task 17 step 6) round-trip via `dosageToFields`, the inverse of
 * `buildDosage` — dose and frequency are read from `Dosage`'s own structured
 * fields (`doseAndRate.doseQuantity`, `timing.code.text`), not un-merged from
 * one string, so there's nothing lossy left to document here. The drug name
 * itself is still uncoded free text (`medicationCodeableConcept.text`) —
 * mapping it to RxNorm is a separate, larger step (TASKS.md task 22).
 */
export function hydrateScreeningForm(data: ScreeningResources, patient: Patient | undefined): HydratedForm {
  const scalars: HydratedScalars = {};
  const texts: Record<string, string> = {};
  const chips: Record<string, string> = {};
  const checks: Record<string, string[]> = {};
  const checkTexts: Record<string, Record<string, string>> = {};

  // ---- Section 1: core Patient fields ----
  const name = patient?.name?.[0];
  if (name?.family) {
    scalars.lastName = name.family;
  }
  if (name?.given?.[0]) {
    scalars.firstName = name.given[0];
  }
  if (name?.given?.[1]) {
    scalars.middleInitial = name.given[1];
  }
  if (patient?.birthDate) {
    scalars.dob = patient.birthDate;
  }
  if (patient?.gender === 'male' || patient?.gender === 'female') {
    scalars.sex = patient.gender;
  }

  const ethnicityText = findExtension(patient, ETHNICITY_EXT_URL)?.valueCodeableConcept?.text;
  if (ethnicityText === 'Hispanic or Latino') {
    scalars.hispanic = 'yes';
  } else if (ethnicityText === 'Not Hispanic or Latino') {
    scalars.hispanic = 'no';
  }

  const birthPlace = findExtension(patient, BIRTHPLACE_EXT_URL)?.valueAddress?.text;
  if (birthPlace) {
    texts['birth-place'] = birthPlace;
  }

  if (findExtension(patient, INTERPRETER_EXT_URL)?.valueBoolean === true) {
    checks['interpreter'] = ['Needs interpreter'];
  }

  const raceText = findExtension(patient, RACE_EXT_URL)?.valueCodeableConcept?.text;
  if (raceText) {
    // Written by savePatientRecord as
    // `raceItems.map((r) => checkTextMap('race')[r] || r).join(', ')` — the
    // free text typed for "Other" takes the place of the literal word
    // "Other" in this list, so a token that isn't one of the grid's own
    // labels must be that free text, not a race category we don't recognize.
    // Known limitation: if the typed "Other" text itself contains a comma,
    // it was split into multiple tokens here and gets rejoined below rather
    // than reconstructed exactly — same class of comma hazard as task 20.
    const tokens = raceText.split(', ').filter(Boolean);
    const knownItems = tokens.filter((t) => KNOWN_RACE_ITEMS.includes(t));
    const otherTokens = tokens.filter((t) => !KNOWN_RACE_ITEMS.includes(t));
    const raceItems = [...knownItems];
    if (otherTokens.length > 0) {
      raceItems.push('Other');
      (checkTexts['race'] ??= {})['Other'] = otherTokens.join(', ');
    }
    if (raceItems.length > 0) {
      checks['race'] = raceItems;
    }
  }

  // ---- Observations: vitals, pain, complaint, checklist items, text fields ----
  for (const obs of data.observations) {
    const code = obs.code?.text;
    if (!code) {
      continue;
    }

    const vitalField = VITAL_CODE_TO_FIELD[code];
    if (vitalField) {
      const value = code === 'Blood pressure' ? obs.valueString : quantityValue(obs);
      if (value !== undefined) {
        scalars[vitalField] = value as never;
      }
      continue;
    }

    const grid = CHECKLIST_CODE_TO_GRID[code];
    if (grid) {
      const item = itemFromKey(obs);
      if (item) {
        (checks[grid] ??= []).push(item);
        // The save side writes valueString: checkTextMap(grid)[item] || item —
        // i.e. the free text typed next to an "Other:"-style item when there
        // is one, else the item's own name. So a stored value that differs
        // from the item name IS that free text; a value equal to the item
        // name means none was typed. This is how every Other::text grid
        // round-trips (see AdmissionHealthScreeningWizard.tsx's
        // saveAllergiesChronic / the ROS systems loop / saveMentalStatus).
        if (obs.valueString && obs.valueString !== item) {
          (checkTexts[grid] ??= {})[item] = obs.valueString;
        }
      }
      continue;
    }

    const textField = TEXT_CODE_TO_FIELD[code];
    if (textField) {
      const value = textOrDateTime(obs);
      if (value !== undefined) {
        texts[textField] = value;
      }
      continue;
    }

    if (code === GLASSES_HISTORY_CODE && obs.valueString) {
      // Save side writes: chip 'yes' but no detail typed -> valueString
      // literally 'Yes' (see saveVitals: `text('vision-glasses-detail') ||
      // 'Yes'`). That's already ambiguous with someone genuinely typing
      // "Yes" as their answer — the read side can't resolve what the write
      // side didn't preserve, so it mirrors the same imprecision: the chip
      // is always restored, the detail only when the value isn't literally
      // the fallback string.
      chips['vision-glasses-past'] = 'yes';
      if (obs.valueString !== 'Yes') {
        texts['vision-glasses-detail'] = obs.valueString;
      }
      continue;
    }

    if (code === PAIN_CODE) {
      scalars.hasPain = 'yes';
      if (obs.valueInteger !== undefined) {
        scalars.painScale = obs.valueInteger;
      }
      if (obs.note?.[0]?.text) {
        scalars.painDetail = obs.note[0].text;
      }
      continue;
    }

    if (code === COMPLAINT_CODE && obs.valueString) {
      scalars.hasComplaint = 'yes';
      scalars.complaintDetail = obs.valueString;
      continue;
    }

    if (code === DENTAL_EXAM_CODE && obs.valueString) {
      texts['last-dental-exam'] = obs.valueString;
      continue;
    }

    if (code === ROS_COMMENTS_CODE && obs.valueString) {
      texts['ros-comments'] = obs.valueString;
      continue;
    }

    if (code === VISION_EXAM_CODE && obs.valueString) {
      // Written as "Date: <d>, provider: <p>"; parse the two back out.
      const match = /^Date:\s*(.*?),\s*provider:\s*(.*)$/.exec(obs.valueString);
      if (match) {
        if (match[1] && match[1] !== '—') {
          texts['vision-exam-date'] = match[1];
        }
        if (match[2] && match[2] !== '—') {
          texts['vision-provider'] = match[2];
        }
      }
      continue;
    }

    if (code === SIGNOFF_CODE) {
      // Written as "Nurse: <n>; Physician: <p>"; same parse-the-formatted-
      // string approach as VISION_EXAM_CODE above. '—' is the save side's
      // own placeholder for "not filled in" (see saveDiagnosisDisposition),
      // not a real signature.
      const match = /^Nurse: (.*); Physician: (.*)$/.exec(obs.valueString ?? '');
      if (match) {
        if (match[1] && match[1] !== '—') {
          texts['nurse-signature'] = match[1];
        }
        if (match[2] && match[2] !== '—') {
          texts['physician-signature'] = match[2];
        }
      }
      if (obs.note?.[0]?.text) {
        texts['health-alerts'] = obs.note[0].text;
      }
      continue;
    }

    if (code === MANDATED_REPORTER_CODE) {
      // Presence of this Observation at all means the checkbox was checked —
      // saveDemographics only writes it via saveObservationSet when
      // checkedItems('mandated-reporter').length > 0, so there's no separate
      // "checked but no value" state to distinguish, unlike GLASSES_HISTORY_CODE.
      checks['mandated-reporter'] = [MANDATED_REPORTER_ITEM];
      const initialsMatch = /^RN initials: (.*)$/.exec(obs.note?.[0]?.text ?? '');
      if (initialsMatch?.[1]) {
        texts['mandated-reporter-initials'] = initialsMatch[1];
      }
      continue;
    }
  }

  // ---- Allergies ----
  const allergyItems: string[] = [];
  for (const allergy of data.allergies as AllergyIntolerance[]) {
    const key = screeningKey(allergy);
    if (key?.startsWith('allergy::')) {
      const item = key.slice('allergy::'.length);
      allergyItems.push(item);
      // Same Other::text convention as the checklist Observations above,
      // but here the free text lives in code.text (saveAllergiesChronic
      // writes `code: { text: checkTextMap('allergy')[item] || item }`),
      // not valueString.
      if (allergy.code?.text && allergy.code.text !== item) {
        (checkTexts['allergy'] ??= {})[item] = allergy.code.text;
      }
    }
    const reaction = allergy.reaction?.[0]?.description;
    if (reaction && !texts['allergy-reaction']) {
      texts['allergy-reaction'] = reaction;
    }
  }
  if (allergyItems.length > 0) {
    checks['allergy'] = allergyItems;
  }

  // ---- Conditions: chronic list and nursing diagnoses ----
  const chronicItems: string[] = [];
  for (const condition of data.conditions as Condition[]) {
    const key = screeningKey(condition);
    if (key?.startsWith('chronic::')) {
      const item = key.slice('chronic::'.length);
      chronicItems.push(item);
      if (condition.code?.text && condition.code.text !== item) {
        (checkTexts['chronic-list'] ??= {})[item] = condition.code.text;
      }
    } else if (key?.startsWith('nursing-diagnosis::') && condition.code?.text) {
      texts[key.slice('nursing-diagnosis::'.length)] = condition.code.text;
    }
  }
  if (chronicItems.length > 0) {
    chips['chronic'] = 'yes';
    checks['chronic-list'] = chronicItems;
  }

  // ---- CarePlan: nursing plan checklist ----
  const carePlan = (data.carePlans as CarePlan[]).find((c) => screeningKey(c) === 'nursing-plan');
  if (carePlan?.description) {
    checks['nursing-plan'] = carePlan.description.split('; ').filter(Boolean);
  }

  // ---- Encounter: admission date and facility ----
  // The facility comes back as its stable `code`, recovered from the
  // referenced Location's identifier — never from `Location.name`, which is a
  // mutable display label. Renaming a facility must not break read-back, and
  // matching on the name would do exactly that.
  const encounter = data.encounters.find((e) => screeningKey(e) === ADMISSION_ENCOUNTER_KEY);
  if (encounter?.period?.start) {
    scalars.admissionDate = encounter.period.start;
  }
  const locationId = encounter?.location?.[0]?.location?.reference?.split('/')[1];
  const location = locationId ? data.locations.find((l) => l.id === locationId) : undefined;
  const facilityCode = location?.identifier?.find((i) => i.system === DJS_FACILITY_SYSTEM)?.value;
  if (facilityCode) {
    scalars.facilityCode = facilityCode;
  }

  // ---- Medications table ----
  // Row order must match the table's own columns (see the `medications-table`
  // Grid in AdmissionHealthScreeningWizard.tsx): name, dose, frequency,
  // reason, prescriber, last taken.
  const medicationRows: string[][] = [];
  for (const med of data.medications as MedicationStatement[]) {
    const name = med.medicationCodeableConcept?.text;
    if (!name) {
      continue;
    }
    const { dose, frequency } = dosageToFields(med.dosage?.[0]);
    const reason = med.reasonCode?.[0]?.text;
    const prescriber = med.informationSource?.display;
    const lastTakenMatch = /^Last taken: (.*)$/.exec(med.note?.[0]?.text ?? '');
    medicationRows.push([
      name,
      dose ?? '',
      frequency ?? '',
      reason ?? '',
      prescriber ?? '',
      lastTakenMatch?.[1] ?? '',
    ]);
  }
  const rows: Record<string, string[][]> = medicationRows.length > 0 ? { 'medications-table': medicationRows } : {};

  return { scalars, texts, chips, checks, checkTexts, rows };
}
