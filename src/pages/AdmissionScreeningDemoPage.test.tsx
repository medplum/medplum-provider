// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { AdmissionScreeningDemoPage } from './AdmissionScreeningDemoPage';

describe('AdmissionScreeningDemoPage (task 38)', () => {
  // The whole point of this page: reachable and functional with zero setup —
  // no MedplumProvider/MockClient wiring needed from the caller, since the
  // page owns its own in-memory client. If this ever needed an ambient
  // MedplumProvider to render, it would defeat the "no credentials" premise.
  test('renders the real wizard against its own in-memory client, with an unmistakable demo banner', async () => {
    await act(async () => {
      render(
        <MantineProvider>
          <Notifications />
          <AdmissionScreeningDemoPage />
        </MantineProvider>
      );
    });

    expect(screen.getByRole('status')).toHaveTextContent(/demo mode/i);
    expect(screen.getByText('Admission Health Screening & Nursing Assessment')).toBeInTheDocument();
    expect(screen.getByText('Patient Information')).toBeInTheDocument();
  });
});
