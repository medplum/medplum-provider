// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient, WithId } from '@medplum/core';
import { createReference, getReferenceString } from '@medplum/core';
import type { ChargeItem, Encounter } from '@medplum/fhirtypes';

/**
 * Standalone function to fetch and apply ChargeItemDefinition to charge item
 * @param medplum - Medplum client instance
 * @param chargeItem - Current charge item
 * @returns Promise with updated charge items
 */
export async function applyChargeItemDefinition(
  medplum: MedplumClient,
  chargeItem: WithId<ChargeItem>
): Promise<WithId<ChargeItem>> {
  if (!chargeItem.definitionCanonical || chargeItem.definitionCanonical.length === 0) {
    return chargeItem;
  }

  const searchResult = await medplum.searchResources(
    'ChargeItemDefinition',
    `url=${chargeItem.definitionCanonical[0]}`
  );

  if (searchResult.length === 0) {
    return chargeItem;
  }

  const chargeItemDefinition = searchResult[0];
  const applyResult = await medplum.post(medplum.fhirUrl('ChargeItemDefinition', chargeItemDefinition.id, '$apply'), {
    resourceType: 'Parameters',
    parameter: [
      {
        name: 'chargeItem',
        valueReference: createReference(chargeItem),
      },
    ],
  });

  return applyResult as WithId<ChargeItem>;
}

export async function getChargeItemsForEncounter(
  medplum: MedplumClient,
  encounter: Encounter
): Promise<WithId<ChargeItem>[]> {
  if (!encounter) {
    return [];
  }

  // MockClient doesn't support reference search params, so fetch all + filter
  const allChargeItems = await medplum.searchResources('ChargeItem', '_count=100');
  const chargeItems = allChargeItems.filter(
    (ci) => ci.context?.reference === getReferenceString(encounter)
  );
  const updatedChargeItems = await Promise.all(
    chargeItems.map((chargeItem) => applyChargeItemDefinition(medplum, chargeItem))
  );
  return updatedChargeItems;
}

export function calculateTotalPrice(items: ChargeItem[]): number {
  return items.reduce((sum, item) => sum + (item.priceOverride?.value || 0), 0);
}
