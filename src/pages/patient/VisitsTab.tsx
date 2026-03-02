import { Badge, Card, Group, Stack, Text, Title } from '@mantine/core';
import type { Appointment, Encounter } from '@medplum/fhirtypes';
import { Document, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';

interface VisitRow {
  appointment: Appointment;
  encounter?: Encounter;
}

function formatDateTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-CA', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
}

function isToday(iso?: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString();
}

function getStatusColor(status?: string): string {
  switch (status) {
    case 'fulfilled': case 'finished': return 'green';
    case 'booked': case 'planned': return 'blue';
    case 'arrived': case 'in-progress': return 'orange';
    case 'cancelled': return 'red';
    default: return 'gray';
  }
}

export function VisitsTab(): JSX.Element {
  const { patientId } = useParams();
  const medplum = useMedplum();
  const navigate = useNavigate();
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadVisits = useCallback(async () => {
    try {
      const appointments = await medplum.searchResources('Appointment', `patient=Patient/${patientId}`);

      // Sort by date descending
      appointments.sort((a, b) => {
        const da = new Date(a.start || '').getTime();
        const db = new Date(b.start || '').getTime();
        return db - da;
      });

      // Load linked encounters
      const rows: VisitRow[] = [];
      for (const appt of appointments) {
        let encounter: Encounter | undefined;
        try {
          const encounters = await medplum.searchResources(
            'Encounter',
            `appointment=Appointment/${appt.id}`
          );
          encounter = encounters[0];
        } catch {
          // No encounter yet
        }
        rows.push({ appointment: appt, encounter });
      }
      setVisits(rows);
    } finally {
      setLoading(false);
    }
  }, [medplum, patientId]);

  useEffect(() => {
    loadVisits();
  }, [loadVisits]);

  if (loading) {
    return <Document><Text>Loading visits...</Text></Document>;
  }

  return (
    <Document>
      <Stack gap="md">
        <Title order={3}>Scheduled Visits</Title>

        {visits.length === 0 ? (
          <Text c="dimmed">No visits scheduled.</Text>
        ) : (
          visits.map((v) => {
            const today = isToday(v.appointment.start);
            return (
              <Card
                key={v.appointment.id}
                withBorder
                shadow={today ? 'md' : 'sm'}
                style={{
                  cursor: v.encounter ? 'pointer' : 'default',
                  borderColor: today ? 'var(--mantine-color-blue-5)' : undefined,
                  borderWidth: today ? 2 : 1,
                }}
                onClick={() => {
                  if (v.encounter?.id) {
                    navigate(`/Patient/${patientId}/Encounter/${v.encounter.id}`)?.catch(console.error);
                  }
                }}
              >
                <Group justify="space-between">
                  <Stack gap={4}>
                    <Group gap="xs">
                      <Text fw={600}>{v.appointment.description}</Text>
                      {today && <Badge color="blue" variant="filled" size="sm">TODAY</Badge>}
                    </Group>
                    <Text size="sm" c="dimmed">
                      {formatDateTime(v.appointment.start)}
                      {v.appointment.end && ` — ${new Date(v.appointment.end).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}`}
                    </Text>
                  </Stack>

                  <Group gap="xs">
                    <Badge variant="light" color={getStatusColor(v.encounter?.status || v.appointment.status)}>
                      {v.encounter?.status || v.appointment.status}
                    </Badge>
                    {!v.encounter && (
                      <Text size="xs" c="dimmed">No encounter yet</Text>
                    )}
                  </Group>
                </Group>
              </Card>
            );
          })
        )}
      </Stack>
    </Document>
  );
}
