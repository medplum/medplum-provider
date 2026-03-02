/**
 * Extracts wound measurement data from a CLE34 QuestionnaireResponse
 * and creates discrete FHIR Observation resources.
 */
import type { MedplumClient } from '@medplum/core';
import type { Observation, QuestionnaireResponse, QuestionnaireResponseItem } from '@medplum/fhirtypes';

function findItem(items: QuestionnaireResponseItem[] | undefined, linkId: string): QuestionnaireResponseItem | undefined {
  if (!items) return undefined;
  for (const item of items) {
    if (item.linkId === linkId) return item;
    const found = findItem(item.item, linkId);
    if (found) return found;
  }
  return undefined;
}

function getDecimalValue(items: QuestionnaireResponseItem[] | undefined, linkId: string): number | undefined {
  const item = findItem(items, linkId);
  return item?.answer?.[0]?.valueDecimal ?? item?.answer?.[0]?.valueInteger;
}

function getCodingValue(items: QuestionnaireResponseItem[] | undefined, linkId: string): { code: string; display: string } | undefined {
  const item = findItem(items, linkId);
  const coding = item?.answer?.[0]?.valueCoding;
  if (coding?.code) return { code: coding.code, display: coding.display || '' };
  return undefined;
}

export async function createWoundObservationsFromCLE34(
  medplum: MedplumClient,
  response: QuestionnaireResponse,
  encounterId: string,
  patientId: string
): Promise<Observation[]> {
  const items = response.item;
  const length = getDecimalValue(items, 'wound-length');
  const width = getDecimalValue(items, 'wound-width');
  const depth = getDecimalValue(items, 'wound-depth');
  const tissueType = getCodingValue(items, 'tissue-type');

  const effectiveDateTime = new Date().toISOString();
  const created: Observation[] = [];

  const baseObs = {
    status: 'final' as const,
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounterId}` },
    effectiveDateTime,
    focus: [{ reference: 'BodyStructure/wound-site-cb' }],
  };

  if (length !== undefined) {
    const obs: Observation = {
      ...baseObs,
      resourceType: 'Observation',
      code: { coding: [{ system: 'http://loinc.org', code: '39126-8', display: 'Wound length' }] },
      valueQuantity: { value: length, unit: 'cm', system: 'http://unitsofmeasure.org', code: 'cm' },
    };
    created.push(await medplum.createResource(obs));
  }

  if (width !== undefined) {
    const obs: Observation = {
      ...baseObs,
      resourceType: 'Observation',
      code: { coding: [{ system: 'http://loinc.org', code: '39125-0', display: 'Wound width' }] },
      valueQuantity: { value: width, unit: 'cm', system: 'http://unitsofmeasure.org', code: 'cm' },
    };
    created.push(await medplum.createResource(obs));
  }

  if (depth !== undefined) {
    const obs: Observation = {
      ...baseObs,
      resourceType: 'Observation',
      code: { coding: [{ system: 'http://loinc.org', code: '39127-6', display: 'Wound depth' }] },
      valueQuantity: { value: depth, unit: 'cm', system: 'http://unitsofmeasure.org', code: 'cm' },
    };
    created.push(await medplum.createResource(obs));
  }

  // Surface area = L x W
  if (length !== undefined && width !== undefined) {
    const area = length * width;
    const obs: Observation = {
      ...baseObs,
      resourceType: 'Observation',
      code: { coding: [{ system: 'http://loinc.org', code: '72298-3', display: 'Wound surface area' }] },
      valueQuantity: { value: area, unit: 'cm2', system: 'http://unitsofmeasure.org', code: 'cm2' },
    };
    created.push(await medplum.createResource(obs));
  }

  if (tissueType) {
    const obs: Observation = {
      ...baseObs,
      resourceType: 'Observation',
      code: { coding: [{ system: 'http://loinc.org', code: '72371-8', display: 'Wound bed appearance' }] },
      valueCodeableConcept: {
        coding: [{ system: 'http://snomed.info/sct', code: tissueType.code, display: tissueType.display }],
      },
    };
    created.push(await medplum.createResource(obs));
  }

  return created;
}
