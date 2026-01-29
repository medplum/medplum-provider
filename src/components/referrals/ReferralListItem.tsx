// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Box, Paper, Stack, Text, Badge, Group } from '@mantine/core';
import { getDisplayString, formatDateTime } from '@medplum/core';
import type { ServiceRequest } from '@medplum/fhirtypes';
import { useNavigate } from 'react-router';
import type { JSX } from 'react';
import cx from 'clsx';
import classes from './ReferralListItem.module.css';

interface ReferralListItemProps {
  item: ServiceRequest;
  selectedItem?: ServiceRequest;
  onItemSelect: (item: ServiceRequest) => string;
}

export function ReferralListItem({ item, selectedItem, onItemSelect }: ReferralListItemProps): JSX.Element {
  const navigate = useNavigate();
  const isSelected = selectedItem?.id === item.id;

  const handleClick = (): void => {
    const path = onItemSelect(item);
    navigate(path);
  };

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

  const getPriorityColor = (priority?: string): string => {
    switch (priority) {
      case 'stat':
      case 'urgent':
        return 'red';
      case 'asap':
        return 'orange';
      case 'routine':
      default:
        return 'gray';
    }
  };

  const specialty = item.code?.coding?.[0]?.display || item.code?.text || 'Referral';
  const performerRef = item.performer?.[0];
  const performer = performerRef?.display || performerRef?.reference || 'Not assigned';
  const date = item.authoredOn ? formatDateTime(item.authoredOn) : 'No date';

  return (
    <Paper
      onClick={handleClick}
      className={cx(classes.item, { [classes.selected]: isSelected })}
      p="md"
      style={{ cursor: 'pointer' }}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start">
          <Text fw={600} size="sm">
            {specialty}
          </Text>
          {item.status && <Badge color={getStatusColor(item.status)} size="sm">{item.status}</Badge>}
        </Group>

        <Box>
          <Text size="xs" c="dimmed">
            To: {performer}
          </Text>
          <Text size="xs" c="dimmed">
            {date}
          </Text>
        </Box>

        {item.priority && item.priority !== 'routine' && (
          <Badge color={getPriorityColor(item.priority)} size="xs" variant="light">
            {item.priority.toUpperCase()}
          </Badge>
        )}

        {item.reasonCode && item.reasonCode.length > 0 && (
          <Text size="xs" c="dimmed" lineClamp={2}>
            Reason: {item.reasonCode[0]?.text || item.reasonCode[0]?.coding?.[0]?.display || 'N/A'}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
