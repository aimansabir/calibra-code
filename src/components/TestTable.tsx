export interface Row {
  name: string;
  call: string;
  expected: string;
  actual?: string;
  passed?: boolean;
  error?: string;
}

export function TestTable({ rows, caption }: { rows: Row[]; caption?: string }) {
  return (
    <table className="tests">
      {caption && <caption>{caption}</caption>}
      <thead>
        <tr>
          <th scope="col">Result</th>
          <th scope="col">Call</th>
          <th scope="col">Expected</th>
          <th scope="col">Got</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name + r.call} className={r.passed == null ? '' : r.passed ? 'pass' : 'fail'}>
            <td>{r.passed == null ? <span className="badge">not run</span> : r.passed ? <span className="badge pass">✓ pass</span> : <span className="badge fail">✗ fail</span>}</td>
            <td>
              <code>{r.call}</code>
              <div className="muted small">{r.name}</div>
            </td>
            <td>
              <code>{r.expected}</code>
            </td>
            <td>
              {r.actual != null && <code>{r.actual}</code>}
              {r.error && !r.passed && <details className="small"><summary>Error details</summary><pre>{r.error}</pre></details>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
