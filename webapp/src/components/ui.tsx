import { ComponentType, ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, PaymentStatus, api } from '../api';
import { STATUS_LABEL, copyText, formatLocalPhone, formatPlate, haptic, initials, localPhoneDigits } from '../utils';
import { AlertIcon, CheckIcon, CloseIcon, CopyIcon, ImageIcon } from './icons';

export type IconType = ComponentType<{ size?: number }>;

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Xatolik yuz berdi';
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="notice notice-error" role="alert">
      <AlertIcon size={18} />
      <span>{message}</span>
    </p>
  );
}

export function SuccessNote({ children }: { children: ReactNode }) {
  return (
    <p className="notice notice-success" role="status">
      <CheckIcon size={18} />
      <span>{children}</span>
    </p>
  );
}

export function StatusBadge({ status }: { status: PaymentStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Plate({ number }: { number: string }) {
  return <span className="plate">{formatPlate(number)}</span>;
}

/** Taksi xizmati belgisi: kutish oynasidagi bilan bir xil ko'rinishda. */
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true" />
      <strong className="brand-number">1087</strong>
      <span className="brand-name">Taksi xizmati</span>
    </div>
  );
}

export function Avatar({ name }: { name?: string }) {
  return <span className="avatar" aria-hidden="true">{initials(name)}</span>;
}

export function Empty({ icon: Icon, title, text }: { icon: IconType; title: string; text?: string }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon size={28} /></span>
      <strong>{title}</strong>
      {text && <span className="muted">{text}</span>}
    </div>
  );
}

/** Ma'lumot kelguncha sahifa shaklini saqlaydi. */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" role="status" aria-label="Yuklanmoqda">
      <div className="skeleton skeleton-title" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton skeleton-card" />
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** +998 doim turadi, foydalanuvchi faqat qolgan 9 ta raqamni yozadi. Tashqariga to'liq raqam beradi. */
export function PhoneInput({ value, onChange }: { value: string; onChange: (phone: string) => void }) {
  const digits = localPhoneDigits(value);
  return (
    <span className="phone-input">
      <span className="phone-prefix">+998</span>
      <input
        value={formatLocalPhone(digits)}
        onChange={(e) => {
          const next = localPhoneDigits(e.target.value);
          onChange(next ? `+998${next}` : '');
        }}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="90 123 45 67"
        required
      />
    </span>
  );
}

export function CopyButton({ value, label, ariaLabel }: { value: string; label?: string; ariaLabel?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={label ? 'btn btn-small' : 'icon-btn'}
      aria-label={label ? undefined : ariaLabel ?? 'Nusxalash'}
      onClick={async () => {
        if (await copyText(value)) {
          haptic('success');
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
      {label && (copied ? 'Nusxalandi' : label)}
    </button>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; icon: IconType; badge?: number }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <nav className="tabs" aria-label="Bo'limlar">
      {tabs.map(({ id, label, icon: Icon, badge }) => (
        <button
          key={id}
          type="button"
          className={id === active ? 'tab tab-active' : 'tab'}
          aria-current={id === active ? 'page' : undefined}
          onClick={() => onChange(id)}
        >
          <span className="tab-icon">
            <Icon size={21} />
            {badge ? <span className="tab-badge">{badge}</span> : null}
          </span>
          {label}
        </button>
      ))}
    </nav>
  );
}

/** Pastdan chiqadigan oyna. Native dialog fokusni ichida ushlaydi va Esc bilan yopiladi. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet-body">
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Yopish" onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** Chek himoyalangan manzildan olinadi, shuning uchun oddiy <img src> bilan ochilmaydi. */
export function ReceiptImage({ url, variant = 'full' }: { url: string; variant?: 'full' | 'thumb' }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const className = variant === 'thumb' ? 'receipt receipt-thumb' : 'receipt';

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    api
      .receiptBlob(url)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (failed) {
    return (
      <div className={`${className} receipt-empty`}>
        <ImageIcon size={20} />
        <small>Chek ochilmadi</small>
      </div>
    );
  }
  if (!src) return <div className={`${className} skeleton`} aria-label="Chek yuklanmoqda" />;

  return (
    <>
      <button type="button" className={className} onClick={() => setZoomed(true)} aria-label="Chekni kattalashtirish">
        <img src={src} alt="To'lov cheki" />
      </button>
      {zoomed &&
        createPortal(
          <button type="button" className="lightbox" onClick={() => setZoomed(false)} aria-label="Yopish">
            <img src={src} alt="To'lov cheki" />
          </button>,
          document.body,
        )}
    </>
  );
}
