import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Card, Driver, DriverList, Operator, Payment, PaymentReport, PaymentStatus, PendingInvite, api } from '../api';
import { ChevronIcon, FilterIcon, PlusIcon, ReceiptIcon, SearchIcon, SendIcon, UserIcon, UsersIcon } from '../components/icons';
import {
  Avatar,
  CopyButton,
  Empty,
  ErrorNote,
  Field,
  Loading,
  PhoneInput,
  Plate,
  ReceiptImage,
  Sheet,
  StatusBadge,
  SuccessNote,
  errorMessage,
} from '../components/ui';
import { STATUS_LABEL, confirmAction, formatCard, formatDateTime, formatMoney, formatPhone, haptic, timeAgo } from '../utils';
import { BankCard } from './Driver';
import { DriverDetails, DuplicateWarning, PaymentEvents } from './Staff';

const WHO_LABEL: Partial<Record<PaymentStatus, string>> = {
  completed: 'Tushirgan',
  rejected: 'Rad etgan',
  in_progress: 'Olgan',
};

function PaymentRow({ payment }: { payment: Payment }) {
  const [open, setOpen] = useState(false);
  const who = payment.finishedByName ?? payment.takenByName;
  const whoLabel = WHO_LABEL[payment.status];

  return (
    <article className="card">
      <button type="button" className="row-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="row-main">
          <strong className="amount">{formatMoney(payment.amount)}</strong>
          <small className="muted">
            {payment.driverInfo?.taxiId ? `ID ${payment.driverInfo.taxiId} · ` : ''}
            {payment.driverInfo?.name} · {timeAgo(payment.createdAt)}
          </small>
        </span>
        <StatusBadge status={payment.status} />
        <span className={open ? 'chevron chevron-open' : 'chevron'}><ChevronIcon size={18} /></span>
      </button>
      {who && whoLabel && (
        <p className="who">
          <Avatar name={who} />
          <span>
            <small className="muted">{whoLabel}</small>
            <strong>{who}</strong>
          </span>
        </p>
      )}
      {payment.rejectionReason && <p className="notice notice-error">Sabab: {payment.rejectionReason}</p>}
      {open && (
        <div className="stack-small">
          <small className="muted">№{payment.number} · {formatDateTime(payment.createdAt)}</small>
          <DriverDetails payment={payment} />
          <DuplicateWarning payment={payment} />
          <ReceiptImage url={payment.receiptUrl} />
          <PaymentEvents payment={payment} />
        </div>
      )}
    </article>
  );
}

const STATUS_FILTERS: (PaymentStatus | '')[] = ['', 'new', 'in_progress', 'completed', 'rejected'];

export function ReportTab({ initialOperatorId, initialQuery }: { initialOperatorId?: string; initialQuery?: string }) {
  const [status, setStatus] = useState<PaymentStatus | ''>('');
  const [operatorId, setOperatorId] = useState(initialOperatorId ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState(initialQuery ?? '');
  const [query, setQuery] = useState(initialQuery ?? '');
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(Boolean(initialOperatorId));
  const [operators, setOperators] = useState<Operator[]>([]);
  const [report, setReport] = useState<PaymentReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.operators().then((res) => setOperators(res.operators)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const params: Record<string, string> = { page: String(page) };
    if (status) params.status = status;
    if (operatorId) params.operatorId = operatorId;
    if (from) params.from = from;
    if (to) params.to = to;
    if (query) params.q = query;
    let cancelled = false;
    api
      .report(params)
      .then((res) => {
        if (!cancelled) {
          setReport(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [status, operatorId, from, to, query, page]);

  function search(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(q.trim());
  }

  const activeFilters = [operatorId, from, to].filter(Boolean).length;

  return (
    <div className="stack">
      <header className="page-head">
        <h1>To'lovlar</h1>
      </header>

      {report && (
        <section className="summary" aria-label="Jami">
          <div className="summary-main">
            <span>Tushirilgan</span>
            <strong>{formatMoney(report.totals.completedSum)}</strong>
            <small>{report.totals.completedCount} ta to'lov</small>
          </div>
          <div className="summary-side">
            <div>
              <strong>{report.totals.openCount}</strong>
              <span>Ochiq</span>
            </div>
            <div>
              <strong>{report.totals.rejectedCount}</strong>
              <span>Rad etilgan</span>
            </div>
          </div>
        </section>
      )}

      <form className="search-row" onSubmit={search}>
        <label className="search">
          <SearchIcon size={18} />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => {
              if (q.trim() !== query) {
                setPage(1);
                setQuery(q.trim());
              }
            }}
            placeholder="ID, telefon, mashina yoki ism"
            aria-label="Qidiruv"
          />
        </label>
        <button
          type="button"
          className={activeFilters ? 'icon-btn icon-btn-large icon-btn-active' : 'icon-btn icon-btn-large'}
          aria-label={`Filtrlar${activeFilters ? `, ${activeFilters} ta tanlangan` : ''}`}
          aria-expanded={showFilters}
          onClick={() => setShowFilters(!showFilters)}
        >
          <FilterIcon size={20} />
        </button>
      </form>

      <div className="chips chips-scroll" role="group" aria-label="Holat">
        {STATUS_FILTERS.map((s) => (
          <button
            type="button"
            key={s || 'all'}
            className={status === s ? 'chip chip-active' : 'chip'}
            aria-pressed={status === s}
            onClick={() => {
              setPage(1);
              setStatus(s);
            }}
          >
            {s ? STATUS_LABEL[s] : 'Barchasi'}
          </button>
        ))}
      </div>

      {showFilters && (
        <section className="filter-panel" aria-label="Filtrlar">
          <Field label="Operator">
            <select
              value={operatorId}
              onChange={(e) => {
                setPage(1);
                setOperatorId(e.target.value);
              }}
            >
              <option value="">Barchasi</option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </Field>
          <div className="date-grid">
            <Field label="Sanadan">
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setPage(1);
                  setFrom(e.target.value);
                }}
              />
            </Field>
            <Field label="Sanagacha">
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setPage(1);
                  setTo(e.target.value);
                }}
              />
            </Field>
          </div>
        </section>
      )}

      <ErrorNote message={error} />
      {!report && !error && <Loading />}
      {report && (
        <>
          {report.items.length === 0 && (
            <Empty icon={ReceiptIcon} title="To'lov topilmadi" text="Filtrlarni o'zgartirib ko'ring." />
          )}
          {report.items.map((p) => (
            <PaymentRow key={p.id} payment={p} />
          ))}
          {report.pages > 1 && (
            <div className="pager">
              <button className="btn btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Oldingi</button>
              <span className="muted">{report.page} / {report.pages}</span>
              <button className="btn btn-small" disabled={page >= report.pages} onClick={() => setPage(page + 1)}>Keyingi</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Ro'yxatda qisqa qator, bosilganda to'liq ma'lumot: ekranga ko'proq haydovchi sig'adi. */
function DriverRow({
  driver,
  open,
  onToggle,
  onOpenPayments,
}: {
  driver: Driver;
  open: boolean;
  onToggle: () => void;
  onOpenPayments: (query: string) => void;
}) {
  return (
    <article className={open ? 'driver-row driver-row-open' : 'driver-row'}>
      <button type="button" className="driver-row-head" aria-expanded={open} onClick={onToggle}>
        <strong className="driver-row-name">{driver.name}</strong>
        {driver.carNumber ? (
          <Plate number={driver.carNumber} />
        ) : (
          driver.taxiId && <span className="driver-row-id">ID {driver.taxiId}</span>
        )}
        <span className={open ? 'chevron chevron-open' : 'chevron'}><ChevronIcon size={18} /></span>
      </button>

      {open && (
        <div className="driver-row-body">
          {driver.taxiId ? (
            <div className="driver-id">
              <span className="driver-id-label">ID</span>
              <strong>{driver.taxiId}</strong>
              <CopyButton value={driver.taxiId} ariaLabel="ID raqamini nusxalash" />
            </div>
          ) : (
            <p className="notice notice-warning">ID hali kiritilmagan</p>
          )}
          <div className="driver">
            {driver.username && <small className="muted">@{driver.username}</small>}
            {driver.phone && (
              <div className="driver-phone">
                <span className="mono">{formatPhone(driver.phone)}</span>
                <CopyButton value={driver.phone} ariaLabel="Telefon raqamini nusxalash" />
              </div>
            )}
          </div>
          <dl className="stats">
            <div>
              <dt>Tushirilgan</dt>
              <dd>{formatMoney(driver.completedSum)}</dd>
              <dd className="muted">{driver.completedCount} ta</dd>
            </div>
            <div>
              <dt>Oxirgi to'lov</dt>
              <dd>{driver.lastPaymentAt ? timeAgo(driver.lastPaymentAt) : "Yo'q"}</dd>
              {driver.openCount > 0 && <dd className="muted">{driver.openCount} ta ochiq</dd>}
            </div>
          </dl>
          <small className="muted">Ro'yxatdan o'tgan: {formatDateTime(driver.registeredAt)}</small>
          <button
            className="btn btn-small btn-block"
            onClick={() => onOpenPayments(driver.taxiId ?? driver.phone ?? driver.name ?? '')}
          >
            To'lovlari
          </button>
        </div>
      )}
    </article>
  );
}

export function DriversTab({ onOpenPayments }: { onOpenPayments: (query: string) => void }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [list, setList] = useState<DriverList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params: Record<string, string> = { page: String(page) };
    if (query) params.q = query;
    let cancelled = false;
    api
      .drivers(params)
      .then((res) => {
        if (!cancelled) {
          setList(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [query, page]);

  function applySearch() {
    if (q.trim() === query) return;
    setPage(1);
    setQuery(q.trim());
  }

  function search(e: FormEvent) {
    e.preventDefault();
    applySearch();
  }

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Haydovchilar</h1>
        {list && <span className="count-pill">{list.total} ta</span>}
      </header>

      <form className="search-row" onSubmit={search}>
        <label className="search">
          <SearchIcon size={18} />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={applySearch}
            placeholder="ID, telefon, mashina yoki ism"
            aria-label="Qidiruv"
          />
        </label>
      </form>

      <ErrorNote message={error} />
      {!list && !error && <Loading />}
      {list && (
        <>
          {list.items.length === 0 && (
            <Empty
              icon={UserIcon}
              title={query ? 'Haydovchi topilmadi' : "Hali haydovchi yo'q"}
              text={query ? "Qidiruvni o'zgartirib ko'ring." : "Botda ro'yxatdan o'tganlar shu yerda ko'rinadi."}
            />
          )}
          {list.items.length > 0 && (
            <div className="driver-list">
              {list.items.map((driver) => (
                <DriverRow
                  key={driver.id}
                  driver={driver}
                  open={openId === driver.id}
                  onToggle={() => setOpenId(openId === driver.id ? null : driver.id)}
                  onOpenPayments={onOpenPayments}
                />
              ))}
            </div>
          )}
          {list.pages > 1 && (
            <div className="pager">
              <button className="btn btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Oldingi</button>
              <span className="muted">{list.page} / {list.pages}</span>
              <button className="btn btn-small" disabled={page >= list.pages} onClick={() => setPage(page + 1)}>Keyingi</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InviteLinkSheet({ link, onClose }: { link: string; onClose: () => void }) {
  const insideTelegram = Boolean(window.Telegram?.WebApp?.initData);
  return (
    <Sheet title="Havola tayyor" onClose={onClose}>
      <div className="stack-small">
        <p className="muted">Uni operatorga yuboring. Havola bir marta ishlaydi va raqam mos kelsagina rol beradi.</p>
        <code className="link-box">{link}</code>
        <CopyButton value={link} label="Havolani nusxalash" />
        {insideTelegram && (
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() =>
              window.Telegram?.WebApp?.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}`)
            }
          >
            <SendIcon size={18} />
            Telegram'da yuborish
          </button>
        )}
      </div>
    </Sheet>
  );
}

function AddOperatorSheet({
  busy,
  error,
  onSubmit,
  onClose,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (name: string, phone: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(name, phone);
  }

  return (
    <Sheet title="Operator qo'shish" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Operator ismi">
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <Field label="Telegram'dagi telefon raqami" hint="Havola ochilganda shu raqam tekshiriladi.">
          <PhoneInput value={phone} onChange={setPhone} />
        </Field>
        <ErrorNote message={error} />
        <button className="btn btn-primary btn-block" disabled={busy}>Havola yaratish</button>
      </form>
    </Sheet>
  );
}

export function OperatorsTab({ onOpenPayments }: { onOpenPayments: (operatorId: string) => void }) {
  const [operators, setOperators] = useState<Operator[] | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .operators()
      .then((res) => {
        setOperators(res.operators);
        setInvites(res.invites);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      haptic('success');
      load();
    } catch (err) {
      haptic('error');
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(operator: Operator) {
    const held = operator.inProgress ? ` Qo'lidagi ${operator.inProgress} ta to'lov boshqalarga qaytadi.` : '';
    if (await confirmAction(`${operator.name} butunlay o'chirilsinmi? Bu amalni qaytarib bo'lmaydi.${held}`)) {
      void run(() => api.removeOperator(operator.id));
    }
  }

  if (!operators) return error ? <ErrorNote message={error} /> : <Loading />;

  return (
    <div className="stack">
      <header className="page-head">
        <h1>Operatorlar</h1>
        <button className="btn btn-small btn-primary" onClick={() => setAdding(true)}>
          <PlusIcon size={18} />
          Qo'shish
        </button>
      </header>

      {!adding && <ErrorNote message={error} />}

      {adding && (
        <AddOperatorSheet
          busy={busy}
          error={error}
          onClose={() => {
            setAdding(false);
            setError(null);
          }}
          onSubmit={(name, phone) =>
            void run(async () => {
              const res = await api.createInvite(name, phone);
              setAdding(false);
              setLink(res.link);
            })
          }
        />
      )}
      {link && <InviteLinkSheet link={link} onClose={() => setLink(null)} />}

      {invites.length > 0 && (
        <section className="stack-small" aria-label="Takliflar">
          <h2 className="group-title">Taklif yuborilganlar</h2>
          {invites.map((invite) => (
            <article key={invite.id} className="card card-dashed">
              <div className="person">
                <Avatar name={invite.name} />
                <div className="person-main">
                  <strong>{invite.name}</strong>
                  <small className="muted mono">{formatPhone(invite.phone)}</small>
                </div>
                <span className={invite.expired ? 'badge badge-rejected' : 'badge badge-new'}>
                  {invite.expired ? 'Eskirgan' : 'Kutilmoqda'}
                </span>
              </div>
              <small className="muted">Amal qiladi: {formatDateTime(invite.expiresAt)} gacha</small>
              <div className="actions">
                <button
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() => run(async () => setLink((await api.reissueInvite(invite.id)).link))}
                >
                  Yangi havola
                </button>
                <button className="btn btn-small btn-danger" disabled={busy} onClick={() => run(() => api.revokeInvite(invite.id))}>
                  Bekor qilish
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {operators.length === 0 && (
        <Empty icon={UsersIcon} title="Hali operator yo'q" text="«Qo'shish» tugmasi orqali taklif yuboring." />
      )}

      {operators.map((operator) => (
        <article key={operator.id} className="card">
          <div className="person">
            <Avatar name={operator.name} />
            <div className="person-main">
              <strong>{operator.name}</strong>
              <small className="muted mono">{operator.phone ? formatPhone(operator.phone) : ''}</small>
            </div>
          </div>
          <dl className="stats">
            <div>
              <dt>Bugun</dt>
              <dd>{formatMoney(operator.todaySum)}</dd>
              <dd className="muted">{operator.todayCount} ta</dd>
            </div>
            <div>
              <dt>Jami</dt>
              <dd>{formatMoney(operator.completedSum)}</dd>
              <dd className="muted">{operator.completedCount} ta</dd>
            </div>
            <div>
              <dt>Qo'lida</dt>
              <dd>{operator.inProgress} ta</dd>
            </div>
            <div>
              <dt>Rad etgan</dt>
              <dd>{operator.rejectedCount} ta</dd>
            </div>
          </dl>
          <div className="actions">
            <button className="btn btn-small" onClick={() => onOpenPayments(operator.id)}>To'lovlari</button>
            <button className="btn btn-small btn-danger" disabled={busy} onClick={() => remove(operator)}>O'chirish</button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function CardTab() {
  const [card, setCard] = useState<Card | null>(null);
  const [history, setHistory] = useState<(Card & { changedByName: string; at: string })[]>([]);
  const [number, setNumber] = useState('');
  const [holder, setHolder] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .adminCard()
      .then((res) => {
        setCard(res.card);
        setHistory(res.history);
        setNumber(res.card ? formatCard(res.card.number) : '');
        setHolder(res.card?.holder ?? '');
        setLoaded(true);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(load, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    if (!(await confirmAction("Karta almashtirilsinmi? Haydovchilar bundan keyin shu kartaga to'laydi."))) return;
    setBusy(true);
    try {
      await api.saveCard(number, holder);
      haptic('success');
      setSaved(true);
      load();
    } catch (err) {
      haptic('error');
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return error ? <ErrorNote message={error} /> : <Loading rows={2} />;

  return (
    <div className="stack">
      <header className="page-head">
        <h1>To'lov kartasi</h1>
      </header>

      {card ? (
        <BankCard card={card} />
      ) : (
        <p className="notice notice-warning">Karta kiritilmaguncha haydovchilar to'lov yubora olmaydi.</p>
      )}

      <form className="card" onSubmit={submit}>
        <h2 className="card-title">{card ? 'Kartani almashtirish' : 'Karta kiritish'}</h2>
        <Field label="Karta raqami">
          <input
            className="mono"
            value={number}
            onChange={(e) => setNumber(formatCard(e.target.value.replace(/\D/g, '').slice(0, 16)))}
            inputMode="numeric"
            placeholder="8600 0000 0000 0000"
            required
          />
        </Field>
        <Field label="Karta egasi">
          <input value={holder} onChange={(e) => setHolder(e.target.value)} required />
        </Field>
        <ErrorNote message={error} />
        {saved && <SuccessNote>Karta saqlandi</SuccessNote>}
        <button className="btn btn-primary btn-block" disabled={busy}>Saqlash</button>
      </form>

      {history.length > 0 && (
        <section className="stack-small">
          <h2 className="group-title">O'zgarishlar tarixi</h2>
          <ol className="timeline">
            {history.map((h, i) => (
              <li key={i}>
                <span className="mono">{formatCard(h.number)} · {h.holder}</span>
                <small className="muted">{h.changedByName}, {formatDateTime(h.at)}</small>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
