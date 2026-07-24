import { useState } from 'react';
import { CheckGridItem } from '../components/CheckGrid';

/**
 * Parses the same compact "A|B|C::text" mini-DSL used throughout the
 * source mockup's `data-items` attributes into CheckGridItem[]. Lets
 * section data be pasted in verbatim from the mockup.
 */
export function parseItems(spec: string): CheckGridItem[] {
  return spec.split('|').map((raw) => {
    const [label, kind] = raw.split('::');
    return { value: label, label, hasText: kind === 'text' };
  });
}

/**
 * Generic state container for the wizard's checklist/chip/table-heavy
 * sections (3–9), so each section doesn't need its own pile of
 * useState calls. Keyed by arbitrary string IDs matching the mockup's
 * own data-track / data-grid / field IDs.
 */
export function useFormState() {
  const [chips, setChipsState] = useState<Record<string, string>>({});
  const [checks, setChecksState] = useState<Record<string, Record<string, boolean>>>({});
  const [checkTexts, setCheckTextsState] = useState<Record<string, Record<string, string>>>({});
  const [texts, setTextsState] = useState<Record<string, string>>({});
  const [tables, setTablesState] = useState<Record<string, string[][]>>({});

  return {
    chip: (id: string) => chips[id],
    setChip: (id: string, value: string) => setChipsState((prev) => ({ ...prev, [id]: value })),

    isChecked: (grid: string, item: string) => !!checks[grid]?.[item],
    checkedMap: (grid: string) => checks[grid] ?? {},
    toggleCheck: (grid: string, item: string, value: boolean) =>
      setChecksState((prev) => ({ ...prev, [grid]: { ...prev[grid], [item]: value } })),
    checkedItems: (grid: string) => Object.entries(checks[grid] ?? {}).filter(([, v]) => v).map(([k]) => k),

    checkTextMap: (grid: string) => checkTexts[grid] ?? {},
    setCheckText: (grid: string, item: string, value: string) =>
      setCheckTextsState((prev) => ({ ...prev, [grid]: { ...prev[grid], [item]: value } })),

    text: (id: string) => texts[id] ?? '',
    setText: (id: string, value: string) => setTextsState((prev) => ({ ...prev, [id]: value })),

    rows: (table: string) => tables[table] ?? [],
    setRows: (table: string, rows: string[][]) => setTablesState((prev) => ({ ...prev, [table]: rows })),
  };
}

export type FormState = ReturnType<typeof useFormState>;
