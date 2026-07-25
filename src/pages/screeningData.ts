// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type {
  AllergyIntolerance,
  CarePlan,
  Condition,
  MedicationStatement,
  Observation,
  Resource,
} from '@medplum/fhirtypes';

/**
 * Every resource the admission wizard writes carries an identifier under this
 * system, keyed by the field that produced it. This is the single source of
 * truth for that string — the wizard writes it, this module reads it back.
 */
export const SCREENING_ID_SYSTEM = 'http://maryland.gov/djs/admission-screening';

/**
 * True once a resource has been withdrawn. Must stay identical to the wizard's
 * own retraction check: Observation/MedicationStatement carry it in `status`,
 * Condition/AllergyIntolerance in `verificationStatus`. Anything the display or
 * read-back treats as live that the wizard treats as retracted (or vice versa)
 * is a correctness bug — a withdrawn finding shown as current, or an active one
 * hidden.
 */
export function isScreeningRetracted(res: Resource): boolean {
  const r = res as { status?: string; verificationStatus?: { coding?: { code?: string }[] } };
  return (
    r.status === 'entered-in-error' ||
    r.verificationStatus?.coding?.some((c) => c.code === 'entered-in-error') === true
  );
}

/** The screening key an admission resource was written under, if any. */
export function screeningKey(res: Resource): string | undefined {
  const withIdentifier = res as { identifier?: { system?: string; value?: string }[] };
  return withIdentifier.identifier?.find((i) => i.system === SCREENING_ID_SYSTEM)?.value;
}

/**
 * The admission-screening resources for one patient, grouped by type, already
 * filtered and deduplicated. Both the DJS patient summary (display) and the
 * wizard's form read-back build on this.
 */
export interface ScreeningResources {
  observations: Observation[];
  conditions: Condition[];
  allergies: AllergyIntolerance[];
  medications: MedicationStatement[];
  carePlans: CarePlan[];
  /** screening key → its single live resource, across every type above. */
  byKey: Map<string, Resource>;
}

function lastUpdated(res: Resource): string {
  return res.meta?.lastUpdated ?? '';
}

/**
 * Searches one resource type for a patient's screening resources, then filters:
 *
 * - **Retracted** resources are dropped — a withdrawn finding must not surface.
 * - **Non-screening** resources are dropped — the fallback search (below) has no
 *   identifier filter and would otherwise return the patient's whole chart.
 * - **Duplicates** — the pre-`0e8f04b` bugs left multiple resources under one
 *   key; keep only the most recently updated, so legacy data reads cleanly.
 *
 * The narrow `identifier=system|` search is tried first; a server that rejects
 * that token form falls back to fetching by patient and filtering here. Either
 * way the client-side filter runs, so the result is correct in both paths.
 * Subject-less orphans from the old bug simply never match a patient-scoped
 * search, which is the right outcome — they can't be attributed to anyone.
 */
async function searchScreening<T extends Resource>(
  medplum: MedplumClient,
  resourceType: T['resourceType'],
  param: 'subject' | 'patient',
  patientRef: string
): Promise<T[]> {
  let results: Resource[];
  try {
    results = (await medplum.searchResources(resourceType as 'Observation', {
      [param]: patientRef,
      identifier: `${SCREENING_ID_SYSTEM}|`,
      _count: 200,
    })) as Resource[];
  } catch {
    results = (await medplum.searchResources(resourceType as 'Observation', {
      [param]: patientRef,
      _count: 200,
    })) as Resource[];
  }

  const byKey = new Map<string, T>();
  for (const res of results) {
    if (isScreeningRetracted(res)) {
      continue;
    }
    const key = screeningKey(res);
    if (!key) {
      continue;
    }
    const existing = byKey.get(key);
    if (!existing || lastUpdated(res) >= lastUpdated(existing)) {
      byKey.set(key, res as T);
    }
  }
  return [...byKey.values()];
}

/**
 * Loads and organizes a patient's admission-screening resources. Returns empty
 * groups (never throws) when the patient has no screening on file, so callers
 * can render an empty state without special-casing.
 */
export async function loadScreeningResources(
  medplum: MedplumClient,
  patientId: string
): Promise<ScreeningResources> {
  const patientRef = `Patient/${patientId}`;
  const [observations, conditions, allergies, medications, carePlans] = await Promise.all([
    searchScreening<Observation>(medplum, 'Observation', 'subject', patientRef),
    searchScreening<Condition>(medplum, 'Condition', 'subject', patientRef),
    searchScreening<AllergyIntolerance>(medplum, 'AllergyIntolerance', 'patient', patientRef),
    searchScreening<MedicationStatement>(medplum, 'MedicationStatement', 'subject', patientRef),
    searchScreening<CarePlan>(medplum, 'CarePlan', 'subject', patientRef),
  ]);

  const byKey = new Map<string, Resource>();
  for (const res of [...observations, ...conditions, ...allergies, ...medications, ...carePlans]) {
    const key = screeningKey(res);
    if (key) {
      byKey.set(key, res);
    }
  }

  return { observations, conditions, allergies, medications, carePlans, byKey };
}
