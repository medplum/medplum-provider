import type { JSX, ReactNode } from 'react';
import { createContext, useCallback, useContext, useState } from 'react';

export type DemoRole = 'coordinator' | 'nurse';

interface RoleContextValue {
  role: DemoRole;
  setRole: (role: DemoRole) => void;
  roleLabel: string;
}

const RoleContext = createContext<RoleContextValue>({
  role: 'coordinator',
  setRole: () => {},
  roleLabel: 'Branch Coordinator',
});

export function RoleProvider({ children }: { children: ReactNode }): JSX.Element {
  const [role, setRoleState] = useState<DemoRole>('coordinator');

  const setRole = useCallback((newRole: DemoRole) => {
    setRoleState(newRole);
  }, []);

  const roleLabel = role === 'coordinator' ? 'Branch Coordinator' : 'Wound Care Nurse';

  return (
    <RoleContext.Provider value={{ role, setRole, roleLabel }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  return useContext(RoleContext);
}
