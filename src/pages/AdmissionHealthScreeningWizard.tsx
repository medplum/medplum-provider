import { createReference, WithId } from '@medplum/core';
import { Encounter, Observation, Reference } from '@medplum/fhirtypes';
import { Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import '../theme/tokens.css';
import { Callout } from '../components/Callout';
import { Card, Field, FieldGrid, SectionHeader } from '../components/Card';
import { ChipGroup, Reveal } from '../components/ChipGroup';
import { DynamicTable } from '../components/DynamicTable';
import { Grid, YesNoChip } from '../components/FormControls';
import { AppFooter, AppHeader, GovBanner } from '../components/MarylandChrome';
import { PatientBand } from '../components/PatientBand';
import { SidebarStepper, WizardStep } from '../components/SidebarStepper';
import { showErrorNotification, showSuccessNotification } from '../utils/notifications';
import { useFormState } from './formState';
// SCREENING_ID_SYSTEM and the retraction check live in screeningData.ts, the
// single source of truth shared with the read-back path — the wizard writes
// each resource under this system's identifier (derived from the field that
// produced it, so a re-save updates in place rather than duplicating), and the
// summary/read-back loads it back by the same key.
import { isScreeningRetracted, loadScreeningResources, SCREENING_ID_SYSTEM } from './screeningData';
import { hydrateScreeningForm } from './hydrateScreening';

/**
 * Status code systems for Condition and AllergyIntolerance.
 *
 * These are required bindings, not optional niceties. FHIR constraints
 * `ait-1` and `con-3` reject a resource that has neither a `clinicalStatus`
 * nor a `verificationStatus` of `entered-in-error`, so a coded
 * `clinicalStatus` has to be written up front — a text-only CodeableConcept
 * satisfies `exists()` but not the required binding.
 */
const ALLERGY_CLINICAL_SYSTEM = 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical';
const ALLERGY_VERIFICATION_SYSTEM = 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification';
const CONDITION_CLINICAL_SYSTEM = 'http://terminology.hl7.org/CodeSystem/condition-clinical';
const CONDITION_VERIFICATION_SYSTEM = 'http://terminology.hl7.org/CodeSystem/condition-ver-status';

const ACTIVE_ALLERGY_STATUS = {
  coding: [{ system: ALLERGY_CLINICAL_SYSTEM, code: 'active' }],
  text: 'Active',
};
const ACTIVE_CONDITION_STATUS = {
  coding: [{ system: CONDITION_CLINICAL_SYSTEM, code: 'active' }],
  text: 'Active',
};

const STEPS: WizardStep[] = [
  { n: 1, title: 'Patient Information' },
  { n: 2, title: 'Current Health Status' },
  { n: 3, title: 'Review of Systems' },
  { n: 4, title: 'Diagnosis & Disposition' },
];

interface Props {
  /** Overrides the route param, for embedding the wizard inside another page. */
  patientId?: string;
  /** Overrides the route param, for embedding the wizard inside another page. */
  encounterId?: string;
}

/**
 * 4-section Admission Health Screening & Nursing Assessment wizard,
 * styled to match the supplied mockup and wired to Medplum FHIR resources.
 *
 * Sections 1–2 use dedicated typed state (they map onto core Patient
 * fields + a handful of well-known Observation codes). Sections 3–4 use
 * the generic `useFormState` container (see formState.ts) since they're
 * mostly large checklists/chip-groups/dynamic tables — see each
 * section's save handler for exactly which FHIR resources it produces.
 */
export function AdmissionHealthScreeningWizard({
  patientId: patientIdProp,
  encounterId: encounterIdProp,
}: Props): JSX.Element {
  // Props win when the wizard is embedded in another page; otherwise fall
  // back to the route params so it works as a standalone route.
  const params = useParams();
  const patientId = patientIdProp ?? params.patientId;
  const encounterId = encounterIdProp ?? params.encounterId;

  const medplum = useMedplum();
  const [activeStep, setActiveStep] = useState(1);
  const [touched, setTouched] = useState<Set<number>>(new Set([1]));
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const form = useFormState();

  const [patient, setPatient] = useState<Patient | undefined>();
  const [facilityName, setFacilityName] = useState('');

  // ---- Section 1 state ----
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleInitial, setMiddleInitial] = useState('');
  const [dob, setDob] = useState('');
  const [admissionDate, setAdmissionDate] = useState('');
  const [sex, setSex] = useState<string>();
  const [hispanic, setHispanic] = useState<string>();

  // ---- Section 2 state ----
  const [temp, setTemp] = useState('');
  const [pulse, setPulse] = useState('');
  const [resp, setResp] = useState('');
  const [bp, setBp] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [hasComplaint, setHasComplaint] = useState<string>();
  const [complaintDetail, setComplaintDetail] = useState('');
  const [hasPain, setHasPain] = useState<string>();
  // Deliberately starts undefined, not 0: on a 0–10 scale, 0 means "no pain",
  // which is a real clinical finding. An untouched slider must stay
  // distinguishable from a recorded score of zero.
  const [painScale, setPainScale] = useState<number>();
  const [painDetail, setPainDetail] = useState('');

  // On mount for an existing patient, load the Patient and any prior screening
  // and repopulate the form, so a partially-completed screening resumes where
  // it left off instead of showing blank fields. Runs once per patient
  // (deps: patientId/medplum); re-applying the same values under StrictMode's
  // double-invoke is idempotent. `form` setters are intentionally not deps —
  // `useFormState` returns a fresh object each render, which would loop.
  useEffect(() => {
    if (!patientId) {
      return;
    }
    let active = true;
    (async () => {
      const loaded = await medplum.readResource('Patient', patientId).catch(() => undefined);
      if (!active) {
        return;
      }
      if (loaded) {
        setPatient(loaded);
      }
      const data = await loadScreeningResources(medplum, patientId).catch(() => undefined);
      if (!active || !data) {
        return;
      }
      const { scalars, texts, chips, checks } = hydrateScreeningForm(data, loaded);

      if (scalars.lastName !== undefined) setLastName(scalars.lastName);
      if (scalars.firstName !== undefined) setFirstName(scalars.firstName);
      if (scalars.middleInitial !== undefined) setMiddleInitial(scalars.middleInitial);
      if (scalars.dob !== undefined) setDob(scalars.dob);
      if (scalars.sex !== undefined) setSex(scalars.sex);
      if (scalars.temp !== undefined) setTemp(scalars.temp);
      if (scalars.pulse !== undefined) setPulse(scalars.pulse);
      if (scalars.resp !== undefined) setResp(scalars.resp);
      if (scalars.bp !== undefined) setBp(scalars.bp);
      if (scalars.weight !== undefined) setWeight(scalars.weight);
      if (scalars.height !== undefined) setHeight(scalars.height);
      if (scalars.hasComplaint !== undefined) setHasComplaint(scalars.hasComplaint);
      if (scalars.complaintDetail !== undefined) setComplaintDetail(scalars.complaintDetail);
      if (scalars.hasPain !== undefined) setHasPain(scalars.hasPain);
      if (scalars.painScale !== undefined) setPainScale(scalars.painScale);
      if (scalars.painDetail !== undefined) setPainDetail(scalars.painDetail);

      for (const [key, value] of Object.entries(texts)) {
        form.setText(key, value);
      }
      for (const [track, value] of Object.entries(chips)) {
        form.setChip(track, value);
      }
      for (const [grid, items] of Object.entries(checks)) {
        for (const item of items) {
          form.toggleCheck(grid, item, true);
        }
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, medplum]);

  const trackedAnswers = [sex, hispanic, hasComplaint, hasPain];
  const answeredCount = trackedAnswers.filter(Boolean).length;
  const progressPct = Math.round((answeredCount / trackedAnswers.length) * 100);

  // BMI = 703 × weight(lb) / height(in)²  — standard imperial BMI formula
  const bmi = weight && height && Number(weight) > 0 && Number(height) > 0
    ? (703 * Number(weight)) / (Number(height) * Number(height))
    : null;

  function goTo(n: number) {
    setActiveStep(n);
    setTouched((prev) => new Set(prev).add(n));
  }

  /**
   * Wraps a section's save handler with a pending state and success/error
   * notifications. Without this, the handlers were fired as floating
   * promises: a rejected save (expired session, validation error, network
   * failure) looked exactly like a successful one — nothing happened either
   * way, so there was no way to tell from the UI whether data landed.
   */
  async function runSave(key: string, successMessage: string, save: () => Promise<void>): Promise<void> {
    setSavingSection(key);
    try {
      await save();
      showSuccessNotification({ title: 'Saved', message: successMessage });
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setSavingSection(null);
    }
  }

  const encounterRef: Encounter['subject'] | undefined = encounterId
    ? { reference: `Encounter/${encounterId}` }
    : undefined;

  /**
   * Scopes an upsert to this patient so an identifier can repeat across
   * patients without colliding. `param` differs by resource type —
   * AllergyIntolerance searches on `patient`, everything else on `subject`.
   */
  /**
   * FHIR search treats `,` (OR-separator), `|` (system delimiter), `$`, and
   * `\` as syntactically significant inside a token value, so a literal one
   * must be backslash-escaped or the search silently splits/misparses it.
   * Every identifier here is derived from real-world text (a checklist item
   * or a form-field label), and several genuinely contain a comma —
   * "Insect allergy (bee, wasp, ant)", "Measles, mumps, or rubella" — which
   * without this made the conditional-PUT match nothing and duplicate the
   * resource on every resave instead of updating it, silently defeating
   * task 8's whole guarantee. Confirmed live via `medplum.upsertResource`
   * called twice with such a key. The escaping is applied only to the search
   * token; the stored `identifier.value` itself stays exact and unescaped.
   */
  function escapeSearchToken(value: string): string {
    return value.replace(/[\\|$,]/g, (c) => `\\${c}`);
  }

  function upsertQuery(key: string, subject: Reference<Patient>, param: 'subject' | 'patient' = 'subject') {
    return { identifier: `${SCREENING_ID_SYSTEM}|${escapeSearchToken(key)}`, [param]: subject.reference as string };
  }

  /**
   * Writes one Observation per screening field.
   *
   * The identifier is derived from `code.text` — the same string that defines
   * what the Observation means — plus `itemKey` for checklist rows, where one
   * code covers many items. Deriving it rather than hand-writing a key per
   * call site means the key cannot drift out of sync with the resource it
   * labels, which is the failure mode this file has a long history of.
   */
  async function obs(
    subject: Reference<Patient>,
    partial: Partial<Observation>,
    itemKey?: string
  ): Promise<void> {
    const codeText = partial.code?.text ?? 'Unspecified screening finding';
    const key = itemKey ? `${codeText}::${itemKey}` : codeText;
    await medplum.upsertResource<Observation>(
      {
        resourceType: 'Observation',
        status: 'final',
        subject,
        encounter: encounterRef,
        identifier: [{ system: SCREENING_ID_SYSTEM, value: key }],
        ...partial,
      } as Observation,
      upsertQuery(key, subject)
    );
  }

  /**
   * Marks a resource as withdrawn without destroying it. Observation and
   * MedicationStatement carry `status`; Condition and AllergyIntolerance
   * express retraction through `verificationStatus` instead.
   *
   * For those two, `clinicalStatus` must be REMOVED, not just left in place:
   * `ait-2` / `con-5` forbid `clinicalStatus` when `verificationStatus` is
   * `entered-in-error`. The live server rejects the update otherwise (the
   * retraction silently failed and the finding stayed active); MockClient does
   * not validate, so only the live test caught it.
   */
  function asRetracted(res: any): any {
    switch (res.resourceType) {
      case 'Observation':
      case 'MedicationStatement':
        return { ...res, status: 'entered-in-error' };
      case 'Condition': {
        const { clinicalStatus: _drop, ...rest } = res;
        return {
          ...rest,
          verificationStatus: { coding: [{ system: CONDITION_VERIFICATION_SYSTEM, code: 'entered-in-error' }] },
        };
      }
      case 'AllergyIntolerance': {
        const { clinicalStatus: _drop, ...rest } = res;
        return {
          ...rest,
          verificationStatus: { coding: [{ system: ALLERGY_VERIFICATION_SYSTEM, code: 'entered-in-error' }] },
        };
      }
      default:
        return res;
    }
  }

  /**
   * Withdraws resources this section wrote previously that the form no longer
   * asserts.
   *
   * Upsert alone only ever adds or updates. Without this, unchecking an item
   * left its resource live in the chart while the form showed it gone — the
   * record kept asserting a finding the nurse had explicitly withdrawn, which
   * is more dangerous than a duplicate. Retracted via status rather than
   * deleted, because clinical records need the audit trail.
   *
   * `inScope` is what keeps this section-local: without it, saving one section
   * would retract every other section's findings, since none of their keys
   * appear in this section's live set.
   */
  async function retractStale(
    resourceType: 'Observation' | 'Condition' | 'AllergyIntolerance' | 'MedicationStatement',
    subject: Reference<Patient>,
    inScope: (key: string) => boolean,
    liveKeys: Set<string>,
    param: 'subject' | 'patient' = 'subject'
  ): Promise<void> {
    // Fetch this patient's resources of this type and filter to our screening
    // system client-side. We deliberately do NOT narrow with a bare
    // `identifier=system|` token search: MockClient matches it, but the live
    // Medplum server returns nothing for it (empty value read literally),
    // which silently broke retraction — a withdrawn finding stayed active on
    // the real server while every offline test passed. The client-side system
    // filter below is the actual correctness guarantee; the `_count` cap is
    // generous for an admission screening's bounded resource set.
    const existing = await medplum.searchResources(resourceType, {
      [param]: subject.reference as string,
      _count: 200,
    });

    for (const res of existing) {
      const key = res.identifier?.find((i) => i.system === SCREENING_ID_SYSTEM)?.value;
      if (!key || !inScope(key) || liveKeys.has(key) || isScreeningRetracted(res)) {
        continue;
      }
      await medplum.updateResource(asRetracted(res));
    }
  }

  /**
   * Writes one Observation per declared field that has a value, and retracts
   * any the form no longer asserts.
   *
   * Sections declare their fields as data rather than as a run of
   * `if (x) await obs(...)` statements so that the reconciliation scope is
   * derived from the very list that drives the writes. A scope constant
   * maintained separately would drift from the writes, which is the failure
   * mode this file has been bitten by repeatedly — and here that drift would
   * be invisible: a field missing from the scope simply never gets retracted,
   * leaving a stale clinical value asserted with nothing to flag it.
   *
   * `value: undefined` means "cleared" — declared, not written, and retracted
   * if a previous save recorded it.
   */
  async function saveObservationSet(
    subject: Reference<Patient>,
    fields: { code: string; value?: Partial<Observation> }[]
  ): Promise<void> {
    const liveKeys = new Set<string>();
    for (const field of fields) {
      if (!field.value) {
        continue;
      }
      liveKeys.add(field.code);
      await obs(subject, { code: { text: field.code }, ...field.value });
    }
    const owned = new Set(fields.map((f) => f.code));
    await retractStale('Observation', subject, (k) => owned.has(k), liveKeys);
  }

  // ---- Save handlers: Sections 1–2 ----

  /** Writes the Patient record itself and returns it, with a guaranteed id. */
  async function savePatientRecord(): Promise<WithId<Patient>> {
    const language = form.chip('language') === 'other' ? form.text('language-other') : form.chip('language');
    const raceItems = form.checkedItems('race');
    const resource: Patient = {
      resourceType: 'Patient',
      id: patient?.id,
      name: [{ family: lastName, given: [firstName, middleInitial].filter(Boolean) }],
      birthDate: dob || undefined,
      gender: sex === 'male' ? 'male' : sex === 'female' ? 'female' : undefined,
      communication: language ? [{ language: { text: language } }] : undefined,
      extension: [
        form.text('birth-place') && {
          url: 'http://hl7.org/fhir/StructureDefinition/patient-birthPlace',
          valueAddress: { text: form.text('birth-place') },
        },
        hispanic && {
          url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity',
          valueCodeableConcept: { text: hispanic === 'yes' ? 'Hispanic or Latino' : 'Not Hispanic or Latino' },
        },
        raceItems.length > 0 && {
          url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race',
          valueCodeableConcept: { text: raceItems.map((r) => form.checkTextMap('race')[r] || r).join(', ') },
        },
        form.checkedItems('interpreter').length > 0 && {
          url: 'http://example.org/fhir/StructureDefinition/needs-interpreter', // not a standard extension — informal, for this prototype only
          valueBoolean: true,
        },
      ].filter(Boolean) as Patient['extension'],
    };
    const saved = patient?.id ? await medplum.updateResource(resource) : await medplum.createResource(resource);
    setPatient(saved);
    return saved;
  }

  /**
   * Resolves the subject reference every other save handler writes against,
   * creating the Patient first on a brand-new intake.
   *
   * Handlers must use this return value rather than reading `patient` state:
   * `setPatient()` does not update the running closure, so the previous code
   * — which awaited the patient save and then read state — sent
   * `subject: undefined` on every resource in a first-time save, silently
   * orphaning them from any patient.
   */
  async function ensurePatientRef(): Promise<Reference<Patient>> {
    return createReference(patient?.id ? (patient as WithId<Patient>) : await savePatientRecord());
  }

  async function saveDemographics(): Promise<void> {
    const subject = createReference(await savePatientRecord());
    const initials = form.text('mandated-reporter-initials');

    await saveObservationSet(subject, [
      { code: 'Hair color', value: form.text('hair-color') ? { valueString: form.text('hair-color') } : undefined },
      { code: 'Eye color', value: form.text('eye-color') ? { valueString: form.text('eye-color') } : undefined },
      {
        code: 'Mandated reporter statement read to youth',
        value:
          form.checkedItems('mandated-reporter').length > 0
            ? {
                valueString: 'Statement read',
                note: initials ? [{ text: `RN initials: ${initials}` }] : undefined,
                effectiveDateTime: new Date().toISOString(),
              }
            : undefined,
      },
    ]);
  }

  async function saveVitals(subject: Reference<Patient>) {
    const visionFields: [string, string][] = [
      ['vision-nocorr-left', 'Visual acuity, left eye, without correction'],
      ['vision-nocorr-right', 'Visual acuity, right eye, without correction'],
      ['vision-nocorr-both', 'Visual acuity, both eyes, without correction'],
      ['vision-corr-left', 'Visual acuity, left eye, with correction'],
      ['vision-corr-right', 'Visual acuity, right eye, with correction'],
      ['vision-corr-both', 'Visual acuity, both eyes, with correction'],
    ];

    await saveObservationSet(subject, [
      { code: 'Body temperature', value: temp ? { valueQuantity: { value: Number(temp), unit: '°F' } } : undefined },
      { code: 'Heart rate', value: pulse ? { valueQuantity: { value: Number(pulse), unit: '/min' } } : undefined },
      { code: 'Respiratory rate', value: resp ? { valueQuantity: { value: Number(resp), unit: '/min' } } : undefined },
      { code: 'Blood pressure', value: bp ? { valueString: bp } : undefined },
      { code: 'Body weight', value: weight ? { valueQuantity: { value: Number(weight), unit: 'lb' } } : undefined },
      { code: 'Body height', value: height ? { valueQuantity: { value: Number(height), unit: 'in' } } : undefined },
      {
        code: 'Body mass index (BMI)',
        value: bmi !== null ? { valueQuantity: { value: Number(bmi.toFixed(1)), unit: 'kg/m2' } } : undefined,
      },
      ...visionFields.map(([key, label]) => ({
        code: label,
        value: form.text(key) ? { valueString: form.text(key) } : undefined,
      })),
      {
        code: 'History of prescribed glasses/contacts',
        value:
          form.chip('vision-glasses-past') === 'yes'
            ? { valueString: form.text('vision-glasses-detail') || 'Yes' }
            : undefined,
      },
      {
        code: 'Chief complaint',
        value: hasComplaint === 'yes' && complaintDetail ? { valueString: complaintDetail } : undefined,
      },
      {
        code: 'Pain severity - 0-10 verbal numeric rating',
        value:
          hasPain === 'yes'
            ? {
                // Pain was reported, so the Observation is still worth recording
                // even if no score was captured — but it must not claim a score
                // of 0. FHIR requires dataAbsentReason instead of value[x],
                // never both.
                ...(painScale === undefined
                  ? {
                      dataAbsentReason: {
                        coding: [
                          { system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason', code: 'unknown' },
                        ],
                        text: 'Pain reported but no score recorded',
                      },
                    }
                  : { valueInteger: painScale }),
                note: painDetail ? [{ text: painDetail }] : undefined,
              }
            : undefined,
      },
    ]);

    const medicationKeys = new Set<string>();
    for (const row of form.rows('medications-table')) {
      const [name, dosage, frequency, reason, prescriber, lastTaken] = row;
      if (!name) continue;
      const key = `medication::${name}`;
      medicationKeys.add(key);
      // Omit `dosage` entirely when there's nothing to put in it: an array
      // holding an empty Dosage violates ele-1 ("all elements must have a
      // value or children"), so a medication logged without a dose would be
      // rejected outright.
      const dosageText = [dosage, frequency].filter(Boolean).join(', ');
      await medplum.upsertResource(
        {
          resourceType: 'MedicationStatement',
          status: 'active',
          subject,
          identifier: [{ system: SCREENING_ID_SYSTEM, value: key }],
          medicationCodeableConcept: { text: name },
          dosage: dosageText ? [{ text: dosageText }] : undefined,
          reasonCode: reason ? [{ text: reason }] : undefined,
          informationSource: prescriber ? { display: prescriber } : undefined,
          note: lastTaken ? [{ text: `Last taken: ${lastTaken}` }] : undefined,
        } as any,
        upsertQuery(key, subject)
      );
    }
    // A medication removed from the table is no longer being taken.
    await retractStale(
      'MedicationStatement',
      subject,
      (k) => k.startsWith('medication::'),
      medicationKeys
    );
  }

  // ---- Save handlers: Sections 3–4 ----

  /** Current Health Status (allergies card): allergies -> AllergyIntolerance, chronic conditions -> Condition */
  async function saveAllergiesChronic(subject: Reference<Patient>) {
    const allergyKeys = new Set<string>();
    for (const item of form.checkedItems('allergy')) {
      if (item === 'No known allergies') continue;
      const key = `allergy::${item}`;
      allergyKeys.add(key);
      await medplum.upsertResource(
        {
          resourceType: 'AllergyIntolerance',
          patient: subject,
          identifier: [{ system: SCREENING_ID_SYSTEM, value: key }],
          // Required by constraint ait-1 — see ALLERGY_CLINICAL_SYSTEM above.
          clinicalStatus: ACTIVE_ALLERGY_STATUS,
          code: { text: form.checkTextMap('allergy')[item] || item },
          reaction: form.text('allergy-reaction') ? [{ description: form.text('allergy-reaction') }] : undefined,
        } as any,
        // AllergyIntolerance has no `subject` search param — it's `patient`.
        upsertQuery(key, subject, 'patient')
      );
    }
    const chronicKeys = new Set<string>();
    // Only populated when 'chronic' is yes — so switching the answer back to
    // "no chronic conditions" leaves an empty live set and retracts them all.
    if (form.chip('chronic') === 'yes') {
      for (const item of form.checkedItems('chronic-list')) {
        const key = `chronic::${item}`;
        chronicKeys.add(key);
        await medplum.upsertResource(
          {
            resourceType: 'Condition',
            subject,
            identifier: [{ system: SCREENING_ID_SYSTEM, value: key }],
            clinicalStatus: ACTIVE_CONDITION_STATUS,
            code: { text: form.checkTextMap('chronic-list')[item] || item },
          } as any,
          upsertQuery(key, subject)
        );
      }
    }

    // Epi-Pen (task 13) and the three chronic free-text fields (task 18) were
    // all rendered but read by no save handler, so the nurse's input was
    // silently discarded. A recorded Epi-Pen "No" is worth persisting too, not
    // just a "Yes" — absence matters for anaphylaxis response. saveObservationSet
    // derives its retraction scope from these codes, so clearing any one later
    // withdraws its Observation rather than leaving a stale value.
    const epipen = form.chip('epipen');
    await saveObservationSet(subject, [
      {
        code: 'Epi-Pen prescribed or previously used',
        value: epipen
          ? {
              valueString: epipen === 'yes' ? 'Yes' : 'No',
              note: epipen === 'yes' && form.text('epipen-detail') ? [{ text: form.text('epipen-detail') }] : undefined,
            }
          : undefined,
      },
      {
        code: 'Doctors/specialists managing chronic conditions',
        value: form.text('chronic-providers') ? { valueString: form.text('chronic-providers') } : undefined,
      },
      {
        code: 'Primary care provider',
        value: form.text('chronic-pcp') ? { valueString: form.text('chronic-pcp') } : undefined,
      },
      {
        code: 'Chronic conditions: additional comments',
        value: form.text('chronic-comments') ? { valueString: form.text('chronic-comments') } : undefined,
      },
    ]);

    await retractStale('AllergyIntolerance', subject, (k) => k.startsWith('allergy::'), allergyKeys, 'patient');
    await retractStale('Condition', subject, (k) => k.startsWith('chronic::'), chronicKeys);
  }

  /** Current Health Status (appearance card): appearance/mental-status findings -> Observation */
  async function saveMentalStatus(subject: Reference<Patient>) {
    const APPEARANCE_CODE = 'Appearance/mental status finding';
    const liveKeys = new Set<string>();
    for (const item of form.checkedItems('appearance')) {
      liveKeys.add(`${APPEARANCE_CODE}::${item}`);
      await obs(subject, { code: { text: APPEARANCE_CODE }, valueString: item }, item);
    }
    await retractStale('Observation', subject, (k) => k.startsWith(`${APPEARANCE_CODE}::`), liveKeys);
  }

  /** Section 3 (Review of Systems): every checked ROS/injury item -> Observation, tagged with its system */
  async function saveReviewOfSystems(subject: Reference<Patient>) {
    const systems: [string, string][] = [
      ['injuries', 'Injuries/trauma'],
      ['firearm-safety', 'Injury prevention'],
      ['dental', 'Oral/dental'],
      ['infectious', 'Infectious disease history'],
    ];
    // Declared once and reused for both the write and the live-key set, so the
    // reconciliation can never drift from the codes actually written.
    const DENTAL_EXAM = 'Last dental exam';
    const VISION_EXAM = 'Last vision exam';
    const ROS_COMMENTS = 'Review of systems: additional comments';
    const INJURIES_DETAIL = 'Injuries/trauma: details';
    const singleFieldKeys = [DENTAL_EXAM, VISION_EXAM, ROS_COMMENTS, INJURIES_DETAIL];

    const liveKeys = new Set<string>();
    for (const [grid, label] of systems) {
      for (const item of form.checkedItems(grid)) {
        if (item.startsWith('No problems') || item.startsWith('No significant')) continue;
        const code = `Review of systems: ${label}`;
        liveKeys.add(`${code}::${item}`);
        await obs(subject, { code: { text: code }, valueString: form.checkTextMap(grid)[item] || item }, item);
      }
    }
    if (form.text('last-dental-exam')) {
      liveKeys.add(DENTAL_EXAM);
      await obs(subject, { code: { text: DENTAL_EXAM }, valueString: form.text('last-dental-exam') });
    }
    if (form.text('vision-exam-date') || form.text('vision-provider')) {
      liveKeys.add(VISION_EXAM);
      await obs(subject, {
        code: { text: VISION_EXAM },
        valueString: `Date: ${form.text('vision-exam-date') || '—'}, provider: ${form.text('vision-provider') || '—'}`,
      });
    }
    if (form.text('ros-comments')) {
      liveKeys.add(ROS_COMMENTS);
      await obs(subject, { code: { text: ROS_COMMENTS }, valueString: form.text('ros-comments') });
    }
    if (form.text('injuries-detail')) {
      liveKeys.add(INJURIES_DETAIL);
      await obs(subject, { code: { text: INJURIES_DETAIL }, valueString: form.text('injuries-detail') });
    }

    // Scope covers both the checklist rows (which carry a `::item` suffix) and
    // this section's single-value text fields, so clearing a text box retracts
    // its Observation too rather than leaving a stale value in the chart.
    await retractStale(
      'Observation',
      subject,
      (k) => (k.startsWith('Review of systems: ') && k.includes('::')) || singleFieldKeys.includes(k),
      liveKeys
    );
  }

  /** Section 4 (Diagnosis & Disposition): nursing diagnoses -> Condition, plan items -> CarePlan note, sign-off -> Observation w/ note */
  async function saveDiagnosisDisposition(subject: Reference<Patient>) {
    const diagnosisKeys = new Set<string>();
    for (const field of ['dx1', 'dx2', 'dx3', 'dx4']) {
      const val = form.text(field);
      if (val) {
        // Keyed by slot, not by text: editing a typo in diagnosis 2 should
        // correct that diagnosis, not leave the misspelling behind and add a
        // second Condition alongside it.
        const key = `nursing-diagnosis::${field}`;
        diagnosisKeys.add(key);
        await medplum.upsertResource(
          {
            resourceType: 'Condition',
            subject,
            identifier: [{ system: SCREENING_ID_SYSTEM, value: key }],
            // Required by constraint con-3, same as the chronic conditions
            // above. Its absence here was a latent copy of the ait-1 failure.
            clinicalStatus: ACTIVE_CONDITION_STATUS,
            category: [{ text: 'Nursing diagnosis' }],
            code: { text: val },
          } as any,
          upsertQuery(key, subject)
        );
      }
    }
    const planItems = form.checkedItems('nursing-plan');
    if (planItems.length > 0) {
      const key = 'nursing-plan';
      await medplum.upsertResource(
        {
          resourceType: 'CarePlan',
          status: 'active',
          intent: 'plan',
          subject,
          identifier: [{ system: SCREENING_ID_SYSTEM, value: key }],
          description: planItems.join('; '),
        } as any,
        upsertQuery(key, subject)
      );
    }
    await obs(subject, {
      code: { text: 'Admission health screening sign-off' },
      valueString: `Nurse: ${form.text('nurse-signature') || '—'}; Physician: ${form.text('physician-signature') || '—'}`,
      note: form.text('health-alerts') ? [{ text: form.text('health-alerts') }] : undefined,
    });

    // Task 19: disposition-notes, signoff-datetime, and review-date were
    // rendered in the JSX but read by no save handler, so the nurse's input
    // was silently discarded — the same epipen/task-18 class of data loss.
    await saveObservationSet(subject, [
      {
        // NOT the field's on-screen label verbatim: that label contains
        // commas, and every identifier here is derived from code.text (see
        // obs()'s doc comment). FHIR search treats a comma inside a token
        // value as an OR-separator, so an identifier search for a
        // comma-containing value silently matches nothing — discovered when
        // this exact string broke `identifier=system|value` lookups. Keep
        // derived-identifier codes comma-free, matching the convention
        // already used elsewhere (e.g. 'Chronic conditions: additional
        // comments').
        code: 'Disposition: additional notes',
        value: form.text('disposition-notes') ? { valueString: form.text('disposition-notes') } : undefined,
      },
      {
        code: 'Admission screening sign-off date/time',
        value: form.text('signoff-datetime') ? { valueDateTime: form.text('signoff-datetime') } : undefined,
      },
      {
        // Observation.value[x] has no valueDate — FHIR's dateTime type
        // accepts a date-only string (e.g. "2026-07-26"), so valueDateTime
        // holds this correctly without a spurious time component.
        code: 'Admission screening review date',
        value: form.text('review-date') ? { valueDateTime: form.text('review-date') } : undefined,
      },
    ]);

    // Scoped to the nursing-diagnosis prefix so this cannot touch the chronic
    // conditions reconciled by saveAllergiesChronic, which are also Conditions.
    await retractStale('Condition', subject, (k) => k.startsWith('nursing-diagnosis::'), diagnosisKeys);
  }

  return (
    <div className="djs-root" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <GovBanner />
      <AppHeader agencyName="Department of Juvenile Services · Health Services" />

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <SidebarStepper
          eyebrow="Maryland DJS · Health Services"
          title="Admission Health Screening & Nursing Assessment"
          subtitle="4-part intake · complete at time of admission"
          steps={STEPS}
          activeStep={activeStep}
          touchedSteps={touched}
          onSelect={goTo}
          progressPct={progressPct}
          progressLabel="Key screening"
          progressFraction={`${answeredCount} / ${trackedAnswers.length}`}
        />

        <div className="main" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <PatientBand patient={patient} facilityName={facilityName} admissionDate={admissionDate} />

          <div className="djs-content">
            {activeStep === 1 && (
              <section>
                <SectionHeader index={1} total={4} title="Demographics & Identification" description="Confirmed at intake." />
                <Card index="01" title="Identification">
                  <FieldGrid>
                    <Field label="Last name" wide><input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
                    <Field label="First name"><input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
                    <Field label="MI"><input type="text" value={middleInitial} onChange={(e) => setMiddleInitial(e.target.value)} /></Field>
                    <Field label="Date of birth"><input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></Field>
                    <Field label="Date of admission"><input type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} /></Field>
                    <Field label="Facility"><input type="text" value={facilityName} onChange={(e) => setFacilityName(e.target.value)} /></Field>
                  </FieldGrid>
                </Card>
                <Card index="02" title="Sex, birth & ethnicity">
                  <FieldGrid>
                    <Field label="Sex (biological)"><ChipGroup value={sex} onChange={setSex} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} /></Field>
                    <Field label="Hispanic / Latino"><ChipGroup value={hispanic} onChange={setHispanic} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} /></Field>
                    <Field label="Place of birth"><input type="text" value={form.text('birth-place')} onChange={(e) => form.setText('birth-place', e.target.value)} /></Field>
                  </FieldGrid>
                </Card>
                <Card index="03" title="Language & race">
                  <FieldGrid>
                    <Field label="Primary language spoken">
                      <ChipGroup value={form.chip('language')} onChange={(v) => form.setChip('language', v)} options={[{ value: 'english', label: 'English' }, { value: 'spanish', label: 'Spanish' }, { value: 'other', label: 'Other' }]} />
                      <Reveal show={form.chip('language') === 'other'}>
                        <Field label="Specify language"><input type="text" value={form.text('language-other')} onChange={(e) => form.setText('language-other', e.target.value)} /></Field>
                      </Reveal>
                    </Field>
                    <Field label="Interpreter"><Grid form={form} grid="interpreter" items="Needs interpreter" /></Field>
                  </FieldGrid>
                  <div style={{ marginTop: 14 }}>
                    <Grid form={form} grid="race" items="Black or African American|White|Asian|American Indian or Alaska Native|Native Hawaiian or Pacific Islander|Other::text" />
                  </div>
                  <FieldGrid style={{ marginTop: 14 }}>
                    <Field label="Color of hair"><input type="text" value={form.text('hair-color')} onChange={(e) => form.setText('hair-color', e.target.value)} /></Field>
                    <Field label="Color of eyes"><input type="text" value={form.text('eye-color')} onChange={(e) => form.setText('eye-color', e.target.value)} /></Field>
                  </FieldGrid>
                </Card>
                <Card index="04" title="Mandated reporter statement">
                  <p className="hint">
                    Read to the youth: &ldquo;I want you to know that if you report to me or to any DJS staff person that you have
                    been physically or sexually abused, neglected, or sexually assaulted before the age of 18, then we will need to
                    report the incident to child protective services.&rdquo;
                  </p>
                  <FieldGrid>
                    <Field label="Statement read"><Grid form={form} grid="mandated-reporter" items="Statement read to youth" /></Field>
                    <Field label="RN initials"><input type="text" value={form.text('mandated-reporter-initials')} onChange={(e) => form.setText('mandated-reporter-initials', e.target.value)} /></Field>
                  </FieldGrid>
                </Card>
                <button
                  type="button"
                  className="djs-btn"
                  disabled={savingSection === 'demographics'}
                  onClick={() => runSave('demographics', 'Demographics saved', saveDemographics)}
                >
                  {savingSection === 'demographics' ? 'Saving…' : 'Save demographics'}
                </button>
              </section>
            )}

            {activeStep === 2 && (
              <section>
                <SectionHeader index={2} total={4} title="Current Health Status" description="Vitals, allergies, chronic conditions, appearance & mental status." />
                <Card index="01" title="Vital signs">
                  <FieldGrid>
                    <Field label="Temp (°F)"><input type="text" value={temp} onChange={(e) => setTemp(e.target.value)} /></Field>
                    <Field label="Pulse"><input type="text" value={pulse} onChange={(e) => setPulse(e.target.value)} /></Field>
                    <Field label="Resp"><input type="text" value={resp} onChange={(e) => setResp(e.target.value)} /></Field>
                    <Field label="BP"><input type="text" placeholder="120/80" value={bp} onChange={(e) => setBp(e.target.value)} /></Field>
                    <Field label="Weight (lb)"><input type="text" value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
                    <Field label="Height (in)"><input type="text" value={height} onChange={(e) => setHeight(e.target.value)} /></Field>
                    <Field label="BMI (computed)">
                      <input type="text" readOnly value={bmi !== null ? bmi.toFixed(1) : ''} placeholder="—" />
                    </Field>
                  </FieldGrid>
                </Card>
                <Card index="02" title="Vision screen" hint="Triage an optometry referral if vision is 20/40 or worse, or for any other vision problem.">
                  <table className="djs-dyn">
                    <thead>
                      <tr><th></th><th>Left eye</th><th>Right eye</th><th>Both eyes</th></tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Without glasses</td>
                        <td><input type="text" placeholder="20/__" value={form.text('vision-nocorr-left')} onChange={(e) => form.setText('vision-nocorr-left', e.target.value)} /></td>
                        <td><input type="text" placeholder="20/__" value={form.text('vision-nocorr-right')} onChange={(e) => form.setText('vision-nocorr-right', e.target.value)} /></td>
                        <td><input type="text" placeholder="20/__" value={form.text('vision-nocorr-both')} onChange={(e) => form.setText('vision-nocorr-both', e.target.value)} /></td>
                      </tr>
                      <tr>
                        <td>With glasses/contacts</td>
                        <td><input type="text" placeholder="20/__" value={form.text('vision-corr-left')} onChange={(e) => form.setText('vision-corr-left', e.target.value)} /></td>
                        <td><input type="text" placeholder="20/__" value={form.text('vision-corr-right')} onChange={(e) => form.setText('vision-corr-right', e.target.value)} /></td>
                        <td><input type="text" placeholder="20/__" value={form.text('vision-corr-both')} onChange={(e) => form.setText('vision-corr-both', e.target.value)} /></td>
                      </tr>
                    </tbody>
                  </table>
                  <div style={{ marginTop: 14 }}>
                    <Field label="Given glasses or corrective contact lenses in the past?">
                      <YesNoChip form={form} track="vision-glasses-past">
                        <Field label="When & where prescribed, location & condition of glasses/lenses" wide>
                          <textarea value={form.text('vision-glasses-detail')} onChange={(e) => form.setText('vision-glasses-detail', e.target.value)} />
                        </Field>
                      </YesNoChip>
                    </Field>
                  </div>
                </Card>
                <Card index="03" title="Chief complaint">
                  <ChipGroup value={hasComplaint} onChange={setHasComplaint} options={[{ value: 'no', label: 'No current complaints' }, { value: 'yes', label: 'Yes — has a complaint' }]} />
                  <Reveal show={hasComplaint === 'yes'}><Field label="Specify"><textarea value={complaintDetail} onChange={(e) => setComplaintDetail(e.target.value)} /></Field></Reveal>
                </Card>
                <Card index="04" title="Pain">
                  <ChipGroup value={hasPain} onChange={setHasPain} options={[{ value: 'no', label: 'No pain' }, { value: 'yes', label: 'Yes — has pain' }]} />
                  <Reveal show={hasPain === 'yes'}>
                    <FieldGrid>
                      <Field label="Pain scale (0–10)" wide>
                        <input
                          type="range"
                          min={0}
                          max={10}
                          value={painScale ?? 0}
                          onChange={(e) => setPainScale(Number(e.target.value))}
                        />
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 12,
                            color: painScale === undefined ? 'var(--muted)' : 'var(--ink)',
                          }}
                        >
                          {painScale === undefined ? 'Not recorded — drag to set a score' : `${painScale} / 10`}
                        </span>
                      </Field>
                      <Field label="Describe location & nature of pain" wide><textarea value={painDetail} onChange={(e) => setPainDetail(e.target.value)} /></Field>
                    </FieldGrid>
                  </Reveal>
                </Card>
                <Card index="05" title="Current medications / supplements" hint="Is the youth prescribed or taking any medication?">
                  <DynamicTable
                    columns={['Medication name', 'Dosage', 'Frequency', 'Reason for med', 'Prescriber', 'Last taken']}
                    rows={form.rows('medications-table')}
                    onChange={(rows) => form.setRows('medications-table', rows)}
                    addLabel="+ Add medication"
                  />
                </Card>
                <Card index="06" title="Allergies">
                  <Grid form={form} grid="allergy" items="No known allergies|Latex allergy|Medication allergy|Insect allergy (bee, wasp, ant)|Food allergy|Environmental (dust, mold)|Seasonal (pollen, grass)|Other::text" />
                  <FieldGrid style={{ marginTop: 14 }}>
                    <Field label="Specify allergen(s) & reaction" wide>
                      <textarea placeholder="e.g. Penicillin — hives; Peanuts — anaphylaxis" value={form.text('allergy-reaction')} onChange={(e) => form.setText('allergy-reaction', e.target.value)} />
                    </Field>
                  </FieldGrid>
                  <div style={{ marginTop: 8 }}>
                    <Field label="Ever used / prescribed an Epi-Pen?">
                      <YesNoChip form={form} track="epipen">
                        <Field label="Specify"><input type="text" value={form.text('epipen-detail')} onChange={(e) => form.setText('epipen-detail', e.target.value)} /></Field>
                      </YesNoChip>
                    </Field>
                  </div>
                </Card>
                <Card index="07" title="Chronic health conditions">
                  <YesNoChip form={form} track="chronic" noLabel="No chronic conditions" yesLabel="Yes — has one or more">
                    <Grid form={form} grid="chronic-list" items="Asthma|Autoimmune disorder (e.g. Lupus)|Cancer|Clotting / bleeding disorder|Cystic fibrosis|Diabetes|Eczema / skin problem|Heart disease|Hypertension|HIV / immune deficiency|Kidney / urologic disorder|Liver disease or Hepatitis B/C|Seizure disorder|Sickle cell anemia or trait|Stomach / intestinal problem|Thyroid disorder|Other::text" />
                    <FieldGrid style={{ marginTop: 14 }}>
                      <Field label="Doctors / specialists managing these conditions" wide><input type="text" value={form.text('chronic-providers')} onChange={(e) => form.setText('chronic-providers', e.target.value)} /></Field>
                      <Field label="Primary care provider (if known)" wide><input type="text" value={form.text('chronic-pcp')} onChange={(e) => form.setText('chronic-pcp', e.target.value)} /></Field>
                      <Field label="Additional comments" wide><textarea value={form.text('chronic-comments')} onChange={(e) => form.setText('chronic-comments', e.target.value)} /></Field>
                    </FieldGrid>
                  </YesNoChip>
                </Card>
                <Card index="08" title="Appearance & mental status">
                  <Grid form={form} grid="appearance" items="Oriented to person|Oriented to place|Oriented to time|Appears intoxicated / under influence|Alert|Tired / sleepy|Lethargic / difficult to arouse|Well-nourished|Pale|Underweight|Overweight|Poor hygiene|Disheveled|Sweating|Visible tremors|Cooperative|Uncooperative|Confused / difficulty understanding|Calm|Agitated|Depressed|Withdrawn|Anxious|Other::text" />
                </Card>
                <button
                  type="button"
                  className="djs-btn"
                  disabled={savingSection === 'health-status'}
                  onClick={() =>
                    runSave('health-status', 'Health status saved', async () => {
                      const subject = await ensurePatientRef();
                      await saveVitals(subject);
                      await saveAllergiesChronic(subject);
                      await saveMentalStatus(subject);
                    })
                  }
                >
                  {savingSection === 'health-status' ? 'Saving…' : 'Save health status'}
                </button>
              </section>
            )}

            {activeStep === 3 && (
              <section>
                <SectionHeader index={3} total={4} title="Review of Systems & Past Medical History" />
                <Card index="01" title="Injuries / trauma">
                  <Grid form={form} grid="injuries" items="Head injury / concussion|Neck / spine injury|Fractures|Sprains / dislocations|Significant lacerations / knife wounds|Gun-shot wounds|Retained bullet fragments|Elevated lead level / poisoning|No significant injury or trauma in past|Other::text" />
                  <Field label="Details, dates, treatment" wide><textarea value={form.text('injuries-detail')} onChange={(e) => form.setText('injuries-detail', e.target.value)} /></Field>
                  <Grid form={form} grid="firearm-safety" items="Reviewed firearm safety tips with youth (no guns in home is safest; if present, keep unloaded, locked, and stored separately from ammunition)" />
                  <Callout variant="amber">Firearm safety reviewed with youth: no guns in a home where kids/teens live or visit is safest; if present, guns unloaded & locked separately from ammunition.</Callout>
                </Card>
                <Card index="03" title="Body systems" hint={'Check any findings for each system. "No problems" clears the rest of that row.'}>
                  {([['Oral / dental', 'dental', 'Braces / retainer|Has dentures / dental appliance|Reviewed importance of brushing teeth twice per day|Breath: normal|Breath: fruity|Breath: halitosis|Teeth: broken|Teeth: loose|Teeth: caries|Teeth: missing|Gums: moist|Gums: pale|Gums: swollen|Gums: bleeding|No problems|Other::text'],
                ] as const).map(([label, grid, items]) => (
                    <div key={grid} style={{ marginBottom: 18 }}>
                      <b style={{ fontSize: 12.5 }}>{label}</b>
                      <Grid form={form} grid={grid} items={items} />
                     {grid === 'dental' && (
                        <FieldGrid style={{ marginTop: 10 }}>
                          <Field label="Last dental exam"><input type="text" value={form.text('last-dental-exam')} onChange={(e) => form.setText('last-dental-exam', e.target.value)} /></Field>
                        </FieldGrid>
                      )}
                      
                    </div>
                  ))}
                  <div style={{ marginBottom: 18 }}>
                    <b style={{ fontSize: 12.5 }}>Eye</b>
                    <FieldGrid style={{ marginTop: 10 }}>
                      <Field label="Last vision exam date"><input type="text" value={form.text('vision-exam-date')} onChange={(e) => form.setText('vision-exam-date', e.target.value)} /></Field>
                      <Field label="Provider"><input type="text" value={form.text('vision-provider')} onChange={(e) => form.setText('vision-provider', e.target.value)} /></Field>
                    </FieldGrid>
                  </div>
                  <div>
                    <b style={{ fontSize: 12.5 }}>Infectious disease history</b>
                    <p className="hint" style={{ marginTop: 2 }}>&ldquo;Have you ever had&hellip;?&rdquo;</p>
                    <Grid form={form} grid="infectious" items="Chicken pox / shingles|Lice|Lyme disease|MRSA|Measles, mumps, or rubella|Meningitis|Mononucleosis|Scabies|Tuberculosis — complete DJS TB Screening Form|Viral hepatitis A, B, or C|No problems|Other::text" />
                  </div>
                  <Field label="Additional comments (all systems)" wide><textarea value={form.text('ros-comments')} onChange={(e) => form.setText('ros-comments', e.target.value)} /></Field>
                </Card>
                <button
                  type="button"
                  className="djs-btn"
                  disabled={savingSection === 'ros'}
                  onClick={() =>
                    runSave('ros', 'Review of systems saved', async () => saveReviewOfSystems(await ensurePatientRef()))
                  }
                >
                  {savingSection === 'ros' ? 'Saving…' : 'Save review of systems'}
                </button>
              </section>
            )}
            {activeStep === 4 && (
              <section>
                <SectionHeader index={4} total={4} title="Nursing Diagnosis & Disposition" />
                <Card index="01" title="Nursing diagnosis" hint="Summarize health & psychosocial issues and record nursing impression.">
                  <FieldGrid>
                    <Field label="1." wide><input type="text" value={form.text('dx1')} onChange={(e) => form.setText('dx1', e.target.value)} /></Field>
                    <Field label="2." wide><input type="text" value={form.text('dx2')} onChange={(e) => form.setText('dx2', e.target.value)} /></Field>
                    <Field label="3." wide><input type="text" value={form.text('dx3')} onChange={(e) => form.setText('dx3', e.target.value)} /></Field>
                    <Field label="4." wide><input type="text" value={form.text('dx4')} onChange={(e) => form.setText('dx4', e.target.value)} /></Field>
                  </FieldGrid>
                </Card>
                <Card index="02" title="Nursing plan / disposition">
                  <Grid form={form} grid="nursing-plan" items="DJS TB Screening Form initiated|Labs obtained per DJS Admission Lab Protocol|Scheduled for Admission History / Physical Exam|Cleared for general population" />
                  <FieldGrid style={{ marginTop: 14 }}>
                    <Field label="Health status alerts (document allergies on chart cover & problem list too)" wide><textarea value={form.text('health-alerts')} onChange={(e) => form.setText('health-alerts', e.target.value)} /></Field>
                    <Field label="Additional notes on referrals, logs, or records requested" wide><textarea value={form.text('disposition-notes')} onChange={(e) => form.setText('disposition-notes', e.target.value)} /></Field>
                  </FieldGrid>
                </Card>
                <Card index="03" title="Sign-off">
                  <FieldGrid>
                    <Field label="Nurse's signature (typed name)"><input type="text" value={form.text('nurse-signature')} onChange={(e) => form.setText('nurse-signature', e.target.value)} /></Field>
                    <Field label="Date & time completed"><input type="datetime-local" value={form.text('signoff-datetime')} onChange={(e) => form.setText('signoff-datetime', e.target.value)} /></Field>
                    <Field label="Physician's signature (typed name)"><input type="text" value={form.text('physician-signature')} onChange={(e) => form.setText('physician-signature', e.target.value)} /></Field>
                    <Field label="Review date"><input type="date" value={form.text('review-date')} onChange={(e) => form.setText('review-date', e.target.value)} /></Field>
                  </FieldGrid>
                </Card>
                <button
                  type="button"
                  className="djs-btn"
                  disabled={savingSection === 'disposition'}
                  onClick={() =>
                    runSave('disposition', 'Diagnosis & disposition saved', async () =>
                      saveDiagnosisDisposition(await ensurePatientRef())
                    )
                  }
                >
                  {savingSection === 'disposition' ? 'Saving…' : 'Save diagnosis & disposition'}
                </button>
              </section>
            )}
          </div>
        </div>
      </div>

      <AppFooter />
    </div>
  );
}
