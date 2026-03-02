/**
 * Phase 2 Seed — loaded after CLE16 intake form is submitted.
 *
 * "Explodes" the eReferral bundle into individual resources and seeds
 * all remaining clinical data for the Kim Tran episode:
 *   - Patient, ServiceRequest, Condition, BodyStructure
 *   - CarePlan, Goal
 *   - Appointments (date-adjusted)
 *   - Encounters + ClinicalImpressions
 *   - Observations (wound measurements, vitals, Braden)
 *   - MedicationStatements
 *   - QuestionnaireResponses (pre-filled for past visits)
 *   - Per-visit Tasks
 *   - Consent, Composition (discharge summary)
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

import charlieBrownBundle from '@bayshore-data/fhir/charlie-brown/bundle.json';
import { todayAt, todayPlus } from './adjustDates';

function extractResource<T>(resourceType: string, id: string): T {
  const bundle = charlieBrownBundle as Bundle;
  const entry = bundle.entry?.find(
    (e: BundleEntry) => e.resource?.resourceType === resourceType && e.resource?.id === id
  );
  if (!entry?.resource) {
    throw new Error(`Seed data missing: ${resourceType}/${id}`);
  }
  return JSON.parse(JSON.stringify(entry.resource)) as T;
}

function extractAllOfType<T>(resourceType: string): T[] {
  const bundle = charlieBrownBundle as Bundle;
  return (bundle.entry || [])
    .filter((e: BundleEntry) => e.resource?.resourceType === resourceType)
    .map((e: BundleEntry) => JSON.parse(JSON.stringify(e.resource)) as T);
}

export async function seedPhase2(medplum: MedplumClient): Promise<void> {
  // 1. Patient (enriched with additional demographics)
  const patient = extractResource<Patient>('Patient', 'patient-charlie-brown');
  patient.generalPractitioner = [{ reference: 'Practitioner/dr-alpha' }];
  patient.managingOrganization = { reference: 'Organization/bayshore-ics-mississauga' };
  patient.maritalStatus = {
    coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-MaritalStatus', code: 'W', display: 'Widowed' }],
  };
  patient.communication = [{
    language: { coding: [{ system: 'urn:ietf:bcp:47', code: 'en', display: 'English' }] },
    preferred: true,
  }];
  // Ensure email telecom exists
  if (!patient.telecom?.find((t) => t.system === 'email')) {
    patient.telecom = [
      ...(patient.telecom || []),
      { system: 'email', value: 'kim.tran@email.ca' },
    ];
  }
  await medplum.createResource(patient);

  // 2. ServiceRequest
  const sr = extractResource<ServiceRequest>('ServiceRequest', 'sr-wound-care-cb');
  sr.status = 'active';
  sr.occurrencePeriod = {
    start: todayPlus(-7),
    end: todayPlus(21),
  };
  await medplum.createResource(sr);

  // 3. Condition (with problem-list-item category for sidebar)
  const condition = extractResource<Condition>('Condition', 'condition-wound-cb');
  condition.clinicalStatus = {
    coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
  };
  condition.category = [{
    coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item', display: 'Problem List Item' }],
  }];
  condition.abatementDateTime = undefined;
  await medplum.createResource(condition);

  // 4. BodyStructure
  const bodyStructure = extractResource<BodyStructure>('BodyStructure', 'wound-site-cb');
  await medplum.createResource(bodyStructure);

  // 5. Goal (in-progress, not completed)
  const goal = extractResource<Goal>('Goal', 'goal-healing-cb');
  goal.lifecycleStatus = 'active';
  goal.achievementStatus = undefined;
  goal.target = [{
    measure: { coding: [{ system: 'http://loinc.org', code: '72298-3', display: 'Wound surface area' }] },
    detailQuantity: { value: 0, unit: 'cm2', system: 'http://unitsofmeasure.org', code: 'cm2' },
    dueDate: todayPlus(21),
  }];
  goal.startDate = todayPlus(-7);
  await medplum.createResource(goal);

  // 6. CarePlan (active, not completed)
  const carePlan = extractResource<CarePlan>('CarePlan', 'cp-wound-care-cb');
  carePlan.status = 'active';
  carePlan.period = { start: todayPlus(-7), end: todayPlus(21) };
  carePlan.instantiatesCanonical = ['https://bayshore.ca/fhir/PlanDefinition/wound-care-ics'];
  await medplum.createResource(carePlan);

  // 7. Appointments (date-adjusted relative to today)
  const appointments: Appointment[] = [
    {
      resourceType: 'Appointment',
      id: 'appt-initial-cb',
      status: 'fulfilled',
      description: 'Initial Wound Care Assessment',
      serviceType: [{ coding: [{ code: 'initial-assessment', display: 'Initial Wound Care Assessment' }] }],
      start: todayAt(9, 0, -5),
      end: todayAt(10, 0, -5),
      participant: [
        { actor: { reference: 'Patient/patient-charlie-brown' }, status: 'accepted' },
        { actor: { reference: 'Practitioner/nurse-ratched' }, status: 'accepted' },
      ],
      basedOn: [{ reference: 'ServiceRequest/sr-wound-care-cb' }],
    },
    {
      resourceType: 'Appointment',
      id: 'appt-visit-2-cb',
      status: 'fulfilled',
      description: 'Routine Wound Care (Visit 2)',
      serviceType: [{ coding: [{ code: 'routine-wound-care', display: 'Routine Wound Care' }] }],
      start: todayAt(9, 0, -2),
      end: todayAt(9, 45, -2),
      participant: [
        { actor: { reference: 'Patient/patient-charlie-brown' }, status: 'accepted' },
        { actor: { reference: 'Practitioner/nurse-ratched' }, status: 'accepted' },
      ],
      basedOn: [{ reference: 'ServiceRequest/sr-wound-care-cb' }],
    },
    {
      resourceType: 'Appointment',
      id: 'appt-visit-3-cb',
      status: 'booked',
      description: 'Routine Wound Care (Visit 3)',
      serviceType: [{ coding: [{ code: 'routine-wound-care', display: 'Routine Wound Care' }] }],
      start: todayAt(9, 0),
      end: todayAt(9, 45),
      participant: [
        { actor: { reference: 'Patient/patient-charlie-brown' }, status: 'accepted' },
        { actor: { reference: 'Practitioner/nurse-ratched' }, status: 'accepted' },
      ],
      basedOn: [{ reference: 'ServiceRequest/sr-wound-care-cb' }],
    },
    {
      resourceType: 'Appointment',
      id: 'appt-visit-4-cb',
      status: 'booked',
      description: 'Routine Wound Care (Visit 4)',
      serviceType: [{ coding: [{ code: 'routine-wound-care', display: 'Routine Wound Care' }] }],
      start: todayAt(9, 0, 3),
      end: todayAt(9, 45, 3),
      participant: [
        { actor: { reference: 'Patient/patient-charlie-brown' }, status: 'accepted' },
        { actor: { reference: 'Practitioner/nurse-ratched' }, status: 'accepted' },
      ],
      basedOn: [{ reference: 'ServiceRequest/sr-wound-care-cb' }],
    },
  ];
  for (const appt of appointments) {
    await medplum.createResource(appt);
  }

  // 8. Encounters (past visits finished, today planned)
  const encounters: Encounter[] = [
    {
      resourceType: 'Encounter',
      id: 'enc-initial-visit-cb',
      status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'HH', display: 'home health' },
      type: [{ text: 'Initial Wound Care Assessment' }],
      subject: { reference: 'Patient/patient-charlie-brown' },
      participant: [{ individual: { reference: 'Practitioner/nurse-ratched' } }],
      appointment: [{ reference: 'Appointment/appt-initial-cb' }],
      period: { start: todayAt(9, 0, -5), end: todayAt(10, 30, -5) },
      serviceProvider: { reference: 'Organization/bayshore-ics-mississauga' },
    },
    {
      resourceType: 'Encounter',
      id: 'enc-routine-visit-2-cb',
      status: 'finished',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'HH', display: 'home health' },
      type: [{ text: 'Routine Wound Care (Visit 2)' }],
      subject: { reference: 'Patient/patient-charlie-brown' },
      participant: [{ individual: { reference: 'Practitioner/nurse-ratched' } }],
      appointment: [{ reference: 'Appointment/appt-visit-2-cb' }],
      period: { start: todayAt(9, 0, -2), end: todayAt(9, 45, -2) },
      serviceProvider: { reference: 'Organization/bayshore-ics-mississauga' },
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
      subject: { reference: 'Patient/patient-charlie-brown' },
      encounter: { reference: `Encounter/${enc.id}` },
      date: enc.period?.start || new Date().toISOString(),
    };
    await medplum.createResource(ci);
  }

  // 10. Observations — wound measurements
  const woundObs: Observation[] = [
    // Visit 1 — full wound measurements
    makeWoundAreaObs('obs-wound-area-cb-01', -5, 15.0, 'enc-initial-visit-cb'),
    makeWoundDimensionObs('obs-wound-length-cb-01', '39126-8', 'Wound length', -5, 5.0, 'enc-initial-visit-cb'),
    makeWoundDimensionObs('obs-wound-width-cb-01', '39125-0', 'Wound width', -5, 3.0, 'enc-initial-visit-cb'),
    makeWoundDimensionObs('obs-wound-depth-cb-01', '39127-6', 'Wound depth', -5, 1.2, 'enc-initial-visit-cb'),
    makeTissueTypeObs('obs-tissue-type-cb-01', -5, '420324007', 'Slough (Yellow)', 'enc-initial-visit-cb'),
    // Visit 2
    makeWoundAreaObs('obs-wound-area-cb-02', -2, 11.25, 'enc-routine-visit-2-cb'),
    makeWoundDimensionObs('obs-wound-length-cb-02', '39126-8', 'Wound length', -2, 4.5, 'enc-routine-visit-2-cb'),
    makeWoundDimensionObs('obs-wound-width-cb-02', '39125-0', 'Wound width', -2, 2.5, 'enc-routine-visit-2-cb'),
    makeWoundDimensionObs('obs-wound-depth-cb-02', '39127-6', 'Wound depth', -2, 0.8, 'enc-routine-visit-2-cb'),
    makeTissueTypeObs('obs-tissue-type-cb-02', -2, '420324007', 'Mixed Slough/Granulation', 'enc-routine-visit-2-cb'),
  ];

  // Braden score
  const bradenObs = extractResource<Observation>('Observation', 'obs-braden-cb');
  bradenObs.effectiveDateTime = todayAt(9, 30, -5);
  bradenObs.encounter = { reference: 'Encounter/enc-initial-visit-cb' };
  woundObs.push(bradenObs);

  // Vital signs from Visit 1
  const vitalIds = ['obs-bp-sys-cb-01', 'obs-bp-dia-cb-01', 'obs-hr-cb-01', 'obs-spo2-cb-01'];
  for (const vId of vitalIds) {
    const obs = extractResource<Observation>('Observation', vId);
    obs.effectiveDateTime = todayAt(9, 15, -5);
    obs.encounter = { reference: 'Encounter/enc-initial-visit-cb' };
    woundObs.push(obs);
  }

  // Smoking status (LOINC 72166-2)
  const smokingObs: Observation = {
    resourceType: 'Observation',
    id: 'obs-smoking-cb',
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '72166-2', display: 'Tobacco smoking status' }] },
    subject: { reference: 'Patient/patient-charlie-brown' },
    effectiveDateTime: todayAt(9, 30, -5),
    valueCodeableConcept: {
      coding: [{ system: 'http://snomed.info/sct', code: '266919005', display: 'Never smoker' }],
      text: 'Never smoker',
    },
  };
  woundObs.push(smokingObs);

  for (const obs of woundObs) {
    await medplum.createResource(obs);
  }

  // 11. MedicationStatements
  const medStmts = extractAllOfType<MedicationStatement>('MedicationStatement');
  for (const ms of medStmts) {
    ms.effectivePeriod = { start: todayPlus(-7), end: todayPlus(21) };
    await medplum.createResource(ms);
  }

  // 11b. MedicationRequests (for PatientSummary sidebar which queries MedicationRequest)
  const medRequests: MedicationRequest[] = medStmts
    .filter((ms) => ms.status === 'active')
    .map((ms) => ({
      resourceType: 'MedicationRequest' as const,
      status: 'active' as const,
      intent: 'order' as const,
      medicationCodeableConcept: ms.medicationCodeableConcept,
      subject: { reference: 'Patient/patient-charlie-brown' },
      requester: { reference: 'Practitioner/dr-alpha' },
      dosageInstruction: ms.dosage,
    }));
  for (const mr of medRequests) {
    await medplum.createResource(mr);
  }

  // 11c. AllergyIntolerance (NKDA for Kim Tran)
  const allergyNKDA: AllergyIntolerance = {
    resourceType: 'AllergyIntolerance',
    clinicalStatus: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }],
    },
    verificationStatus: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: 'confirmed' }],
    },
    code: {
      coding: [{ system: 'http://snomed.info/sct', code: '716186003', display: 'No known allergy' }],
      text: 'No Known Drug Allergies (NKDA)',
    },
    patient: { reference: 'Patient/patient-charlie-brown' },
    recordedDate: todayPlus(-7),
  };
  await medplum.createResource(allergyNKDA);

  // 12. QuestionnaireResponses (pre-filled for past visits)
  const qrIds = [
    'qr-cle16-cb-01', 'qr-cle287-cb-01', 'qr-cle10-cb-01',
    'qr-cle35-cb-01', 'qr-cle116-cb-01', 'qr-cle28-cb-01',
    'qr-cle34-cb-01', 'qr-cle34-cb-04',
  ];
  for (const qrId of qrIds) {
    const qr = extractResource<QuestionnaireResponse>('QuestionnaireResponse', qrId);
    // Adjust encounter references for the first set of responses
    if (qr.encounter?.reference === 'Encounter/enc-initial-visit-cb') {
      // keep as is
    } else if (qr.encounter?.reference === 'Encounter/enc-routine-visit-cb-04') {
      qr.encounter = { reference: 'Encounter/enc-routine-visit-2-cb' };
    }
    qr.authored = todayAt(9, 30, -5);
    await medplum.createResource(qr);
  }

  // 13. Per-visit Tasks
  // Initial visit tasks (all completed)
  const initialVisitTasks: Task[] = [
    makeVisitTask('task-init-cle287', 'enc-initial-visit-cb', 'q-cle287-safety-risk', 'CLE287', 'Safety Risk Screener', 'completed', 'qr-cle287-cb-01', -5),
    makeVisitTask('task-init-cle35', 'enc-initial-visit-cb', 'q-cle35-medication-profile', 'CLE35', 'Medication Profile', 'completed', 'qr-cle35-cb-01', -5),
    makeVisitTask('task-init-cle116', 'enc-initial-visit-cb', 'q-cle116-wound-assessment', 'CLE116', 'Comprehensive Wound Assessment', 'completed', 'qr-cle116-cb-01', -5),
  ];

  // Visit 2 tasks (completed)
  const visit2Tasks: Task[] = [
    makeVisitTask('task-v2-cle34', 'enc-routine-visit-2-cb', 'q-cle34-wound-flowsheet', 'CLE34', 'Wound Care Flow Sheet', 'completed', 'qr-cle34-cb-04', -2),
  ];

  for (const t of [...initialVisitTasks, ...visit2Tasks]) {
    await medplum.createResource(t);
  }

  // 14. Consent
  const consents = extractAllOfType<Consent>('Consent');
  for (const c of consents) {
    await medplum.createResource(c);
  }

  // 15. Composition (discharge summary — pre-seeded, read-only)
  const composition = extractResource<Composition>('Composition', 'comp-discharge-cb');
  await medplum.createResource(composition);
}

// ── Helper functions ──

function makeWoundAreaObs(id: string, dayOffset: number, area: number, encounterId: string): Observation {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '72298-3', display: 'Wound surface area' }] },
    subject: { reference: 'Patient/patient-charlie-brown' },
    encounter: { reference: `Encounter/${encounterId}` },
    effectiveDateTime: todayAt(9, 30, dayOffset),
    valueQuantity: { value: area, unit: 'cm2', system: 'http://unitsofmeasure.org', code: 'cm2' },
    focus: [{ reference: 'BodyStructure/wound-site-cb' }],
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
    subject: { reference: 'Patient/patient-charlie-brown' },
    encounter: { reference: `Encounter/${encounterId}` },
    effectiveDateTime: todayAt(9, 30, dayOffset),
    valueQuantity: { value, unit: 'cm', system: 'http://unitsofmeasure.org', code: 'cm' },
    focus: [{ reference: 'BodyStructure/wound-site-cb' }],
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
    subject: { reference: 'Patient/patient-charlie-brown' },
    encounter: { reference: `Encounter/${encounterId}` },
    effectiveDateTime: todayAt(9, 30, dayOffset),
    valueCodeableConcept: {
      coding: [{ system: 'http://snomed.info/sct', code: snomedCode, display }],
    },
    focus: [{ reference: 'BodyStructure/wound-site-cb' }],
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
    for: { reference: 'Patient/patient-charlie-brown' },
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
