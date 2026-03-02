/**
 * Phase 1 Seed — loaded on app start.
 *
 * Seeds infrastructure resources needed before the intake workflow:
 *   - Organizations
 *   - Practitioners
 *   - PlanDefinition (wound care template)
 *   - All Questionnaires (CLE forms)
 *   - eReferral message Bundle (intact — not exploded)
 *   - Intake Tasks (CLE16 ready, CLE287 requested)
 */
import type { MedplumClient } from '@medplum/core';
import type {
  Bundle,
  BundleEntry,
  Condition,
  Organization,
  Patient,
  PlanDefinition,
  Practitioner,
  Questionnaire,
  ServiceRequest,
  Task,
} from '@medplum/fhirtypes';

// Import seed data
import charlieBrownBundle from '@bayshore-data/fhir/charlie-brown/bundle.json';
import pdWoundCareIcs from '@bayshore-data/fhir/plan-definitions/pd-wound-care-ics.json';

// Import all questionnaires
import qCle05 from '@bayshore-data/fhir/questionnaires/q-cle05-service-agreement.json';
import qCle10 from '@bayshore-data/fhir/questionnaires/q-cle10-client-care-assessment.json';
import qCle115 from '@bayshore-data/fhir/questionnaires/q-cle115-care-plan-wound.json';
import qCle116Foot from '@bayshore-data/fhir/questionnaires/q-cle116-foot-assessment.json';
import qCle116 from '@bayshore-data/fhir/questionnaires/q-cle116-wound-assessment.json';
import qCle16 from '@bayshore-data/fhir/questionnaires/q-cle16-physician-orders.json';
import qCle171 from '@bayshore-data/fhir/questionnaires/q-cle171-diabetes-assessment.json';
import qCle174 from '@bayshore-data/fhir/questionnaires/q-cle174-lower-limb.json';
import qCle187 from '@bayshore-data/fhir/questionnaires/q-cle187-foot-care-flowsheet.json';
import qCle21 from '@bayshore-data/fhir/questionnaires/q-cle21-vital-signs.json';
import qCle23 from '@bayshore-data/fhir/questionnaires/q-cle23-client-consent.json';
import qCle28 from '@bayshore-data/fhir/questionnaires/q-cle28-cardio-resp.json';
import qCle286 from '@bayshore-data/fhir/questionnaires/q-cle286-discharge.json';
import qCle287 from '@bayshore-data/fhir/questionnaires/q-cle287-safety-risk.json';
import qCle288wb from '@bayshore-data/fhir/questionnaires/q-cle288wb-violence-assessment.json';
import qCle30 from '@bayshore-data/fhir/questionnaires/q-cle30-medication-admin.json';
import qCle31 from '@bayshore-data/fhir/questionnaires/q-cle31-diabetes-flowsheet.json';
import qCle34 from '@bayshore-data/fhir/questionnaires/q-cle34-wound-flowsheet.json';
import qCle35 from '@bayshore-data/fhir/questionnaires/q-cle35-medication-profile.json';
import qCle52 from '@bayshore-data/fhir/questionnaires/q-cle52-pain-assessment.json';
import qCle75 from '@bayshore-data/fhir/questionnaires/q-cle75-infection-screener.json';
import qCle83 from '@bayshore-data/fhir/questionnaires/q-cle83-wound-resource-referral.json';

const allQuestionnaires: Questionnaire[] = [
  qCle05, qCle10, qCle115, qCle116Foot, qCle116, qCle16, qCle171, qCle174,
  qCle187, qCle21, qCle23, qCle28, qCle286, qCle287, qCle288wb, qCle30,
  qCle31, qCle34, qCle35, qCle52, qCle75, qCle83,
] as unknown as Questionnaire[];

/** Helper to extract a resource by ID from the Charlie Brown transaction bundle */
function extractResource<T>(resourceType: string, id: string): T {
  const bundle = charlieBrownBundle as Bundle;
  const entry = bundle.entry?.find(
    (e: BundleEntry) => e.resource?.resourceType === resourceType && e.resource?.id === id
  );
  if (!entry?.resource) {
    throw new Error(`Seed data missing: ${resourceType}/${id}`);
  }
  return entry.resource as T;
}

/** Extract all resources of a given type from the bundle */
function extractAllOfType<T>(resourceType: string): T[] {
  const bundle = charlieBrownBundle as Bundle;
  return (bundle.entry || [])
    .filter((e: BundleEntry) => e.resource?.resourceType === resourceType)
    .map((e: BundleEntry) => e.resource as T);
}

export async function seedPhase1(medplum: MedplumClient): Promise<void> {
  // 1. Organizations
  const orgs = extractAllOfType<Organization>('Organization');
  for (const org of orgs) {
    await medplum.createResource(org);
  }

  // 2. Practitioners
  const practitioners = extractAllOfType<Practitioner>('Practitioner');
  for (const pract of practitioners) {
    await medplum.createResource(pract);
  }

  // 3. PlanDefinition
  await medplum.createResource(pdWoundCareIcs as unknown as PlanDefinition);

  // 4. Questionnaires
  for (const q of allQuestionnaires) {
    await medplum.createResource(q);
  }

  // 5. eReferral message Bundle
  const patient = extractResource<Patient>('Patient', 'patient-charlie-brown');
  const drAlpha = extractResource<Practitioner>('Practitioner', 'dr-alpha');
  const serviceRequest = extractResource<ServiceRequest>('ServiceRequest', 'sr-wound-care-cb');
  const condition = extractResource<Condition>('Condition', 'condition-wound-cb');

  const eReferralBundle: Bundle = {
    resourceType: 'Bundle',
    id: 'ereferral-cb',
    type: 'message',
    timestamp: '2026-02-27T14:00:00Z',
    entry: [
      {
        resource: {
          resourceType: 'MessageHeader',
          id: 'msg-ereferral-cb',
          eventCoding: {
            system: 'https://ehealthontario.ca/fhir/CodeSystem/message-event',
            code: 'new-referral',
            display: 'New eReferral',
          },
          source: {
            name: 'Ontario eReferral System',
            endpoint: 'https://ereferral.ehealthontario.ca/fhir',
          },
          focus: [{ reference: 'ServiceRequest/sr-wound-care-cb' }],
        },
      },
      { resource: patient },
      { resource: drAlpha },
      { resource: serviceRequest },
      { resource: condition },
    ],
  };
  await medplum.createResource(eReferralBundle);

  // 6. Intake Tasks
  const taskCle16: Task = {
    resourceType: 'Task',
    id: 'task-intake-cle16',
    status: 'ready',
    intent: 'order',
    code: {
      coding: [{ system: 'https://bayshore.ca/fhir/CodeSystem/cle-forms', code: 'CLE16' }],
      text: 'Physician/Prescriber Orders',
    },
    description: 'Complete CLE16 — Physician/Authorized Prescribers\' Orders to process this referral.',
    focus: { reference: 'Questionnaire/q-cle16-physician-orders' },
    input: [{ type: { text: 'Questionnaire' }, valueReference: { reference: 'Questionnaire/q-cle16-physician-orders' } }],
    authoredOn: new Date().toISOString(),
    meta: { tag: [{ system: 'https://bayshore.ca/fhir/tags', code: 'intake' }] },
  };

  const taskCle287: Task = {
    resourceType: 'Task',
    id: 'task-intake-cle287',
    status: 'requested',
    intent: 'order',
    code: {
      coding: [{ system: 'https://bayshore.ca/fhir/CodeSystem/cle-forms', code: 'CLE287' }],
      text: 'Safety Risk Screener',
    },
    description: 'Complete CLE287 — Safety Risk Screener.',
    focus: { reference: 'Questionnaire/q-cle287-safety-risk' },
    input: [{ type: { text: 'Questionnaire' }, valueReference: { reference: 'Questionnaire/q-cle287-safety-risk' } }],
    authoredOn: new Date().toISOString(),
    meta: { tag: [{ system: 'https://bayshore.ca/fhir/tags', code: 'intake' }] },
  };

  await medplum.createResource(taskCle16);
  await medplum.createResource(taskCle287);
}
