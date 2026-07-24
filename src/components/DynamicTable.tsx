interface DynamicTableProps {
  columns: string[];
  rows: string[][];
  onChange: (rows: string[][]) => void;
  addLabel?: string;
}

/** Add/remove-row table — used for medications, substance-use detail, family history, placement history. */
export function DynamicTable({ columns, rows, onChange, addLabel = '+ Add row' }: DynamicTableProps): JSX.Element {
  function updateCell(rowIdx: number, colIdx: number, value: string) {
    const next = rows.map((r) => [...r]);
    next[rowIdx][colIdx] = value;
    onChange(next);
  }

  function addRow() {
    onChange([...rows, columns.map(() => '')]);
  }

  function removeRow(rowIdx: number) {
    onChange(rows.filter((_, i) => i !== rowIdx));
  }

  return (
    <div>
      <table className="djs-dyn">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {row.map((cell, colIdx) => (
                <td key={colIdx}>
                  <input type="text" value={cell} onChange={(e) => updateCell(rowIdx, colIdx, e.target.value)} />
                </td>
              ))}
              <td className="rm">
                <button type="button" className="djs-btn rm-row" onClick={() => removeRow(rowIdx)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="djs-btn" onClick={addRow}>
        {addLabel}
      </button>
    </div>
  );
}
