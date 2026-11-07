import { Schema, Types, model } from 'mongoose';

export interface ICardChange {
  number: string;
  holder: string;
  changedBy: Types.ObjectId;
  changedByName: string;
  at: Date;
}

export interface ICardSetting {
  key: 'card';
  number: string;
  holder: string;
  // Karta pul qayerga borishini belgilaydi, shuning uchun har bir o'zgarish saqlanadi.
  history: ICardChange[];
}

const cardSettingSchema = new Schema<ICardSetting>(
  {
    key: { type: String, enum: ['card'], required: true, unique: true },
    number: { type: String, required: true },
    holder: { type: String, required: true },
    history: {
      type: [
        {
          _id: false,
          number: String,
          holder: String,
          changedBy: Schema.Types.ObjectId,
          changedByName: String,
          at: Date,
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export const CardSetting = model<ICardSetting>('CardSetting', cardSettingSchema);

const counterSchema = new Schema<{ _id: string; value: number }>({
  _id: { type: String, required: true },
  value: { type: Number, default: 0 },
});

export const Counter = model('Counter', counterSchema);

/** Odam o'qiy oladigan navbatdagi to'lov raqami. */
export async function nextPaymentNumber(): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { _id: 'payment' },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return counter.value;
}
