import { QueryFilter, Types, isValidObjectId } from 'mongoose';
import { IPayment, Payment, PaymentDoc, PaymentStatus } from '../models/Payment';
import { IUser, User, UserDoc } from '../models/User';
import { AppError } from '../utils/errors';
import { tashkentDayStart } from '../utils/format';
import { escapeRegex, normalizePhone } from '../utils/normalize';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PaymentFilters {
  status?: PaymentStatus;
  operatorId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  limit?: number;
}

function buildFilter(filters: PaymentFilters): QueryFilter<IPayment> {
  const query: QueryFilter<IPayment> = {};
  if (filters.status) query.status = filters.status;

  if (filters.operatorId) {
    if (!isValidObjectId(filters.operatorId)) throw new AppError(400, 'BAD_OPERATOR', "Operator noto'g'ri");
    const id = new Types.ObjectId(filters.operatorId);
    query.$or = [{ finishedBy: id }, { takenBy: id }];
  }

  const createdAt: Record<string, Date> = {};
  if (filters.from) {
    const start = tashkentDayStart(filters.from);
    if (!start) throw new AppError(400, 'BAD_DATE', "Sana noto'g'ri");
    createdAt.$gte = start;
  }
  if (filters.to) {
    const start = tashkentDayStart(filters.to);
    if (!start) throw new AppError(400, 'BAD_DATE', "Sana noto'g'ri");
    createdAt.$lt = new Date(start.getTime() + DAY_MS);
  }
  if (Object.keys(createdAt).length) query.createdAt = createdAt;

  const q = filters.q?.trim();
  if (q) {
    const phone = normalizePhone(q);
    const pattern = new RegExp(escapeRegex(q.replace(/[\s-]/g, '')), 'i');
    const search: QueryFilter<IPayment>[] = [
      { 'driverInfo.taxiId': pattern },
      { 'driverInfo.phone': phone ?? pattern },
      { 'driverInfo.carNumber': pattern },
      { 'driverInfo.name': new RegExp(escapeRegex(q), 'i') },
    ];
    if (/^\d+$/.test(q)) search.push({ number: Number(q) });
    const orFilter = query.$or;
    if (orFilter) {
      delete query.$or;
      query.$and = [{ $or: orFilter }, { $or: search }];
    } else {
      query.$or = search;
    }
  }
  return query;
}

export async function listPayments(filters: PaymentFilters) {
  const query = buildFilter(filters);
  const limit = Math.min(filters.limit ?? 20, 100);
  const page = Math.max(filters.page ?? 1, 1);

  const [items, total, totals] = await Promise.all([
    Payment.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Payment.countDocuments(query),
    Payment.aggregate<{ _id: string; count: number; sum: number }>([
      { $match: query },
      { $group: { _id: '$status', count: { $sum: 1 }, sum: { $sum: '$amount' } } },
    ]),
  ]);

  const byStatus = new Map(totals.map((t) => [t._id, t]));
  return {
    items,
    page,
    pages: Math.max(Math.ceil(total / limit), 1),
    total,
    totals: {
      completedCount: byStatus.get('completed')?.count ?? 0,
      completedSum: byStatus.get('completed')?.sum ?? 0,
      rejectedCount: byStatus.get('rejected')?.count ?? 0,
      openCount: (byStatus.get('new')?.count ?? 0) + (byStatus.get('in_progress')?.count ?? 0),
    },
  };
}

/** Ro'yxatdan o'tgan haydovchilar va ularning to'lovlari bo'yicha qisqa ko'rsatkichlar. */
export async function listDrivers(filters: { q?: string; page?: number; limit?: number }) {
  const limit = Math.min(filters.limit ?? 20, 100);
  const page = Math.max(filters.page ?? 1, 1);

  const query: QueryFilter<IUser> = { role: 'driver', registeredAt: { $ne: null } };
  const q = filters.q?.trim();
  if (q) {
    const phone = normalizePhone(q);
    const compact = new RegExp(escapeRegex(q.replace(/[\s-]/g, '')), 'i');
    query.$or = [
      { taxiId: compact },
      { phone: phone ?? compact },
      { carNumber: compact },
      { name: new RegExp(escapeRegex(q), 'i') },
    ];
  }

  const [drivers, total] = await Promise.all([
    User.find(query)
      .sort({ registeredAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(query),
  ]);

  const stats = await Payment.aggregate<{
    _id: unknown;
    completedCount: number;
    completedSum: number;
    openCount: number;
    lastPaymentAt: Date;
  }>([
    { $match: { driver: { $in: drivers.map((d) => d._id) } } },
    {
      $group: {
        _id: '$driver',
        completedCount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        completedSum: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] } },
        openCount: { $sum: { $cond: [{ $in: ['$status', ['new', 'in_progress']] }, 1, 0] } },
        lastPaymentAt: { $max: '$createdAt' },
      },
    },
  ]);
  const statsById = new Map(stats.map((s) => [String(s._id), s]));

  return {
    page,
    pages: Math.max(Math.ceil(total / limit), 1),
    total,
    items: drivers.map((d) => {
      const s = statsById.get(String(d._id));
      return {
        id: String(d._id),
        taxiId: d.taxiId,
        name: d.name,
        phone: d.phone,
        carNumber: d.carNumber,
        username: d.username,
        registeredAt: d.registeredAt,
        completedCount: s?.completedCount ?? 0,
        completedSum: s?.completedSum ?? 0,
        openCount: s?.openCount ?? 0,
        lastPaymentAt: s?.lastPaymentAt,
      };
    }),
  };
}

/** Barcha xodimlarga ko'rinadigan navbat: eng eski to'lov birinchi. */
export function listQueue(): Promise<PaymentDoc[]> {
  return Payment.find({ status: { $in: ['new', 'in_progress'] } })
    .sort({ createdAt: 1 })
    .limit(200);
}

export function listMine(driver: UserDoc): Promise<PaymentDoc[]> {
  return Payment.find({ driver: driver._id }).sort({ createdAt: -1 }).limit(50);
}

export function listHandledBy(staff: UserDoc): Promise<PaymentDoc[]> {
  return Payment.find({ finishedBy: staff._id }).sort({ finishedAt: -1 }).limit(50);
}
