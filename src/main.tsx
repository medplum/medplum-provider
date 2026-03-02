import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';
import { MockClient } from '@medplum/mock';
import { MedplumProvider } from '@medplum/react';
import '@medplum/react/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { App } from './App';
import { seedPhase1 } from './seed/seedPhase1';

/**
 * Bayshore brand colors:
 *   Primary dark teal: #0b435a
 *   Accent gold: #c9a376
 *   White: #ffffff
 *
 * We generate a Mantine-compatible 10-shade scale from the primary teal.
 */
const bayshoreTeal: [string, string, string, string, string, string, string, string, string, string] = [
  '#e6f2f7', // 0 - lightest
  '#b8dce8', // 1
  '#8ac5d9', // 2
  '#5caeca', // 3
  '#2e97bb', // 4
  '#1a7a9c', // 5
  '#135e7a', // 6 - used for primary
  '#0b435a', // 7 - brand primary
  '#083347', // 8
  '#052334', // 9 - darkest
];

const theme = createTheme({
  primaryColor: 'bayshoreTeal',
  colors: {
    bayshoreTeal,
  },
  headings: {
    sizes: {
      h1: {
        fontSize: '1.125rem',
        fontWeight: '500',
        lineHeight: '2.0',
      },
    },
  },
  fontSizes: {
    xs: '0.6875rem',
    sm: '0.875rem',
    md: '0.875rem',
    lg: '1.0rem',
    xl: '1.125rem',
  },
});

const router = createBrowserRouter([{ path: '*', element: <App /> }]);
const navigate = (path: string): Promise<void> => router.navigate(path);
const container = document.getElementById('root') as HTMLDivElement;
const root = createRoot(container);

// Initialize MockClient and seed data, then render
(async () => {
  const medplum = new MockClient();

  // Seed Phase 1 data (infrastructure: orgs, practitioners, questionnaires, eReferral bundle)
  await seedPhase1(medplum);

  // Set initial profile to coordinator (default role)
  try {
    const coordinator = await medplum.readResource('Practitioner', 'coordinator-anderson');
    (medplum as any).setProfile(coordinator);
  } catch {
    // Ignore if practitioner not found
  }

  root.render(
    <StrictMode>
      <MedplumProvider medplum={medplum} navigate={navigate}>
        <MantineProvider theme={theme}>
          <Notifications position="bottom-right" />
          <RouterProvider router={router} />
        </MantineProvider>
      </MedplumProvider>
    </StrictMode>
  );
})();
