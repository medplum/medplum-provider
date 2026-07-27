// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Loader, Paper, ScrollArea } from '@mantine/core';
import { calculateAgeString, formatHumanName, getReferenceString, isOk } from '@medplum/core';
import type { OperationOutcome } from '@medplum/fhirtypes';
import { Document, LinkTabs, OperationOutcomeAlert, useMedplum } from '@medplum/react';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { Outlet } from 'react-router';
import { useDoseSpotAccess } from '../../hooks/useDoseSpotAccess';
import { usePatient } from '../../hooks/usePatient';
import classes from './PatientPage.module.css';
import { getPatientPageTabs, patientPathPrefix } from './PatientPage.utils';

export function PatientPage(): JSX.Element {
  const medplum = useMedplum();
  const membership = medplum.getProjectMembership();
  const [outcome, setOutcome] = useState<OperationOutcome>();
  const patient = usePatient({ setOutcome });
  const { hasAccess: hasDoseSpotAccess } = useDoseSpotAccess();
  const tabs = getPatientPageTabs(membership, { hasDoseSpotAccess });
  const resolvedTabs = useMemo(
    () =>
      tabs.map((t) => ({
        label: t.label,
        value: (t.url ? t.url.replace('%patient.id', patient?.id ?? '') : t.id) || t.id,
      })),
    [patient?.id, tabs]
  );

  if (outcome && !isOk(outcome)) {
    return (
      <Document>
        <OperationOutcomeAlert outcome={outcome} />
      </Document>
    );
  }

  // Guarding on `patient` itself (not just `patient?.id`) so TS narrows
  // `patient` to defined below — the sidebar now reads `patient.name`/
  // `patient.birthDate` directly rather than going through PatientSummary,
  // which used to need its own `as WithId<Patient>` cast for this.
  if (!patient?.id) {
    return (
      <Document>
        <Loader />
      </Document>
    );
  }
  const patientId = patient.id;

  return (
    <div key={getReferenceString(patient)} className={classes.container}>
      <div className={classes.sidebar}>
        <ScrollArea className={classes.scrollArea}>
          {/*
            Task 42: the old sidebar held BOTH DjsPatientSummary and Medplum's
            default PatientSummary side by side — additive on purpose at the
            time (task 16), but it meant Vitals/Allergies/Medications were
            shown twice, and the "miscommunication" the user later flagged.
            All of that content now lives in the "Overview" tab
            (PatientOverviewPage.tsx), which owns the full page rather than a
            narrow always-visible strip. The sidebar keeps only identity + a
            direct link there, so it doesn't compete with the tab content.
          */}
          <div style={{ padding: '16px 12px' }}>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>{formatHumanName(patient.name?.[0])}</p>
            {patient.birthDate && (
              <p style={{ fontSize: 13, color: 'var(--mantine-color-gray-6)' }}>
                {patient.birthDate} ({calculateAgeString(patient.birthDate)})
              </p>
            )}
            {patient.gender && (
              <p style={{ fontSize: 13, color: 'var(--mantine-color-gray-6)' }}>
                {patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1)}
              </p>
            )}
            <a href={`${patientPathPrefix(patientId)}/overview`} style={{ display: 'inline-block', marginTop: 12 }}>
              View full overview →
            </a>
          </div>
        </ScrollArea>
      </div>

      <div className={classes.content}>
        <Paper w="100%" radius={0} style={{ borderBottom: '1px solid var(--app-shell-border-color)' }}>
          <ScrollArea>
            <LinkTabs
              baseUrl={patientPathPrefix(patientId)}
              tabs={resolvedTabs}
              variant="unstyled"
              className="pill-tabs"
              p="sm"
            />
          </ScrollArea>
        </Paper>
        <div className={classes.contentBody}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
