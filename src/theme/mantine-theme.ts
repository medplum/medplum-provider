import { MantineThemeOverride } from '@mantine/core';

/**
 * Pass into <MantineProvider theme={djsTheme}> so Medplum's Mantine-based
 * React components (buttons, inputs, tables, etc.) inherit this palette.
 *
 * Colors are USWDS's real default theme values (blue-60v primary,
 * red-50 secondary, green-cool-40v success) — see tokens.css for sourcing.
 */
export const djsTheme: MantineThemeOverride = {
  fontFamily: "'Public Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontFamilyMonospace: "'Roboto Mono', monospace",
  headings: { fontFamily: "'Public Sans', system-ui, -apple-system, 'Segoe UI', sans-serif" },
  primaryColor: 'djsBlue',
  colors: {
    djsBlue: [
      '#e7f6f8', '#cde5f0', '#9fcde3', '#69b3d6', '#3e9dcb',
      '#005ea2', // base — USWDS blue-60v (default theme primary)
      '#1a4480', // USWDS blue-warm-70v (primary-dark)
      '#162e51', // USWDS blue-warm-80v (primary-darker)
      '#0f2039',
      '#0a1626',
    ],
    djsSuccess: [
      '#ecf3ec', '#c3e6c1', '#94d693', '#5cc25e', '#2eae35',
      '#00a91c', // base — USWDS green-cool-40v
      '#008817',
      '#166c1a',
      '#0f511a',
      '#0a3818',
    ],
    djsDanger: [
      '#f4e3e3', '#f2938c', '#e5504a',
      '#d83933', // base — USWDS red-50 (default theme secondary)
      '#c52c22',
      '#b50909', // USWDS red-60v (secondary-dark)
      '#8b0a03',
      '#6f0906',
      '#530704',
      '#380503',
    ],
  },
  defaultRadius: 'sm',
  radius: { sm: '4px', md: '4px' }, // USWDS's 4px base corner radius
  components: {
    Button: { defaultProps: { radius: 'sm' } },
  },
};
