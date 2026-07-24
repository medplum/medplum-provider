import { createReference } from '@medplum/core';
import { Encounter, Observation } from '@medplum/fhirtypes';
import { Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import { useEffect, useState } from 'react';
import { Callout } from '../components/Callout';
import { Card, Field, FieldGrid, SectionHeader } from '../components/Card';
import { ChipGroup, Reveal } from '../components/ChipGroup';
import { DynamicTable } from '../components/DynamicTable';
import { Grid, YesNoChip } from '../components/FormControls';
import { AppFooter, AppHeader, GovBanner } from '../components/MarylandChrome';
import { PatientBand } from '../components/PatientBand';
import { SidebarStepper, WizardStep } from '../components/SidebarStepper';
import { useFormState } from './formState';

const STEPS: WizardStep[] = [
  { n: 1, title: 'Patient Information' },
  { n: 2, title: 'Current Health Status' },
  { n: 3, title: 'Review of Systems' },
  { n: 4, title: 'Diagnosis & Disposition' },
];

interface Props {
  patientId?: string;
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

  // ---- Save handlers: Sections 3–4 ----

  /** Current Health Status (allergies card): allergies -> AllergyIntolerance, chronic conditions -> Condition */
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
    // remove chronic
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

  /** Current Health Status (appearance card): appearance/mental-status findings -> Observation */
  async function saveMentalStatus() {
    for (const item of form.checkedItems('appearance')) {
      await obs({ code: { text: 'Appearance/mental status finding' }, valueString: item });
    }
  }

  /** Section 3 (Review of Systems): every checked ROS/injury item -> Observation, tagged with its system */
  async function saveReviewOfSystems() {
    const systems: [string, string][] = [
      ['injuries', 'Injuries/trauma'],
      ['firearm-safety', 'Injury prevention'],
      ['dental', 'Oral/dental'],
      ['infectious', 'Infectious disease history'],
    ];
    for (const [grid, label] of systems) {
      for (const item of form.checkedItems(grid)) {
        if (item.startsWith('No problems') || item.startsWith('No significant')) continue;
        await obs({ code: { text: `Review of systems: ${label}` }, valueString: form.checkTextMap(grid)[item] || item });
      }
    }
    if (form.text('last-dental-exam')) {
      await obs({ code: { text: 'Last dental exam' }, valueString: form.text('last-dental-exam') });
    }
    if (form.text('vision-exam-date') || form.text('vision-provider')) {
      await obs({
        code: { text: 'Last vision exam' },
        valueString: `Date: ${form.text('vision-exam-date') || '—'}, provider: ${form.text('vision-provider') || '—'}`,
      });
    }
    if (form.text('ros-comments')) {
      await obs({ code: { text: 'Review of systems: additional comments' }, valueString: form.text('ros-comments') });
    }
  }

  /** Section 4 (Diagnosis & Disposition): nursing diagnoses -> Condition, plan items -> CarePlan note, sign-off -> Observation w/ note */
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
                <button type="button" className="djs-btn" onClick={saveDemographics}>Save demographics</button>
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
                  onClick={async () => {
                    await saveVitals();
                    await saveAllergiesChronic();
                    await saveMentalStatus();
                  }}
                >
                  Save health status
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
                <button type="button" className="djs-btn" onClick={saveReviewOfSystems}>Save review of systems</button>
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
