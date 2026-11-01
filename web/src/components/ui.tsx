import { useEffect, type ReactNode } from 'react';
import { initials } from '../format';

export function Spinner({ full = false }: { full?: boolean }) {
  return (
    <div className={full ? 'spinner-full' : 'spinner-inline'}>
      <div className="spinner" aria-label="Φόρτωση" />
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      {error}
    </div>
  );
}

export function SuccessBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="alert alert-success" role="status">
      {message}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Κλείσιμο">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue} 60% 45%)` }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

/** Collapsed list of deleted items with a restore button. Renders nothing when there are none. */
export function DeletedItems<T extends { id: number }>({
  items,
  label,
  onRestore,
}: {
  items: T[];
  label: (item: T) => ReactNode;
  onRestore: (item: T) => void;
}) {
  if (items.length === 0) return null;
  return (
    <details className="card deleted-items">
      <summary>Διαγραμμένα ({items.length})</summary>
      <ul className="list plain">
        {items.map((item) => (
          <li key={item.id} className="list-item static">
            <div className="list-main">{label(item)}</div>
            <button className="btn btn-small" onClick={() => onRestore(item)}>
              Επαναφορά
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function BalanceText({ amount, currency, format }: { amount: number; currency: string; format: (n: number, c: string) => string }) {
  const cls = amount > 0.004 ? 'pos' : amount < -0.004 ? 'neg' : 'zero';
  return <span className={`balance ${cls}`}>{format(Math.abs(amount), currency)}</span>;
}
