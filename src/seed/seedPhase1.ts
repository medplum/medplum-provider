/**
 * Phase 1 Seed — loaded on app start.
 *
 * Seeds infrastructure resources and one fully active patient (Homer Simpson):
 *   - Organizations (from both bundles)
 *   - Practitioners (from both bundles)
 *   - PlanDefinition (wound care template)
 *   - All Questionnaires (CLE forms)
 *   - Homer Simpson: fully active patient with appointments, care plan, etc.
 *   - eReferral message Bundles (Homer=processed, Charlie Brown=pending, Eleanor Rigby=pending)
 *   - Charlie Brown Intake Tasks (CLE16 ready, CLE287 requested)
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

// Import seed data from both bundles
import charlieBrownBundle from '@bayshore-data/fhir/charlie-brown/bundle.json';
import homerBundle from '@bayshore-data/fhir/homer-simpson/bundle.json';
import pdWoundCareIcs from '@bayshore-data/fhir/plan-definitions/pd-wound-care-ics.json';

import { seedHomerSimpson } from './seedHomerSimpson';

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
function extractCBResource<T>(resourceType: string, id: string): T {
  const bundle = charlieBrownBundle as Bundle;
  const entry = bundle.entry?.find(
    (e: BundleEntry) => e.resource?.resourceType === resourceType && e.resource?.id === id
  );
  if (!entry?.resource) {
    throw new Error(`Seed data missing: ${resourceType}/${id}`);
  }
  return entry.resource as T;
}

/** Extract all resources of a given type from the Charlie Brown bundle */
function extractCBAllOfType<T>(resourceType: string): T[] {
  const bundle = charlieBrownBundle as Bundle;
  return (bundle.entry || [])
    .filter((e: BundleEntry) => e.resource?.resourceType === resourceType)
    .map((e: BundleEntry) => e.resource as T);
}

/** Extract a resource from the Homer Simpson bundle */
function extractHSResource<T>(resourceType: string, id: string): T {
  const bundle = homerBundle as Bundle;
  const entry = bundle.entry?.find(
    (e: BundleEntry) => e.resource?.resourceType === resourceType && e.resource?.id === id
  );
  if (!entry?.resource) {
    throw new Error(`Homer seed data missing: ${resourceType}/${id}`);
  }
  return JSON.parse(JSON.stringify(entry.resource)) as T;
}

export async function seedPhase1(medplum: MedplumClient): Promise<void> {
  // 0. Remove MockClient's built-in test patients (Homer id:123, Bart id:555)
  try { await medplum.deleteResource('Patient', '123'); } catch { /* ignore */ }
  try { await medplum.deleteResource('Patient', '555'); } catch { /* ignore */ }

  // 1. Organizations (from both bundles — deduplicate by ID)
  const cbOrgs = extractCBAllOfType<Organization>('Organization');
  const seenOrgIds = new Set<string>();
  for (const org of cbOrgs) {
    seenOrgIds.add(org.id || '');
    await medplum.createResource(org);
  }
  // Homer bundle has additional orgs (bayshore-hhp-toronto-east)
  const hsOrgs = (homerBundle as Bundle).entry
    ?.filter((e: BundleEntry) => e.resource?.resourceType === 'Organization')
    .map((e: BundleEntry) => e.resource as Organization) || [];
  for (const org of hsOrgs) {
    if (!seenOrgIds.has(org.id || '')) {
      await medplum.createResource(org);
    }
  }

  // 2. Practitioners (from both bundles — deduplicate)
  const cbPracts = extractCBAllOfType<Practitioner>('Practitioner');
  const seenPractIds = new Set<string>();
  for (const pract of cbPracts) {
    seenPractIds.add(pract.id || '');
    await medplum.createResource(pract);
  }
  // Homer bundle has additional practitioners (dr-hibbert, nurse-mills, nurse-resource-chen)
  const hsPracts = (homerBundle as Bundle).entry
    ?.filter((e: BundleEntry) => e.resource?.resourceType === 'Practitioner')
    .map((e: BundleEntry) => e.resource as Practitioner) || [];
  for (const pract of hsPracts) {
    if (!seenPractIds.has(pract.id || '')) {
      await medplum.createResource(pract);
    }
  }

  // 3. PlanDefinition
  await medplum.createResource(pdWoundCareIcs as unknown as PlanDefinition);

  // 4. Questionnaires
  for (const q of allQuestionnaires) {
    await medplum.createResource(q);
  }

  // 5. Seed Homer Simpson as a fully active patient
  await seedHomerSimpson(medplum);

  // 6. eReferral message Bundles

  // 6a. Homer Simpson — already processed (active client)
  const homerPatient = extractHSResource<Patient>('Patient', 'patient-homer-simpson');
  const drHibbert = extractHSResource<Practitioner>('Practitioner', 'dr-hibbert');
  const homerSR = extractHSResource<ServiceRequest>('ServiceRequest', 'sr-wound-care-hs');
  const homerCondition = extractHSResource<Condition>('Condition', 'condition-wound-hs');

  const eReferralHomer: Bundle = {
    resourceType: 'Bundle',
    id: 'ereferral-hs',
    type: 'message',
    timestamp: '2026-02-20T10:00:00Z',
    meta: { tag: [{ system: 'https://bayshore.ca/fhir/tags', code: 'processed' }] },
    entry: [
      {
        resource: {
          resourceType: 'MessageHeader',
          id: 'msg-ereferral-hs',
          eventCoding: {
            system: 'https://ehealthontario.ca/fhir/CodeSystem/message-event',
            code: 'new-referral',
            display: 'New eReferral',
          },
          source: { name: 'Ontario eReferral System', endpoint: 'https://ereferral.ehealthontario.ca/fhir' },
          focus: [{ reference: 'ServiceRequest/sr-wound-care-hs' }],
        },
      },
      { resource: homerPatient },
      { resource: drHibbert },
      { resource: homerSR },
      { resource: homerCondition },
    ],
  };
  await medplum.createResource(eReferralHomer);

  // 6b. Charlie Brown — pending intake
  const cbPatient = extractCBResource<Patient>('Patient', 'patient-charlie-brown');
  const drAlpha = extractCBResource<Practitioner>('Practitioner', 'dr-alpha');
  const cbSR = extractCBResource<ServiceRequest>('ServiceRequest', 'sr-wound-care-cb');
  const cbCondition = extractCBResource<Condition>('Condition', 'condition-wound-cb');

  const eReferralCB: Bundle = {
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
          source: { name: 'Ontario eReferral System', endpoint: 'https://ereferral.ehealthontario.ca/fhir' },
          focus: [{ reference: 'ServiceRequest/sr-wound-care-cb' }],
        },
      },
      { resource: cbPatient },
      { resource: drAlpha },
      { resource: cbSR },
      { resource: cbCondition },
    ],
  };
  await medplum.createResource(eReferralCB);

  // 6c. Eleanor Rigby — pending referral (fabricated, gives queue 3 rows)
  const eReferralER: Bundle = {
    resourceType: 'Bundle',
    id: 'ereferral-er',
    type: 'message',
    timestamp: '2026-03-01T09:30:00Z',
    entry: [
      {
        resource: {
          resourceType: 'MessageHeader',
          id: 'msg-ereferral-er',
          eventCoding: {
            system: 'https://ehealthontario.ca/fhir/CodeSystem/message-event',
            code: 'new-referral',
            display: 'New eReferral',
          },
          source: { name: 'Ontario eReferral System', endpoint: 'https://ereferral.ehealthontario.ca/fhir' },
          focus: [{ reference: 'ServiceRequest/sr-wound-care-er' }],
        },
      },
      {
        resource: {
          resourceType: 'Patient',
          id: 'patient-eleanor-rigby',
          name: [{ family: 'Rigby', given: ['Eleanor'] }],
          gender: 'female',
          birthDate: '1942-08-05',
          address: [{ line: ['64 Penny Lane'], city: 'Liverpool', state: 'ON', postalCode: 'N5Y 1A4', country: 'CA' }],
          telecom: [{ system: 'phone', value: '519-555-0164', use: 'home' }],
        },
      },
      {
        resource: {
          resourceType: 'Practitioner',
          id: 'dr-mccartney',
          name: [{ family: 'McCartney', given: ['Paul'], prefix: ['Dr.'] }],
        },
      },
      {
        resource: {
          resourceType: 'ServiceRequest',
          id: 'sr-wound-care-er',
          status: 'active',
          intent: 'order',
          code: {
            coding: [{ system: 'http://snomed.info/sct', code: '225358003', display: 'Wound care' }],
            text: 'Nursing for pressure ulcer, sacral region. Dressing changes BID.',
          },
          subject: { reference: 'Patient/patient-eleanor-rigby' },
          requester: { reference: 'Practitioner/dr-mccartney' },
          authoredOn: '2026-03-01',
        },
      },
      {
        resource: {
          resourceType: 'Condition',
          id: 'condition-pressure-ulcer-er',
          clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
          code: {
            coding: [
              { system: 'http://hl7.org/fhir/sid/icd-10-ca', code: 'L89.153', display: 'Pressure ulcer of sacral region, stage III' },
            ],
            text: 'Pressure Ulcer — Sacral, Stage III',
          },
          subject: { reference: 'Patient/patient-eleanor-rigby' },
        },
      },
    ],
  };
  await medplum.createResource(eReferralER);

  // 7. Charlie Brown Intake Tasks
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
