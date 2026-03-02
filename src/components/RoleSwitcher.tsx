import { Badge, Group, SegmentedControl } from '@mantine/core';
import { useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import type { DemoRole } from '../context/RoleContext';
import { useRole } from '../context/RoleContext';

const ROLE_PRACTITIONER_MAP: Record<DemoRole, string> = {
  coordinator: 'coordinator-anderson',
  nurse: 'nurse-ratched',
};

export function RoleSwitcher(): JSX.Element {
  const { role, setRole } = useRole();
  const navigate = useNavigate();
  const medplum = useMedplum();

  const handleChange = (value: string): void => {
    const newRole = value as DemoRole;
    setRole(newRole);

    // Switch practitioner profile so the header name updates
    const practitionerId = ROLE_PRACTITIONER_MAP[newRole];
    medplum.readResource('Practitioner', practitionerId).then((practitioner) => {
      (medplum as any).setProfile(practitioner);
    }).catch(console.error);

    if (newRole === 'coordinator') {
      navigate('/referrals')?.catch(console.error);
    } else {
      navigate('/nurse-schedule')?.catch(console.error);
    }
  };

  return (
    <Group gap="sm">
      <Badge
        variant="filled"
        size="sm"
        style={{ backgroundColor: '#c9a376', color: '#052334' }}
      >
        DEMO
      </Badge>
      <SegmentedControl
        value={role}
        onChange={handleChange}
        size="xs"
        styles={{
          root: { backgroundColor: 'rgba(255,255,255,0.15)' },
          label: { color: '#fff', fontSize: '0.7rem', padding: '2px 10px' },
          indicator: { backgroundColor: '#fff' },
        }}
        data={[
          { label: 'Coordinator', value: 'coordinator' },
          { label: 'Nurse', value: 'nurse' },
        ]}
      />
    </Group>
  );
}
