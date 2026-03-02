import { Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import type { Appointment, Encounter } from '@medplum/fhirtypes';
import { Document, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { startWoundCareVisit } from '../../utils/startVisit';

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
  const [starting, setStarting] = useState<string | null>(null);

  const loadVisits = useCallback(async () => {
    try {
      // MockClient doesn't support compound search params, so fetch all + filter client-side
      const allAppointments = await medplum.searchResources('Appointment', '_count=100');
      const appointments = allAppointments.filter(
        (appt) => appt.participant?.some((p) => p.actor?.reference === `Patient/${patientId}`)
      );

      // Sort by date descending
      appointments.sort((a, b) => {
        const da = new Date(a.start || '').getTime();
        const db = new Date(b.start || '').getTime();
        return db - da;
      });

      // Load linked encounters (fetch all once, then match)
      const allEncounters = await medplum.searchResources('Encounter', '_count=200');
      const rows: VisitRow[] = [];
      for (const appt of appointments) {
        const encounter = allEncounters.find(
          (enc) => enc.appointment?.some((a) => a.reference === `Appointment/${appt.id}`)
        );
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

  const handleStartVisit = useCallback(
    async (v: VisitRow) => {
      if (!patientId || !v.appointment.id) return;
      setStarting(v.appointment.id);
      try {
        const encounter = await startWoundCareVisit(medplum, v.appointment, patientId);
        navigate(`/Patient/${patientId}/Encounter/${encounter.id}`)?.catch(console.error);
      } catch (err) {
        console.error('Failed to start visit:', err);
      } finally {
        setStarting(null);
      }
    },
    [medplum, navigate, patientId]
  );

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
            const canStartVisit = v.appointment.status === 'booked' && !v.encounter;
            const hasEncounter = !!v.encounter?.id;

            return (
              <Card
                key={v.appointment.id}
                withBorder
                shadow={today ? 'md' : 'sm'}
                style={{
                  cursor: hasEncounter ? 'pointer' : 'default',
                  borderColor: today ? 'var(--mantine-color-blue-5)' : undefined,
                  borderWidth: today ? 2 : 1,
                }}
                onClick={() => {
                  if (hasEncounter) {
                    navigate(`/Patient/${patientId}/Encounter/${v.encounter!.id}`)?.catch(console.error);
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
                    {canStartVisit && (
                      <Button
                        size="xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartVisit(v);
                        }}
                        loading={starting === v.appointment.id}
                      >
                        Start Visit
                      </Button>
                    )}
                    <Badge variant="light" color={getStatusColor(v.encounter?.status || v.appointment.status)}>
                      {v.encounter?.status || v.appointment.status}
                    </Badge>
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
