import { useEffect, useRef, type ReactNode } from 'react';

// Native <dialog> so focus is trapped and Esc cancels without extra code.
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);

  return (
    <dialog ref={ref} className="dialog" onCancel={props.onCancel} aria-labelledby="dialog-title">
      <h2 id="dialog-title">{props.title}</h2>
      <div>{props.children}</div>
      <div className="dialog-actions">
        <button onClick={props.onCancel}>Cancel</button>
        <button className="primary" onClick={props.onConfirm} autoFocus>
          {props.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
