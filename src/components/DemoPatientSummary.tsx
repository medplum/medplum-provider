/**
 * Custom patient sidebar for the demo.
 *
 * Replaces @medplum/react's PatientSummary which uses internal searchResources()
 * calls with reference params that fail in MockClient.
 * Uses the fetch-all + filter pattern instead.
 */
import { Avatar, Badge, Card, Divider, Group, ScrollArea, Stack, Text, Title } from '@mantine/core';
import type {
  AllergyIntolerance,
  Condition,
  MedicationRequest,
  Observation,
  Patient,
} from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';

interface DemoPatientSummaryProps {
  patient: Patient;
  onClickResource?: (resource: { resourceType: string; id: string }) => void;
}

function calculateAge(birthDate: string): number {
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

interface SidebarData {
  conditions: Condition[];
  medications: MedicationRequest[];
  allergies: AllergyIntolerance[];
  smokingStatus?: Observation;
  vitals: Observation[];
}

export function DemoPatientSummary({ patient, onClickResource }: DemoPatientSummaryProps): JSX.Element {
  const medplum = useMedplum();
  const [data, setData] = useState<SidebarData>({
    conditions: [],
    medications: [],
    allergies: [],
    vitals: [],
  });

  const loadData = useCallback(async () => {
    const patientRef = `Patient/${patient.id}`;

    // Fetch all resources in parallel, then filter client-side
    const [allConditions, allMedRequests, allAllergies, allObs] = await Promise.all([
      medplum.searchResources('Condition', '_count=200'),
      medplum.searchResources('MedicationRequest', '_count=200'),
      medplum.searchResources('AllergyIntolerance', '_count=200'),
      medplum.searchResources('Observation', '_count=500'),
    ]);

    const conditions = allConditions.filter(
      (c) =>
        c.subject?.reference === patientRef &&
        c.category?.some((cat) =>
          cat.coding?.some((code) => code.code === 'problem-list-item')
        )
    );

    const medications = allMedRequests.filter(
      (mr) => mr.subject?.reference === patientRef && mr.status === 'active'
    );

    const allergies = allAllergies.filter(
      (ai) => ai.patient?.reference === patientRef
    );

    const patientObs = allObs.filter((obs) => obs.subject?.reference === patientRef);

    // Smoking status — LOINC 72166-2
    const smokingStatus = patientObs.find(
      (obs) => obs.code?.coding?.some((c) => c.code === '72166-2')
    );

    // Latest vitals — BP systolic (8480-6), BP diastolic (8462-4), Heart rate (8867-4), SpO2 (2708-6), Temperature (8310-5)
    const vitalCodes = ['8480-6', '8462-4', '8867-4', '2708-6', '8310-5'];
    const vitals: Observation[] = [];
    for (const code of vitalCodes) {
      const matching = patientObs
        .filter((obs) => obs.code?.coding?.some((c) => c.code === code))
        .sort((a, b) => new Date(b.effectiveDateTime || '').getTime() - new Date(a.effectiveDateTime || '').getTime());
      if (matching.length > 0) {
        vitals.push(matching[0]);
      }
    }

    setData({ conditions, medications, allergies, smokingStatus, vitals });
  }, [medplum, patient.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const name = patient.name?.[0];
  const displayName = name ? `${name.given?.join(' ') || ''} ${name.family || ''}`.trim() : 'Unknown';
  const initials = name ? `${(name.given?.[0]?.[0] || '')}${(name.family?.[0] || '')}`.toUpperCase() : '??';

  return (
    <ScrollArea style={{ height: '100%' }}>
      <Stack gap="xs" p="md">
        {/* Patient Header */}
        <Card p="sm" withBorder={false} shadow="none">
          <Group gap="sm" align="center">
            <Avatar size="lg" radius="xl" color="blue">{initials}</Avatar>
            <Stack gap={2}>
              <Text fw={700} size="md">{displayName}</Text>
              {patient.birthDate && (
                <Text size="xs" c="dimmed">
                  {formatDate(patient.birthDate)} ({calculateAge(patient.birthDate)} yrs)
                </Text>
              )}
              {patient.gender && (
                <Badge size="xs" variant="light" color="gray" tt="capitalize">{patient.gender}</Badge>
              )}
            </Stack>
          </Group>

          {/* Contact info */}
          {patient.telecom && patient.telecom.length > 0 && (
            <Stack gap={2} mt="xs">
              {patient.telecom.map((t, i) => (
                <Text key={i} size="xs" c="dimmed">
                  {t.system === 'phone' ? 'Phone' : t.system === 'email' ? 'Email' : t.system}: {t.value}
                </Text>
              ))}
            </Stack>
          )}

          {/* Address */}
          {patient.address?.[0] && (
            <Text size="xs" c="dimmed" mt={4}>
              {[patient.address[0].line?.join(', '), patient.address[0].city, patient.address[0].state]
                .filter(Boolean)
                .join(', ')}
            </Text>
          )}
        </Card>

        <Divider />

        {/* Problems */}
        <SidebarSection title="Problems" count={data.conditions.length}>
          {data.conditions.length === 0 ? (
            <Text size="xs" c="dimmed">No active problems</Text>
          ) : (
            data.conditions.map((c) => (
              <Text
                key={c.id}
                size="xs"
                style={{ cursor: onClickResource ? 'pointer' : 'default' }}
                onClick={() => c.id && onClickResource?.({ resourceType: 'Condition', id: c.id })}
              >
                {c.code?.text || c.code?.coding?.[0]?.display || 'Unknown condition'}
              </Text>
            ))
          )}
        </SidebarSection>

        <Divider />

        {/* Medications */}
        <SidebarSection title="Medications" count={data.medications.length}>
          {data.medications.length === 0 ? (
            <Text size="xs" c="dimmed">No active medications</Text>
          ) : (
            data.medications.map((mr) => (
              <Text key={mr.id} size="xs">
                {mr.medicationCodeableConcept?.text ||
                  mr.medicationCodeableConcept?.coding?.[0]?.display ||
                  'Unknown medication'}
              </Text>
            ))
          )}
        </SidebarSection>

        <Divider />

        {/* Allergies */}
        <SidebarSection title="Allergies" count={data.allergies.length}>
          {data.allergies.length === 0 ? (
            <Text size="xs" c="dimmed">No known allergies</Text>
          ) : (
            data.allergies.map((ai) => (
              <Group key={ai.id} gap={4}>
                <Text size="xs">
                  {ai.code?.text || ai.code?.coding?.[0]?.display || 'Unknown allergy'}
                </Text>
                {ai.criticality === 'high' && (
                  <Badge size="xs" color="red" variant="light">High</Badge>
                )}
              </Group>
            ))
          )}
        </SidebarSection>

        <Divider />

        {/* Smoking Status */}
        <SidebarSection title="Smoking Status">
          {data.smokingStatus ? (
            <Text size="xs">
              {data.smokingStatus.valueCodeableConcept?.text ||
                data.smokingStatus.valueCodeableConcept?.coding?.[0]?.display ||
                'Recorded'}
            </Text>
          ) : (
            <Text size="xs" c="dimmed">Not recorded</Text>
          )}
        </SidebarSection>

        <Divider />

        {/* Vitals */}
        <SidebarSection title="Latest Vitals" count={data.vitals.length}>
          {data.vitals.length === 0 ? (
            <Text size="xs" c="dimmed">No vitals recorded</Text>
          ) : (
            data.vitals.map((obs, i) => (
              <Group key={i} justify="space-between">
                <Text size="xs" c="dimmed">
                  {obs.code?.coding?.[0]?.display || obs.code?.text || ''}
                </Text>
                <Text size="xs" fw={500}>
                  {obs.valueQuantity?.value !== undefined
                    ? `${obs.valueQuantity.value} ${obs.valueQuantity.unit || ''}`
                    : obs.valueCodeableConcept?.coding?.[0]?.display || ''}
                </Text>
              </Group>
            ))
          )}
        </SidebarSection>
      </Stack>
    </ScrollArea>
  );
}

function SidebarSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Title order={6} c="dimmed" tt="uppercase" size="xs">
          {title}
        </Title>
        {count !== undefined && count > 0 && (
          <Badge size="xs" variant="light" color="gray">{count}</Badge>
        )}
      </Group>
      {children}
    </Stack>
  );
}
