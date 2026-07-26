// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient, WithId } from '@medplum/core';
import type {
  AllergyIntolerance,
  CarePlan,
  CodeableConcept,
  Condition,
  Dosage,
  Encounter,
  Location,
  MedicationStatement,
  Observation,
  ObservationComponent,
  Quantity,
  Resource,
} from '@medplum/fhirtypes';

/**
 * Every resource the admission wizard writes carries an identifier under this
 * system, keyed by the field that produced it. This is the single source of
 * truth for that string — the wizard writes it, this module reads it back.
 */
export const SCREENING_ID_SYSTEM = 'http://maryland.gov/djs/admission-screening';

/**
 * Screening key for the admission Encounter itself — one per patient's
 * screening, so the conditional upsert updates it in place rather than
 * creating a second admission on every save. Defined here rather than in the
 * wizard because both the write path and the read-back must agree on it; a
 * drift between them would silently strand the admission date and facility.
 */
export const ADMISSION_ENCOUNTER_KEY = 'admission-encounter';

/**
 * True once a resource has been withdrawn. Must stay identical to the wizard's
 * own retraction check: Observation/MedicationStatement carry it in `status`,
 * Condition/AllergyIntolerance in `verificationStatus`. Anything the display or
 * read-back treats as live that the wizard treats as retracted (or vice versa)
 * is a correctness bug — a withdrawn finding shown as current, or an active one
 * hidden.
 */
export function isScreeningRetracted(res: Resource): boolean {
  const r = res as { status?: string; verificationStatus?: { coding?: { code?: string }[] } };
  return (
    r.status === 'entered-in-error' ||
    r.verificationStatus?.coding?.some((c) => c.code === 'entered-in-error') === true
  );
}

/** The screening key an admission resource was written under, if any. */
export function screeningKey(res: Resource): string | undefined {
  const withIdentifier = res as { identifier?: { system?: string; value?: string }[] };
  return withIdentifier.identifier?.find((i) => i.system === SCREENING_ID_SYSTEM)?.value;
}

/**
 * The BP panel's `code.text`.
 *
 * Blood pressure is modeled as FHIR's standard two-component panel rather than
 * a "120/80" string — a string can't be trended, alerted on, or compared, and
 * a pediatric BP percentile check, which this population actually needs, is
 * impossible against text. Codes verified against the FHIR R4 blood-pressure
 * profile (hl7.org/fhir/R4/bp.html), which fixes all three.
 *
 * Exported so the wizard, read-back, and the summary display share one
 * definition — all three depend on the same components now, so a drifted
 * string here would strand a reading in three places at once. The value stays
 * `'Blood pressure'`: screening identifiers derive from it, so changing it
 * would orphan every previously saved reading.
 */
export const BLOOD_PRESSURE_CODE = 'Blood pressure';

const UCUM_SYSTEM = 'http://unitsofmeasure.org';
const LOINC_SYSTEM = 'http://loinc.org';
const BP_SYSTOLIC_LOINC = '8480-6';
const BP_DIASTOLIC_LOINC = '8462-4';

/**
 * US Core makes the vital-signs profile mandatory, and it requires this
 * category on every vital-sign Observation. Nothing in the wizard set
 * `Observation.category` at all before task 26.
 */
export const VITAL_SIGNS_CATEGORY: CodeableConcept = {
  coding: [
    {
      system: 'http://terminology.hl7.org/CodeSystem/observation-category',
      code: 'vital-signs',
      display: 'Vital Signs',
    },
  ],
  text: 'Vital Signs',
};

export interface VitalSignDef {
  loinc: string;
  display: string;
  /** Human-readable unit for display. Omitted for BP, whose value lives in components. */
  unit?: string;
  /** UCUM code — the machine-readable unit that makes the number comparable. */
  ucum?: string;
}

/**
 * `code.text` → its LOINC code and units, for every vital the form captures.
 *
 * Codes and permitted units verified against the FHIR R4 vital-signs profile
 * (hl7.org/fhir/R4/observation-vitalsigns.html), not recalled — the profile
 * lists the LOINC "magic values" implementations must use, and the UCUM units
 * each one allows. The imperial units this form collects are all in those
 * allowed sets: `[degF]` for temperature, `[lb_av]` for weight, `[in_i]` for
 * height.
 *
 * **The keys are the existing `code.text` strings and must not change** —
 * screening identifiers derive from them, so editing one would orphan every
 * previously saved reading of that vital rather than upgrading it.
 *
 * This table is the single source of truth for a vital's unit: `obs()` applies
 * it, so call sites pass only the number. Two places naming the same unit is
 * how they drift.
 */
export const VITAL_SIGN_DEFS: Record<string, VitalSignDef> = {
  'Body temperature': { loinc: '8310-5', display: 'Body temperature', unit: '°F', ucum: '[degF]' },
  'Heart rate': { loinc: '8867-4', display: 'Heart rate', unit: '/min', ucum: '/min' },
  'Respiratory rate': { loinc: '9279-1', display: 'Respiratory rate', unit: '/min', ucum: '/min' },
  'Body weight': { loinc: '29463-7', display: 'Body weight', unit: 'lb', ucum: '[lb_av]' },
  'Body height': { loinc: '8302-2', display: 'Body height', unit: 'in', ucum: '[in_i]' },
  'Body mass index (BMI)': { loinc: '39156-5', display: 'Body mass index (BMI)', unit: 'kg/m2', ucum: 'kg/m2' },
  // The panel code. Its reading lives in `component`, so it has no unit of its
  // own — the components carry mm[Hg] themselves.
  'Blood pressure': { loinc: '85354-9', display: 'Blood pressure panel' },
};

/** The UCUM-coded Quantity for a vital, given its raw number. */
export function vitalQuantity(codeText: string, value: number): Quantity {
  const def = VITAL_SIGN_DEFS[codeText];
  return def?.ucum ? { value, unit: def.unit, system: UCUM_SYSTEM, code: def.ucum } : { value };
}

function bpComponent(loinc: string, display: string, value: number): ObservationComponent {
  return {
    code: { coding: [{ system: LOINC_SYSTEM, code: loinc, display }], text: display },
    valueQuantity: { value, unit: 'mmHg', system: UCUM_SYSTEM, code: 'mm[Hg]' },
  };
}

/**
 * Builds the systolic/diastolic components from the two BP inputs.
 *
 * The form captures systolic and diastolic as **separate numeric fields**, so
 * unlike the medication dose there is nothing to parse here and no lossy
 * text fallback to fall back to — the data is already structured at the point
 * of entry. A half-filled reading still records the half that exists rather
 * than discarding it; FHIR permits a panel with a single component.
 *
 * Returns `undefined` when neither field has a usable number, so the caller
 * omits the Observation entirely rather than writing an empty one (`ele-1`).
 */
export function buildBloodPressureComponents(
  systolic: string | undefined,
  diastolic: string | undefined
): ObservationComponent[] | undefined {
  const components: ObservationComponent[] = [];
  const sys = Number(systolic);
  const dia = Number(diastolic);
  if (systolic && Number.isFinite(sys)) {
    components.push(bpComponent(BP_SYSTOLIC_LOINC, 'Systolic blood pressure', sys));
  }
  if (diastolic && Number.isFinite(dia)) {
    components.push(bpComponent(BP_DIASTOLIC_LOINC, 'Diastolic blood pressure', dia));
  }
  return components.length > 0 ? components : undefined;
}

/**
 * Recovers the two BP fields from a saved Observation, for read-back and
 * display.
 *
 * Falls back to parsing a legacy `valueString` such as `"120/80"`: every
 * reading saved before this change is stored that way, and those must keep
 * loading rather than silently coming back blank. That parse is now purely a
 * backward-compatibility path — nothing writes a BP string anymore.
 */
export function bloodPressureFromObservation(obs: Observation | undefined): {
  systolic?: string;
  diastolic?: string;
} {
  if (!obs) {
    return {};
  }
  const byCode = (loinc: string): string | undefined => {
    const value = obs.component?.find((c) => c.code?.coding?.some((cd) => cd.code === loinc))?.valueQuantity?.value;
    return value === undefined ? undefined : String(value);
  };
  const systolic = byCode(BP_SYSTOLIC_LOINC);
  const diastolic = byCode(BP_DIASTOLIC_LOINC);
  if (systolic !== undefined || diastolic !== undefined) {
    return { systolic, diastolic };
  }
  const legacy = /^\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*$/.exec(obs.valueString ?? '');
  return legacy ? { systolic: legacy[1], diastolic: legacy[2] } : {};
}

/** `"120/80"` for display, or whatever half of it exists. Empty when neither does. */
export function bloodPressureText(obs: Observation | undefined): string {
  const { systolic, diastolic } = bloodPressureFromObservation(obs);
  if (systolic === undefined && diastolic === undefined) {
    return '';
  }
  return `${systolic ?? '—'}/${diastolic ?? '—'}`;
}

/**
 * Dose units the medications table's free-text dose field is expected to
 * produce, mapped to their UCUM unit code (`http://unitsofmeasure.org`) — the
 * coded unit system FHIR `Quantity` uses for clinical measurements.
 * Deliberately small: an unrecognized unit still saves fine (as
 * `Quantity.unit`, a display string), just without a coded `system`/`code`.
 */
const DOSE_UCUM_CODES: Record<string, string> = {
  mg: 'mg',
  g: 'g',
  kg: 'kg',
  mcg: 'ug',
  ug: 'ug',
  ml: 'mL',
  l: 'L',
};

/**
 * Splits a free-text dose like `"5 mg"` into a value + unit. Returns
 * `undefined` for anything that isn't a bare `<number> <unit>` (e.g.
 * `"1-2 tablets"`, `"as directed"`) — those still save, just as `Dosage.text`
 * rather than a coded `doseAndRate.doseQuantity` (see `buildDosage`).
 *
 * The drug name itself (`medicationCodeableConcept.text`) stays uncoded free
 * text for now, too — mapping it to RxNorm needs a drug-search/terminology
 * source this form doesn't have; tracked separately as its own step
 * (TASKS.md task 22) rather than guessed at here.
 */
export function parseDoseQuantity(input: string): { value: number; unit: string } | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*([A-Za-zµ]+)$/.exec(input.trim());
  if (!match) {
    return undefined;
  }
  return { value: Number(match[1]), unit: match[2] };
}

/**
 * Builds a FHIR `Dosage` from the medications table's free-text dose and
 * frequency inputs, using the datatype's own structured fields —
 * `doseAndRate.doseQuantity` for the dose, `timing.code.text` for the
 * frequency — instead of concatenating both into one `text` string. That
 * merge was step 6's original lossy read-back problem; keeping them in
 * separate elements means each round-trips independently (see
 * `dosageToFields`, its inverse) with nothing to un-merge.
 *
 * A dose that isn't a bare `<number> <unit>` shape falls back to
 * `Dosage.text` rather than being dropped — still lossy for *that* dose
 * (unstructured), but no longer coupled to the frequency's data.
 *
 * Returns `undefined` when there's nothing to record: an empty `Dosage`
 * object would violate `ele-1` ("all elements must have a value or
 * children").
 */
export function buildDosage(dose: string | undefined, frequency: string | undefined): Dosage | undefined {
  const parsed = dose ? parseDoseQuantity(dose) : undefined;
  const doseQuantity: Quantity | undefined = parsed
    ? {
        value: parsed.value,
        unit: parsed.unit,
        ...(DOSE_UCUM_CODES[parsed.unit.toLowerCase()]
          ? { system: 'http://unitsofmeasure.org', code: DOSE_UCUM_CODES[parsed.unit.toLowerCase()] }
          : {}),
      }
    : undefined;
  const doseTextFallback = dose && !parsed ? dose : undefined;

  if (!doseQuantity && !frequency && !doseTextFallback) {
    return undefined;
  }
  return {
    ...(doseTextFallback ? { text: doseTextFallback } : {}),
    ...(frequency ? { timing: { code: { text: frequency } } } : {}),
    ...(doseQuantity ? { doseAndRate: [{ doseQuantity }] } : {}),
  };
}

/**
 * Inverse of `buildDosage` — recovers the medications table's dose and
 * frequency text fields from a saved `Dosage`, for form read-back.
 */
export function dosageToFields(dosage: Dosage | undefined): { dose?: string; frequency?: string } {
  if (!dosage) {
    return {};
  }
  const q = dosage.doseAndRate?.[0]?.doseQuantity;
  const dose = q?.value !== undefined ? `${q.value}${q.unit ? ` ${q.unit}` : ''}` : dosage.text;
  return { dose, frequency: dosage.timing?.code?.text };
}

/**
 * The admission-screening resources for one patient, grouped by type, already
 * filtered and deduplicated. Both the DJS patient summary (display) and the
 * wizard's form read-back build on this.
 */
export interface ScreeningResources {
  observations: Observation[];
  conditions: Condition[];
  allergies: AllergyIntolerance[];
  medications: MedicationStatement[];
  carePlans: CarePlan[];
  encounters: Encounter[];
  /**
   * Locations referenced by `encounters` — fetched by reference, not by
   * search, because a Location carries the *facility* identifier system, not
   * `SCREENING_ID_SYSTEM`, so it would never match the screening filter.
   * Read-back needs the resource itself (not just the reference) to recover a
   * facility's `code`, which is what the form's dropdown binds to.
   */
  locations: Location[];
  /** screening key → its single live resource, across every type above. */
  byKey: Map<string, Resource>;
}

function lastUpdated(res: Resource): string {
  return res.meta?.lastUpdated ?? '';
}

/**
 * Searches one resource type for a patient's screening resources, then filters:
 *
 * - **Non-screening** resources are dropped — the search fetches the patient's
 *   whole chart of this type, so only those carrying our identifier are kept.
 * - **Retracted** resources are dropped — a withdrawn finding must not surface.
 * - **Duplicates** — the pre-`0e8f04b` bugs left multiple resources under one
 *   key; keep only the most recently updated, so legacy data reads cleanly.
 *
 * We search by patient/subject only and filter to our system client-side,
 * rather than narrowing with a bare `identifier=system|` token: MockClient
 * matches that form, but the live Medplum server returns nothing for it —
 * which would make the summary and read-back show an empty screening even when
 * data exists. The client-side filter is the correctness guarantee, and it
 * runs regardless. Subject-less orphans from the old bug simply never match a
 * patient-scoped search, which is the right outcome — they can't be attributed
 * to anyone. The `_count` cap is generous for an admission screening's bounded
 * resource set.
 */
async function searchScreening<T extends Resource>(
  medplum: MedplumClient,
  resourceType: T['resourceType'],
  param: 'subject' | 'patient',
  patientRef: string
): Promise<T[]> {
  const results = (await medplum.searchResources(resourceType as 'Observation', {
    [param]: patientRef,
    _count: 200,
  })) as Resource[];

  const byKey = new Map<string, T>();
  for (const res of results) {
    if (isScreeningRetracted(res)) {
      continue;
    }
    const key = screeningKey(res);
    if (!key) {
      continue;
    }
    const existing = byKey.get(key);
    if (!existing || lastUpdated(res) >= lastUpdated(existing)) {
      byKey.set(key, res as T);
    }
  }
  return [...byKey.values()];
}

/**
 * Loads and organizes a patient's admission-screening resources. Returns empty
 * groups (never throws) when the patient has no screening on file, so callers
 * can render an empty state without special-casing.
 */
export async function loadScreeningResources(
  medplum: MedplumClient,
  patientId: string
): Promise<ScreeningResources> {
  const patientRef = `Patient/${patientId}`;
  const [observations, conditions, allergies, medications, carePlans, encounters] = await Promise.all([
    searchScreening<Observation>(medplum, 'Observation', 'subject', patientRef),
    searchScreening<Condition>(medplum, 'Condition', 'subject', patientRef),
    searchScreening<AllergyIntolerance>(medplum, 'AllergyIntolerance', 'patient', patientRef),
    searchScreening<MedicationStatement>(medplum, 'MedicationStatement', 'subject', patientRef),
    searchScreening<CarePlan>(medplum, 'CarePlan', 'subject', patientRef),
    searchScreening<Encounter>(medplum, 'Encounter', 'subject', patientRef),
  ]);

  // Resolve the facilities those encounters point at. A missing or unreadable
  // Location is skipped rather than thrown: the rest of a screening must still
  // load if one reference is dangling.
  const locationIds = [
    ...new Set(
      encounters
        .flatMap((e) => e.location ?? [])
        .map((l) => l.location?.reference?.split('/')[1])
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const locations: Location[] = (
    await Promise.all(locationIds.map((id) => medplum.readResource('Location', id).catch(() => undefined)))
  ).filter((l): l is WithId<Location> => Boolean(l));

  const byKey = new Map<string, Resource>();
  for (const res of [...observations, ...conditions, ...allergies, ...medications, ...carePlans, ...encounters]) {
    const key = screeningKey(res);
    if (key) {
      byKey.set(key, res);
    }
  }

  return { observations, conditions, allergies, medications, carePlans, encounters, locations, byKey };
}
