// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AllergyIntolerance, CarePlan, Condition, Observation, Patient } from '@medplum/fhirtypes';
import { screeningKey, type ScreeningResources } from './screeningData';

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
  sex?: string;
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
const ROS_COMMENTS_CODE = 'Review of systems: additional comments';

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
};

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
 * Only fields the wizard actually persists can be repopulated. Known gaps,
 * deliberately not mapped here (documented in TASKS.md task 17):
 * - Medications — `dosage`+`frequency` are merged into one string on save;
 *   splitting them back into the table's two columns is lossy and needs a
 *   product decision, not just code (see TASKS.md).
 * - The sign-off Nurse/Physician signatures and mandated-reporter statement —
 *   formatted strings, not yet parsed back (disposition-notes/
 *   signoff-datetime/review-date from that same section ARE mapped, below).
 * - Hair/eye colour, race, interpreter, birthplace, and the ethnicity chip —
 *   additional demographics, not yet mapped.
 * - The 6-cell vision-acuity grid — not yet mapped.
 * - `checkText` free-text on "Other::" items — not yet mapped; distinct from
 *   the checkbox toggle above, which already restores correctly.
 */
export function hydrateScreeningForm(data: ScreeningResources, patient: Patient | undefined): HydratedForm {
  const scalars: HydratedScalars = {};
  const texts: Record<string, string> = {};
  const chips: Record<string, string> = {};
  const checks: Record<string, string[]> = {};

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
  }

  // ---- Allergies ----
  const allergyItems: string[] = [];
  for (const allergy of data.allergies as AllergyIntolerance[]) {
    const key = screeningKey(allergy);
    if (key?.startsWith('allergy::')) {
      allergyItems.push(key.slice('allergy::'.length));
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
      chronicItems.push(key.slice('chronic::'.length));
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

  return { scalars, texts, chips, checks };
}
