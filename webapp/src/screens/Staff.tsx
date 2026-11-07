import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Payment, Role, User, api } from '../api';
import { AlertIcon, DoneAllIcon, InboxIcon, ReturnIcon } from '../components/icons';
import {
  CopyButton,
  Empty,
  ErrorNote,
  Loading,
  Plate,
  ReceiptImage,
  Sheet,
  StatusBadge,
  errorMessage,
} from '../components/ui';
import { EVENT_LABEL, formatDateTime, formatMoney, formatPhone, haptic, maskCard, timeAgo } from '../utils';

const QUICK_REASONS = ['Pul kartaga tushmagan', 'Summa mos kelmadi', "Chek noto'g'ri yoki o'qib bo'lmaydi"];
const REFRESH_MS = 15_000;

/** Dispetcher haydovchini web dasturda ID orqali topadi, telefon va mashina raqami esa tekshirish uchun. */
export function DriverDetails({ payment }: { payment: Payment }) {
  if (!payment.driverInfo) return null;
  const { taxiId, name, phone, carNumber } = payment.driverInfo;
  return (
    <div className="driver">
      {taxiId && (
        <div className="driver-id">
          <span className="driver-id-label">ID</span>
          <strong>{taxiId}</strong>
          <CopyButton value={taxiId} ariaLabel="ID raqamini nusxalash" />
        </div>
      )}
      <strong className="driver-name">{name}</strong>
      <div className="driver-phone">
        <span className="mono">{formatPhone(phone)}</span>
        <CopyButton value={phone} ariaLabel="Telefon raqamini nusxalash" />
      </div>
      <Plate number={carNumber} />
      <small className="muted mono">Karta {maskCard(payment.card.number)}</small>
    </div>
  );
}

export function DuplicateWarning({ payment }: { payment: Payment }) {
  if (!payment.duplicateOfNumber) return null;
  return (
    <p className="notice notice-warning" role="alert">
      <AlertIcon size={18} />
      <span>Bu chek avval №{payment.duplicateOfNumber} to'lovda yuborilgan</span>
    </p>
  );
}

export function PaymentEvents({ payment }: { payment: Payment }) {
  if (!payment.events?.length) return null;
  return (
    <ol className="timeline">
      {payment.events.map((e, i) => (
        <li key={i}>
          <span>
            <strong>{e.actorName}</strong> {EVENT_LABEL[e.action]}
            {e.note ? `: ${e.note}` : ''}
          </span>
          <small className="muted">{formatDateTime(e.at)}</small>
        </li>
      ))}
    </ol>
  );
}

function RejectSheet({
  payment,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  payment: Payment;
  busy: boolean;
  error: string | null;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(reason);
  }

  return (
    <Sheet title={`№${payment.number} to'lovni rad etish`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="reason-list" role="group" aria-label="Tayyor sabablar">
          {QUICK_REASONS.map((r) => (
            <button
              type="button"
              key={r}
              className={reason === r ? 'reason reason-active' : 'reason'}
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Yoki sababni o'zingiz yozing"
          aria-label="Rad etish sababi"
          maxLength={300}
          rows={2}
        />
        <ErrorNote message={error} />
        <button className="btn btn-danger-solid btn-block" disabled={busy || !reason.trim()}>
          {busy ? 'Yuborilmoqda...' : 'Rad etish'}
        </button>
      </form>
    </Sheet>
  );
}

function QueueCard({
  payment,
  me,
  role,
  onChanged,
}: {
  payment: Payment;
  me: User;
  role: Role;
  onChanged: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, onDone?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      haptic('success');
      onDone?.();
      onChanged();
    } catch (err) {
      haptic('error');
      setError(errorMessage(err));
      // Boshqa operator ulgurgan bo'lsa, ro'yxat yangilanadi.
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const mine = payment.takenById === me.id;
  const canRelease = role === 'superadmin' && payment.status === 'in_progress';

  return (
    <article className={mine ? 'card card-mine' : 'card'}>
      <div className="card-head">
        <div>
          <strong className="amount amount-large">{formatMoney(payment.amount)}</strong>
          <small className="muted">№{payment.number} · {timeAgo(payment.createdAt)}</small>
        </div>
        <StatusBadge status={payment.status} />
      </div>

      <div className="queue-body">
        <DriverDetails payment={payment} />
        <ReceiptImage url={payment.receiptUrl} variant="thumb" />
      </div>

      <DuplicateWarning payment={payment} />
      {!rejecting && <ErrorNote message={error} />}

      {payment.status === 'new' && (
        <button className="btn btn-primary btn-block" disabled={busy} onClick={() => run(() => api.take(payment.id))}>
          Oldim
        </button>
      )}

      {payment.status === 'in_progress' && !mine && (
        <p className="taken-by">{payment.takenByName} ko'rib chiqmoqda</p>
      )}

      {mine && (
        <>
          <ol className="checklist">
            <li>Kartaga pul tushganini tekshiring</li>
            <li>Web dasturda haydovchini ID orqali toping va balansni to'ldiring</li>
          </ol>
          <div className="actions">
            <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.complete(payment.id))}>
              Tushirdim
            </button>
            <button className="btn btn-danger" disabled={busy} onClick={() => setRejecting(true)}>
              Rad etish
            </button>
          </div>
        </>
      )}

      {canRelease && (
        <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => run(() => api.release(payment.id))}>
          <ReturnIcon size={18} />
          Navbatga qaytarish
        </button>
      )}

      {rejecting && (
        <RejectSheet
          payment={payment}
          busy={busy}
          error={error}
          onClose={() => {
            setRejecting(false);
            setError(null);
          }}
          onSubmit={(reason) => void run(() => api.reject(payment.id, reason), () => setRejecting(false))}
        />
      )}
    </article>
  );
}

export function QueueTab({ me, onCount }: { me: User; onCount: (count: number) => void }) {
  const [items, setItems] = useState<Payment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(() => {
    api
      .queue()
      .then((res) => {
        if (!alive.current) return;
        setItems(res.items);
        setError(null);
        onCount(res.items.filter((p) => p.status === 'new').length);
      })
      .catch((err) => {
        if (alive.current) setError(errorMessage(err));
      });
  }, [onCount]);

  useEffect(() => {
    alive.current = true;
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [load]);

  if (!items) return error ? <ErrorNote message={error} /> : <Loading />;

  const mine = items.filter((p) => p.takenById === me.id);
  const fresh = items.filter((p) => p.status === 'new');
  const others = items.filter((p) => p.status === 'in_progress' && p.takenById !== me.id);
  const groups = [
    { title: 'Sizda', items: mine },
    { title: 'Yangi', items: fresh },
    { title: 'Boshqalarda', items: others },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Navbat</h1>
      </header>

      <section className="tiles" aria-label="Navbat holati">
        <div className="tile tile-accent">
          <strong>{fresh.length}</strong>
          <span>Yangi</span>
        </div>
        <div className="tile">
          <strong>{mine.length}</strong>
          <span>Sizda</span>
        </div>
        <div className="tile">
          <strong>{others.length}</strong>
          <span>Boshqalarda</span>
        </div>
      </section>

      <ErrorNote message={error} />
      {items.length === 0 && (
        <Empty icon={InboxIcon} title="Kutilayotgan chek yo'q" text="Yangi to'lov kelsa, bot xabar beradi." />
      )}
      {groups.map((group) => (
        <section className="stack-small" key={group.title} aria-label={group.title}>
          <h2 className="group-title">{group.title}</h2>
          {group.items.map((p) => (
            <QueueCard key={p.id} payment={p} me={me} role={me.role} onChanged={load} />
          ))}
        </section>
      ))}
    </div>
  );
}

export function HandledTab() {
  const [items, setItems] = useState<Payment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .handled()
      .then((res) => setItems(res.items))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!items) return <Loading />;
  return (
    <div className="stack">
      <header className="page-head">
        <h1>Amallarim</h1>
      </header>
      {items.length === 0 && (
        <Empty icon={DoneAllIcon} title="Hali amal yo'q" text="Tushirgan va rad etgan to'lovlaringiz shu yerda turadi." />
      )}
      {items.map((p) => (
        <article key={p.id} className="card">
          <div className="card-head">
            <div>
              <strong className="amount">{formatMoney(p.amount)}</strong>
              <small className="muted">№{p.number} · {p.finishedAt ? formatDateTime(p.finishedAt) : ''}</small>
            </div>
            <StatusBadge status={p.status} />
          </div>
          <DriverDetails payment={p} />
          {p.rejectionReason && <p className="notice notice-error">Sabab: {p.rejectionReason}</p>}
        </article>
      ))}
    </div>
  );
}
