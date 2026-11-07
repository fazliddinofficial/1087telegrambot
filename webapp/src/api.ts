export type Role = 'driver' | 'operator' | 'superadmin';
export type PaymentStatus = 'new' | 'in_progress' | 'completed' | 'rejected';

export interface User {
  id: string;
  telegramId: number;
  role: Role;
  name?: string;
  taxiId?: string;
  phone?: string;
  carNumber?: string;
  registered: boolean;
}

export interface Limits {
  minAmount: number;
  maxAmount: number;
}

export interface Card {
  number: string;
  holder: string;
}

export interface PaymentEvent {
  action: 'created' | 'taken' | 'completed' | 'rejected' | 'released';
  actorName: string;
  at: string;
  note?: string;
}

export interface Payment {
  id: string;
  number: number;
  amount: number;
  status: PaymentStatus;
  rejectionReason?: string;
  createdAt: string;
  finishedAt?: string;
  receiptUrl: string;
  card: Card;
  driverInfo?: { taxiId?: string; name: string; phone: string; carNumber: string };
  duplicateOfNumber?: number;
  takenById?: string;
  takenByName?: string;
  takenAt?: string;
  finishedByName?: string;
  events?: PaymentEvent[];
}

export interface Operator {
  id: string;
  name?: string;
  phone?: string;
  joinedAt?: string;
  todayCount: number;
  todaySum: number;
  completedCount: number;
  completedSum: number;
  rejectedCount: number;
  inProgress: number;
}

export interface PendingInvite {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

export interface Driver {
  id: string;
  taxiId?: string;
  name?: string;
  phone?: string;
  carNumber?: string;
  username?: string;
  registeredAt: string;
  completedCount: number;
  completedSum: number;
  openCount: number;
  lastPaymentAt?: string;
}

export interface DriverList {
  items: Driver[];
  page: number;
  pages: number;
  total: number;
}

export interface PaymentReport {
  items: Payment[];
  page: number;
  pages: number;
  total: number;
  totals: { completedCount: number; completedSum: number; rejectedCount: number; openCount: number };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Telegram initData'ni havola oxirida beradi: ilova Telegram skriptini kutmasdan ishlay oladi. */
const initDataFromUrl = new URLSearchParams(location.hash.slice(1)).get('tgWebAppData') ?? '';

/** Imzo serverda tekshiriladi. Lokal brauzer sinovida faqat dev rejimda localStorage'dan olinadi. */
function initData(): string {
  const fromTelegram = window.Telegram?.WebApp?.initData || initDataFromUrl;
  if (fromTelegram) return fromTelegram;
  if (import.meta.env.DEV) {
    try {
      return localStorage.getItem('devInitData') ?? '';
    } catch {
      return '';
    }
  }
  return '';
}

export function isInsideTelegram(): boolean {
  return Boolean(initData());
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { Authorization: `tma ${initData()}`, ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Internet aloqasini tekshiring');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new ApiError(res.status, body?.code ?? 'ERROR', body?.error ?? 'Xatolik yuz berdi');
  }
  return res;
}

async function json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return res.json() as Promise<T>;
}

export const api = {
  me: () => json<{ user: User; limits: Limits; card: Card | null }>('/me'),
  saveProfile: (data: { taxiId: string; name: string; phone: string; phoneConfirm: string; carNumber: string }) =>
    json<{ user: User }>('/me/profile', 'PUT', data),
  card: () => json<{ card: Card | null }>('/card'),

  createPayment: (amount: number, receipt: File) => {
    const form = new FormData();
    form.set('amount', String(amount));
    form.set('receipt', receipt);
    return request('/payments', { method: 'POST', body: form }).then((r) => r.json() as Promise<{ payment: Payment }>);
  },
  myPayments: () => json<{ items: Payment[] }>('/payments/mine'),
  queue: () => json<{ items: Payment[] }>('/payments/queue'),
  handled: () => json<{ items: Payment[] }>('/payments/handled'),
  take: (id: string) => json<{ payment: Payment }>(`/payments/${id}/take`, 'POST'),
  complete: (id: string) => json<{ payment: Payment }>(`/payments/${id}/complete`, 'POST'),
  reject: (id: string, reason: string) => json<{ payment: Payment }>(`/payments/${id}/reject`, 'POST', { reason }),
  receiptBlob: (url: string) => request(url.replace(/^\/api/, '')).then((r) => r.blob()),

  release: (id: string) => json<{ payment: Payment }>(`/admin/payments/${id}/release`, 'POST'),
  report: (params: Record<string, string>) =>
    json<PaymentReport>(`/admin/payments?${new URLSearchParams(params).toString()}`),
  drivers: (params: Record<string, string>) =>
    json<DriverList>(`/admin/drivers?${new URLSearchParams(params).toString()}`),
  operators: () => json<{ operators: Operator[]; invites: PendingInvite[] }>('/admin/operators'),
  createInvite: (name: string, phone: string) =>
    json<{ id: string; link: string; expiresAt: string }>('/admin/invites', 'POST', { name, phone }),
  reissueInvite: (id: string) =>
    json<{ id: string; link: string; expiresAt: string }>(`/admin/invites/${id}/reissue`, 'POST'),
  revokeInvite: (id: string) => json<{ ok: true }>(`/admin/invites/${id}/revoke`, 'POST'),
  removeOperator: (id: string) => json<{ released: number }>(`/admin/operators/${id}`, 'DELETE'),
  adminCard: () =>
    json<{ card: Card | null; history: (Card & { changedByName: string; at: string })[] }>('/admin/card'),
  saveCard: (number: string, holder: string) => json<{ card: Card }>('/admin/card', 'PUT', { number, holder }),
};
