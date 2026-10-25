import { hunks, lineDiff } from '../lib/diff';

export function PatchDiff({ before, after }: { before: string; after: string }) {
  const groups = hunks(lineDiff(before, after));
  if (!groups.length) return <p className="muted">The patch makes no changes.</p>;
  return (
    <div className="diff" role="table" aria-label="Suggested patch, changed lines">
      {groups.map((g, gi) => (
        <div key={gi} className="hunk" role="rowgroup">
          {g.map((d, i) => (
            <div key={i} className={`diff-line ${d.kind}`} role="row">
              <span className="ln" role="cell">{d.oldNo ?? ''}</span>
              <span className="ln" role="cell">{d.newNo ?? ''}</span>
              <span className="mark" role="cell" aria-label={d.kind === 'add' ? 'added' : d.kind === 'remove' ? 'removed' : 'unchanged'}>
                {d.kind === 'add' ? '+' : d.kind === 'remove' ? '−' : ' '}
              </span>
              <code role="cell">{d.text || ' '}</code>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
