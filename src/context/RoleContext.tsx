import type { JSX, ReactNode } from 'react';
import { createContext, useCallback, useContext, useState } from 'react';

export type DemoRole = 'coordinator' | 'nurse' | 'content-manager';

const ROLE_LABELS: Record<DemoRole, string> = {
  coordinator: 'Branch Manager',
  nurse: 'Visiting Nurse',
  'content-manager': 'Clinical Content Manager',
};

const ROLE_NAMES: Record<DemoRole, string> = {
  coordinator: 'Priya Sharma',
  nurse: 'Alice Smith',
  'content-manager': 'David Okafor',
};

interface RoleContextValue {
  role: DemoRole;
  setRole: (role: DemoRole) => void;
  roleLabel: string;
  practitionerName: string;
}

const RoleContext = createContext<RoleContextValue>({
  role: 'coordinator',
  setRole: () => {},
  roleLabel: ROLE_LABELS.coordinator,
  practitionerName: ROLE_NAMES.coordinator,
});

export function RoleProvider({ children }: { children: ReactNode }): JSX.Element {
  const [role, setRoleState] = useState<DemoRole>('coordinator');

  const setRole = useCallback((newRole: DemoRole) => {
    setRoleState(newRole);
  }, []);

  const roleLabel = ROLE_LABELS[role];
  const practitionerName = ROLE_NAMES[role];

  return (
    <RoleContext.Provider value={{ role, setRole, roleLabel, practitionerName }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  return useContext(RoleContext);
}
