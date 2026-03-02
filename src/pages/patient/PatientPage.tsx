import { Loader, ScrollArea } from '@mantine/core';
import { getReferenceString, isOk } from '@medplum/core';
import type { OperationOutcome } from '@medplum/fhirtypes';
import { Document, OperationOutcomeAlert, PatientSummary, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Location } from 'react-router';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { usePatient } from '../../hooks/usePatient';
import classes from './PatientPage.module.css';
import type { PatientPageTabInfo } from './PatientPage.utils';
import { formatPatientPageTabUrl, getPatientPageTabs } from './PatientPage.utils';
import { PatientTabsNavigation } from './PatientTabsNavigation';

function getTabFromLocation(location: Location, tabs: PatientPageTabInfo[]): PatientPageTabInfo | undefined {
  const tabId = location.pathname.split('/')[3] ?? '';
  return tabId
    ? tabs.find((t) => t.id === tabId || t.url.toLowerCase().startsWith(tabId.toLowerCase()))
    : undefined;
}

export function PatientPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const medplum = useMedplum();
  const [outcome, setOutcome] = useState<OperationOutcome>();
  const patient = usePatient({ setOutcome });
  const tabs = getPatientPageTabs();
  const [currentTab, setCurrentTab] = useState<string>(() => {
    return (getTabFromLocation(location, tabs) ?? tabs[0]).id;
  });

  const onTabChange = useCallback(
    (newTabName: string | null): void => {
      if (!patient?.id) {
        console.error('Not within a patient context');
        return;
      }
      const tab = newTabName ? tabs.find((t) => t.id === newTabName) : tabs[0];
      if (tab) {
        setCurrentTab(tab.id);
        navigate(formatPatientPageTabUrl(patient.id, tab))?.catch(console.error);
      }
    },
    [navigate, patient?.id, tabs]
  );

  useEffect(() => {
    const newTab = getTabFromLocation(location, tabs);
    if (newTab && newTab.id !== currentTab) {
      setCurrentTab(newTab.id);
    }
  }, [currentTab, location, tabs]);

  // Hide irrelevant PatientSummary sidebar sections (no props available for this)
  const sidebarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const hideSections = ['Insurance', 'Labs', 'Sexual Orientation', 'Pharmacies'];
    const hideSectionElements = (): void => {
      sidebar.querySelectorAll('[class*="CollapsibleSection"] [class*="title"]').forEach((el) => {
        if (hideSections.some((s) => el.textContent?.trim() === s)) {
          const section = el.closest('[class*="CollapsibleSection_root"]') as HTMLElement | null;
          if (section) section.style.display = 'none';
        }
      });
    };
    // Run immediately and observe for async rendering
    hideSectionElements();
    const observer = new MutationObserver(hideSectionElements);
    observer.observe(sidebar, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [patient]);

  if (outcome && !isOk(outcome)) {
    return (
      <Document>
        <OperationOutcomeAlert outcome={outcome} />
      </Document>
    );
  }

  const patientId = patient?.id;
  if (!patientId) {
    return (
      <Document>
        <Loader />
      </Document>
    );
  }

  return (
    <div key={getReferenceString(patient)} className={classes.container}>
      <div ref={sidebarRef} className={classes.sidebar}>
        <ScrollArea className={classes.scrollArea}>
          <PatientSummary
            patient={patient}
            onClickResource={(resource) =>
              navigate(`/Patient/${patientId}/${resource.resourceType}/${resource.id}`)?.catch(
                console.error
              )
            }
          />
        </ScrollArea>
      </div>
      <div className={classes.content}>
        <PatientTabsNavigation tabs={tabs} currentTab={currentTab} onTabChange={onTabChange} />
        <Outlet context={{ patient, medplum }} />
      </div>
    </div>
  );
}
