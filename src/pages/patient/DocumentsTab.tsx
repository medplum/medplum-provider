import { Accordion, Badge, Card, Group, Stack, Text, Title } from '@mantine/core';
import type { Composition } from '@medplum/fhirtypes';
import { Document, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';

export function DocumentsTab(): JSX.Element {
  const { patientId } = useParams();
  const medplum = useMedplum();
  const [compositions, setCompositions] = useState<Composition[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDocuments = useCallback(async () => {
    try {
      const comps = await medplum.searchResources('Composition', `subject=Patient/${patientId}`);
      setCompositions(comps);
    } finally {
      setLoading(false);
    }
  }, [medplum, patientId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  if (loading) {
    return <Document><Text>Loading documents...</Text></Document>;
  }

  return (
    <Document>
      <Stack gap="md">
        <Title order={3}>Documents</Title>

        {compositions.length === 0 ? (
          <Card withBorder shadow="sm" p="xl">
            <Text ta="center" c="dimmed">No documents available.</Text>
          </Card>
        ) : (
          compositions.map((comp) => (
            <Card key={comp.id} withBorder shadow="sm">
              <Group justify="space-between" mb="md">
                <Stack gap={2}>
                  <Title order={4}>{comp.title}</Title>
                  <Text size="xs" c="dimmed">
                    {comp.type?.coding?.[0]?.display} | {comp.date?.slice(0, 10)}
                  </Text>
                </Stack>
                <Badge variant="light" color={comp.status === 'final' ? 'green' : 'blue'}>
                  {comp.status}
                </Badge>
              </Group>

              {comp.author?.[0]?.reference && (
                <Text size="sm" mb="sm">
                  <strong>Author:</strong> {comp.author[0].display || comp.author[0].reference}
                </Text>
              )}

              <Accordion variant="contained">
                {comp.section?.map((section, i) => (
                  <Accordion.Item key={i} value={`section-${i}`}>
                    <Accordion.Control>
                      <Text fw={600} size="sm">{section.title}</Text>
                    </Accordion.Control>
                    <Accordion.Panel>
                      {section.text?.div ? (
                        <div
                          dangerouslySetInnerHTML={{ __html: section.text.div }}
                          style={{ fontSize: '0.875rem', lineHeight: 1.6 }}
                        />
                      ) : (
                        <Text size="sm" c="dimmed">No content</Text>
                      )}

                      {section.entry && section.entry.length > 0 && (
                        <Stack gap="xs" mt="sm">
                          <Text size="xs" fw={600} c="dimmed">Referenced Resources:</Text>
                          {section.entry.map((ref, j) => (
                            <Text key={j} size="xs" c="dimmed">{ref.reference}</Text>
                          ))}
                        </Stack>
                      )}
                    </Accordion.Panel>
                  </Accordion.Item>
                ))}
              </Accordion>
            </Card>
          ))
        )}
      </Stack>
    </Document>
  );
}
