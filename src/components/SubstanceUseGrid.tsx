import { FormState } from '../pages/formState';

export interface SubstanceDef {
  key: string;
  label: string;
}

/** Matches the real DJS form's substance list — the paper form pairs
 * Marijuana/Synthetic THC and Heroin/Fentanyl on one row each, but since
 * a youth can use one without the other with different age/frequency,
 * each gets its own row here rather than sharing one set of detail
 * fields. */
export const SUBSTANCES: SubstanceDef[] = [
  { key: 'tobacco', label: 'Tobacco' },
  { key: 'alcohol', label: 'Alcohol' },
  { key: 'marijuana', label: 'Marijuana' },
  { key: 'synthetic-thc', label: 'Synthetic THC' },
  { key: 'cocaine', label: 'Cocaine / Crack' },
  { key: 'amphetamines', label: 'Amphetamines ("Meth")' },
  { key: 'narcotics', label: 'Narcotics (Oxy, Percocet, etc)' },
  { key: 'heroin', label: 'Heroin' },
  { key: 'fentanyl', label: 'Fentanyl' },
  { key: 'suboxone', label: 'Suboxone (Buprenorphine)' },
  { key: 'methadone', label: 'Methadone' },
  { key: 'benzodiazepines', label: 'Benzodiazepines (Xanax, etc)' },
  { key: 'pcp', label: 'PCP' },
  { key: 'ecstasy', label: 'Ecstasy' },
  { key: 'lsd', label: 'LSD / Acid' },
  { key: 'otc-cough-cold', label: 'OTC cough / cold medication' },
];

/**
 * One row per substance — a checkbox plus its own initial-use age,
 * method/route, amount & frequency, and last-used fields, so checking a
 * substance and filling in its details is one action instead of two
 * (the mockup's checklist + separately-typed free-add table required
 * re-entering the substance name and never actually linked the two —
 * the checklist wasn't even saved). Storage reuses the existing
 * FormState chip/text primitives rather than adding new ones: `chip`
 * for the checked flag, `text` for each detail field.
 */
export function SubstanceUseGrid({ form }: { form: FormState }): JSX.Element {
  return (
    <div>
      <table className="djs-dyn">
        <thead>
          <tr>
            <th style={{ width: 24 }}></th>
            <th>Substance</th>
            <th>Initial use (age)</th>
            <th>Method / route</th>
            <th>Amount &amp; frequency</th>
            <th>Last used</th>
          </tr>
        </thead>
        <tbody>
          {SUBSTANCES.map((s) => {
            const checked = form.chip(`sub-${s.key}`) === 'yes';
            return (
              <tr key={s.key}>
                <td>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => form.setChip(`sub-${s.key}`, e.target.checked ? 'yes' : '')}
                  />
                </td>
                <td>{s.label}</td>
                <td>
                  <input
                    type="text"
                    disabled={!checked}
                    value={form.text(`sub-${s.key}-age`)}
                    onChange={(e) => form.setText(`sub-${s.key}-age`, e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    disabled={!checked}
                    placeholder="IV, inhaled, po, nasal"
                    value={form.text(`sub-${s.key}-method`)}
                    onChange={(e) => form.setText(`sub-${s.key}-method`, e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    disabled={!checked}
                    value={form.text(`sub-${s.key}-amount`)}
                    onChange={(e) => form.setText(`sub-${s.key}-amount`, e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    disabled={!checked}
                    value={form.text(`sub-${s.key}-last`)}
                    onChange={(e) => form.setText(`sub-${s.key}-last`, e.target.value)}
                  />
                </td>
              </tr>
            );
          })}
          {/* "Other" row needs its own name field alongside the same four detail columns */}
          <tr>
            <td>
              <input
                type="checkbox"
                checked={form.chip('sub-other') === 'yes'}
                onChange={(e) => form.setChip('sub-other', e.target.checked ? 'yes' : '')}
              />
            </td>
            <td>
              <input
                type="text"
                placeholder="Other — specify"
                disabled={form.chip('sub-other') !== 'yes'}
                value={form.text('sub-other-name')}
                onChange={(e) => form.setText('sub-other-name', e.target.value)}
              />
            </td>
            <td>
              <input
                type="text"
                disabled={form.chip('sub-other') !== 'yes'}
                value={form.text('sub-other-age')}
                onChange={(e) => form.setText('sub-other-age', e.target.value)}
              />
            </td>
            <td>
              <input
                type="text"
                disabled={form.chip('sub-other') !== 'yes'}
                value={form.text('sub-other-method')}
                onChange={(e) => form.setText('sub-other-method', e.target.value)}
              />
            </td>
            <td>
              <input
                type="text"
                disabled={form.chip('sub-other') !== 'yes'}
                value={form.text('sub-other-amount')}
                onChange={(e) => form.setText('sub-other-amount', e.target.value)}
              />
            </td>
            <td>
              <input
                type="text"
                disabled={form.chip('sub-other') !== 'yes'}
                value={form.text('sub-other-last')}
                onChange={(e) => form.setText('sub-other-last', e.target.value)}
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
