import { HydratedDocument, Schema, Types, model } from 'mongoose';

export interface IInvite {
  tokenHash: string;
  name: string;
  phone: string;
  createdBy: Types.ObjectId;
  expiresAt: Date;
  usedAt?: Date;
  usedBy?: Types.ObjectId;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type InviteDoc = HydratedDocument<IInvite>;

const inviteSchema = new Schema<IInvite>(
  {
    // Havolaning o'zi saqlanmaydi, faqat xeshi: baza ochilib qolsa ham havolalar ishlamaydi.
    tokenHash: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    phone: { type: String, required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
    usedBy: Schema.Types.ObjectId,
    revokedAt: Date,
  },
  { timestamps: true },
);

export const Invite = model<IInvite>('Invite', inviteSchema);
