import mongoose from 'mongoose';

// Records a customer-authorised online payment intent from the Shopwise
// website checkout. AUTHORIZED means: code validated, customer linkage
// confirmed, 4-digit till PIN verified, balance covers the amount.
//
// Money NEVER moves here. Capture/settlement stays a staff till action
// (existing redeem/debit flows), which is why this record carries no
// cashier/store references — only the shopper's chosen store label.
const onlineAuthorizationSchema = new mongoose.Schema(
  {
    // Voucher/gift-card code or wallet code, uppercased.
    code: { type: String, required: true, uppercase: true, trim: true, index: true },
    kind: { type: String, enum: ['VOUCHER', 'GIFT_CARD', 'WALLET'], required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    holderName: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0.01 },
    // Website order reference — idempotency key: one live authorization
    // per order; retries replay instead of duplicating.
    orderRef: { type: String, required: true, trim: true, unique: true, index: true },
    storeLabel: { type: String, trim: true, default: '' },
    // Human reference shown to the shopper (e.g. AUTH-482913).
    authorizationCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    status: { type: String, enum: ['AUTHORIZED', 'CONSUMED', 'EXPIRED'], default: 'AUTHORIZED', index: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const OnlineAuthorization = mongoose.model('OnlineAuthorization', onlineAuthorizationSchema);
export default OnlineAuthorization;
