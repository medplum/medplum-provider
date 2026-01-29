// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  Stack,
  Title,
  Text,
  Group,
  Badge,
  Paper,
  Divider,
  Box,
  Button,
  Textarea,
  Select,
} from '@mantine/core';
import { formatDateTime } from '@medplum/core';
import type { ServiceRequest } from '@medplum/fhirtypes';
import { ResourceBadge, useMedplum } from '@medplum/react';
import { showNotification } from '@mantine/notifications';
import { useState } from 'react';
import type { JSX } from 'react';
import { showErrorNotification } from '../../utils/notifications';
import { IconEdit, IconDeviceFloppy } from '@tabler/icons-react';

interface ReferralDetailsProps {
  referral: ServiceRequest;
  onUpdate?: () => void;
}

export function ReferralDetails({ referral, onUpdate }: ReferralDetailsProps): JSX.Element {
  const medplum = useMedplum();
  const [isEditing, setIsEditing] = useState(false);
  const [editedReferral, setEditedReferral] = useState(referral);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (): Promise<void> => {
    setIsSaving(true);
    try {
      await medplum.updateResource(editedReferral);
      showNotification({
        title: 'Referral Updated',
        message: 'Successfully updated referral.',
        color: 'green',
      });
      setIsEditing(false);
      if (onUpdate) {
        onUpdate();
      }
    } catch (error) {
      showErrorNotification(error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = (): void => {
    setEditedReferral(referral);
    setIsEditing(false);
  };

  const specialty = referral.code?.coding?.[0]?.display || referral.code?.text || 'Referral';
  const performer = referral.performer?.[0];
  const requester = referral.requester;
  const patient = referral.subject;

  const getStatusColor = (status?: string): string => {
    switch (status) {
      case 'active':
        return 'blue';
      case 'completed':
        return 'green';
      case 'on-hold':
        return 'yellow';
      case 'revoked':
      case 'entered-in-error':
        return 'red';
      case 'draft':
        return 'gray';
      default:
        return 'gray';
    }
  };

  return (
    <Box p="xl" style={{ height: '100%', overflowY: 'auto' }}>
      <Stack gap="lg">
        {/* Header */}
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={3}>{specialty}</Title>
            <Text size="sm" c="dimmed">
              Referral ID: {referral.id}
            </Text>
          </div>
          <Group>
            {!isEditing ? (
              <Button
                variant="light"
                leftSection={<IconEdit size={16} />}
                onClick={() => setIsEditing(true)}
              >
                Edit
              </Button>
            ) : (
              <>
                <Button variant="subtle" onClick={handleCancel} disabled={isSaving}>
                  Cancel
                </Button>
                <Button
                  leftSection={<IconDeviceFloppy size={16} />}
                  onClick={handleSave}
                  loading={isSaving}
                >
                  Save
                </Button>
              </>
            )}
          </Group>
        </Group>

        <Divider />

        {/* Status and Priority */}
        <Paper p="md" withBorder>
          <Stack gap="md">
            <Group>
              <Text size="sm" fw={600}>
                Status:
              </Text>
              {isEditing ? (
                <Select
                  value={editedReferral.status}
                  onChange={(value) =>
                    setEditedReferral({
                      ...editedReferral,
                      status: value as ServiceRequest['status'],
                    })
                  }
                  data={[
                    { value: 'draft', label: 'Draft' },
                    { value: 'active', label: 'Active' },
                    { value: 'on-hold', label: 'On Hold' },
                    { value: 'completed', label: 'Completed' },
                    { value: 'revoked', label: 'Revoked' },
                  ]}
                  style={{ width: 150 }}
                />
              ) : (
                <Badge color={getStatusColor(referral.status)}>{referral.status}</Badge>
              )}
            </Group>

            <Group>
              <Text size="sm" fw={600}>
                Priority:
              </Text>
              {isEditing ? (
                <Select
                  value={editedReferral.priority}
                  onChange={(value) =>
                    setEditedReferral({
                      ...editedReferral,
                      priority: value as ServiceRequest['priority'],
                    })
                  }
                  data={[
                    { value: 'routine', label: 'Routine' },
                    { value: 'urgent', label: 'Urgent' },
                    { value: 'asap', label: 'ASAP' },
                    { value: 'stat', label: 'STAT' },
                  ]}
                  style={{ width: 150 }}
                />
              ) : (
                <Text size="sm">{referral.priority || 'routine'}</Text>
              )}
            </Group>

            <Group>
              <Text size="sm" fw={600}>
                Intent:
              </Text>
              <Text size="sm">{referral.intent}</Text>
            </Group>
          </Stack>
        </Paper>

        {/* Patient & Providers */}
        <Paper p="md" withBorder>
          <Stack gap="md">
            <div>
              <Text size="sm" fw={600} mb={4}>
                Patient
              </Text>
              {patient && <ResourceBadge value={patient} link />}
            </div>

            <div>
              <Text size="sm" fw={600} mb={4}>
                Referring Provider
              </Text>
              {requester ? (
                <ResourceBadge value={requester} link />
              ) : (
                <Text size="sm" c="dimmed">
                  Not specified
                </Text>
              )}
            </div>

            <div>
              <Text size="sm" fw={600} mb={4}>
                Referred To
              </Text>
              {performer ? (
                <ResourceBadge value={performer} link />
              ) : (
                <Text size="sm" c="dimmed">
                  Not assigned
                </Text>
              )}
            </div>
          </Stack>
        </Paper>

        {/* Clinical Information */}
        <Paper p="md" withBorder>
          <Stack gap="md">
            <div>
              <Text size="sm" fw={600} mb={4}>
                Reason for Referral
              </Text>
              {referral.reasonCode && referral.reasonCode.length > 0 ? (
                referral.reasonCode.map((reason, index) => (
                  <Text key={index} size="sm">
                    {reason.text || reason.coding?.[0]?.display || 'N/A'}
                  </Text>
                ))
              ) : (
                <Text size="sm" c="dimmed">
                  No reason specified
                </Text>
              )}
            </div>

            {referral.occurrenceDateTime && (
              <div>
                <Text size="sm" fw={600} mb={4}>
                  Scheduled Date
                </Text>
                <Text size="sm">{formatDateTime(referral.occurrenceDateTime)}</Text>
              </div>
            )}

            <div>
              <Text size="sm" fw={600} mb={4}>
                Authored On
              </Text>
              <Text size="sm">{referral.authoredOn ? formatDateTime(referral.authoredOn) : 'N/A'}</Text>
            </div>
          </Stack>
        </Paper>

        {/* Notes */}
        <Paper p="md" withBorder>
          <Stack gap="md">
            <Text size="sm" fw={600}>
              Notes
            </Text>
            {isEditing ? (
              <Textarea
                value={editedReferral.note?.[0]?.text || ''}
                onChange={(e) =>
                  setEditedReferral({
                    ...editedReferral,
                    note: [{ text: e.currentTarget.value }],
                  })
                }
                rows={4}
                placeholder="Add notes about this referral..."
              />
            ) : referral.note && referral.note.length > 0 ? (
              referral.note.map((note, index) => (
                <Text key={index} size="sm">
                  {note.text}
                </Text>
              ))
            ) : (
              <Text size="sm" c="dimmed">
                No notes
              </Text>
            )}
          </Stack>
        </Paper>
      </Stack>
    </Box>
  );
}
