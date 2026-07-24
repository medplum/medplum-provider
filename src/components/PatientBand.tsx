import { calculateAgeString, formatHumanName } from '@medplum/core';
import { Patient } from '@medplum/fhirtypes';
import { ReactNode } from 'react';

interface PatientBandProps {
  patient?: Patient;
  facilityName?: string;
  admissionDate?: string;
  /** extra badges, e.g. alert flags */
  extra?: ReactNode;
}

/**
 * Sticky patient identity strip from the mockup. Reads directly off a
 * Medplum Patient resource instead of the mockup's plain form inputs.
 */
export function PatientBand({ patient, facilityName, admissionDate, extra }: PatientBandProps): JSX.Element {
  const name = patient?.name?.[0] ? formatHumanName(patient.name[0]) : 'Unnamed youth';
  const dob = patient?.birthDate ?? '—';
  const age = patient?.birthDate ? calculateAgeString(patient.birthDate) : '—';

  return (
    <div className="djs-patient-band">
      <div className="djs-patient-id">
        <span className="name">{name}</span>
        <span className="meta">
          DOB <b>{dob}</b> · Age <b>{age}</b>
        </span>
      </div>
      <div className="djs-band-actions">
        <span className="djs-badge blue">{facilityName ?? 'Facility not set'}</span>
        <span className="djs-badge">{admissionDate ? `Admitted ${admissionDate}` : 'Admission date —'}</span>
        {extra}
      </div>
    </div>
  );
}
