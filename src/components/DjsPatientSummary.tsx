// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { WithId } from '@medplum/core';
import type { Condition, MedicationStatement, Observation, Patient } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import '../theme/tokens.css';
import { dosageToFields, loadScreeningResources, screeningKey, type ScreeningResources } from '../pages/screeningData';

/** Vitals to show, in display order, keyed by the Observation code the wizard writes. */
const VITALS: { code: string; label: string }[] = [
  { code: 'Body temperature', label: 'Temp' },
  { code: 'Heart rate', label: 'Pulse' },
  { code: 'Respiratory rate', label: 'Resp' },
  { code: 'Blood pressure', label: 'BP' },
  { code: 'Body weight', label: 'Weight' },
  { code: 'Body height', label: 'Height' },
  { code: 'Body mass index (BMI)', label: 'BMI' },
];

const PAIN_CODE = 'Pain severity - 0-10 verbal numeric rating';
const SIGNOFF_CODE = 'Admission health screening sign-off';

function observationValue(obs: Observation): string {
  if (obs.valueQuantity) {
    return `${obs.valueQuantity.value ?? ''} ${obs.valueQuantity.unit ?? ''}`.trim();
  }
  if (obs.valueString) {
    return obs.valueString;
  }
  if (obs.valueInteger !== undefined) {
    return String(obs.valueInteger);
  }
  if (obs.dataAbsentReason) {
    return obs.dataAbsentReason.text ?? 'Not recorded';
  }
  return '—';
}

function findObs(data: ScreeningResources, code: string): Observation | undefined {
  return data.observations.find((o) => o.code?.text === code);
}

/** Conditions whose screening key carries the given prefix, e.g. `chronic::` or `nursing-diagnosis::`. */
function conditionsWithPrefix(data: ScreeningResources, prefix: string): Condition[] {
  return data.conditions.filter((c) => screeningKey(c)?.startsWith(prefix));
}

function medicationLabel(med: MedicationStatement): string {
  const name = med.medicationCodeableConcept?.text ?? 'Medication';
  const { dose, frequency } = dosageToFields(med.dosage?.[0]);
  const doseText = [dose, frequency].filter(Boolean).join(', ');
  return doseText ? `${name} — ${doseText}` : name;
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: 'var(--muted)',
  margin: '0 0 6px',
};

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}>
      <p style={labelStyle}>{title}</p>
      {children}
    </div>
  );
}

interface DjsPatientSummaryProps {
  patient: WithId<Patient>;
}

/**
 * Compact read-only summary of a patient's DJS admission screening, for the
 * patient record sidebar. Reads through {@link loadScreeningResources}, so it
 * shows only live findings — retracted ones are already filtered out, and the
 * pre-`0e8f04b` duplicates collapsed — and renders each section only when it
 * has data, with a single empty state when there is no screening on file.
 */
export function DjsPatientSummary({ patient }: DjsPatientSummaryProps): JSX.Element {
  const medplum = useMedplum();
  const [data, setData] = useState<ScreeningResources>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    setData(undefined);
    setError(undefined);
    loadScreeningResources(medplum, patient.id)
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      active = false;
    };
  }, [medplum, patient.id]);

  if (error) {
    return (
      <div className="djs-root" style={{ padding: 16, fontSize: 13, color: 'var(--danger)' }}>
        Could not load admission screening: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="djs-root" style={{ padding: 16, fontSize: 13, color: 'var(--muted)' }}>
        Loading admission screening…
      </div>
    );
  }

  const vitals = VITALS.map((v) => ({ ...v, obs: findObs(data, v.code) })).filter((v) => v.obs);
  const pain = findObs(data, PAIN_CODE);
  const signoff = findObs(data, SIGNOFF_CODE);
  const chronic = conditionsWithPrefix(data, 'chronic::');
  const diagnoses = conditionsWithPrefix(data, 'nursing-diagnosis::');

  const hasAnything =
    vitals.length > 0 ||
    pain ||
    data.allergies.length > 0 ||
    chronic.length > 0 ||
    data.medications.length > 0 ||
    diagnoses.length > 0 ||
    signoff;

  if (!hasAnything) {
    return (
      <div className="djs-root" style={{ padding: 16, fontSize: 13, color: 'var(--muted)' }}>
        No admission screening on file for this patient.
      </div>
    );
  }

  return (
    <div className="djs-root" style={{ padding: '4px 16px 16px', color: 'var(--ink)' }}>
      <p style={{ ...labelStyle, fontSize: 12, color: 'var(--primary)', marginTop: 12 }}>Admission Health Screening</p>

      {vitals.length > 0 && (
        <Section title="Vitals">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 13 }}>
            {vitals.map((v) => (
              <div key={v.code} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: 'var(--muted)' }}>{v.label}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{observationValue(v.obs as Observation)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {pain && (
        <Section title="Pain">
          <div style={{ fontSize: 13 }}>
            {pain.valueInteger !== undefined ? `${pain.valueInteger} / 10` : observationValue(pain)}
          </div>
        </Section>
      )}

      {data.allergies.length > 0 && (
        <Section title="Allergies">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {data.allergies.map((a) => (
              <li key={a.id} style={{ color: 'var(--danger)' }}>
                {a.code?.text ?? 'Allergy'}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {chronic.length > 0 && (
        <Section title="Chronic conditions">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {chronic.map((c) => (
              <li key={c.id}>{c.code?.text ?? 'Condition'}</li>
            ))}
          </ul>
        </Section>
      )}

      {data.medications.length > 0 && (
        <Section title="Current medications">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {data.medications.map((m) => (
              <li key={m.id}>{medicationLabel(m)}</li>
            ))}
          </ul>
        </Section>
      )}

      {diagnoses.length > 0 && (
        <Section title="Nursing diagnoses">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {diagnoses.map((d) => (
              <li key={d.id}>{d.code?.text ?? 'Diagnosis'}</li>
            ))}
          </ul>
        </Section>
      )}

      {signoff && (
        <Section title="Sign-off">
          <div style={{ fontSize: 13 }}>{observationValue(signoff)}</div>
        </Section>
      )}
    </div>
  );
}
