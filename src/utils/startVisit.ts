/**
 * Demo-specific utility to start a wound care visit.
 *
 * Creates an Encounter, ClinicalImpression, and CLE34 Task from a booked Appointment.
 * This replaces the PlanDefinition.$apply flow which doesn't work with MockClient.
 */
import type { MedplumClient } from '@medplum/core';
import type { Appointment, ClinicalImpression, Encounter, Task } from '@medplum/fhirtypes';

export async function startWoundCareVisit(
  medplum: MedplumClient,
  appointment: Appointment,
  patientId: string
): Promise<Encounter> {
  // 1. Update appointment status to arrived
  await medplum.updateResource<Appointment>({
    ...appointment,
    status: 'arrived',
  });

  // 2. Create Encounter
  const encounter = await medplum.createResource<Encounter>({
    resourceType: 'Encounter',
    status: 'arrived',
    class: {
      system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
      code: 'HH',
      display: 'home health',
    },
    type: [{ text: appointment.description || 'Wound Care Visit' }],
    subject: { reference: `Patient/${patientId}` },
    participant: [
      {
        individual: { reference: 'Practitioner/nurse-ratched' },
      },
    ],
    appointment: [{ reference: `Appointment/${appointment.id}` }],
    period: { start: new Date().toISOString() },
    serviceProvider: { reference: 'Organization/bayshore-ics-mississauga' },
  });

  // 3. Create ClinicalImpression (for chart note textarea)
  await medplum.createResource<ClinicalImpression>({
    resourceType: 'ClinicalImpression',
    status: 'in-progress',
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounter.id}` },
    date: new Date().toISOString(),
  });

  // 4. Create CLE34 Task (Wound Care Flow Sheet)
  await medplum.createResource<Task>({
    resourceType: 'Task',
    status: 'ready',
    intent: 'order',
    code: {
      coding: [{ system: 'https://bayshore.ca/fhir/CodeSystem/cle-forms', code: 'CLE34' }],
      text: 'Wound Care Flow Sheet',
    },
    description: 'Wound Care Flow Sheet',
    for: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounter.id}` },
    focus: { reference: 'Questionnaire/q-cle34-wound-flowsheet' },
    input: [
      {
        type: { text: 'Questionnaire' },
        valueReference: { reference: 'Questionnaire/q-cle34-wound-flowsheet' },
      },
    ],
    authoredOn: new Date().toISOString(),
  });

  return encounter;
}
