import type { Patient } from '@medplum/fhirtypes';

export function patientPathPrefix(patientId: string): string {
  return `/Patient/${patientId}`;
}

export function prependPatientPath(patient: Patient | undefined, path: string): string {
  if (patient?.id) {
    return `${patientPathPrefix(patient.id)}${!path.startsWith('/') ? '/' : ''}${path}`;
  }
  return path;
}

export function formatPatientPageTabUrl(patientId: string, tab: PatientPageTabInfo): string {
  return `${patientPathPrefix(patientId)}/${tab.url.replace('%patient.id', patientId)}`;
}

export type PatientPageTabInfo = {
  id: string;
  url: string;
  label: string;
};

export function getPatientPageTabOrThrow(tabId: string): PatientPageTabInfo {
  const result = PatientPageTabs.find((tab) => tab.id === tabId);
  if (!result) {
    throw new Error(`Could not find patient page tab with id ${tabId}`);
  }
  return result;
}

export function getPatientPageTabs(): PatientPageTabInfo[] {
  return PatientPageTabs;
}

export const PatientPageTabs: PatientPageTabInfo[] = [
  { id: 'timeline', url: '', label: 'Summary' },
  { id: 'careplan', url: 'careplan', label: 'Care Plan' },
  { id: 'visits', url: 'visits', label: 'Visits' },
  { id: 'medications', url: 'medications', label: 'Medications' },
  { id: 'documents', url: 'documents', label: 'Documents' },
  { id: 'edit', url: 'edit', label: 'Edit' },
];
