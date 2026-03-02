import { Badge, Group, Stack, Text } from '@mantine/core';
import type { JSX } from 'react';
import { useRole } from '../context/RoleContext';

export function RoleSwitcher(): JSX.Element {
  const { roleLabel, practitionerName } = useRole();

  return (
    <Group gap="sm" align="center">
      <Badge
        variant="filled"
        size="sm"
        style={{ backgroundColor: '#c9a376', color: '#052334' }}
      >
        DEMO
      </Badge>
      <Stack gap={0}>
        <Text size="sm" c="white" fw={600} lh={1.2}>
          {practitionerName}
        </Text>
        <Text size="xs" c="dimmed" lh={1.2}>
          {roleLabel}
        </Text>
      </Stack>
    </Group>
  );
}
