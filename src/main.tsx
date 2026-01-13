// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';
import { MedplumClient } from '@medplum/core';
import { MedplumProvider } from '@medplum/react';
import '@medplum/react/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { App } from './App';
import './epic-styles.css';

const medplum = new MedplumClient({
  onUnauthenticated: () => (window.location.href = '/'),
  // baseUrl: 'http://localhost:8103/', // Uncomment this to run against the server on your localhost
  cacheTime: 60000,
  autoBatchTime: 100,
});

const theme = createTheme({
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontFamilyMonospace: 'Courier New, monospace',
  headings: {
    fontFamily: 'Arial, Helvetica, sans-serif',
    sizes: {
      h1: {
        fontSize: '1.125rem',
        fontWeight: '600',
        lineHeight: '1.5',
      },
      h2: {
        fontSize: '1rem',
        fontWeight: '600',
        lineHeight: '1.5',
      },
      h3: {
        fontSize: '0.9375rem',
        fontWeight: '600',
        lineHeight: '1.5',
      },
    },
  },
  fontSizes: {
    xs: '0.6875rem',
    sm: '0.8125rem',
    md: '0.8125rem',
    lg: '1rem',
    xl: '1.125rem',
  },
  primaryColor: 'blue',
  colors: {
    blue: [
      '#E3F2FD',
      '#BBDEFB',
      '#90CAF9',
      '#64B5F6',
      '#42A5F5',
      '#4A90E2', // Epic blue
      '#357ABD', // Epic blue dark
      '#1976D2',
      '#1565C0',
      '#0D47A1',
    ],
  },
  defaultRadius: 'sm',
  radius: {
    xs: '2px',
    sm: '3px',
    md: '4px',
    lg: '6px',
    xl: '8px',
  },
  components: {
    Button: {
      defaultProps: {
        size: 'sm',
      },
      styles: {
        root: {
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '13px',
        },
      },
    },
    TextInput: {
      styles: {
        input: {
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '13px',
        },
        label: {
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '12px',
          fontWeight: 600,
        },
      },
    },
    Select: {
      styles: {
        input: {
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '13px',
        },
        label: {
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '12px',
          fontWeight: 600,
        },
      },
    },
    Table: {
      styles: {
        root: {
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '13px',
        },
      },
    },
    Tabs: {
      styles: {
        tab: {
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '13px',
        },
      },
    },
  },
});

const router = createBrowserRouter([{ path: '*', element: <App /> }]);

const navigate = (path: string): Promise<void> => router.navigate(path);

const container = document.getElementById('root') as HTMLDivElement;
const root = createRoot(container);
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
