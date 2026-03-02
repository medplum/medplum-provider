import { Badge, Card, Grid, Group, Stack, Text, TextInput, Title } from '@mantine/core';
import type { Questionnaire } from '@medplum/fhirtypes';
import { Document, QuestionnaireForm, useMedplum } from '@medplum/react';
import { IconSearch } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';

export function QuestionnairesPage(): JSX.Element {
  const medplum = useMedplum();
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Questionnaire | undefined>();

  const loadQuestionnaires = useCallback(async () => {
    try {
      const results = await medplum.searchResources('Questionnaire', '_count=100&_sort=title');
      setQuestionnaires(results);
    } finally {
      setLoading(false);
    }
  }, [medplum]);

  useEffect(() => {
    loadQuestionnaires();
  }, [loadQuestionnaires]);

  const filtered = questionnaires.filter((q) => {
    const term = search.toLowerCase();
    return (
      !term ||
      q.title?.toLowerCase().includes(term) ||
      q.name?.toLowerCase().includes(term) ||
      q.id?.toLowerCase().includes(term)
    );
  });

  // Extract CLE code from questionnaire ID (e.g., "q-cle34-wound-flowsheet" -> "CLE34")
  const getCleCode = (q: Questionnaire): string | undefined => {
    const match = q.id?.match(/cle(\d+)/i);
    return match ? `CLE${match[1]}` : undefined;
  };

  if (loading) {
    return <Document><Text>Loading forms...</Text></Document>;
  }

  return (
    <Document>
      <Stack gap="lg">
        <Group justify="space-between" align="center">
          <Title order={2}>Clinical Forms Library</Title>
          <Badge size="lg" variant="light">{questionnaires.length} forms</Badge>
        </Group>

        <TextInput
          placeholder="Search forms by name or code..."
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />

        {selected ? (
          <Stack gap="md">
            <Group>
              <Text
                c="blue"
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(undefined)}
              >
                &larr; Back to forms
              </Text>
            </Group>
            <Card withBorder shadow="sm" p="md">
              <Group justify="space-between" mb="md">
                <Title order={3}>{selected.title || selected.name || selected.id}</Title>
                {getCleCode(selected) && (
                  <Badge size="lg" variant="light" color="blue">{getCleCode(selected)}</Badge>
                )}
              </Group>
              <Text size="sm" c="dimmed" mb="md">
                Read-only preview. This form can be filled in during a patient encounter.
              </Text>
              <QuestionnaireForm
                questionnaire={selected}
                onSubmit={() => {
                  // Read-only preview — do nothing on submit
                }}
              />
            </Card>
          </Stack>
        ) : (
          <Grid>
            {filtered.length === 0 ? (
              <Grid.Col span={12}>
                <Text c="dimmed" ta="center">No forms match your search.</Text>
              </Grid.Col>
            ) : (
              filtered.map((q) => {
                const cleCode = getCleCode(q);
                const itemCount = q.item?.length || 0;
                return (
                  <Grid.Col key={q.id} span={{ base: 12, sm: 6, md: 4 }}>
                    <Card
                      withBorder
                      shadow="sm"
                      p="md"
                      style={{ cursor: 'pointer', height: '100%' }}
                      onClick={() => setSelected(q)}
                    >
                      <Stack gap="xs" justify="space-between" style={{ height: '100%' }}>
                        <Stack gap={4}>
                          <Group gap="xs">
                            {cleCode && <Badge size="sm" variant="filled" color="blue">{cleCode}</Badge>}
                            <Badge size="sm" variant="light" color="gray">{itemCount} fields</Badge>
                          </Group>
                          <Text fw={600} size="sm" lineClamp={2}>
                            {q.title || q.name || q.id}
                          </Text>
                          {q.description && (
                            <Text size="xs" c="dimmed" lineClamp={2}>{q.description}</Text>
                          )}
                        </Stack>
                        <Text size="xs" c="blue">View form &rarr;</Text>
                      </Stack>
                    </Card>
                  </Grid.Col>
                );
              })
            )}
          </Grid>
        )}
      </Stack>
    </Document>
  );
}
