import { Badge, Card, Grid, Group, Stack, Text, Title } from '@mantine/core';
import type { Bundle, Condition, Patient, Practitioner, ServiceRequest } from '@medplum/fhirtypes';
import type { JSX } from 'react';

interface ReferralBundleViewProps {
  bundle: Bundle;
}

function findResource<T>(bundle: Bundle, resourceType: string): T | undefined {
  return bundle.entry?.find((e) => e.resource?.resourceType === resourceType)?.resource as T | undefined;
}

export function ReferralBundleView({ bundle }: ReferralBundleViewProps): JSX.Element {
  const patient = findResource<Patient>(bundle, 'Patient');
  const practitioner = findResource<Practitioner>(bundle, 'Practitioner');
  const serviceRequest = findResource<ServiceRequest>(bundle, 'ServiceRequest');
  const condition = findResource<Condition>(bundle, 'Condition');

  return (
    <Stack gap="md">
      <Title order={3}>eReferral Details</Title>

      <Grid>
        {/* Patient Info */}
        <Grid.Col span={6}>
          <Card withBorder shadow="sm">
            <Title order={4}>Patient</Title>
            <Stack gap="xs" mt="sm">
              <Group gap="xs">
                <Text fw={600} size="sm">Name:</Text>
                <Text size="sm">
                  {patient?.name?.[0]?.given?.join(' ')} {patient?.name?.[0]?.family}
                </Text>
              </Group>
              <Group gap="xs">
                <Text fw={600} size="sm">DOB:</Text>
                <Text size="sm">{patient?.birthDate}</Text>
              </Group>
              <Group gap="xs">
                <Text fw={600} size="sm">Gender:</Text>
                <Text size="sm">{patient?.gender}</Text>
              </Group>
              {patient?.identifier?.map((id, i) => (
                <Group gap="xs" key={i}>
                  <Text fw={600} size="sm">
                    {id.system?.includes('ohip') ? 'OHIP' : id.type?.text || 'ID'}:
                  </Text>
                  <Text size="sm">{id.value}</Text>
                </Group>
              ))}
              {patient?.address?.[0] && (
                <Group gap="xs">
                  <Text fw={600} size="sm">Address:</Text>
                  <Text size="sm">
                    {patient.address[0].line?.join(', ')}, {patient.address[0].city},{' '}
                    {patient.address[0].state} {patient.address[0].postalCode}
                  </Text>
                </Group>
              )}
              {patient?.contact?.[0] && (
                <Group gap="xs">
                  <Text fw={600} size="sm">Emergency Contact:</Text>
                  <Text size="sm">
                    {patient.contact[0].name?.given?.join(' ')} {patient.contact[0].name?.family}{' '}
                    ({patient.contact[0].relationship?.[0]?.text})
                  </Text>
                </Group>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        {/* Referring Physician */}
        <Grid.Col span={6}>
          <Card withBorder shadow="sm">
            <Title order={4}>Referring Physician</Title>
            <Stack gap="xs" mt="sm">
              <Group gap="xs">
                <Text fw={600} size="sm">Name:</Text>
                <Text size="sm">
                  {practitioner?.name?.[0]?.prefix?.join(' ')} {practitioner?.name?.[0]?.given?.join(' ')}{' '}
                  {practitioner?.name?.[0]?.family}
                </Text>
              </Group>
              {practitioner?.identifier?.map((id, i) => (
                <Group gap="xs" key={i}>
                  <Text fw={600} size="sm">License:</Text>
                  <Text size="sm">{id.value}</Text>
                </Group>
              ))}
            </Stack>
          </Card>
        </Grid.Col>

        {/* Diagnosis */}
        <Grid.Col span={6}>
          <Card withBorder shadow="sm">
            <Title order={4}>Diagnosis</Title>
            <Stack gap="xs" mt="sm">
              {condition?.code?.coding?.map((c, i) => (
                <Group gap="xs" key={i}>
                  <Badge variant="light" size="sm">{c.system?.includes('icd') ? 'ICD-10' : 'SNOMED'}</Badge>
                  <Text size="sm">{c.code} — {c.display}</Text>
                </Group>
              ))}
              {condition?.bodySite?.map((bs, i) => (
                <Group gap="xs" key={i}>
                  <Text fw={600} size="sm">Body Site:</Text>
                  <Text size="sm">{bs.coding?.[0]?.display}</Text>
                </Group>
              ))}
            </Stack>
          </Card>
        </Grid.Col>

        {/* Service Request */}
        <Grid.Col span={6}>
          <Card withBorder shadow="sm">
            <Title order={4}>Service Request</Title>
            <Stack gap="xs" mt="sm">
              <Group gap="xs">
                <Text fw={600} size="sm">Service:</Text>
                <Text size="sm">{serviceRequest?.code?.coding?.[0]?.display}</Text>
              </Group>
              <Group gap="xs">
                <Text fw={600} size="sm">Orders:</Text>
                <Text size="sm">{serviceRequest?.patientInstruction || serviceRequest?.note?.[0]?.text}</Text>
              </Group>
              {serviceRequest?.occurrencePeriod && (
                <Group gap="xs">
                  <Text fw={600} size="sm">Period:</Text>
                  <Text size="sm">
                    {serviceRequest.occurrencePeriod.start} to {serviceRequest.occurrencePeriod.end}
                  </Text>
                </Group>
              )}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
