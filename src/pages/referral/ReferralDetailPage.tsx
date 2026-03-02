import { Alert, Badge, Button, Card, Divider, Grid, Group, Stack, Text, Title } from '@mantine/core';
import { normalizeOperationOutcome } from '@medplum/core';
import type { Bundle, Condition, Patient, Practitioner, QuestionnaireResponse, ServiceRequest, Task } from '@medplum/fhirtypes';
import { Document, QuestionnaireForm, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ReferralBundleView } from '../../components/referral/ReferralBundleView';
import { seedPhase2 } from '../../seed/seedPhase2';
import { showErrorNotification } from '../../utils/notifications';

type IntakeStep = 'cle16' | 'cle287' | 'done';

function findBundleResource<T>(bundle: Bundle, resourceType: string): T | undefined {
  return bundle.entry?.find((e) => e.resource?.resourceType === resourceType)?.resource as T | undefined;
}

function buildCle16PrePopulation(bundle: Bundle): QuestionnaireResponse {
  const patient = findBundleResource<Patient>(bundle, 'Patient');
  const practitioner = findBundleResource<Practitioner>(bundle, 'Practitioner');
  const condition = findBundleResource<Condition>(bundle, 'Condition');
  const serviceRequest = findBundleResource<ServiceRequest>(bundle, 'ServiceRequest');

  const items: QuestionnaireResponse['item'] = [];

  // Patient name
  if (patient?.name?.[0]) {
    const name = [patient.name[0].given?.join(' '), patient.name[0].family].filter(Boolean).join(' ');
    items.push({ linkId: 'patient-name', answer: [{ valueString: name }] });
  }

  // DOB
  if (patient?.birthDate) {
    items.push({ linkId: 'dob', answer: [{ valueDate: patient.birthDate }] });
  }

  // OHIP number
  const ohip = patient?.identifier?.find((id) => id.system?.includes('ohip'));
  if (ohip?.value) {
    items.push({ linkId: 'ohip-number', answer: [{ valueString: ohip.value }] });
  }

  // Prescriber name
  if (practitioner?.name?.[0]) {
    const n = practitioner.name[0];
    const prescriberName = [n.prefix?.join(' '), n.given?.join(' '), n.family].filter(Boolean).join(' ');
    items.push({ linkId: 'prescriber-name', answer: [{ valueString: prescriberName }] });
  }

  // Prescriber license
  if (practitioner?.identifier?.[0]?.value) {
    items.push({ linkId: 'prescriber-license', answer: [{ valueString: practitioner.identifier[0].value }] });
  }

  // Diagnosis
  const diagnosisCoding = condition?.code?.coding?.[0];
  if (diagnosisCoding) {
    items.push({ linkId: 'diagnosis', answer: [{ valueCoding: diagnosisCoding }] });
  }

  // Orders / Instructions
  const orders = serviceRequest?.code?.text || serviceRequest?.note?.[0]?.text;
  if (orders) {
    items.push({ linkId: 'orders', answer: [{ valueString: orders }] });
  }

  // Start date
  const startDate = serviceRequest?.occurrencePeriod?.start || serviceRequest?.authoredOn;
  if (startDate) {
    items.push({ linkId: 'start-date', answer: [{ valueDate: startDate }] });
  }

  // Duration (calculate from occurrence period if both dates present)
  if (serviceRequest?.occurrencePeriod?.start && serviceRequest?.occurrencePeriod?.end) {
    const start = new Date(serviceRequest.occurrencePeriod.start);
    const end = new Date(serviceRequest.occurrencePeriod.end);
    const weeks = Math.round((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
    items.push({ linkId: 'duration', answer: [{ valueString: `${weeks} weeks` }] });
  }

  return {
    resourceType: 'QuestionnaireResponse',
    status: 'in-progress',
    item: items,
  };
}

export function ReferralDetailPage(): JSX.Element {
  const { bundleId } = useParams();
  const medplum = useMedplum();
  const navigate = useNavigate();

  const [bundle, setBundle] = useState<Bundle | undefined>();
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState<IntakeStep>('cle16');
  const [taskCle16, setTaskCle16] = useState<Task | undefined>();
  const [taskCle287, setTaskCle287] = useState<Task | undefined>();
  const [questionnaireCle16, setQuestionnaireCle16] = useState<any>();
  const [questionnaireCle287, setQuestionnaireCle287] = useState<any>();

  const cle16PrePopulation = useMemo(() => {
    return bundle ? buildCle16PrePopulation(bundle) : undefined;
  }, [bundle]);

  const loadData = useCallback(async () => {
    try {
      if (!bundleId) return;

      // Load the eReferral bundle
      const b = await medplum.readResource('Bundle', bundleId);
      setBundle(b);

      // Load intake tasks
      const tasks = await medplum.searchResources('Task', '_tag=intake');
      const t16 = tasks.find((t) => t.id === 'task-intake-cle16');
      const t287 = tasks.find((t) => t.id === 'task-intake-cle287');
      setTaskCle16(t16);
      setTaskCle287(t287);

      // Determine current step
      if (t16?.status === 'completed' && t287?.status === 'completed') {
        setCurrentStep('done');
      } else if (t16?.status === 'completed') {
        setCurrentStep('cle287');
      } else {
        setCurrentStep('cle16');
      }

      // Load questionnaires
      const q16 = await medplum.readResource('Questionnaire', 'q-cle16-physician-orders');
      setQuestionnaireCle16(q16);
      const q287 = await medplum.readResource('Questionnaire', 'q-cle287-safety-risk');
      setQuestionnaireCle287(q287);
    } catch (err) {
      showErrorNotification(err);
    } finally {
      setLoading(false);
    }
  }, [bundleId, medplum]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCle16Submit = useCallback(async (response: QuestionnaireResponse) => {
    try {
      // Create QuestionnaireResponse
      await medplum.createResource<QuestionnaireResponse>({
        ...response,
        resourceType: 'QuestionnaireResponse',
        status: 'completed',
        authored: new Date().toISOString(),
      });

      // Mark CLE16 task completed
      if (taskCle16?.id) {
        await medplum.updateResource({
          ...taskCle16,
          status: 'completed',
        });
      }

      // "Explode" the bundle — seed all patient clinical data
      await seedPhase2(medplum);

      // Update CLE287 task to ready
      if (taskCle287?.id) {
        const updated = await medplum.updateResource({
          ...taskCle287,
          status: 'ready',
          for: { reference: 'Patient/patient-charlie-brown' },
        });
        setTaskCle287(updated);
      }

      setCurrentStep('cle287');
    } catch (err) {
      showErrorNotification(normalizeOperationOutcome(err));
    }
  }, [medplum, taskCle16, taskCle287]);

  const handleCle287Submit = useCallback(async (response: QuestionnaireResponse) => {
    try {
      // Create QuestionnaireResponse
      await medplum.createResource<QuestionnaireResponse>({
        ...response,
        resourceType: 'QuestionnaireResponse',
        status: 'completed',
        authored: new Date().toISOString(),
        subject: { reference: 'Patient/patient-charlie-brown' },
      });

      // Mark CLE287 task completed
      if (taskCle287?.id) {
        await medplum.updateResource({
          ...taskCle287,
          status: 'completed',
        });
      }

      // Mark bundle as processed
      if (bundle?.id) {
        await medplum.updateResource({
          ...bundle,
          meta: {
            ...bundle.meta,
            tag: [...(bundle.meta?.tag || []), { system: 'https://bayshore.ca/fhir/tags', code: 'processed' }],
          },
        });
      }

      setCurrentStep('done');
    } catch (err) {
      showErrorNotification(normalizeOperationOutcome(err));
    }
  }, [medplum, taskCle287, bundle]);

  if (loading) {
    return <Document><Text>Loading referral...</Text></Document>;
  }

  if (!bundle) {
    return <Document><Text c="red">Referral not found</Text></Document>;
  }

  return (
    <Document>
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={2}>Referral Intake</Title>
          <Badge
            variant="light"
            color={currentStep === 'done' ? 'green' : 'orange'}
            size="lg"
          >
            {currentStep === 'done' ? 'Active Client' : currentStep === 'cle287' ? 'CLE287 Pending' : 'Pending Intake'}
          </Badge>
        </Group>

        <Grid>
          {/* Left panel — Bundle contents */}
          <Grid.Col span={6}>
            <ReferralBundleView bundle={bundle} />
          </Grid.Col>

          {/* Right panel — Intake tasks */}
          <Grid.Col span={6}>
            <Stack gap="md">
              <Title order={3}>Intake Tasks</Title>

              {/* CLE16 */}
              <Card withBorder shadow="sm">
                <Group justify="space-between" mb="sm">
                  <Title order={4}>CLE16 — Physician Orders</Title>
                  <Badge
                    variant="light"
                    color={currentStep === 'cle16' ? 'blue' : 'green'}
                  >
                    {currentStep === 'cle16' ? 'Ready' : 'Completed'}
                  </Badge>
                </Group>

                {currentStep === 'cle16' && questionnaireCle16 && (
                  <QuestionnaireForm
                    questionnaire={questionnaireCle16}
                    questionnaireResponse={cle16PrePopulation}
                    onSubmit={handleCle16Submit}
                  />
                )}
                {currentStep !== 'cle16' && (
                  <Text c="dimmed" size="sm">Physician orders have been processed. Patient record created.</Text>
                )}
              </Card>

              <Divider />

              {/* CLE287 */}
              <Card withBorder shadow="sm">
                <Group justify="space-between" mb="sm">
                  <Title order={4}>CLE287 — Safety Risk Screener</Title>
                  <Badge
                    variant="light"
                    color={
                      currentStep === 'cle287' ? 'blue'
                        : currentStep === 'done' ? 'green'
                        : 'gray'
                    }
                  >
                    {currentStep === 'cle16' ? 'Waiting' : currentStep === 'cle287' ? 'Ready' : 'Completed'}
                  </Badge>
                </Group>

                {currentStep === 'cle287' && questionnaireCle287 && (
                  <QuestionnaireForm
                    questionnaire={questionnaireCle287}
                    onSubmit={handleCle287Submit}
                  />
                )}
                {currentStep === 'cle16' && (
                  <Text c="dimmed" size="sm">Complete CLE16 first to unlock this form.</Text>
                )}
                {currentStep === 'done' && (
                  <Text c="dimmed" size="sm">Safety screening complete.</Text>
                )}
              </Card>

              {/* Done — navigate to patient */}
              {currentStep === 'done' && (
                <>
                  <Alert color="green" title="Intake Complete">
                    Patient record is now active. All intake forms have been submitted.
                  </Alert>
                  <Button
                    size="md"
                    onClick={() => navigate('/Patient/patient-charlie-brown')?.catch(console.error)}
                  >
                    Go to Patient Profile
                  </Button>
                </>
              )}
            </Stack>
          </Grid.Col>
        </Grid>
      </Stack>
    </Document>
  );
}
