/**
 * Seeds Homer Simpson as a fully active patient during Phase 1.
 *
 * Homer has a completed diabetic foot ulcer episode from the
 * homer-simpson/bundle.json test data. We re-use that data but:
 *   - Change statuses to "active" so it looks like an ongoing episode
 *   - Date-adjust encounters/appointments relative to today
 *   - Add AllergyIntolerances and MedicationRequests (not in original bundle)
 *   - Add Condition category for PatientSummary sidebar
 */
import type { MedplumClient } from '@medplum/core';
import type {
  AllergyIntolerance,
  Appointment,
  BodyStructure,
  Bundle,
  BundleEntry,
  CarePlan,
  ClinicalImpression,
  Composition,
  Condition,
  Consent,
  Encounter,
  Goal,
  MedicationRequest,
  MedicationStatement,
  Observation,
  Patient,
  QuestionnaireResponse,
  ServiceRequest,
  Task,
} from '@medplum/fhirtypes';

import homerBundle from '@bayshore-data/fhir/homer-simpson/bundle.json';
import { todayAt, todayPlus } from './adjustDates';

function extractResource<T>(resourceType: string, id: string): T {
  const bundle = homerBundle as Bundle;
  const entry = bundle.entry?.find(
    (e: BundleEntry) => e.resource?.resourceType === resourceType && e.resource?.id === id
  );
  if (!entry?.resource) {
    throw new Error(`Homer seed data missing: ${resourceType}/${id}`);
  }
  return JSON.parse(JSON.stringify(entry.resource)) as T;
}

function extractAllOfType<T>(resourceType: string): T[] {
  const bundle = homerBundle as Bundle;
  return (bundle.entry || [])
    .filter((e: BundleEntry) => e.resource?.resourceType === resourceType)
    .map((e: BundleEntry) => JSON.parse(JSON.stringify(e.resource)) as T);
}

export async function seedHomerSimpson(medplum: MedplumClient): Promise<void> {
  // 1. Patient (already has rich demographics in bundle)
  const patient = extractResource<Patient>('Patient', 'patient-homer-simpson');
  // Re-point practitioner references to our seeded practitioner for schedule
  patient.generalPractitioner = [{ reference: 'Practitioner/dr-hibbert' }];
  patient.managingOrganization = { reference: 'Organization/bayshore-hhp-toronto-east' };
  await medplum.createResource(patient);

  // 2. Conditions (add problem-list-item category for PatientSummary sidebar)
  const conditionIds = ['condition-wound-hs', 'condition-t2dm-hs', 'condition-neuropathy-hs', 'condition-htn-hs'];
  for (const cid of conditionIds) {
    const condition = extractResource<Condition>('Condition', cid);
    condition.clinicalStatus = {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
    };
    condition.category = [{
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item', display: 'Problem List Item' }],
    }];
    // Clear any abatement
    (condition as any).abatementDateTime = undefined;
    await medplum.createResource(condition);
  }

  // 3. BodyStructure
  const bodyStructure = extractResource<BodyStructure>('BodyStructure', 'wound-site-hs');
  await medplum.createResource(bodyStructure);

  // 4. ServiceRequest (set to active, adjust dates)
  const sr = extractResource<ServiceRequest>('ServiceRequest', 'sr-wound-care-hs');
  sr.status = 'active';
  sr.occurrencePeriod = { start: todayPlus(-7), end: todayPlus(21) };
  // Re-point performer to our demo nurse
  sr.performer = [{ reference: 'Practitioner/nurse-ratched' }];
  await medplum.createResource(sr);

  // 5. Goals (set to active, adjust dates)
  const goalWound = extractResource<Goal>('Goal', 'goal-wound-healing-hs');
  goalWound.lifecycleStatus = 'active';
  goalWound.achievementStatus = undefined;
  goalWound.startDate = todayPlus(-7);
  if (goalWound.target?.[0]) {
    goalWound.target[0].dueDate = todayPlus(21);
  }
  await medplum.createResource(goalWound);

  const goalGlycemic = extractResource<Goal>('Goal', 'goal-glycemic-hs');
  goalGlycemic.lifecycleStatus = 'active';
  goalGlycemic.achievementStatus = undefined;
  goalGlycemic.startDate = todayPlus(-7);
  if (goalGlycemic.target?.[0]) {
    goalGlycemic.target[0].dueDate = todayPlus(60);
  }
  await medplum.createResource(goalGlycemic);

  // 6. CarePlan (set to active, adjust dates)
  const carePlan = extractResource<CarePlan>('CarePlan', 'cp-wound-care-hs');
  carePlan.status = 'active';
  carePlan.period = { start: todayPlus(-7), end: todayPlus(21) };
  carePlan.instantiatesCanonical = ['https://bayshore.ca/fhir/PlanDefinition/wound-care-ics'];
  // Re-point author to our demo nurse
  carePlan.author = { reference: 'Practitioner/nurse-ratched' };
  await medplum.createResource(carePlan);

  // 7. Appointments (date-adjusted relative to today)
  const appointments: Appointment[] = [
    {
      resourceType: 'Appointment',
      id: 'appt-initial-hs',
      status: 'fulfilled',
      description: 'Initial Diabetic Foot Ulcer Assessment',
      serviceType: [{ coding: [{ code: 'initial-assessment', display: 'Initial Wound Care Assessment' }] }],
      start: todayAt(9, 0, -5),
      end: todayAt(11, 0, -5),
      participant: [
        { actor: { reference: 'Patient/patient-homer-simpson' }, status: 'accepted' },
        { actor: { reference: 'Practitioner/nurse-ratched' }, status: 'accepted' },
      ],
      basedOn: [{ reference: 'ServiceRequest/sr-wound-care-hs' }],
    },
    {
      resourceType: 'Appointment',
      id: 'appt-visit-2-hs',
      status: 'fulfilled',
      description: 'Routine Wound Care (Visit 2)',
      serviceType: [{ coding: [{ code: 'routine-wound-care', display: 'Routine Wound Care' }] }],
      start: todayAt(10, 0, -2),
      end: todayAt(10, 45, -2),
      participant: [
        { actor: { reference: 'Patient/patient-homer-simpson' }, status: 'accepted' },
        { actor: { reference: 'Practitioner/nurse-ratched' }, status: 'accepted' },
      ],
      basedOn: [{ reference: 'ServiceRequest/sr-wound-care-hs' }],
    },
    {
      resourceType: 'Appointment',
      id: 'appt-visit-3-hs',
      status: 'booked',
      description: 'Routine Wound Care (Visit 3)',
      serviceType: [{ coding: [{ code: 'routine-wound-care', display: 'Routine Wound Care' }] }],
      start: todayAt(10, 0),
      end: todayAt(10, 45),
      participant: [
        { actor: { reference: 'Patient/patient-homer-simpson' }, status: 'accepted' },
        { actor: { reference: 'Practitioner/nurse-ratched' }, status: 'accepted' },
      ],
      basedOn: [{ reference: 'ServiceRequest/sr-wound-care-hs' }],
    },
    {
      resourceType: 'Appointment',
      id: 'appt-visit-4-hs',
      status: 'booked',
      description: 'Routine Wound Care (Visit 4)',
      serviceType: [{ coding: [{ code: 'routine-wound-care', display: 'Routine Wound Care' }] }],
      start: todayAt(10, 0, 3),
      end: todayAt(10, 45, 3),
      participant: [
        { actor: { reference: 'Patient/patient-homer-simpson' }, status: 'accepted' },
        { actor: { reference: 'Practitioner/nurse-ratched' }, status: 'accepted' },
      ],
      basedOn: [{ reference: 'ServiceRequest/sr-wound-care-hs' }],
    },
  ];
  for (const appt of appointments) {
    await medplum.createResource(appt);
  }

  // 8. Encounters (past visits finished, today planned)
  const encounters: Encounter[] = [
    {
      resourceType: 'Encounter',
      id: 'enc-initial-visit-hs',
      status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'HH', display: 'home health' },
      type: [{ text: 'Initial Diabetic Foot Ulcer Assessment' }],
      subject: { reference: 'Patient/patient-homer-simpson' },
      participant: [{ individual: { reference: 'Practitioner/nurse-ratched' } }],
      appointment: [{ reference: 'Appointment/appt-initial-hs' }],
      period: { start: todayAt(9, 0, -5), end: todayAt(11, 0, -5) },
      serviceProvider: { reference: 'Organization/bayshore-hhp-toronto-east' },
    },
    {
      resourceType: 'Encounter',
      id: 'enc-routine-visit-2-hs',
      status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'HH', display: 'home health' },
      type: [{ text: 'Routine Wound Care (Visit 2)' }],
      subject: { reference: 'Patient/patient-homer-simpson' },
      participant: [{ individual: { reference: 'Practitioner/nurse-ratched' } }],
      appointment: [{ reference: 'Appointment/appt-visit-2-hs' }],
      period: { start: todayAt(10, 0, -2), end: todayAt(10, 45, -2) },
      serviceProvider: { reference: 'Organization/bayshore-hhp-toronto-east' },
    },
    {
      resourceType: 'Encounter',
      id: 'enc-routine-today-hs',
      status: 'planned',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'HH', display: 'home health' },
      type: [{ text: 'Routine Wound Care (Visit 3)' }],
      subject: { reference: 'Patient/patient-homer-simpson' },
      participant: [{ individual: { reference: 'Practitioner/nurse-ratched' } }],
      appointment: [{ reference: 'Appointment/appt-visit-3-hs' }],
      period: { start: todayAt(10, 0) },
      serviceProvider: { reference: 'Organization/bayshore-hhp-toronto-east' },
    },
  ];
  for (const enc of encounters) {
    await medplum.createResource(enc);
  }

  // 9. ClinicalImpressions (needed by EncounterChart)
  for (const enc of encounters) {
    const ci: ClinicalImpression = {
      resourceType: 'ClinicalImpression',
      status: enc.status === 'finished' ? 'completed' : 'in-progress',
      subject: { reference: 'Patient/patient-homer-simpson' },
      encounter: { reference: `Encounter/${enc.id}` },
      date: enc.period?.start || new Date().toISOString(),
    };
    await medplum.createResource(ci);
  }

  // 10. Observations — wound measurements
  const woundObs: Observation[] = [
    // Visit 1 — initial wound measurements
    makeWoundAreaObs('obs-wound-area-hs-01', -5, 6.0, 'enc-initial-visit-hs'),
    makeWoundDimensionObs('obs-wound-length-hs-01', '39126-8', 'Wound length', -5, 3.0, 'enc-initial-visit-hs'),
    makeWoundDimensionObs('obs-wound-width-hs-01', '39125-0', 'Wound width', -5, 2.0, 'enc-initial-visit-hs'),
    makeTissueTypeObs('obs-tissue-type-hs-01', -5, '420324007', 'Slough (Yellow)', 'enc-initial-visit-hs'),
    // Visit 2
    makeWoundAreaObs('obs-wound-area-hs-02', -2, 5.5, 'enc-routine-visit-2-hs'),
    makeTissueTypeObs('obs-tissue-type-hs-02', -2, '420324007', 'Mixed Slough/Granulation', 'enc-routine-visit-2-hs'),
  ];

  // Vitals from Visit 1
  const bradenObs = extractResource<Observation>('Observation', 'obs-braden-hs');
  bradenObs.effectiveDateTime = todayAt(9, 30, -5);
  bradenObs.encounter = { reference: 'Encounter/enc-initial-visit-hs' };
  woundObs.push(bradenObs);

  const bpSys = extractResource<Observation>('Observation', 'obs-bp-sys-hs-01');
  bpSys.effectiveDateTime = todayAt(9, 30, -5);
  bpSys.encounter = { reference: 'Encounter/enc-initial-visit-hs' };
  woundObs.push(bpSys);

  const bpDia = extractResource<Observation>('Observation', 'obs-bp-dia-hs-01');
  bpDia.effectiveDateTime = todayAt(9, 30, -5);
  bpDia.encounter = { reference: 'Encounter/enc-initial-visit-hs' };
  woundObs.push(bpDia);

  const bgObs = extractResource<Observation>('Observation', 'obs-bg-premeal-hs-01');
  bgObs.effectiveDateTime = todayAt(9, 15, -5);
  bgObs.encounter = { reference: 'Encounter/enc-initial-visit-hs' };
  woundObs.push(bgObs);

  // Smoking status (LOINC 72166-2)
  const smokingObs: Observation = {
    resourceType: 'Observation',
    id: 'obs-smoking-hs',
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '72166-2', display: 'Tobacco smoking status' }] },
    subject: { reference: 'Patient/patient-homer-simpson' },
    effectiveDateTime: todayAt(9, 30, -5),
    valueCodeableConcept: {
      coding: [{ system: 'http://snomed.info/sct', code: '8517006', display: 'Ex-smoker' }],
      text: 'Former smoker',
    },
  };
  woundObs.push(smokingObs);

  // Heart rate (LOINC 8867-4)
  const hrObs: Observation = {
    resourceType: 'Observation',
    id: 'obs-hr-hs-01',
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '8867-4', display: 'Heart rate' }] },
    subject: { reference: 'Patient/patient-homer-simpson' },
    encounter: { reference: 'Encounter/enc-initial-visit-hs' },
    effectiveDateTime: todayAt(9, 30, -5),
    valueQuantity: { value: 82, unit: '/min', system: 'http://unitsofmeasure.org', code: '/min' },
  };
  woundObs.push(hrObs);

  // SpO2 (LOINC 2708-6)
  const spo2Obs: Observation = {
    resourceType: 'Observation',
    id: 'obs-spo2-hs-01',
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '2708-6', display: 'Oxygen saturation' }] },
    subject: { reference: 'Patient/patient-homer-simpson' },
    encounter: { reference: 'Encounter/enc-initial-visit-hs' },
    effectiveDateTime: todayAt(9, 30, -5),
    valueQuantity: { value: 96, unit: '%', system: 'http://unitsofmeasure.org', code: '%' },
  };
  woundObs.push(spo2Obs);

  for (const obs of woundObs) {
    await medplum.createResource(obs);
  }

  // 11. MedicationStatements
  const medStmts = extractAllOfType<MedicationStatement>('MedicationStatement');
  for (const ms of medStmts) {
    ms.effectivePeriod = { start: todayPlus(-7), end: todayPlus(21) };
    if (ms.status === 'completed') {
      // Keep augmentin as completed but with adjusted dates
      ms.effectivePeriod = { start: todayPlus(-14), end: todayPlus(-1) };
    }
    await medplum.createResource(ms);
  }

  // 12. MedicationRequests (for PatientSummary sidebar which queries MedicationRequest)
  const medRequests: MedicationRequest[] = medStmts
    .filter((ms) => ms.status === 'active')
    .map((ms) => ({
      resourceType: 'MedicationRequest' as const,
      status: 'active' as const,
      intent: 'order' as const,
      medicationCodeableConcept: ms.medicationCodeableConcept,
      subject: { reference: 'Patient/patient-homer-simpson' },
      requester: { reference: 'Practitioner/dr-hibbert' },
      dosageInstruction: ms.dosage,
    }));
  for (const mr of medRequests) {
    await medplum.createResource(mr);
  }

  // 13. AllergyIntolerances (for PatientSummary sidebar)
  const allergies: AllergyIntolerance[] = [
    {
      resourceType: 'AllergyIntolerance',
      clinicalStatus: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }],
      },
      verificationStatus: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: 'confirmed' }],
      },
      type: 'allergy',
      category: ['medication'],
      criticality: 'high',
      code: {
        coding: [{ system: 'http://snomed.info/sct', code: '91936005', display: 'Penicillin allergy' }],
        text: 'Penicillin',
      },
      patient: { reference: 'Patient/patient-homer-simpson' },
      recordedDate: todayPlus(-7),
      reaction: [{
        manifestation: [{ coding: [{ system: 'http://snomed.info/sct', code: '39579001', display: 'Anaphylaxis' }] }],
        severity: 'severe',
      }],
    },
    {
      resourceType: 'AllergyIntolerance',
      clinicalStatus: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }],
      },
      verificationStatus: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: 'confirmed' }],
      },
      type: 'intolerance',
      category: ['environment'],
      criticality: 'low',
      code: {
        coding: [{ system: 'http://snomed.info/sct', code: '424213003', display: 'Latex allergy' }],
        text: 'Latex',
      },
      patient: { reference: 'Patient/patient-homer-simpson' },
      recordedDate: todayPlus(-7),
      reaction: [{
        manifestation: [{ coding: [{ system: 'http://snomed.info/sct', code: '271807003', display: 'Skin rash' }] }],
        severity: 'mild',
      }],
    },
  ];
  for (const ai of allergies) {
    await medplum.createResource(ai);
  }

  // 14. Per-visit Tasks
  const initialVisitTasks: Task[] = [
    makeVisitTask('task-hs-init-cle287', 'enc-initial-visit-hs', 'q-cle287-safety-risk', 'CLE287', 'Safety Risk Screener', 'completed', 'qr-cle287-hs-01', -5),
    makeVisitTask('task-hs-init-cle35', 'enc-initial-visit-hs', 'q-cle35-medication-profile', 'CLE35', 'Medication Profile', 'completed', 'qr-cle35-hs-01', -5),
    makeVisitTask('task-hs-init-cle116', 'enc-initial-visit-hs', 'q-cle116-wound-assessment', 'CLE116', 'Comprehensive Wound Assessment', 'completed', 'qr-cle116-hs-01', -5),
    makeVisitTask('task-hs-init-cle171', 'enc-initial-visit-hs', 'q-cle171-diabetes-assessment', 'CLE171', 'Diabetes Assessment', 'completed', 'qr-cle171-hs-01', -5),
  ];

  const visit2Tasks: Task[] = [
    makeVisitTask('task-hs-v2-cle187', 'enc-routine-visit-2-hs', 'q-cle187-foot-care-flowsheet', 'CLE187', 'Foot Care Flow Sheet', 'completed', undefined, -2),
  ];

  const todayTasks: Task[] = [
    makeVisitTask('task-hs-today-cle187', 'enc-routine-today-hs', 'q-cle187-foot-care-flowsheet', 'CLE187', 'Foot Care Flow Sheet', 'ready', undefined, 0),
  ];

  for (const t of [...initialVisitTasks, ...visit2Tasks, ...todayTasks]) {
    await medplum.createResource(t);
  }

  // 15. QuestionnaireResponses (pre-filled for past visits)
  const qrIds = [
    'qr-cle16-hs-01', 'qr-cle287-hs-01', 'qr-cle10-hs-01',
    'qr-cle35-hs-01', 'qr-cle116-hs-01', 'qr-cle116-foot-hs-01',
    'qr-cle171-hs-01', 'qr-cle52-hs-01', 'qr-cle174-hs-01',
  ];
  for (const qrId of qrIds) {
    const qr = extractResource<QuestionnaireResponse>('QuestionnaireResponse', qrId);
    qr.authored = todayAt(9, 30, -5);
    qr.encounter = { reference: 'Encounter/enc-initial-visit-hs' };
    await medplum.createResource(qr);
  }

  // 16. Consents
  const consents = extractAllOfType<Consent>('Consent');
  for (const c of consents) {
    await medplum.createResource(c);
  }

  // 17. Composition (discharge summary)
  const composition = extractResource<Composition>('Composition', 'comp-discharge-hs');
  await medplum.createResource(composition);
}

// ── Helper functions ──

function makeWoundAreaObs(id: string, dayOffset: number, area: number, encounterId: string): Observation {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '72298-3', display: 'Wound surface area' }] },
    subject: { reference: 'Patient/patient-homer-simpson' },
    encounter: { reference: `Encounter/${encounterId}` },
    effectiveDateTime: todayAt(10, 30, dayOffset),
    valueQuantity: { value: area, unit: 'cm2', system: 'http://unitsofmeasure.org', code: 'cm2' },
    focus: [{ reference: 'BodyStructure/wound-site-hs' }],
  };
}

function makeWoundDimensionObs(
  id: string, loincCode: string, display: string,
  dayOffset: number, value: number, encounterId: string
): Observation {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: loincCode, display }] },
    subject: { reference: 'Patient/patient-homer-simpson' },
    encounter: { reference: `Encounter/${encounterId}` },
    effectiveDateTime: todayAt(10, 30, dayOffset),
    valueQuantity: { value, unit: 'cm', system: 'http://unitsofmeasure.org', code: 'cm' },
    focus: [{ reference: 'BodyStructure/wound-site-hs' }],
  };
}

function makeTissueTypeObs(
  id: string, dayOffset: number, snomedCode: string, display: string, encounterId: string
): Observation {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '72371-8', display: 'Wound bed appearance' }] },
    subject: { reference: 'Patient/patient-homer-simpson' },
    encounter: { reference: `Encounter/${encounterId}` },
    effectiveDateTime: todayAt(10, 30, dayOffset),
    valueCodeableConcept: {
      coding: [{ system: 'http://snomed.info/sct', code: snomedCode, display }],
    },
    focus: [{ reference: 'BodyStructure/wound-site-hs' }],
  };
}

function makeVisitTask(
  id: string, encounterId: string, questionnaireId: string,
  cleCode: string, cleTitle: string, status: Task['status'],
  qrId?: string, dayOffset = 0
): Task {
  const task: Task = {
    resourceType: 'Task',
    id,
    status,
    intent: 'order',
    code: {
      coding: [{ system: 'https://bayshore.ca/fhir/CodeSystem/cle-forms', code: cleCode }],
      text: cleTitle,
    },
    description: cleTitle,
    for: { reference: 'Patient/patient-homer-simpson' },
    encounter: { reference: `Encounter/${encounterId}` },
    focus: { reference: `Questionnaire/${questionnaireId}` },
    input: [{ type: { text: 'Questionnaire' }, valueReference: { reference: `Questionnaire/${questionnaireId}` } }],
    authoredOn: todayAt(9, 0, dayOffset),
  };
  if (qrId) {
    task.output = [{ type: { text: 'QuestionnaireResponse' }, valueReference: { reference: `QuestionnaireResponse/${qrId}` } }];
  }
  return task;
}
