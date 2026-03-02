import { AppShell, Loading, useMedplum } from '@medplum/react';
import {
  IconCalendarEvent,
  IconClipboardList,
  IconFileText,
  IconUsers,
} from '@tabler/icons-react';
import type { JSX } from 'react';
import { Suspense, useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router';
import { BayshoreLogo } from './components/BayshoreLogo';
import { RoleSwitcher } from './components/RoleSwitcher';
import type { DemoRole } from './context/RoleContext';
import { RoleProvider, useRole } from './context/RoleContext';
import './index.css';

import { EncounterChartPage } from './pages/encounter/EncounterChartPage';
import { CarePlanTab } from './pages/patient/CarePlanTab';
import { DocumentsTab } from './pages/patient/DocumentsTab';
import { EditTab } from './pages/patient/EditTab';
import { MedicationsTab } from './pages/patient/MedicationsTab';
import { PatientPage } from './pages/patient/PatientPage';
import { PatientSearchPage } from './pages/patient/PatientSearchPage';
import { TimelineTab } from './pages/patient/TimelineTab';
import { VisitsTab } from './pages/patient/VisitsTab';
import { ReferralDetailPage } from './pages/referral/ReferralDetailPage';
import { ReferralQueuePage } from './pages/referral/ReferralQueuePage';
import { ResourceDetailPage } from './pages/resource/ResourceDetailPage';
import { ResourcePage } from './pages/resource/ResourcePage';
import { QuestionnairesPage } from './pages/questionnaires/QuestionnairesPage';
import { NurseSchedulePage } from './pages/schedule/NurseSchedulePage';
import { SearchPage } from './pages/SearchPage';

const ROLE_PRACTITIONER_MAP: Record<DemoRole, string> = {
  coordinator: 'coordinator-anderson',
  nurse: 'nurse-ratched',
  'content-manager': 'content-manager-okafor',
};

function getRoleForPath(pathname: string): DemoRole {
  if (pathname.startsWith('/referrals')) return 'coordinator';
  if (pathname.startsWith('/Patient') || pathname.startsWith('/nurse-schedule')) return 'nurse';
  if (pathname.startsWith('/questionnaires')) return 'content-manager';
  return 'coordinator';
}

function AppRoutes(): JSX.Element {
  const medplum = useMedplum();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { role, setRole } = useRole();
  const lastRoleRef = useRef<DemoRole>(role);

  // Auto-switch persona based on current route
  useEffect(() => {
    const newRole = getRoleForPath(location.pathname);
    if (newRole !== lastRoleRef.current) {
      lastRoleRef.current = newRole;
      setRole(newRole);

      // Switch practitioner profile so the AppShell header name updates
      const practitionerId = ROLE_PRACTITIONER_MAP[newRole];
      medplum.readResource('Practitioner', practitionerId).then((practitioner) => {
        (medplum as any).setProfile(practitioner);
      }).catch(console.error);
    }
  }, [location.pathname, medplum, setRole, role]);

  if (medplum.isLoading()) {
    return <Loading />;
  }

  return (
    <AppShell
      logo={<BayshoreLogo />}
      pathname={location.pathname}
      searchParams={searchParams}
      layoutVersion="v2"
      showLayoutVersionToggle={false}
      menus={[
        {
          links: [
            { icon: <IconFileText />, label: 'Referrals', href: '/referrals' },
            {
              icon: <IconUsers />,
              label: 'Patients',
              href: '/Patient?_count=20&_fields=name,gender&_sort=-_lastUpdated',
            },
            { icon: <IconCalendarEvent />, label: 'Schedule', href: '/nurse-schedule' },
            { icon: <IconClipboardList />, label: 'Forms', href: '/questionnaires' },
          ],
        },
      ]}
      resourceTypeSearchDisabled={true}
      notifications={<RoleSwitcher />}
    >
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Navigate to="/referrals" replace />} />

          {/* Referral routes (coordinator) */}
          <Route path="/referrals" element={<ReferralQueuePage />} />
          <Route path="/referrals/:bundleId" element={<ReferralDetailPage />} />

          {/* Nurse schedule */}
          <Route path="/nurse-schedule" element={<NurseSchedulePage />} />

          {/* Forms library */}
          <Route path="/questionnaires" element={<QuestionnairesPage />} />

          {/* Patient routes */}
          <Route path="/Patient/:patientId" element={<PatientPage />}>
            <Route path="edit" element={<EditTab />} />
            <Route path="careplan" element={<CarePlanTab />} />
            <Route path="visits" element={<VisitsTab />} />
            <Route path="medications" element={<MedicationsTab />} />
            <Route path="documents" element={<DocumentsTab />} />
            <Route path="Encounter/:encounterId" element={<EncounterChartPage />} />
            <Route path=":resourceType" element={<PatientSearchPage />} />
            <Route path=":resourceType/:id" element={<ResourcePage />}>
              <Route path="" element={<ResourceDetailPage />} />
            </Route>
            <Route path="" element={<TimelineTab />} />
          </Route>

          {/* Generic search */}
          <Route path="/:resourceType" element={<SearchPage />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

export function App(): JSX.Element {
  return (
    <RoleProvider>
      <AppRoutes />
    </RoleProvider>
  );
}
