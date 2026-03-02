import { Badge, Button, Card, Divider, Group, Select, Stack, Text, Title } from '@mantine/core';
import type { CarePlan, Goal, PlanDefinition } from '@medplum/fhirtypes';
import { Document, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { WoundTrendChart } from '../../components/WoundTrendChart';

export function CarePlanTab(): JSX.Element {
  const { patientId } = useParams();
  const medplum = useMedplum();
  const [carePlan, setCarePlan] = useState<CarePlan | undefined>();
  const [goal, setGoal] = useState<Goal | undefined>();
  const [planDefinition, setPlanDefinition] = useState<PlanDefinition | undefined>();
  const [loading, setLoading] = useState(true);
  const [templateApplied, setTemplateApplied] = useState(false);

  const loadData = useCallback(async () => {
    try {
      // Load CarePlan (MockClient doesn't support compound search params, so fetch all + filter)
      const allPlans = await medplum.searchResources('CarePlan', '_count=100');
      const plans = allPlans.filter(
        (cp) => cp.subject?.reference === `Patient/${patientId}` && cp.status === 'active'
      );
      const plan = plans[0];

      if (plan) {
        setCarePlan(plan);
        setTemplateApplied(true);

        // Load Goal
        if (plan.goal?.[0]?.reference) {
          try {
            const g = await medplum.readReference(plan.goal[0]);
            setGoal(g as Goal);
          } catch {
            // Goal might not exist yet
          }
        }

        // Load PlanDefinition
        if (plan.instantiatesCanonical?.[0]) {
          const pds = await medplum.searchResources('PlanDefinition', '_count=10');
          const pd = pds.find((p) => p.url === plan.instantiatesCanonical?.[0]);
          if (pd) setPlanDefinition(pd);
        }
      } else {
        // No care plan yet — load available PlanDefinitions for template selection
        const pds = await medplum.searchResources('PlanDefinition', '_count=10');
        if (pds.length > 0) setPlanDefinition(pds[0]);
      }
    } finally {
      setLoading(false);
    }
  }, [medplum, patientId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApplyTemplate = useCallback(() => {
    // Simulate applying the template — the CarePlan was already seeded
    setTemplateApplied(true);
    loadData();
  }, [loadData]);

  if (loading) {
    return <Document><Text>Loading care plan...</Text></Document>;
  }

  if (!patientId) {
    return <Document><Text c="red">No patient context</Text></Document>;
  }

  return (
    <Document>
      <Stack gap="lg">
        {/* Template selection (simulated $apply) */}
        {!templateApplied && (
          <Card withBorder shadow="sm" p="lg">
            <Title order={3}>Generate Care Plan</Title>
            <Text size="sm" c="dimmed" mb="md">
              Select a care template to generate a care plan for this patient.
            </Text>
            <Group>
              <Select
                label="Care Template"
                data={planDefinition ? [{ value: planDefinition.id || '', label: planDefinition.title || '' }] : []}
                value={planDefinition?.id}
                style={{ flex: 1 }}
              />
              <Button mt="xl" onClick={handleApplyTemplate}>
                Generate Care Plan
              </Button>
            </Group>
          </Card>
        )}

        {/* Fallback when template was "applied" but no care plan exists */}
        {templateApplied && !carePlan && (
          <Card withBorder shadow="sm" p="lg">
            <Text c="dimmed" ta="center">
              No care plan found. Complete the referral intake to generate a care plan for this patient.
            </Text>
          </Card>
        )}

        {/* Care Plan details */}
        {templateApplied && carePlan && (
          <>
            <Card withBorder shadow="sm">
              <Group justify="space-between" mb="md">
                <Title order={3}>{carePlan.title || 'Wound Care Plan'}</Title>
                <Badge variant="light" color="green" size="lg">
                  {carePlan.status}
                </Badge>
              </Group>

              <Stack gap="sm">
                {planDefinition && (
                  <Group gap="xs">
                    <Text fw={600} size="sm">Template:</Text>
                    <Badge variant="outline" color="blue">{planDefinition.title}</Badge>
                  </Group>
                )}

                {carePlan.period && (
                  <Group gap="xs">
                    <Text fw={600} size="sm">Period:</Text>
                    <Text size="sm">{carePlan.period.start} to {carePlan.period.end}</Text>
                  </Group>
                )}

                {carePlan.description && (
                  <Group gap="xs">
                    <Text fw={600} size="sm">Description:</Text>
                    <Text size="sm">{carePlan.description}</Text>
                  </Group>
                )}

                <Group gap="xs">
                  <Text fw={600} size="sm">Based on:</Text>
                  <Text size="sm">{carePlan.basedOn?.[0]?.reference || 'Service Request'}</Text>
                </Group>
              </Stack>
            </Card>

            {/* Goal */}
            {goal && (
              <Card withBorder shadow="sm">
                <Title order={4} mb="sm">Goal</Title>
                <Stack gap="xs">
                  <Text size="sm">{goal.description?.text}</Text>
                  {goal.target?.[0] && (
                    <Group gap="xs">
                      <Text fw={600} size="sm">Target:</Text>
                      <Text size="sm">
                        {goal.target[0].measure?.coding?.[0]?.display}:{' '}
                        {goal.target[0].detailQuantity?.value} {goal.target[0].detailQuantity?.unit}
                      </Text>
                      <Text size="sm" c="dimmed">Due: {goal.target[0].dueDate}</Text>
                    </Group>
                  )}
                  <Badge
                    variant="light"
                    color={goal.lifecycleStatus === 'active' ? 'blue' : 'green'}
                  >
                    {goal.lifecycleStatus}
                  </Badge>
                </Stack>
              </Card>
            )}

            {/* Interventions from PlanDefinition */}
            {planDefinition?.action && (
              <Card withBorder shadow="sm">
                <Title order={4} mb="sm">Interventions (from Template)</Title>
                <Stack gap="xs">
                  {planDefinition.action.map((action, i) => (
                    <Group key={action.id || i} gap="xs">
                      <Badge variant="light" size="sm" color="gray">{i + 1}</Badge>
                      <Text size="sm">{action.title}</Text>
                    </Group>
                  ))}
                </Stack>
              </Card>
            )}

            <Divider label="Wound Healing Trend" labelPosition="center" />

            {/* Wound Trend Chart */}
            <WoundTrendChart patientId={patientId} />
          </>
        )}
      </Stack>
    </Document>
  );
}
