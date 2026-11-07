import type { PaymentDoc } from '../models/Payment';
import type { Role, UserDoc } from '../models/User';

export function serializeUser(user: UserDoc) {
  return {
    id: String(user._id),
    telegramId: user.telegramId,
    role: user.role,
    name: user.role === 'driver' ? user.name : user.staffName || user.telegramName,
    taxiId: user.taxiId,
    phone: user.phone,
    carNumber: user.carNumber,
    // ID qo'shilishidan oldin yozilgan haydovchi ham formani bir marta to'ldiradi.
    registered: Boolean(user.registeredAt && user.taxiId),
  };
}

/** Haydovchiga xodimlar haqidagi ichki ma'lumot ko'rsatilmaydi. */
export function serializePayment(payment: PaymentDoc, viewerRole: Role) {
  const base = {
    id: String(payment._id),
    number: payment.number,
    amount: payment.amount,
    status: payment.status,
    rejectionReason: payment.rejectionReason,
    createdAt: payment.createdAt,
    finishedAt: payment.finishedAt,
    receiptUrl: `/api/payments/${payment._id}/receipt`,
    card: payment.card,
  };
  if (viewerRole === 'driver') return base;

  return {
    ...base,
    driverInfo: {
      taxiId: payment.driverInfo.taxiId,
      name: payment.driverInfo.name,
      phone: payment.driverInfo.phone,
      carNumber: payment.driverInfo.carNumber,
    },
    duplicateOfNumber: payment.duplicateOfNumber,
    takenById: payment.takenBy ? String(payment.takenBy) : undefined,
    takenByName: payment.takenByName,
    takenAt: payment.takenAt,
    finishedByName: payment.finishedByName,
    events: payment.events.map((e) => ({ action: e.action, actorName: e.actorName, at: e.at, note: e.note })),
  };
}
