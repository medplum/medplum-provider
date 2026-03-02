import { Badge, Card, Group, Stack, Table, Text, Title } from '@mantine/core';
import type { MedicationStatement } from '@medplum/fhirtypes';
import { Document, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';

function isHighRisk(ms: MedicationStatement): boolean {
  const noteText = ms.note?.map((n) => n.text || '').join(' ').toLowerCase() || '';
  return noteText.includes('high risk') || noteText.includes('high-risk') || noteText.includes('high alert');
}

export function MedicationsTab(): JSX.Element {
  const { patientId } = useParams();
  const medplum = useMedplum();
  const [medications, setMedications] = useState<MedicationStatement[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMedications = useCallback(async () => {
    try {
      const meds = await medplum.searchResources('MedicationStatement', `subject=Patient/${patientId}`);
      setMedications(meds);
    } finally {
      setLoading(false);
    }
  }, [medplum, patientId]);

  useEffect(() => {
    loadMedications();
  }, [loadMedications]);

  if (loading) {
    return <Document><Text>Loading medications...</Text></Document>;
  }

  return (
    <Document>
      <Stack gap="md">
        <Title order={3}>Medication Profile</Title>

        {medications.length === 0 ? (
          <Card withBorder shadow="sm" p="xl">
            <Text ta="center" c="dimmed">No medications recorded.</Text>
          </Card>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Medication</Table.Th>
                <Table.Th>Dosage</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Flags</Table.Th>
                <Table.Th>Notes</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {medications.map((ms) => {
                const medName = ms.medicationCodeableConcept?.coding?.[0]?.display
                  || ms.medicationCodeableConcept?.text
                  || 'Unknown';
                const dosage = ms.dosage?.[0];
                const dosageText = dosage
                  ? `${dosage.doseAndRate?.[0]?.doseQuantity?.value || ''} ${dosage.doseAndRate?.[0]?.doseQuantity?.unit || ''} ${dosage.route?.coding?.[0]?.display || ''} ${dosage.timing?.code?.text || dosage.text || ''}`.trim()
                  : '';

                return (
                  <Table.Tr key={ms.id}>
                    <Table.Td>
                      <Text fw={600}>{medName}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{dosageText}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={ms.status === 'active' ? 'green' : 'gray'}>
                        {ms.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {isHighRisk(ms) && (
                        <Badge variant="filled" color="red" size="sm">HIGH RISK</Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {ms.note?.map((n) => n.text).join('; ')}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Document>
  );
}
