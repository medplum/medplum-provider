// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { parseItems, useFormState } from './formState';

describe('parseItems', () => {
  test('splits a pipe-delimited spec into one item per segment', () => {
    expect(parseItems('A|B|C')).toEqual([
      { value: 'A', label: 'A', hasText: false },
      { value: 'B', label: 'B', hasText: false },
      { value: 'C', label: 'C', hasText: false },
    ]);
  });

  test('marks a segment as hasText when suffixed with ::text', () => {
    expect(parseItems('A|B|C::text')).toEqual([
      { value: 'A', label: 'A', hasText: false },
      { value: 'B', label: 'B', hasText: false },
      { value: 'C', label: 'C', hasText: true },
    ]);
  });

  test('supports more than one ::text segment in the same spec', () => {
    expect(parseItems('A::text|B|C::text')).toEqual([
      { value: 'A', label: 'A', hasText: true },
      { value: 'B', label: 'B', hasText: false },
      { value: 'C', label: 'C', hasText: true },
    ]);
  });

  test('handles a single item with no pipes', () => {
    expect(parseItems('Solo')).toEqual([{ value: 'Solo', label: 'Solo', hasText: false }]);
    expect(parseItems('Solo::text')).toEqual([{ value: 'Solo', label: 'Solo', hasText: true }]);
  });

  test('regression: a trailing pipe produces a blank, labelless checkbox', () => {
    // CLAUDE.md calls this out explicitly: "Never leave a trailing |, it
    // parses into a real, blank, labelless checkbox." This locks that in.
    const result = parseItems('A|B|C::text|');
    expect(result).toHaveLength(4);
    expect(result[3]).toEqual({ value: '', label: '', hasText: false });
  });

  test('regression: a leading pipe produces the same blank-checkbox bug at the front', () => {
    const result = parseItems('|A|B');
    expect(result[0]).toEqual({ value: '', label: '', hasText: false });
    expect(result).toHaveLength(3);
  });
});

describe('useFormState', () => {
  describe('chip / setChip', () => {
    test('is undefined before being set', () => {
      const { result } = renderHook(() => useFormState());
      expect(result.current.chip('mandated-reporter')).toBeUndefined();
    });

    test('setChip stores and chip retrieves the value', () => {
      const { result } = renderHook(() => useFormState());

      act(() => {
        result.current.setChip('mandated-reporter', 'yes');
      });

      expect(result.current.chip('mandated-reporter')).toBe('yes');
    });

    test('chip values are keyed independently', () => {
      const { result } = renderHook(() => useFormState());

      act(() => {
        result.current.setChip('mandated-reporter', 'yes');
        result.current.setChip('epipen', 'no');
      });

      expect(result.current.chip('mandated-reporter')).toBe('yes');
      expect(result.current.chip('epipen')).toBe('no');
    });

    test('setChip overwrites a previous value for the same key', () => {
      const { result } = renderHook(() => useFormState());

      act(() => {
        result.current.setChip('epipen', 'no');
      });
      act(() => {
        result.current.setChip('epipen', 'yes');
      });

      expect(result.current.chip('epipen')).toBe('yes');
    });
  });

  describe('text / setText', () => {
    test('defaults to an empty string, not undefined', () => {
      const { result } = renderHook(() => useFormState());
      expect(result.current.text('disposition-notes')).toBe('');
    });

    test('setText stores and text retrieves the value', () => {
      const { result } = renderHook(() => useFormState());

      act(() => {
        result.current.setText('disposition-notes', 'Referred to on-site clinician.');
      });

      expect(result.current.text('disposition-notes')).toBe('Referred to on-site clinician.');
    });

    test('text values are keyed independently', () => {
      const { result } = renderHook(() => useFormState());

      act(() => {
        result.current.setText('disposition-notes', 'note A');
        result.current.setText('ros-comments', 'note B');
      });

      expect(result.current.text('disposition-notes')).toBe('note A');
      expect(result.current.text('ros-comments')).toBe('note B');
    });
  });

  describe('checked items (isChecked / toggleCheck / checkedItems / checkedMap)', () => {
    test('an item is unchecked by default', () => {
      const { result } = renderHook(() => useFormState());
      expect(result.current.isChecked('injuries', 'bruising')).toBe(false);
      expect(result.current.checkedItems('injuries')).toEqual([]);
      expect(result.current.checkedMap('injuries')).toEqual({});
    });

    test('toggleCheck(true) checks an item; checkedItems reflects only checked ones', () => {
      const { result } = renderHook(() => useFormState());

      act(() => {
        result.current.toggleCheck('injuries', 'bruising', true);
        result.current.toggleCheck('injuries', 'laceration', true);
        result.current.toggleCheck('injuries', 'burn', false);
      });

      expect(result.current.isChecked('injuries', 'bruising')).toBe(true);
      expect(result.current.isChecked('injuries', 'burn')).toBe(false);
      expect(result.current.checkedItems('injuries').sort()).toEqual(['bruising', 'laceration']);
    });

    test('toggleCheck(false) unchecks a previously checked item', () => {
      const { result } = renderHook(() => useFormState());

      act(() => {
        result.current.toggleCheck('injuries', 'bruising', true);
      });
      act(() => {
        result.current.toggleCheck('injuries', 'bruising', false);
      });

      expect(result.current.isChecked('injuries', 'bruising')).toBe(false);
      expect(result.current.checkedItems('injuries')).toEqual([]);
    });

    test('grids are keyed independently — checking one grid does not affect another', () => {
      const { result } = renderHook(() => useFormState());

      act(() => {
        result.current.toggleCheck('injuries', 'bruising', true);
        result.current.toggleCheck('firearm-safety', 'bruising', false);
      });

      expect(result.current.isChecked('injuries', 'bruising')).toBe(true);
      expect(result.current.isChecked('firearm-safety', 'bruising')).toBe(false);
    });
  });

  describe('checkTextMap / setCheckText', () => {
    test('is an empty object before any text is set for the grid', () => {
      const { result } = renderHook(() => useFormState());
      expect(result.current.checkTextMap('allergies')).toEqual({});
    });

    test('setCheckText stores inline free text for a checklist item', () => {
      const { result } = renderHook(() => useFormState());

      act(() => {
        result.current.setCheckText('allergies', 'other', 'Penicillin');
      });

      expect(result.current.checkTextMap('allergies')).toEqual({ other: 'Penicillin' });
    });

    test('preserves other entries in the same grid when adding another', () => {
      const { result } = renderHook(() => useFormState());

      act(() => {
        result.current.setCheckText('allergies', 'other', 'Penicillin');
        result.current.setCheckText('allergies', 'epipen-detail', 'Carried, not used');
      });

      expect(result.current.checkTextMap('allergies')).toEqual({
        other: 'Penicillin',
        'epipen-detail': 'Carried, not used',
      });
    });
  });

  describe('rows / setRows', () => {
    test('defaults to an empty array', () => {
      const { result } = renderHook(() => useFormState());
      expect(result.current.rows('medications')).toEqual([]);
    });

    test('setRows stores and rows retrieves the table', () => {
      const { result } = renderHook(() => useFormState());
      const table = [
        ['Ibuprofen', '200mg', 'PO'],
        ['Albuterol', '90mcg', 'Inhaled'],
      ];

      act(() => {
        result.current.setRows('medications', table);
      });

      expect(result.current.rows('medications')).toEqual(table);
    });

    test('setRows replaces the whole table rather than appending', () => {
      const { result } = renderHook(() => useFormState());

      act(() => {
        result.current.setRows('medications', [['Ibuprofen', '200mg', 'PO']]);
      });
      act(() => {
        result.current.setRows('medications', [['Albuterol', '90mcg', 'Inhaled']]);
      });

      expect(result.current.rows('medications')).toEqual([['Albuterol', '90mcg', 'Inhaled']]);
    });

    test('tables are keyed independently', () => {
      const { result } = renderHook(() => useFormState());

      act(() => {
        result.current.setRows('medications', [['Ibuprofen', '200mg', 'PO']]);
      });

      expect(result.current.rows('nursing-diagnoses')).toEqual([]);
    });
  });
});
