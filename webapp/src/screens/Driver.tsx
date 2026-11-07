import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { Card, Limits, Payment, PaymentStatus, User, api } from '../api';
import { CheckIcon, ChevronIcon, ClockIcon, CloseIcon, ImageIcon, UserIcon, WalletIcon } from '../components/icons';
import {
  Avatar,
  Brand,
  CopyButton,
  Empty,
  ErrorNote,
  Field,
  Loading,
  PhoneInput,
  Plate,
  ReceiptImage,
  StatusBadge,
  SuccessNote,
  Tabs,
  errorMessage,
} from '../components/ui';
import { formatCard, formatDateTime, formatMoney, groupDigits, haptic } from '../utils';

const QUICK_AMOUNTS = [20_000, 50_000, 100_000, 200_000];

export function BankCard({ card, children }: { card: Card; children?: ReactNode }) {
  return (
    <section className="bank-card" aria-label="To'lov kartasi">
      <span className="bank-card-check" aria-hidden="true" />
      <span className="bank-card-label">To'lov kartasi</span>
      <strong className="bank-card-number">{formatCard(card.number)}</strong>
      <span className="bank-card-holder">{card.holder}</span>
      {children}
    </section>
  );
}

export function ProfileForm({
  user,
  submitLabel,
  onSaved,
}: {
  user: User;
  submitLabel: string;
  onSaved: (user: User) => void;
}) {
  const [taxiId, setTaxiId] = useState(user.taxiId ?? '');
  const [name, setName] = useState(user.name ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [phoneConfirm, setPhoneConfirm] = useState(user.phone ?? '');
  const [carNumber, setCarNumber] = useState(user.carNumber ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.saveProfile({ taxiId, name, phone, phoneConfirm, carNumber });
      haptic('success');
      setSaved(true);
      onSaved(res.user);
    } catch (err) {
      haptic('error');
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <Field label="Haydovchi ID raqamingizni kiriting" hint="Taksi dasturidagi ID raqamingiz. Dispetcher sizni shu ID orqali topadi, diqqat bilan yozing.">
        <input
          className="input-plate"
          value={taxiId}
          onChange={(e) => setTaxiId(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={40}
          required
        />
      </Field>
      <Field label="Ism va familiya">
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      </Field>
      <Field label="Telefon raqami" hint="Taksi dasturidagi raqamingiz.">
        <PhoneInput value={phone} onChange={setPhone} />
      </Field>
      <Field label="Telefon raqamini qayta kiriting">
        <PhoneInput value={phoneConfirm} onChange={setPhoneConfirm} />
      </Field>
      <Field label="Mashina raqami">
        <input
          className="input-plate"
          value={carNumber}
          onChange={(e) => setCarNumber(e.target.value.toUpperCase())}
          placeholder="01 A 123 BC"
          autoCapitalize="characters"
          maxLength={40}
          required
        />
      </Field>
      <ErrorNote message={error} />
      {saved && <SuccessNote>Saqlandi</SuccessNote>}
      <button className="btn btn-primary btn-block" disabled={busy}>
        {busy ? 'Saqlanmoqda...' : submitLabel}
      </button>
    </form>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="step">
      <span className="step-number" aria-hidden="true">{number}</span>
      <div className="step-body">
        <h2>{title}</h2>
        {children}
      </div>
    </li>
  );
}

function ReceiptPicker({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <label className={file ? 'dropzone dropzone-filled' : 'dropzone'}>
      <input
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png"
        aria-label="Chek rasmi"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {preview ? <img className="dropzone-preview" src={preview} alt="" /> : <span className="dropzone-icon"><ImageIcon /></span>}
      <span className="dropzone-text">
        <strong>{file ? file.name : 'Chek rasmini tanlang'}</strong>
        <small className="muted">{file ? 'Almashtirish uchun bosing' : 'Click yoki Payme skrinshoti, JPG yoki PNG, 5 MB gacha'}</small>
      </span>
    </label>
  );
}

function PayTab({
  user,
  limits,
  initialCard,
  onSent,
}: {
  user: User;
  limits: Limits;
  initialCard: Card | null;
  onSent: () => void;
}) {
  const [card, setCard] = useState<Card | null>(initialCard);
  const [amount, setAmount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Sahifa darhol ochiladi, karta esa orqada yangilanadi: admin almashtirgan bo'lsa, eskisi turib qolmasin.
  useEffect(() => {
    api
      .card()
      .then((res) => setCard(res.card))
      .catch(() => undefined);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Chek rasmini tanlang');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createPayment(Number(amount.replace(/\s/g, '')), file);
      haptic('success');
      onSent();
    } catch (err) {
      haptic('error');
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <header className="page-head">
        <div>
          <p className="eyebrow">Salom, {user.name?.split(' ')[0]} · ID {user.taxiId}</p>
          <h1>Balansni to'ldirish</h1>
        </div>
        {user.carNumber && <Plate number={user.carNumber} />}
      </header>

      <ol className="steps">
        <Step number={1} title="Kartaga pul o'tkazing">
          {card ? (
            <BankCard card={card}>
              <CopyButton value={card.number} label="Raqamni nusxalash" />
            </BankCard>
          ) : (
            <p className="notice notice-error">To'lov kartasi hali kiritilmagan. Dispetcherga murojaat qiling.</p>
          )}
        </Step>

        <Step number={2} title="Summani kiriting">
          <label className="amount-field">
            <span className="sr-only">O'tkazilgan summa</span>
            <input
              value={amount}
              onChange={(e) => setAmount(groupDigits(e.target.value))}
              inputMode="numeric"
              placeholder="0"
              required
            />
            <span className="amount-suffix" aria-hidden="true">so'm</span>
          </label>
          <div className="chips" role="group" aria-label="Tayyor summalar">
            {QUICK_AMOUNTS.map((value) => {
              const text = groupDigits(value);
              return (
                <button
                  type="button"
                  key={value}
                  className={amount === text ? 'chip chip-active' : 'chip'}
                  onClick={() => setAmount(text)}
                >
                  {text}
                </button>
              );
            })}
          </div>
          <small className="muted">Eng kami {formatMoney(limits.minAmount)}</small>
        </Step>

        <Step number={3} title="Chekni yuklang">
          <ReceiptPicker file={file} onChange={setFile} />
        </Step>
      </ol>

      <ErrorNote message={error} />
      <button className="btn btn-primary btn-block" disabled={busy || !card}>
        {busy ? 'Yuborilmoqda...' : 'Chekni yuborish'}
      </button>
    </form>
  );
}

/** Haydovchi to'lovi qaysi bosqichda ekanini ko'rsatadi. */
function Progress({ status }: { status: PaymentStatus }) {
  const stage = status === 'new' ? 1 : status === 'in_progress' ? 2 : 3;
  const last = status === 'rejected' ? 'Rad etildi' : 'Tushirildi';
  const labels = ['Yuborildi', 'Tekshirilmoqda', last];
  return (
    <ol className={status === 'rejected' ? 'progress progress-rejected' : 'progress'}>
      {labels.map((label, i) => (
        <li key={label} className={i < stage ? 'progress-step progress-done' : 'progress-step'}>
          <span className="progress-dot" aria-hidden="true">
            {i < stage && (status === 'rejected' && i === 2 ? <CloseIcon size={12} /> : <CheckIcon size={12} />)}
          </span>
          {label}
        </li>
      ))}
    </ol>
  );
}

function HistoryTab() {
  const [items, setItems] = useState<Payment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    api
      .myPayments()
      .then((res) => setItems(res.items))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!items) return <Loading />;

  return (
    <div className="stack">
      <header className="page-head">
        <h1>To'lovlarim</h1>
      </header>
      {items.length === 0 && (
        <Empty icon={ClockIcon} title="Hali to'lov yo'q" text="Yuborgan to'lovlaringiz shu yerda ko'rinadi." />
      )}
      {items.map((p) => {
        const open = openId === p.id;
        const active = p.status === 'new' || p.status === 'in_progress';
        return (
          <article key={p.id} className="card">
            <button type="button" className="row-button" aria-expanded={open} onClick={() => setOpenId(open ? null : p.id)}>
              <span className="row-main">
                <strong className="amount">{formatMoney(p.amount)}</strong>
                <small className="muted">№{p.number} · {formatDateTime(p.createdAt)}</small>
              </span>
              <StatusBadge status={p.status} />
              <span className={open ? 'chevron chevron-open' : 'chevron'}><ChevronIcon size={18} /></span>
            </button>
            {p.rejectionReason && <p className="notice notice-error">Sabab: {p.rejectionReason}</p>}
            {(active || open) && <Progress status={p.status} />}
            {open && <ReceiptImage url={p.receiptUrl} />}
          </article>
        );
      })}
    </div>
  );
}

type DriverTab = 'pay' | 'history' | 'profile';

export function DriverApp({
  user,
  limits,
  card,
  onUserChange,
}: {
  user: User;
  limits: Limits;
  card: Card | null;
  onUserChange: (user: User) => void;
}) {
  const [tab, setTab] = useState<DriverTab>('pay');
  const [justSent, setJustSent] = useState(false);

  const onSent = useCallback(() => {
    setJustSent(true);
    setTab('history');
  }, []);

  if (!user.registered) {
    return (
      <main className="screen screen-plain">
        <section className="welcome">
          <span className="welcome-check" aria-hidden="true" />
          <Brand />
          <h1>Xush kelibsiz!</h1>
          <p>Bir marta to'ldirasiz. Dispetcher balansingizni shu ID bo'yicha to'ldiradi.</p>
        </section>
        <ProfileForm user={user} submitLabel="Davom etish" onSaved={onUserChange} />
      </main>
    );
  }

  return (
    <>
      <main className="screen" key={tab}>
        <Brand />
        {tab === 'history' && justSent && (
          <SuccessNote>Chek yuborildi. Dispetcher tekshirgach, botga xabar keladi.</SuccessNote>
        )}
        {tab === 'pay' && <PayTab user={user} limits={limits} initialCard={card} onSent={onSent} />}
        {tab === 'history' && <HistoryTab />}
        {tab === 'profile' && (
          <div className="stack">
            <header className="profile-head">
              <Avatar name={user.name} />
              <div>
                <h1>{user.name}</h1>
                <p className="muted profile-id">ID {user.taxiId}</p>
                {user.carNumber && <Plate number={user.carNumber} />}
              </div>
            </header>
            <ProfileForm user={user} submitLabel="Saqlash" onSaved={onUserChange} />
          </div>
        )}
      </main>
      <Tabs
        active={tab}
        onChange={(next) => {
          setJustSent(false);
          setTab(next);
        }}
        tabs={[
          { id: 'pay', label: "To'ldirish", icon: WalletIcon },
          { id: 'history', label: "To'lovlarim", icon: ClockIcon },
          { id: 'profile', label: 'Profil', icon: UserIcon },
        ]}
      />
    </>
  );
}
