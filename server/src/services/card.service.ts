import { CardSetting } from '../models/Setting';
import { UserDoc, displayName } from '../models/User';
import { AppError } from '../utils/errors';
import { normalizeCardNumber } from '../utils/normalize';

export async function getCard(): Promise<{ number: string; holder: string } | null> {
  const card = await CardSetting.findOne({ key: 'card' });
  return card ? { number: card.number, holder: card.holder } : null;
}

export async function getCardHistory() {
  const card = await CardSetting.findOne({ key: 'card' });
  return (card?.history ?? []).slice().reverse();
}

/** Yangi karta keyingi to'lovlarga darhol ta'sir qiladi, eski to'lovlar o'z nusxasini saqlaydi. */
export async function setCard(actor: UserDoc, numberInput: string, holder: string) {
  const number = normalizeCardNumber(numberInput);
  if (!number) throw new AppError(400, 'BAD_CARD', "Karta raqami 16 ta raqamdan iborat bo'lishi kerak");

  const card = await CardSetting.findOneAndUpdate(
    { key: 'card' },
    {
      $set: { number, holder },
      $push: {
        history: { number, holder, changedBy: actor._id, changedByName: displayName(actor), at: new Date() },
      },
    },
    { upsert: true, returnDocument: 'after' },
  );
  return { number: card.number, holder: card.holder };
}
