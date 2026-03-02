import { Badge, Button, Card, Group, Stack, Table, Text, Title } from '@mantine/core';
import type { Bundle, Condition, Patient, Practitioner, ServiceRequest } from '@medplum/fhirtypes';
import { Document, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

interface ReferralRow {
  bundleId: string;
  patientName: string;
  referringPhysician: string;
  diagnosis: string;
  referralDate: string;
  status: 'Pending Intake' | 'Active Client';
}

function findResource<T>(bundle: Bundle, resourceType: string): T | undefined {
  return bundle.entry?.find((e) => e.resource?.resourceType === resourceType)?.resource as T | undefined;
}

export function ReferralQueuePage(): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadReferrals = useCallback(async () => {
    try {
      const bundles = await medplum.searchResources('Bundle', 'type=message');
      const rows: ReferralRow[] = bundles.map((bundle) => {
        const patient = findResource<Patient>(bundle, 'Patient');
        const practitioner = findResource<Practitioner>(bundle, 'Practitioner');
        const sr = findResource<ServiceRequest>(bundle, 'ServiceRequest');
        const condition = findResource<Condition>(bundle, 'Condition');

        const patientName = patient?.name?.[0]
          ? `${patient.name[0].given?.join(' ')} ${patient.name[0].family}`
          : 'Unknown Patient';

        const physician = practitioner?.name?.[0]
          ? `${practitioner.name[0].prefix?.join(' ') || ''} ${practitioner.name[0].given?.join(' ')} ${practitioner.name[0].family}`
          : 'Unknown';

        const diagnosisDisplay = condition?.code?.coding?.[0]?.display || 'Unknown';
        const icdCode = condition?.code?.coding?.find((c) => c.system?.includes('icd'))?.code;

        // Check if patient has been created (Phase 2 seeded) = Active Client
        const isActive = !!(bundle.meta?.tag?.find((t) => t.code === 'processed'));

        return {
          bundleId: bundle.id || '',
          patientName: patientName.trim(),
          referringPhysician: physician.trim(),
          diagnosis: icdCode ? `${icdCode} — ${diagnosisDisplay}` : diagnosisDisplay,
          referralDate: sr?.authoredOn || bundle.timestamp || '',
          status: isActive ? 'Active Client' : 'Pending Intake',
        };
      });
      setReferrals(rows);
    } finally {
      setLoading(false);
    }
  }, [medplum]);

  useEffect(() => {
    loadReferrals();
  }, [loadReferrals]);

  if (loading) {
    return <Document><Text>Loading referrals...</Text></Document>;
  }

  return (
    <Document>
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={2}>Referral Queue</Title>
          <Badge variant="light" color="blue" size="lg">{referrals.length} referral(s)</Badge>
        </Group>

        {referrals.length === 0 ? (
          <Card withBorder shadow="sm" p="xl">
            <Text ta="center" c="dimmed">No pending referrals</Text>
          </Card>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Patient</Table.Th>
                <Table.Th>Referring Physician</Table.Th>
                <Table.Th>Diagnosis</Table.Th>
                <Table.Th>Date</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Action</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {referrals.map((r) => (
                <Table.Tr key={r.bundleId}>
                  <Table.Td>
                    <Text fw={600}>{r.patientName}</Text>
                  </Table.Td>
                  <Table.Td>{r.referringPhysician}</Table.Td>
                  <Table.Td>
                    <Text size="sm">{r.diagnosis}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{r.referralDate?.slice(0, 10)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      variant="light"
                      color={r.status === 'Active Client' ? 'green' : 'orange'}
                    >
                      {r.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => navigate(`/referrals/${r.bundleId}`)?.catch(console.error)}
                    >
                      View Referral
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Document>
  );
}
