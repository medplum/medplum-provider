import { createReference } from '@medplum/core';
import { Encounter, Observation } from '@medplum/fhirtypes';
import { Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import { useEffect, useState } from 'react';
import { Callout } from '../components/Callout';
import { Card, Field, FieldGrid, SectionHeader } from '../components/Card';
import { ChipGroup, Reveal } from '../components/ChipGroup';
import { CheckGrid } from '../components/CheckGrid';
import { DynamicTable } from '../components/DynamicTable';
import { Grid, TrackedChip, YesNoChip } from '../components/FormControls';
import { SubstanceUseGrid, SUBSTANCES } from '../components/SubstanceUseGrid';
import { AppFooter, AppHeader, GovBanner } from '../components/MarylandChrome';
import { PatientBand } from '../components/PatientBand';
import { SidebarStepper, WizardStep } from '../components/SidebarStepper';
import { parseItems, useFormState } from './formState';

const STEPS: WizardStep[] = [
  { n: 1, title: 'Demographics' },
  { n: 2, title: 'Current Health Status' },
  { n: 3, title: 'Allergies & Chronic' },
  { n: 4, title: 'Skin / Body Exam' },
  { n: 5, title: 'Mental Status & Psychosocial' },
  { n: 6, title: 'Abuse, Substance & Family' },
  { n: 7, title: 'Review of Systems' },
  { n: 8, title: 'Reproductive Health' },
  { n: 9, title: 'Diagnosis & Disposition' },
];

interface Props {
  patientId?: string;
  encounterId?: string;
}

/**
 * Full 9-section Admission Health Screening & Nursing Assessment wizard,
 * styled to match the supplied mockup and wired to Medplum FHIR resources.
 *
 * Sections 1–2 use dedicated typed state (they map onto core Patient
 * fields + a handful of well-known Observation codes). Sections 3–9 use
 * the generic `useFormState` container (see formState.ts) since they're
 * mostly large checklists/chip-groups/dynamic tables — see each
 * section's save handler for exactly which FHIR resources it produces.
 */
export function AdmissionHealthScreeningWizard({ patientId, encounterId }: Props): JSX.Element {
  const medplum = useMedplum();
  const [activeStep, setActiveStep] = useState(1);
  const [touched, setTouched] = useState<Set<number>>(new Set([1]));
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
  const [painScale, setPainScale] = useState(0);
  const [painDetail, setPainDetail] = useState('');

  // ---- Section 8 branch ----
  const [reproSex, setReproSex] = useState<'male' | 'female'>('male');

  useEffect(() => {
    if (patientId) {
      medplum.readResource('Patient', patientId).then(setPatient).catch(console.error);
    }
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

  const subjectRef = patient?.id ? createReference(patient) : undefined;
  const encounterRef: Encounter['subject'] | undefined = encounterId
    ? { reference: `Encounter/${encounterId}` }
    : undefined;

  async function obs(partial: Partial<Observation>): Promise<void> {
    await medplum.createResource<Observation>({
      resourceType: 'Observation',
      status: 'final',
      subject: subjectRef,
      encounter: encounterRef,
      ...partial,
    } as Observation);
  }

  // ---- Save handlers: Sections 1–2 (unchanged) ----
  async function saveDemographics() {
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

    if (form.text('hair-color')) {
      await obs({ code: { text: 'Hair color' }, valueString: form.text('hair-color') });
    }
    if (form.text('eye-color')) {
      await obs({ code: { text: 'Eye color' }, valueString: form.text('eye-color') });
    }
    if (form.checkedItems('mandated-reporter').length > 0) {
      await obs({
        code: { text: 'Mandated reporter statement read to youth' },
        valueString: 'Statement read',
        note: form.text('mandated-reporter-initials') ? [{ text: `RN initials: ${form.text('mandated-reporter-initials')}` }] : undefined,
        effectiveDateTime: new Date().toISOString(),
      });
    }
  }

  async function saveVitals() {
    if (!patient?.id) await saveDemographics();
    if (temp) await obs({ code: { text: 'Body temperature' }, valueQuantity: { value: Number(temp), unit: '°F' } });
    if (pulse) await obs({ code: { text: 'Heart rate' }, valueQuantity: { value: Number(pulse), unit: '/min' } });
    if (resp) await obs({ code: { text: 'Respiratory rate' }, valueQuantity: { value: Number(resp), unit: '/min' } });
    if (bp) await obs({ code: { text: 'Blood pressure' }, valueString: bp });
    if (weight) await obs({ code: { text: 'Body weight' }, valueQuantity: { value: Number(weight), unit: 'lb' } });
    if (height) await obs({ code: { text: 'Body height' }, valueQuantity: { value: Number(height), unit: 'in' } });
    if (bmi !== null) await obs({ code: { text: 'Body mass index (BMI)' }, valueQuantity: { value: Number(bmi.toFixed(1)), unit: 'kg/m2' } });

    const visionFields: [string, string][] = [
      ['vision-nocorr-left', 'Visual acuity, left eye, without correction'],
      ['vision-nocorr-right', 'Visual acuity, right eye, without correction'],
      ['vision-nocorr-both', 'Visual acuity, both eyes, without correction'],
      ['vision-corr-left', 'Visual acuity, left eye, with correction'],
      ['vision-corr-right', 'Visual acuity, right eye, with correction'],
      ['vision-corr-both', 'Visual acuity, both eyes, with correction'],
    ];
    for (const [key, label] of visionFields) {
      if (form.text(key)) await obs({ code: { text: label }, valueString: form.text(key) });
    }
    if (form.chip('vision-glasses-past') === 'yes') {
      await obs({ code: { text: 'History of prescribed glasses/contacts' }, valueString: form.text('vision-glasses-detail') || 'Yes' });
    }

    if (hasComplaint === 'yes' && complaintDetail) {
      await obs({ code: { text: 'Chief complaint' }, valueString: complaintDetail });
    }
    if (hasPain === 'yes') {
      await obs({
        code: { text: 'Pain severity - 0-10 verbal numeric rating' },
        valueInteger: painScale,
        note: painDetail ? [{ text: painDetail }] : undefined,
      });
    }

    for (const row of form.rows('medications-table')) {
      const [name, dosage, frequency, reason, prescriber, lastTaken] = row;
      if (!name) continue;
      await medplum.createResource({
        resourceType: 'MedicationStatement',
        status: 'active',
        subject: subjectRef,
        medicationCodeableConcept: { text: name },
        dosage: [{ text: [dosage, frequency].filter(Boolean).join(', ') || undefined }],
        reasonCode: reason ? [{ text: reason }] : undefined,
        informationSource: prescriber ? { display: prescriber } : undefined,
        note: lastTaken ? [{ text: `Last taken: ${lastTaken}` }] : undefined,
      } as any);
    }
  }

  // ---- Save handlers: Sections 3–9 ----

  /** Section 3: allergies -> AllergyIntolerance, chronic conditions -> Condition */
  async function saveAllergiesChronic() {
    for (const item of form.checkedItems('allergy')) {
      if (item === 'No known allergies') continue;
      await medplum.createResource({
        resourceType: 'AllergyIntolerance',
        patient: subjectRef,
        code: { text: form.checkTextMap('allergy')[item] || item },
        reaction: form.text('allergy-reaction') ? [{ description: form.text('allergy-reaction') }] : undefined,
      } as any);
    }
    if (form.chip('chronic') === 'yes') {
      for (const item of form.checkedItems('chronic-list')) {
        await medplum.createResource({
          resourceType: 'Condition',
          subject: subjectRef,
          clinicalStatus: { text: 'active' },
          code: { text: form.checkTextMap('chronic-list')[item] || item },
        } as any);
      }
    }
  }

  /** Section 4: skin findings -> Observation (bodySite text captured in note until body-chart is wired to real coordinates) */
  async function saveSkinExam() {
    for (const item of form.checkedItems('skin')) {
      await obs({ code: { text: 'Skin/body exam finding' }, valueString: form.checkTextMap('skin')[item] || item });
    }
  }

  /** Section 5: appearance findings + mental health dx (Condition) + SI/HI screening (flagged Observation) */
  async function saveMentalStatus() {
    for (const item of form.checkedItems('appearance')) {
      await obs({ code: { text: 'Appearance/mental status finding' }, valueString: item });
    }
    for (const item of form.checkedItems('mh-dx')) {
      await medplum.createResource({
        resourceType: 'Condition',
        subject: subjectRef,
        category: [{ text: 'Mental health' }],
        code: { text: form.checkTextMap('mh-dx')[item] || item },
      } as any);
    }
    if (form.chip('si-now') === 'yes') {
      await obs({
        code: { text: 'Active suicidal/homicidal ideation screening' },
        valueString: form.text('si-now-detail') || 'Positive — Behavioral Health notified per protocol',
        interpretation: [{ text: 'Critical' }],
      });
    } else if (form.chip('si-now') === 'no') {
      await obs({ code: { text: 'Active suicidal/homicidal ideation screening' }, valueString: 'Negative' });
    }
    if (form.chip('si-hist') === 'yes') {
      await obs({ code: { text: 'History of suicidal ideation/gestures/attempts' }, valueString: form.text('si-hist-detail') });
    }
  }

  /** Section 6: abuse history -> Observation, substances table -> Observation per row, family history table -> FamilyMemberHistory per row */
  async function saveAbuseSubstanceFamily() {
    if (form.chip('abuse') === 'yes') {
      await obs({
        code: { text: 'History of abuse/assault' },
        valueString: [...form.checkedItems('abuse-type'), form.text('abuse-detail')].filter(Boolean).join('; '),
      });
    }
    if (form.checkedItems('abuse-type').includes('Sexual')) {
      // Real compliance deadline from the form: MD/NP must be notified within
      // 7 days of ADMISSION (not of the disclosure) whenever sexual abuse is
      // disclosed. Modeled as a real Task with a due date, not just narrative
      // text, so it's trackable/queryable rather than easy to lose in a note.
      const dueDate = admissionDate
        ? new Date(new Date(admissionDate).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        : undefined;
      await medplum.createResource({
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        priority: 'urgent',
        for: subjectRef,
        encounter: encounterRef,
        code: { text: 'MD/NP notification of sexual abuse/assault disclosure (required within 7 days of admission)' },
        restriction: dueDate ? { period: { end: dueDate } } : undefined,
        authoredOn: new Date().toISOString(),
      } as any);
      if (form.chip('mdnp-called-now')) {
        await obs({
          code: { text: 'MD/NP called now for consultation (sexual abuse disclosed within past 2 weeks)' },
          valueString: form.chip('mdnp-called-now') === 'yes' ? 'Yes' : form.chip('mdnp-called-now') === 'no' ? 'No' : 'N/A',
        });
      }
    }
    for (const s of SUBSTANCES) {
      if (form.chip(`sub-${s.key}`) !== 'yes') continue;
      await obs({
        code: { text: `Substance use history: ${s.label}` },
        component: [
          { code: { text: 'Age at initial use' }, valueString: form.text(`sub-${s.key}-age`) || undefined },
          { code: { text: 'Method / route' }, valueString: form.text(`sub-${s.key}-method`) || undefined },
          { code: { text: 'Amount & frequency' }, valueString: form.text(`sub-${s.key}-amount`) || undefined },
          { code: { text: 'Last used' }, valueString: form.text(`sub-${s.key}-last`) || undefined },
        ].filter((c) => c.valueString),
      });
    }
    if (form.chip('sub-other') === 'yes') {
      await obs({
        code: { text: `Substance use history: ${form.text('sub-other-name') || 'Other (unspecified)'}` },
        component: [
          { code: { text: 'Age at initial use' }, valueString: form.text('sub-other-age') || undefined },
          { code: { text: 'Method / route' }, valueString: form.text('sub-other-method') || undefined },
          { code: { text: 'Amount & frequency' }, valueString: form.text('sub-other-amount') || undefined },
          { code: { text: 'Last used' }, valueString: form.text('sub-other-last') || undefined },
        ].filter((c) => c.valueString),
      });
    }
    const substanceFlags: [string, string][] = [
      ['withdrawal', 'History of withdrawal (convulsions, feeling sick)'],
      ['withdrawal-risk', 'May experience withdrawal at facility'],
      ['od', 'History of overdose / naloxone use'],
      ['sud-tx', 'Past substance abuse treatment'],
      ['mat', 'Past MAT (Vivitrol, buprenorphine, methadone)'],
    ];
    for (const [track, label] of substanceFlags) {
      if (form.chip(track)) {
        await obs({ code: { text: label }, valueString: form.chip(track) === 'yes' ? 'Yes' : 'No' });
      }
    }
    if (form.text('substance-comments')) {
      await obs({ code: { text: 'Substance use: additional comments' }, valueString: form.text('substance-comments') });
    }
    for (const row of form.rows('family-table')) {
      const [condition, relative] = row;
      if (!condition) continue;
      await medplum.createResource({
        resourceType: 'FamilyMemberHistory',
        patient: subjectRef,
        status: 'completed',
        relationship: { text: relative || 'unknown' },
        condition: [{ code: { text: condition } }],
      } as any);
    }
    if (form.text('family-comments')) {
      await obs({ code: { text: 'Family history: additional comments' }, valueString: form.text('family-comments') });
    }
  }

  /** Section 7: every checked ROS/injury item -> Observation, tagged with its system */
  async function saveReviewOfSystems() {
    const systems: [string, string][] = [
      ['injuries', 'Injuries/trauma'],
      ['firearm-safety', 'Injury prevention'],
      ['mss', 'Musculoskeletal'],
      ['eye', 'Eye'],
      ['ent', 'Ears/nose/throat'],
      ['dental', 'Oral/dental'],
      ['gi', 'GI/nutrition'],
      ['gu', 'GU/kidney'],
      ['resp', 'Respiratory/cardiovascular'],
      ['neuro', 'Neurologic'],
      ['infectious', 'Infectious disease history'],
    ];
    for (const [grid, label] of systems) {
      for (const item of form.checkedItems(grid)) {
        if (item.startsWith('No problems') || item.startsWith('No significant')) continue;
        await obs({ code: { text: `Review of systems: ${label}` }, valueString: form.checkTextMap(grid)[item] || item });
      }
    }
    if (form.chip('surgeries') === 'yes') {
      await obs({ code: { text: 'Past surgical history' }, valueString: form.text('surgeries-detail') });
    }
    if (form.chip('hosp') === 'yes') {
      await obs({ code: { text: 'Past hospitalizations' }, valueString: form.text('hosp-detail') });
    }
    if (form.text('vision-exam-date') || form.text('vision-provider')) {
      await obs({
        code: { text: 'Last vision exam' },
        valueString: `Date: ${form.text('vision-exam-date') || '—'}, provider: ${form.text('vision-provider') || '—'}`,
      });
    }
    if (form.text('last-hearing-test')) {
      await obs({ code: { text: 'Last hearing test' }, valueString: form.text('last-hearing-test') });
    }
    if (form.text('last-dental-exam')) {
      await obs({ code: { text: 'Last dental exam' }, valueString: form.text('last-dental-exam') });
    }
    if (form.chip('urine-color')) {
      await obs({ code: { text: 'Urine color' }, valueString: form.chip('urine-color') });
    }
    if (form.text('ros-comments')) {
      await obs({ code: { text: 'Review of systems: additional comments' }, valueString: form.text('ros-comments') });
    }
  }

  /** Section 8: reproductive health fields, branched by selected assessment */
  async function saveReproductiveHealth() {
    if (reproSex === 'male') {
      if (form.chip('male-tse')) {
        await obs({ code: { text: 'Testicular self-exam practice' }, valueString: form.chip('male-tse') });
      }
      for (const item of form.checkedItems('male-testicular')) {
        await obs({ code: { text: 'Testicular/scrotal finding' }, valueString: form.checkTextMap('male-testicular')[item] || item });
      }
      if (form.chip('male-sex') === 'yes') {
        await obs({
          code: { text: 'Sexual history (male assessment)' },
          valueString: [
            `Female partners (lifetime): ${form.text('male-fem-partners') || '—'}`,
            `Male partners (lifetime): ${form.text('male-male-partners') || '—'}`,
            `Age at first intercourse: ${form.text('male-first-sex-age') || '—'}`,
            `Last intercourse: ${form.text('male-last-sex') || '—'}`,
            `Condom at last intercourse: ${form.chip('male-condom') || '—'}`,
            `Partner currently pregnant: ${form.chip('male-partner-preg') || '—'}`,
          ].join('; '),
        });
      }
      for (const item of form.checkedItems('male-identity')) {
        await obs({ code: { text: 'Self-identified gender/orientation' }, valueString: form.checkTextMap('male-identity')[item] || item });
      }
      if (form.chip('male-exchange-sex') === 'yes') {
        await obs({ code: { text: 'History of exchange sex (survival/gang initiation)' }, valueString: 'Yes', interpretation: [{ text: 'Flagged' }] });
      }
      if (form.chip('male-forced-sex') === 'yes') {
        await obs({ code: { text: 'History of forced sex' }, valueString: 'Yes', interpretation: [{ text: 'Critical' }] });
      }
      if (form.chip('male-sti') === 'yes') {
        await obs({
          code: { text: 'STI history' },
          valueString: `${form.checkedItems('male-sti-list').join(', ') || '—'}; dates: ${form.text('male-sti-dates') || '—'}; treated: ${form.text('male-sti-treated') || '—'}`,
        });
      }
      if (form.chip('male-sti-worried') === 'yes') {
        await obs({ code: { text: 'Worried about current STI' }, valueString: 'Yes' });
      }
      if (form.chip('male-hiv') === 'yes') {
        await obs({ code: { text: 'HIV testing history' }, valueString: `Date: ${form.text('male-hiv-date') || '—'}, result: ${form.text('male-hiv-result') || '—'}` });
      }
    } else {
      await obs({
        code: { text: 'Menstrual history' },
        valueString: [
          `Menarche age: ${form.text('fem-menarche-age') || '—'}`,
          `LMP: ${form.text('fem-lmp') || '—'}`,
          `Period length: ${form.text('fem-period-length') || '—'}`,
          `Cycle length: ${form.text('fem-cycle-length') || '—'}`,
          `Regular: ${form.chip('fem-regular') || '—'}`,
          `Pain/heavy flow: ${form.chip('fem-pain') || '—'}`,
        ].join('; '),
      });
      if (form.chip('fem-bc') === 'yes') {
        await medplum.createResource({
          resourceType: 'Observation',
          status: 'final',
          subject: subjectRef,
          code: { text: 'Hormonal birth control' },
          valueString: `${form.checkedItems('bc-type').join(', ') || '—'}; when: ${form.text('fem-bc-when') || '—'}; used regularly: ${form.chip('fem-bc-regular') || '—'}`,
        } as any);
      }
      if (form.chip('fem-pelvic')) {
        await obs({ code: { text: 'History of pelvic exam' }, valueString: form.chip('fem-pelvic') });
      }
      if (form.chip('fem-sex') === 'yes') {
        await obs({
          code: { text: 'Sexual history (female assessment)' },
          valueString: [
            `Male partners (lifetime): ${form.text('fem-male-partners') || '—'}`,
            `Female partners (lifetime): ${form.text('fem-fem-partners') || '—'}`,
            `Age at first intercourse: ${form.text('fem-first-sex-age') || '—'}`,
            `Last intercourse: ${form.text('fem-last-sex') || '—'}`,
            `Condom at last intercourse: ${form.chip('fem-condom') || '—'}`,
          ].join('; '),
        });
      }
      for (const item of form.checkedItems('fem-identity')) {
        await obs({ code: { text: 'Self-identified gender/orientation' }, valueString: form.checkTextMap('fem-identity')[item] || item });
      }
      if (form.chip('fem-exchange-sex') === 'yes') {
        await obs({ code: { text: 'History of exchange sex (survival/gang initiation)' }, valueString: 'Yes', interpretation: [{ text: 'Flagged' }] });
      }
      if (form.chip('fem-forced-sex') === 'yes') {
        await obs({ code: { text: 'History of forced sex' }, valueString: 'Yes', interpretation: [{ text: 'Critical' }] });
      }
      if (form.chip('fem-preg-worried') === 'yes') {
        await obs({ code: { text: 'Worried about current pregnancy' }, valueString: 'Yes', interpretation: [{ text: 'Flagged' }] });
      }
      if (form.chip('fem-preg') === 'yes') {
        await obs({
          code: { text: 'Pregnancy history' },
          valueString: [
            `OB/GYN: ${form.text('fem-obgyn') || '—'}`,
            `Pregnancies: ${form.text('fem-pregnancies') || '—'}`,
            `Live births: ${form.text('fem-live-births') || '—'}`,
            `Miscarriages: ${form.text('fem-miscarriages') || '—'}`,
            `Abortions: ${form.text('fem-abortions') || '—'}`,
          ].join('; '),
        });
      }
      if (form.chip('ec') && form.chip('ec') !== 'na') {
        await obs({ code: { text: 'Emergency contraception discussion' }, valueString: form.chip('ec') });
      }
      if (form.chip('fem-sti') === 'yes') {
        await obs({
          code: { text: 'STI/PID history' },
          valueString: `${form.checkedItems('fem-sti-list').join(', ') || '—'}; dates: ${form.text('fem-sti-dates') || '—'}; treated: ${form.text('fem-sti-treated') || '—'}`,
        });
      }
      if (form.chip('fem-hiv') === 'yes') {
        await obs({ code: { text: 'HIV testing history' }, valueString: `Date: ${form.text('fem-hiv-date') || '—'}, result: ${form.text('fem-hiv-result') || '—'}` });
      }
    }
    if (form.text('followup-phone')) {
      await obs({
        code: { text: 'Preferred follow-up contact' },
        valueString: `${form.text('followup-phone')} (${form.chip('phone-type') || 'unspecified'}) — ${form.text('followup-phone-whose') || 'owner unspecified'}`,
      });
    }
  }

  /** Section 9: nursing diagnoses -> Condition, plan items -> CarePlan note, sign-off -> Observation w/ note */
  async function saveDiagnosisDisposition() {
    for (const key of ['dx1', 'dx2', 'dx3', 'dx4']) {
      const val = form.text(key);
      if (val) {
        await medplum.createResource({
          resourceType: 'Condition',
          subject: subjectRef,
          category: [{ text: 'Nursing diagnosis' }],
          code: { text: val },
        } as any);
      }
    }
    const planItems = form.checkedItems('nursing-plan');
    if (planItems.length > 0) {
      await medplum.createResource({
        resourceType: 'CarePlan',
        status: 'active',
        intent: 'plan',
        subject: subjectRef,
        description: planItems.join('; '),
      } as any);
    }
    await obs({
      code: { text: 'Admission health screening sign-off' },
      valueString: `Nurse: ${form.text('nurse-signature') || '—'}; Physician: ${form.text('physician-signature') || '—'}`,
      note: form.text('health-alerts') ? [{ text: form.text('health-alerts') }] : undefined,
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <GovBanner />
      <AppHeader agencyName="Department of Juvenile Services · Health Services" />

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <SidebarStepper
          eyebrow="Maryland DJS · Health Services"
          title="Admission Health Screening & Nursing Assessment"
          subtitle="9-part intake · complete at time of admission"
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
                <SectionHeader index={1} total={9} title="Demographics & Identification" description="Confirmed at intake." />
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
                <button type="button" className="djs-btn" onClick={saveDemographics}>Save demographics</button>
              </section>
            )}

            {activeStep === 2 && (
              <section>
                <SectionHeader index={2} total={9} title="Current Health Status" description="Vitals, chief complaint, and pain." />
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
                        <input type="range" min={0} max={10} value={painScale} onChange={(e) => setPainScale(Number(e.target.value))} />
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>{painScale}</span>
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
                <button type="button" className="djs-btn" onClick={saveVitals}>Save health status</button>
              </section>
            )}

            {activeStep === 3 && (
              <section>
                <SectionHeader index={3} total={9} title="Allergies & Chronic Conditions" description="Anything flagged here should also be reflected on the chart cover and problem list." />
                <Card index="01" title="Allergies">
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
                <Card index="02" title="Chronic health conditions">
                  <YesNoChip form={form} track="chronic" noLabel="No chronic conditions" yesLabel="Yes — has one or more">
                    <Grid form={form} grid="chronic-list" items="Asthma|Autoimmune disorder (e.g. Lupus)|Cancer|Clotting / bleeding disorder|Cystic fibrosis|Diabetes|Eczema / skin problem|Heart disease|Hypertension|HIV / immune deficiency|Kidney / urologic disorder|Liver disease or Hepatitis B/C|Seizure disorder|Sickle cell anemia or trait|Stomach / intestinal problem|Thyroid disorder|Other::text" />
                    <FieldGrid style={{ marginTop: 14 }}>
                      <Field label="Doctors / specialists managing these conditions" wide><input type="text" value={form.text('chronic-providers')} onChange={(e) => form.setText('chronic-providers', e.target.value)} /></Field>
                      <Field label="Primary care provider (if known)" wide><input type="text" value={form.text('chronic-pcp')} onChange={(e) => form.setText('chronic-pcp', e.target.value)} /></Field>
                      <Field label="Additional comments" wide><textarea value={form.text('chronic-comments')} onChange={(e) => form.setText('chronic-comments', e.target.value)} /></Field>
                    </FieldGrid>
                  </YesNoChip>
                </Card>
                <button type="button" className="djs-btn" onClick={saveAllergiesChronic}>Save allergies & chronic conditions</button>
              </section>
            )}

            {activeStep === 4 && (
              <section>
                <SectionHeader index={4} total={9} title="Skin / Body Examination" description="Check any findings, then note location." />
                <Card index="01" title="Findings">
                  <Grid form={form} grid="skin" items="Acne|Alopecia (hair loss)|Bites (animal, human, insect)|Blisters|Boils / pustules|Bruises|Burns|Casts / splints|Draining sores|Dry skin|Erythema (redness)|Excoriations (scratches)|Hives|Jaundice|Laceration / wound|Lice|Nail problem|Needle / track marks|Piercing(s)|Rash|Scar|Sutures / staples|Swelling|Tattoo|Warts|Other::text" />
                </Card>
                <Card index="02" title="Body chart" hint="Full body-map click-to-place markers weren't carried over from the mockup (it was visual-only there too) — capture location in the notes field for now; see README for wiring Observation.bodySite properly.">
                  <Field label="Location notes for findings above" wide>
                    <textarea value={form.text('body-chart-notes')} onChange={(e) => form.setText('body-chart-notes', e.target.value)} />
                  </Field>
                </Card>
                <button type="button" className="djs-btn" onClick={saveSkinExam}>Save skin/body exam</button>
              </section>
            )}

            {activeStep === 5 && (
              <section>
                <SectionHeader index={5} total={9} title="Appearance, Mental Status & Psychosocial History" description="Contact Behavioral Health staff immediately if the youth reports current suicidal or homicidal ideation." />
                <Card index="01" title="Appearance & mental status">
                  <Grid form={form} grid="appearance" items="Oriented to person|Oriented to place|Oriented to time|Appears intoxicated / under influence|Alert|Tired / sleepy|Lethargic / difficult to arouse|Well-nourished|Pale|Underweight|Overweight|Poor hygiene|Disheveled|Sweating|Visible tremors|Cooperative|Uncooperative|Confused / difficulty understanding|Calm|Agitated|Depressed|Withdrawn|Anxious|Other::text" />
                </Card>
                <Card index="02" title="Psychosocial history">
                  <FieldGrid>
                    <Field label="Prior to admission, residing with" wide><input type="text" value={form.text('residing-with')} onChange={(e) => form.setText('residing-with', e.target.value)} /></Field>
                    <Field label="Last time home"><input type="text" value={form.text('last-home')} onChange={(e) => form.setText('last-home', e.target.value)} /></Field>
                    <Field label="Ever homeless or a runaway?">
                      <YesNoChip form={form} track="homeless"><Field label="When and where"><input type="text" value={form.text('homeless-detail')} onChange={(e) => form.setText('homeless-detail', e.target.value)} /></Field></YesNoChip>
                    </Field>
                  </FieldGrid>
                  <FieldGrid style={{ marginTop: 14 }}>
                    <Field label="Parent / guardian name(s) & phone number(s)" wide><input type="text" value={form.text('guardians')} onChange={(e) => form.setText('guardians', e.target.value)} /></Field>
                    <Field label="# Brothers"><input type="text" inputMode="numeric" value={form.text('brothers')} onChange={(e) => form.setText('brothers', e.target.value)} /></Field>
                    <Field label="# Sisters"><input type="text" inputMode="numeric" value={form.text('sisters')} onChange={(e) => form.setText('sisters', e.target.value)} /></Field>
                  </FieldGrid>
                  <FieldGrid style={{ marginTop: 14 }}>
                    <Field label="Does youth have any children?"><YesNoChip form={form} track="children"><Field label="DOB, sex, location"><input type="text" value={form.text('children-detail')} onChange={(e) => form.setText('children-detail', e.target.value)} /></Field></YesNoChip></Field>
                    <Field label="Any parent, sibling, or child deceased?"><YesNoChip form={form} track="deceased"><Field label="Who, age, how died"><input type="text" value={form.text('deceased-detail')} onChange={(e) => form.setText('deceased-detail', e.target.value)} /></Field></YesNoChip></Field>
                    <Field label="Any family member in DJS or jail?"><YesNoChip form={form} track="famdjs"><Field label="Specify"><input type="text" value={form.text('famdjs-detail')} onChange={(e) => form.setText('famdjs-detail', e.target.value)} /></Field></YesNoChip></Field>
                  </FieldGrid>
                  <FieldGrid style={{ marginTop: 14 }}>
                    <Field label="Last school attended" wide><input type="text" value={form.text('school')} onChange={(e) => form.setText('school', e.target.value)} /></Field>
                    <Field label="Last grade completed"><input type="text" value={form.text('grade')} onChange={(e) => form.setText('grade', e.target.value)} /></Field>
                    <Field label="Learning disability / special ed?"><YesNoChip form={form} track="ld"><Field label="Specify"><input type="text" value={form.text('ld-detail')} onChange={(e) => form.setText('ld-detail', e.target.value)} /></Field></YesNoChip></Field>
                  </FieldGrid>
                  <FieldGrid style={{ marginTop: 14 }}>
                    <Field label="Youth employed?"><YesNoChip form={form} track="employed"><Field label="Specify"><input type="text" value={form.text('employed-detail')} onChange={(e) => form.setText('employed-detail', e.target.value)} /></Field></YesNoChip></Field>
                    <Field label="Sports activities" wide><input type="text" value={form.text('sports')} onChange={(e) => form.setText('sports', e.target.value)} /></Field>
                  </FieldGrid>
                </Card>
                <Card index="03" title="Previous placements or detention">
                  <YesNoChip form={form} track="placements" noLabel="No previous placements" yesLabel="Yes — has history">
                    <Grid form={form} grid="placement-facilities" items="Alfred D Noyes|Baltimore City Juvenile Justice Center|Carter|Cheltenham|Hickey|Lower Eastern Shore|Victor Cullen|Waxter|Western Maryland|Youth Centers / Allegany County|Adult Detention Center / Jail::text|Youth Detention Center (YDC), Baltimore DOC|Youth Services Center (YSC), Wash DC|Group Home::text|Out of State::text|Residential Treatment Center::text|Other::text" />
                    <DynamicTable
                      columns={['Facility', '# Times admitted', 'Date(s)']}
                      rows={form.rows('placements-table')}
                      onChange={(rows) => form.setRows('placements-table', rows)}
                      addLabel="+ Add placement record"
                    />
                  </YesNoChip>
                </Card>
                <Card index="04" title="Mental health history">
                  <Callout variant="amber">Contact Behavioral Health staff if the youth is currently having suicidal or homicidal ideation.</Callout>
                  <div style={{ marginTop: 14 }}>
                    <Field label="Prior psychiatric hospitalization / in-patient evaluation?">
                      <YesNoChip form={form} track="psychhosp"><Field label="Specify where, when"><input type="text" value={form.text('psychhosp-detail')} onChange={(e) => form.setText('psychhosp-detail', e.target.value)} /></Field></YesNoChip>
                    </Field>
                  </div>
                  <Field label="Diagnosed mental health illness" wide>
                    <Grid form={form} grid="mh-dx" items="Anxiety|ADHD|Depression|OCD|Disruptive Mood Dysregulation Disorder|Intermittent Explosive Disorder|Bipolar / other mood disorder|PTSD|Other::text" />
                  </Field>
                  <FieldGrid style={{ marginTop: 14 }}>
                    <Field label="History of suicidal ideation / gestures / attempts?">
                      <YesNoChip form={form} track="si-hist" danger><Field label="Specify"><input type="text" value={form.text('si-hist-detail')} onChange={(e) => form.setText('si-hist-detail', e.target.value)} /></Field></YesNoChip>
                    </Field>
                    <Field label="History of hallucinations?">
                      <YesNoChip form={form} track="hallucinations"><Field label="Auditory / visual / tactile — specify"><input type="text" value={form.text('hallucinations-detail')} onChange={(e) => form.setText('hallucinations-detail', e.target.value)} /></Field></YesNoChip>
                    </Field>
                    <Field label="Ever on psychiatric medication?">
                      <YesNoChip form={form} track="psychmed"><Field label="Specify"><input type="text" value={form.text('psychmed-detail')} onChange={(e) => form.setText('psychmed-detail', e.target.value)} /></Field></YesNoChip>
                    </Field>
                  </FieldGrid>
                  <div style={{ marginTop: 16 }}>
                    <Field label={'Ask directly: "Do you currently feel like hurting yourself or someone else?"'}>
                      <YesNoChip form={form} track="si-now" danger>
                        <Callout variant="critical">Active ideation reported — notify Behavioral Health staff immediately per protocol before continuing the screening.</Callout>
                        <Field label="Specify"><textarea value={form.text('si-now-detail')} onChange={(e) => form.setText('si-now-detail', e.target.value)} /></Field>
                      </YesNoChip>
                    </Field>
                  </div>
                </Card>
                <button type="button" className="djs-btn" onClick={saveMentalStatus}>Save mental status & psychosocial</button>
              </section>
            )}

            {activeStep === 6 && (
              <section>
                <SectionHeader index={6} total={9} title="Abuse History, Substance Use & Family History" />
                <Card index="01" title="History of abuse / assault">
                  <Callout variant="amber">Being sex trafficked under the age of 18 is itself a form of sexual abuse and must be reported.</Callout>
                  <div style={{ marginTop: 14 }}>
                    <YesNoChip form={form} track="abuse" danger>
                      <Grid form={form} grid="abuse-type" items="Physical|Sexual|Neglect|Mental injury" />
                      <FieldGrid style={{ marginTop: 12 }}>
                        <Field label="Describe incident(s)" wide><textarea value={form.text('abuse-detail')} onChange={(e) => form.setText('abuse-detail', e.target.value)} /></Field>
                      </FieldGrid>
                      <FieldGrid style={{ marginTop: 4 }}>
                        <Field label="Reported to authorities?"><YesNoChip form={form} track="abuse-reported"><Field label="When and by whom"><input type="text" value={form.text('abuse-reported-detail')} onChange={(e) => form.setText('abuse-reported-detail', e.target.value)} /></Field></YesNoChip></Field>
                        <Field label="Mental health referral"><ChipGroup value={form.chip('mh-referral')} onChange={(v) => form.setChip('mh-referral', v)} options={[{ value: 'accepted', label: 'Accepted' }, { value: 'declined', label: 'Declined' }, { value: 'na', label: 'N/A' }]} /></Field>
                        <Field label="SAFE / SANE referral made?"><ChipGroup value={form.chip('safe-sane')} onChange={(v) => form.setChip('safe-sane', v)} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'na', label: 'N/A' }]} /></Field>
                      </FieldGrid>
                      <Callout variant="red">If not reported, or reporting is unverified, report to CPS per DJS policy. If a sexual assault occurred in the community and the youth was 18 or older at the time, obtain informed consent before reporting to an outside agency.</Callout>
                      <Reveal show={form.checkedItems('abuse-type').includes('Sexual')}>
                        <Callout variant="critical">
                          Sexual abuse/assault disclosed: MD/NP must be notified within 7 days of admission. If the assault occurred
                          within the past 2 weeks, call the on-call MD/NP now for consultation.
                        </Callout>
                        <FieldGrid style={{ marginTop: 12 }}>
                          <Field label="Called MD/NP now for consultation?">
                            <ChipGroup value={form.chip('mdnp-called-now')} onChange={(v) => form.setChip('mdnp-called-now', v)} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'na', label: 'N/A' }]} />
                          </Field>
                        </FieldGrid>
                      </Reveal>
                    </YesNoChip>
                  </div>
                </Card>
                <Card index="02" title="Substance use history" hint="Check every substance ever used and log its details in the same row.">
                  <SubstanceUseGrid form={form} />
                  <FieldGrid style={{ marginTop: 18 }}>
                    <Field label="History of withdrawal (convulsions, feeling sick)?"><YesNoChip form={form} track="withdrawal" /></Field>
                    <Field label="May experience withdrawal at facility?"><YesNoChip form={form} track="withdrawal-risk" /></Field>
                    <Field label="History of overdose / naloxone use?"><YesNoChip form={form} track="od" /></Field>
                    <Field label="Past substance abuse treatment?"><YesNoChip form={form} track="sud-tx" /></Field>
                    <Field label="Past MAT (Vivitrol, buprenorphine, methadone)?"><YesNoChip form={form} track="mat" /></Field>
                  </FieldGrid>
                  <Field label="Additional comments" wide><textarea value={form.text('substance-comments')} onChange={(e) => form.setText('substance-comments', e.target.value)} /></Field>
                  <Callout variant="red">Call the MD if the youth appears intoxicated or at risk for withdrawal / drug dependence.</Callout>
                </Card>
                <Card index="03" title="Family history" hint="Check any condition present in the family, then note the relative for each.">
                  <Grid form={form} grid="family-hx" items="Asthma|Cancer|Diabetes|Heart disease|High blood pressure|High cholesterol|Stroke or clot|Hepatitis B or C|HIV / AIDS|Kidney disease / dialysis|Mental health illness|Sickle cell anemia|Drug / alcohol disorder|Other::text" />
                  <DynamicTable
                    columns={['Condition', 'Relative (parent, sibling, grandparent, etc.)']}
                    rows={form.rows('family-table')}
                    onChange={(rows) => form.setRows('family-table', rows)}
                    addLabel="+ Add relative detail"
                  />
                  <Field label="Additional comments" wide><textarea value={form.text('family-comments')} onChange={(e) => form.setText('family-comments', e.target.value)} /></Field>
                </Card>
                <button type="button" className="djs-btn" onClick={saveAbuseSubstanceFamily}>Save abuse, substance & family history</button>
              </section>
            )}

            {activeStep === 7 && (
              <section>
                <SectionHeader index={7} total={9} title="Review of Systems & Past Medical History" />
                <Card index="01" title="Injuries / trauma">
                  <Grid form={form} grid="injuries" items="Head injury / concussion|Neck / spine injury|Fractures|Sprains / dislocations|Significant lacerations / knife wounds|Gun-shot wounds|Retained bullet fragments|Elevated lead level / poisoning|No significant injury or trauma in past|Other::text" />
                  <Field label="Details, dates, treatment" wide><textarea value={form.text('injuries-detail')} onChange={(e) => form.setText('injuries-detail', e.target.value)} /></Field>
                  <Grid form={form} grid="firearm-safety" items="Reviewed firearm safety tips with youth (no guns in home is safest; if present, keep unloaded, locked, and stored separately from ammunition)" />
                  <Callout variant="amber">Firearm safety reviewed with youth: no guns in a home where kids/teens live or visit is safest; if present, guns unloaded & locked separately from ammunition.</Callout>
                </Card>
                <Card index="02" title="Past surgeries / hospitalizations">
                  <FieldGrid>
                    <Field label="Surgeries"><YesNoChip form={form} track="surgeries" noLabel="None"><Field label="Specify, with dates & location"><input type="text" value={form.text('surgeries-detail')} onChange={(e) => form.setText('surgeries-detail', e.target.value)} /></Field></YesNoChip></Field>
                    <Field label="Hospitalizations"><YesNoChip form={form} track="hosp" noLabel="None"><Field label="Specify, with dates & location"><input type="text" value={form.text('hosp-detail')} onChange={(e) => form.setText('hosp-detail', e.target.value)} /></Field></YesNoChip></Field>
                  </FieldGrid>
                </Card>
                <Card index="03" title="Body systems" hint={'Check any findings for each system. "No problems" clears the rest of that row.'}>
                  {([
                    ['Musculoskeletal', 'mss', 'Arthritis|Joint swelling|Hand, arm, or shoulder problem|Limitation of movement|Foot, leg, hip/pelvis problem|Difficulty walking|Chest, back, or spine problem|Amputation / deformity / prosthetic|Scoliosis / back brace|Physical handicap|No problems|Other::text'],
                    ['Eye', 'eye', 'Wears eyeglasses or contacts|Eye burning or itching|Has difficulty seeing|Erythema / redness on exam|Blindness or severe vision impairment|Discharge on exam|No problems|Other::text'],
                    ['Ears / nose / throat', 'ent', 'Trouble hearing|Deafness|Uses hearing aid|Tinnitus (ringing)|Ear pain|Ear drainage|Foreign body / wax occluding ear|Inflammation / swelling of ear|Nasal congestion|Runny nose|Frequent / prolonged nosebleeds|Current epistaxis|Sore throat|Obstructive sleep apnea / CPAP|No problems|Other::text'],
                    ['Oral / dental', 'dental', 'Braces / retainer|Has dentures / dental appliance|Reviewed importance of brushing teeth twice per day|Breath: normal|Breath: fruity|Breath: halitosis|Teeth: broken|Teeth: loose|Teeth: caries|Teeth: missing|Gums: moist|Gums: pale|Gums: swollen|Gums: bleeding|No problems|Other::text'],
                    ['GI / nutrition', 'gi', 'Stomach / gallbladder problem|Bowel disease|Recent weight loss or gain|Eating disorder (anorexia, bulimia, pica)|History of anemia or vitamin deficiency|On a special diet|Nausea|Vomiting|Diarrhea|Constipation|Blood in stool|Encopresis (leaking stool)|No problems|Other::text'],
                    ['GU / kidney', 'gu', 'Urinary frequency or urgency|Burning / pain on urination|History of UTI|Enuresis (bed wetting)|Kidney disease / stones / dialysis|Genital / vaginal itching or discharge|Blood in urine|No problems|Other::text'],
                    ['Respiratory / cardiovascular', 'resp', 'Asthma — complete DJS Asthma Assessment Tool|Chronic cough|Shortness of breath|Chest pain|Breast problem (pain, mass, discharge)|History of pneumonia|Heart murmur or palpitations|Wheezing|Coughing during assessment|Blood-tinged sputum|No problems|Other::text'],
                    ['Neurologic', 'neuro', 'Dizziness / vertigo|History of fainting|Frequent / chronic headaches|Migraines|Tics|Tingling / numbness / paralysis|History of tremors / convulsions|Weakness|No problems|Other::text'],
                  ] as const).map(([label, grid, items]) => (
                    <div key={grid} style={{ marginBottom: 18 }}>
                      <b style={{ fontSize: 12.5 }}>{label}</b>
                      <Grid form={form} grid={grid} items={items} />
                      {grid === 'ent' && (
                        <FieldGrid style={{ marginTop: 10 }}>
                          <Field label="Last hearing test"><input type="text" value={form.text('last-hearing-test')} onChange={(e) => form.setText('last-hearing-test', e.target.value)} /></Field>
                        </FieldGrid>
                      )}
                      {grid === 'dental' && (
                        <FieldGrid style={{ marginTop: 10 }}>
                          <Field label="Last dental exam"><input type="text" value={form.text('last-dental-exam')} onChange={(e) => form.setText('last-dental-exam', e.target.value)} /></Field>
                        </FieldGrid>
                      )}
                      {grid === 'gu' && (
                        <FieldGrid style={{ marginTop: 10 }}>
                          <Field label="Urine color">
                            <div className="djs-chip-group">
                              {['Clear', 'Yellow', 'Brown', 'Red', 'Cloudy'].map((c) => (
                                <button
                                  key={c}
                                  type="button"
                                  className={`djs-chip ${form.chip('urine-color') === c ? 'active' : ''}`}
                                  onClick={() => form.setChip('urine-color', c)}
                                >
                                  {c}
                                </button>
                              ))}
                            </div>
                          </Field>
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
                <button type="button" className="djs-btn" onClick={saveReviewOfSystems}>Save review of systems</button>
              </section>
            )}

            {activeStep === 8 && (
              <section>
                <SectionHeader index={8} total={9} title="Reproductive Health Assessment" description="Select the appropriate assessment. Sexual-history questions are gated behind a yes/no to reduce exposure of sensitive answers until relevant." />
                <div className="djs-chip-group" style={{ marginBottom: 18 }}>
                  <button type="button" className={`djs-chip ${reproSex === 'male' ? 'active' : ''}`} onClick={() => setReproSex('male')}>Male assessment</button>
                  <button type="button" className={`djs-chip ${reproSex === 'female' ? 'active' : ''}`} onClick={() => setReproSex('female')}>Female assessment</button>
                </div>

                {reproSex === 'male' && (
                  <>
                    <Card index="M1" title="Testicular health">
                      <Field label="Performs testicular self-exams?"><ChipGroup value={form.chip('male-tse')} onChange={(v) => form.setChip('male-tse', v)} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} /></Field>
                      <div style={{ marginTop: 12 }}>
                        <Grid form={form} grid="male-testicular" items="Undescended testicle|Testicular, scrotal, or genital lump/mass|Other testicular or scrotal concern" />
                      </div>
                    </Card>
                    <Card index="M2" title="Sexual history">
                      <YesNoChip form={form} track="male-sex" noLabel="No to all">
                        <FieldGrid>
                          <Field label="# Female partners (lifetime)"><input type="text" inputMode="numeric" value={form.text('male-fem-partners')} onChange={(e) => form.setText('male-fem-partners', e.target.value)} /></Field>
                          <Field label="# Male partners (lifetime)"><input type="text" inputMode="numeric" value={form.text('male-male-partners')} onChange={(e) => form.setText('male-male-partners', e.target.value)} /></Field>
                          <Field label="Age at first intercourse"><input type="text" inputMode="numeric" value={form.text('male-first-sex-age')} onChange={(e) => form.setText('male-first-sex-age', e.target.value)} /></Field>
                          <Field label="Last sexual intercourse"><input type="text" value={form.text('male-last-sex')} onChange={(e) => form.setText('male-last-sex', e.target.value)} /></Field>
                          <Field label="Condom used at last intercourse?"><ChipGroup value={form.chip('male-condom')} onChange={(v) => form.setChip('male-condom', v)} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }, { value: 'broke', label: 'Yes, broke' }]} /></Field>
                          <Field label="Any partner currently pregnant?"><ChipGroup value={form.chip('male-partner-preg')} onChange={(v) => form.setChip('male-partner-preg', v)} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} /></Field>
                        </FieldGrid>
                        <Callout variant="amber">Discuss consistent condom use to prevent STIs and unplanned pregnancy; condoms available on discharge or home pass.</Callout>
                      </YesNoChip>
                    </Card>
                    <Card index="M3" title="Identity & safety">
                      <Field label="Self identifies as" wide><Grid form={form} grid="male-identity" items="Male|Female|Heterosexual|Gay|Bisexual|Transgender|Intersex|Questioning|Lesbian|Other::text" /></Field>
                      <FieldGrid style={{ marginTop: 12 }}>
                        <Field label="Ever had sex in exchange for drugs, money, gang initiation, or survival?"><ChipGroup value={form.chip('male-exchange-sex')} onChange={(v) => form.setChip('male-exchange-sex', v)} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} /></Field>
                        <Field label="Ever forced to have sex?"><ChipGroup value={form.chip('male-forced-sex')} onChange={(v) => form.setChip('male-forced-sex', v)} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes', danger: true }]} /></Field>
                      </FieldGrid>
                    </Card>
                    <Card index="M4" title="STI & HIV">
                      <Field label="Ever had an STI?">
                        <YesNoChip form={form} track="male-sti">
                          <Grid form={form} grid="male-sti-list" items="Chlamydia|Gonorrhea|Herpes|Syphilis|Trichomonas|HPV / warts" />
                          <FieldGrid style={{ marginTop: 10 }}>
                            <Field label="Date(s)"><input type="text" value={form.text('male-sti-dates')} onChange={(e) => form.setText('male-sti-dates', e.target.value)} /></Field>
                            <Field label="Treated?"><input type="text" value={form.text('male-sti-treated')} onChange={(e) => form.setText('male-sti-treated', e.target.value)} /></Field>
                          </FieldGrid>
                        </YesNoChip>
                      </Field>
                      <FieldGrid style={{ marginTop: 14 }}>
                        <Field label="Worried they may have an STI?"><ChipGroup value={form.chip('male-sti-worried')} onChange={(v) => form.setChip('male-sti-worried', v)} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} /></Field>
                        <Field label="Ever tested for HIV?">
                          <YesNoChip form={form} track="male-hiv">
                            <FieldGrid>
                              <Field label="Date"><input type="text" value={form.text('male-hiv-date')} onChange={(e) => form.setText('male-hiv-date', e.target.value)} /></Field>
                              <Field label="Result"><input type="text" value={form.text('male-hiv-result')} onChange={(e) => form.setText('male-hiv-result', e.target.value)} /></Field>
                            </FieldGrid>
                          </YesNoChip>
                        </Field>
                      </FieldGrid>
                      <Callout variant="amber">If high risk, or not HIV-tested in the past 6 months with documented results, review the DJS Informed Consent & Pre-Test Information form before testing.</Callout>
                    </Card>
                  </>
                )}

                {reproSex === 'female' && (
                  <>
                    <Card index="F1" title="Menstrual history">
                      <FieldGrid>
                        <Field label="Age at first period"><input type="text" inputMode="numeric" value={form.text('fem-menarche-age')} onChange={(e) => form.setText('fem-menarche-age', e.target.value)} /></Field>
                        <Field label="Date of last period"><input type="date" value={form.text('fem-lmp')} onChange={(e) => form.setText('fem-lmp', e.target.value)} /></Field>
                        <Field label="How long do periods last"><input type="text" value={form.text('fem-period-length')} onChange={(e) => form.setText('fem-period-length', e.target.value)} /></Field>
                        <Field label="Days between periods"><input type="text" value={form.text('fem-cycle-length')} onChange={(e) => form.setText('fem-cycle-length', e.target.value)} /></Field>
                        <Field label="Regular?"><ChipGroup value={form.chip('fem-regular')} onChange={(v) => form.setChip('fem-regular', v)} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} /></Field>
                        <Field label="Pain / cramps / heavy flow?"><ChipGroup value={form.chip('fem-pain')} onChange={(v) => form.setChip('fem-pain', v)} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} /></Field>
                      </FieldGrid>
                    </Card>
                    <Card index="F2" title="Birth control & pelvic exam">
                      <Field label="Currently on hormonal birth control?">
                        <YesNoChip form={form} track="fem-bc">
                          <Grid form={form} grid="bc-type" items="Pills|Depo / shot|Implant|IUD|Patch|Ring|Other::text" />
                          <FieldGrid style={{ marginTop: 10 }}>
                            <Field label="Last taken / when placed"><input type="text" value={form.text('fem-bc-when')} onChange={(e) => form.setText('fem-bc-when', e.target.value)} /></Field>
                            <Field label="Used regularly?"><ChipGroup value={form.chip('fem-bc-regular')} onChange={(v) => form.setChip('fem-bc-regular', v)} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} /></Field>
                          </FieldGrid>
                        </YesNoChip>
                      </Field>
                      <div style={{ marginTop: 14 }}>
                        <Field label="History of pelvic exam?"><ChipGroup value={form.chip('fem-pelvic')} onChange={(v) => form.setChip('fem-pelvic', v)} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }, { value: 'unsure', label: "Don't know" }]} /></Field>
                      </div>
                    </Card>
                    <Card index="F3" title="Sexual history">
                      <YesNoChip form={form} track="fem-sex" noLabel="No to all">
                        <FieldGrid>
                          <Field label="# Male partners (lifetime)"><input type="text" inputMode="numeric" value={form.text('fem-male-partners')} onChange={(e) => form.setText('fem-male-partners', e.target.value)} /></Field>
                          <Field label="# Female partners (lifetime)"><input type="text" inputMode="numeric" value={form.text('fem-fem-partners')} onChange={(e) => form.setText('fem-fem-partners', e.target.value)} /></Field>
                          <Field label="Age at first intercourse"><input type="text" inputMode="numeric" value={form.text('fem-first-sex-age')} onChange={(e) => form.setText('fem-first-sex-age', e.target.value)} /></Field>
                          <Field label="Last sexual intercourse"><input type="text" value={form.text('fem-last-sex')} onChange={(e) => form.setText('fem-last-sex', e.target.value)} /></Field>
                          <Field label="Condom used at last intercourse?"><ChipGroup value={form.chip('fem-condom')} onChange={(v) => form.setChip('fem-condom', v)} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }, { value: 'broke', label: 'Yes, broke' }]} /></Field>
                        </FieldGrid>
                        <Callout variant="amber">Discuss consistent condom use to prevent STIs and unplanned pregnancy; condoms available on discharge or home pass.</Callout>
                      </YesNoChip>
                    </Card>
                    <Card index="F4" title="Identity & safety">
                      <Field label="Self identifies as" wide><Grid form={form} grid="fem-identity" items="Female|Male|Heterosexual|Lesbian|Gay|Bisexual|Transgender|Intersex|Questioning|Other::text" /></Field>
                      <FieldGrid style={{ marginTop: 12 }}>
                        <Field label="Ever had sex in exchange for drugs, money, gang initiation, or survival?"><ChipGroup value={form.chip('fem-exchange-sex')} onChange={(v) => form.setChip('fem-exchange-sex', v)} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} /></Field>
                        <Field label="Ever forced to have sex?"><ChipGroup value={form.chip('fem-forced-sex')} onChange={(v) => form.setChip('fem-forced-sex', v)} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes', danger: true }]} /></Field>
                      </FieldGrid>
                    </Card>
                    <Card index="F5" title="Pregnancy & emergency contraception">
                      <FieldGrid>
                        <Field label="Pregnant or worried they might be?"><ChipGroup value={form.chip('fem-preg-worried')} onChange={(v) => form.setChip('fem-preg-worried', v)} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} /></Field>
                        <Field label="Ever been pregnant?"><YesNoChip form={form} track="fem-preg" /></Field>
                      </FieldGrid>
                      <Reveal show={form.chip('fem-preg') === 'yes'}>
                        <FieldGrid>
                          <Field label="OB/GYN provider"><input type="text" value={form.text('fem-obgyn')} onChange={(e) => form.setText('fem-obgyn', e.target.value)} /></Field>
                          <Field label="Pregnancies"><input type="text" inputMode="numeric" value={form.text('fem-pregnancies')} onChange={(e) => form.setText('fem-pregnancies', e.target.value)} /></Field>
                          <Field label="Live births"><input type="text" inputMode="numeric" value={form.text('fem-live-births')} onChange={(e) => form.setText('fem-live-births', e.target.value)} /></Field>
                          <Field label="Miscarriages"><input type="text" inputMode="numeric" value={form.text('fem-miscarriages')} onChange={(e) => form.setText('fem-miscarriages', e.target.value)} /></Field>
                          <Field label="Abortions"><input type="text" inputMode="numeric" value={form.text('fem-abortions')} onChange={(e) => form.setText('fem-abortions', e.target.value)} /></Field>
                        </FieldGrid>
                        <p className="hint">If pregnant, obtain prenatal labs, follow prenatal guidelines, and call MD/NP/midwife for orders.</p>
                      </Reveal>
                      <Callout variant="amber">If intercourse occurred in the past 120 hours / 5 days, discuss Emergency Contraception using the EC Fact Sheet, and initiate the EC Protocol if the youth is interested.</Callout>
                      <ChipGroup value={form.chip('ec')} onChange={(v) => form.setChip('ec', v)} options={[{ value: 'na', label: 'Not necessary / no sex in past 5 days' }, { value: 'declined', label: 'Not interested at this time' }, { value: 'initiated', label: 'EC Protocol initiated' }]} />
                    </Card>
                    <Card index="F6" title="STI & HIV">
                      <Field label="Ever had an STI or PID?">
                        <YesNoChip form={form} track="fem-sti">
                          <Grid form={form} grid="fem-sti-list" items="Chlamydia|Gonorrhea|Herpes|Syphilis|Trichomonas|HPV / warts|PID" />
                          <FieldGrid style={{ marginTop: 10 }}>
                            <Field label="Date(s)"><input type="text" value={form.text('fem-sti-dates')} onChange={(e) => form.setText('fem-sti-dates', e.target.value)} /></Field>
                            <Field label="Treated?"><input type="text" value={form.text('fem-sti-treated')} onChange={(e) => form.setText('fem-sti-treated', e.target.value)} /></Field>
                          </FieldGrid>
                        </YesNoChip>
                      </Field>
                      <div style={{ marginTop: 14 }}>
                        <Field label="Ever tested for HIV?">
                          <YesNoChip form={form} track="fem-hiv">
                            <FieldGrid>
                              <Field label="Date"><input type="text" value={form.text('fem-hiv-date')} onChange={(e) => form.setText('fem-hiv-date', e.target.value)} /></Field>
                              <Field label="Result"><input type="text" value={form.text('fem-hiv-result')} onChange={(e) => form.setText('fem-hiv-result', e.target.value)} /></Field>
                            </FieldGrid>
                          </YesNoChip>
                        </Field>
                      </div>
                    </Card>
                  </>
                )}

                <Card index="R" title="Follow-up contact">
                  <FieldGrid>
                    <Field label="Best phone number for lab results"><input type="tel" value={form.text('followup-phone')} onChange={(e) => form.setText('followup-phone', e.target.value)} /></Field>
                    <Field label="Cell or home?"><ChipGroup value={form.chip('phone-type')} onChange={(v) => form.setChip('phone-type', v)} options={[{ value: 'cell', label: 'Cell' }, { value: 'home', label: 'Home' }]} /></Field>
                    <Field label="Whose phone is this?" wide><input type="text" value={form.text('followup-phone-whose')} onChange={(e) => form.setText('followup-phone-whose', e.target.value)} /></Field>
                  </FieldGrid>
                </Card>
                <button type="button" className="djs-btn" onClick={saveReproductiveHealth}>Save reproductive health</button>
              </section>
            )}

            {activeStep === 9 && (
              <section>
                <SectionHeader index={9} total={9} title="Nursing Diagnosis & Disposition" />
                <Card index="01" title="Nursing diagnosis" hint="Summarize health & psychosocial issues and record nursing impression.">
                  <FieldGrid>
                    <Field label="1." wide><input type="text" value={form.text('dx1')} onChange={(e) => form.setText('dx1', e.target.value)} /></Field>
                    <Field label="2." wide><input type="text" value={form.text('dx2')} onChange={(e) => form.setText('dx2', e.target.value)} /></Field>
                    <Field label="3." wide><input type="text" value={form.text('dx3')} onChange={(e) => form.setText('dx3', e.target.value)} /></Field>
                    <Field label="4." wide><input type="text" value={form.text('dx4')} onChange={(e) => form.setText('dx4', e.target.value)} /></Field>
                  </FieldGrid>
                </Card>
                <Card index="02" title="Nursing plan / disposition">
                  <Grid form={form} grid="nursing-plan" items="DJS TB Screening Form initiated|Labs obtained per DJS Admission Lab Protocol|Sick call procedure explained to youth|Health education initiated|Influenza vaccine offered (if flu season)|Physician / psychiatrist notified for medication orders|On-call MD/NP contacted for consultation|Scheduled for Admission History / Physical Exam|Referrals made|Appropriate log entries made|Medications ordered from pharmacy|Medication administration forms completed|Unit advised of special needs / health status alert|Cleared for general population|Admitted to infirmary|Initiation of special needs treatment plan|Records requested from previous placement|Referred to emergency room" />
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
                <button type="button" className="djs-btn" onClick={saveDiagnosisDisposition}>Save diagnosis & disposition</button>
              </section>
            )}
          </div>
        </div>
      </div>

      <AppFooter />
    </div>
  );
}
