import { useState, type ReactNode } from 'react';

// A row of labelled radio buttons. Used for Likert items and multiple choice.
export function ChoiceGroup(props: {
  name: string;
  legend: ReactNode;
  options: { value: string; label?: ReactNode }[];
  value: string | undefined;
  onChange: (v: string) => void;
  inline?: boolean;
  low?: string;
  high?: string;
}) {
  return (
    <fieldset className={`choice ${props.inline ? 'inline' : ''}`}>
      <legend>{props.legend}</legend>
      <div className="choice-row">
        {props.low && <span className="anchor">{props.low}</span>}
        {props.options.map((o) => (
          <label key={o.value} className={props.value === o.value ? 'chosen' : ''}>
            <input type="radio" name={props.name} value={o.value} checked={props.value === o.value} onChange={() => props.onChange(o.value)} />
            <span>{o.label ?? o.value}</span>
          </label>
        ))}
        {props.high && <span className="anchor">{props.high}</span>}
      </div>
    </fieldset>
  );
}

export function Likert(props: { name: string; text: ReactNode; value: string | undefined; onChange: (v: string) => void; points?: number; low?: string; high?: string }) {
  const n = props.points ?? 7;
  return (
    <ChoiceGroup
      name={props.name}
      legend={props.text}
      inline
      low={props.low}
      high={props.high}
      value={props.value}
      onChange={props.onChange}
      options={Array.from({ length: n }, (_, i) => ({ value: String(i + 1) }))}
    />
  );
}

// 0-100 in steps of 5, like the paper TLX. The thumb is hidden until the
// participant has actually chosen a value, so nobody submits the default by accident.
export function TlxSlider(props: { id: string; label: string; question: string; low: string; high: string; value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div className="tlx">
      <label htmlFor={props.id}>
        <strong>{props.label}</strong> {props.question}
      </label>
      <div className="tlx-row">
        <span className="anchor">{props.low}</span>
        <input
          id={props.id}
          type="range"
          min={0}
          max={100}
          step={5}
          className={props.value == null ? 'untouched' : ''}
          value={props.value ?? 50}
          aria-valuetext={props.value == null ? 'not answered' : String(props.value)}
          onChange={(e) => props.onChange(Number(e.target.value))}
          onClick={(e) => props.onChange(Number((e.target as HTMLInputElement).value))}
        />
        <span className="anchor">{props.high}</span>
        <output>{props.value ?? '–'}</output>
      </div>
    </div>
  );
}

export function useSubmit<T>(fn: () => Promise<T>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {error}
    </p>
  );
}
