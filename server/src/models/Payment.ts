import { HydratedDocument, Schema, Types, model } from 'mongoose';

export type PaymentStatus = 'new' | 'in_progress' | 'completed' | 'rejected';
export type PaymentAction = 'created' | 'taken' | 'completed' | 'rejected' | 'released';

export interface IPaymentEvent {
  action: PaymentAction;
  actorId: Types.ObjectId;
  actorName: string;
  at: Date;
  note?: string;
}

export interface IPayment {
  number: number;
  driver: Types.ObjectId;
  // Yuborilgan paytdagi nusxalar: haydovchi profili yoki karta keyin o'zgarsa ham eski yozuv to'g'ri qoladi.
  // taxiId eski to'lovlarda bo'lmasligi mumkin: u keyinroq qo'shilgan.
  driverInfo: { telegramId: number; taxiId?: string; name: string; phone: string; carNumber: string };
  card: { number: string; holder: string };
  amount: number;
  receipt: { fileName: string; mime: string; size: number; sha256: string; telegramFileId?: string };
  duplicateOfNumber?: number;
  status: PaymentStatus;
  takenBy?: Types.ObjectId;
  takenByName?: string;
  takenByTelegramId?: number;
  takenAt?: Date;
  finishedBy?: Types.ObjectId;
  finishedByName?: string;
  finishedAt?: Date;
  rejectionReason?: string;
  messages: { chatId: number; messageId: number }[];
  lastReminderAt?: Date;
  events: IPaymentEvent[];
  createdAt: Date;
  updatedAt: Date;
}

export type PaymentDoc = HydratedDocument<IPayment>;

const paymentSchema = new Schema<IPayment>(
  {
    number: { type: Number, required: true, unique: true },
    driver: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    driverInfo: {
      telegramId: { type: Number, required: true },
      taxiId: String,
      name: { type: String, required: true },
      phone: { type: String, required: true },
      carNumber: { type: String, required: true },
    },
    card: {
      number: { type: String, required: true },
      holder: { type: String, required: true },
    },
    amount: { type: Number, required: true, min: 1 },
    receipt: {
      fileName: { type: String, required: true },
      mime: { type: String, required: true },
      size: { type: Number, required: true },
      sha256: { type: String, required: true, index: true },
      telegramFileId: String,
    },
    duplicateOfNumber: Number,
    status: { type: String, enum: ['new', 'in_progress', 'completed', 'rejected'], default: 'new' },
    takenBy: Schema.Types.ObjectId,
    takenByName: String,
    takenByTelegramId: Number,
    takenAt: Date,
    finishedBy: Schema.Types.ObjectId,
    finishedByName: String,
    finishedAt: Date,
    rejectionReason: String,
    messages: { type: [{ _id: false, chatId: Number, messageId: Number }], default: [] },
    lastReminderAt: Date,
    events: {
      type: [
        {
          _id: false,
          action: { type: String, required: true },
          actorId: { type: Schema.Types.ObjectId, required: true },
          actorName: { type: String, required: true },
          at: { type: Date, required: true },
          note: String,
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

paymentSchema.index({ status: 1, createdAt: 1 });
paymentSchema.index({ driver: 1, createdAt: -1 });
paymentSchema.index({ finishedBy: 1, finishedAt: -1 });
paymentSchema.index({ createdAt: -1 });

export const Payment = model<IPayment>('Payment', paymentSchema);
