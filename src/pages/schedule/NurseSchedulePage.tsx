import { Badge, Card, Divider, Group, Stack, Text, Title } from '@mantine/core';
import type { Appointment, Encounter } from '@medplum/fhirtypes';
import { Document, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

interface VisitCard {
  appointment: Appointment;
  encounter?: Encounter;
  patientName: string;
}

function isToday(iso?: string): boolean {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}

function isPast(iso?: string): boolean {
  if (!iso) return false;
  return new Date(iso) < new Date(new Date().toDateString());
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getStatusColor(status?: string): string {
  switch (status) {
    case 'fulfilled': case 'finished': return 'green';
    case 'booked': case 'planned': return 'blue';
    case 'arrived': case 'in-progress': return 'orange';
    default: return 'gray';
  }
}

export function NurseSchedulePage(): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();
  const [visits, setVisits] = useState<VisitCard[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSchedule = useCallback(async () => {
    try {
      // Load all appointments (in demo, all belong to nurse-ratched)
      const appointments = await medplum.searchResources('Appointment', '_count=50&_sort=date');

      const cards: VisitCard[] = [];
      for (const appt of appointments) {
        // Find linked encounter
        let encounter: Encounter | undefined;
        try {
          const encounters = await medplum.searchResources('Encounter', `appointment=Appointment/${appt.id}`);
          encounter = encounters[0];
        } catch {
          // No encounter
        }

        // Get patient name from participant
        const patientRef = appt.participant?.find((p) => p.actor?.reference?.startsWith('Patient/'));
        let patientName = 'Unknown Patient';
        if (patientRef?.actor?.reference) {
          try {
            const patient = await medplum.readReference(patientRef.actor);
            const name = (patient as any)?.name?.[0];
            if (name) {
              patientName = `${name.given?.join(' ') || ''} ${name.family || ''}`.trim();
            }
          } catch {
            // Patient not yet created (pre-intake)
          }
        }

        cards.push({ appointment: appt, encounter, patientName });
      }

      // Sort by date ascending
      cards.sort((a, b) => {
        const da = new Date(a.appointment.start || '').getTime();
        const db = new Date(b.appointment.start || '').getTime();
        return da - db;
      });

      setVisits(cards);
    } finally {
      setLoading(false);
    }
  }, [medplum]);

  useEffect(() => {
    loadSchedule();
  }, [loadSchedule]);

  if (loading) {
    return <Document><Text>Loading schedule...</Text></Document>;
  }

  const todayVisits = visits.filter((v) => isToday(v.appointment.start));
  const upcomingVisits = visits.filter((v) => !isToday(v.appointment.start) && !isPast(v.appointment.start));
  const pastVisits = visits.filter((v) => isPast(v.appointment.start));

  const renderCard = (v: VisitCard) => {
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
            const patientRef = v.appointment.participant?.find((p) => p.actor?.reference?.startsWith('Patient/'));
            const patientId = patientRef?.actor?.reference?.replace('Patient/', '');
            if (patientId) {
              navigate(`/Patient/${patientId}/Encounter/${v.encounter.id}`)?.catch(console.error);
            }
          }
        }}
      >
        <Group justify="space-between">
          <Stack gap={2}>
            <Group gap="xs">
              <Text fw={600}>{v.patientName}</Text>
              {today && <Badge color="blue" variant="filled" size="sm">TODAY</Badge>}
            </Group>
            <Text size="sm">{v.appointment.description}</Text>
            <Text size="xs" c="dimmed">
              {formatDate(v.appointment.start)} | {formatTime(v.appointment.start)} — {formatTime(v.appointment.end)}
            </Text>
          </Stack>
          <Badge variant="light" color={getStatusColor(v.encounter?.status || v.appointment.status)}>
            {v.encounter?.status || v.appointment.status}
          </Badge>
        </Group>
      </Card>
    );
  };

  return (
    <Document>
      <Stack gap="lg">
        <Title order={2}>Visit Schedule</Title>

        {visits.length === 0 && (
          <Card withBorder shadow="sm" p="xl">
            <Text ta="center" c="dimmed">
              No visits scheduled. Complete the referral intake first.
            </Text>
          </Card>
        )}

        {todayVisits.length > 0 && (
          <>
            <Divider label="Today" labelPosition="left" />
            <Stack gap="sm">
              {todayVisits.map(renderCard)}
            </Stack>
          </>
        )}

        {upcomingVisits.length > 0 && (
          <>
            <Divider label="Upcoming" labelPosition="left" />
            <Stack gap="sm">
              {upcomingVisits.map(renderCard)}
            </Stack>
          </>
        )}

        {pastVisits.length > 0 && (
          <>
            <Divider label="Past" labelPosition="left" />
            <Stack gap="sm">
              {pastVisits.map(renderCard)}
            </Stack>
          </>
        )}
      </Stack>
    </Document>
  );
}
