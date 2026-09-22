import Customer from '../models/Customer.js';
import { sendDirect } from './notification.service.js';

// "Your money moved" alerts: emailed when the customer has an email address,
// otherwise SMS when the phone looks usable. Fire-and-forget by design —
// this helper NEVER throws, so a notification failure can never fail or
// block the payment it describes.
export async function notifyWalletCredit(txn) {
  try {
    if (!txn?.customer) return;
    const customer = await Customer.findById(txn.customer).select('name email phone');
    if (!customer) return;
    const mwk = (n) => `K${Number(n).toFixed(2)}`;
    const text =
      `Shopwise Vouchera: your wallet was credited ${mwk(txn.amount)}` +
      `${txn.paymentReference ? ` (ref ${txn.paymentReference})` : ''}. ` +
      `New balance ${mwk(txn.newBalance)}. If this wasn't you, please visit any Shopwise store.`;
    if (customer.email) {
      await sendDirect({
        channel: 'email',
        recipient: customer.email,
        subject: 'Your Shopwise wallet was credited',
        text: `Hello ${customer.name},\n\n${text}`,
        actor: txn.performedBy ?? null,
      });
      return;
    }
    const phone = String(customer.phone || '').replace(/[\s-]/g, '');
    if (/^\+?[0-9]{7,15}$/.test(phone)) {
      await sendDirect({ channel: 'sms', recipient: phone, subject: '', text, actor: txn.performedBy ?? null });
    }
  } catch {
    // Logged in the delivery log by sendDirect; never surfaces.
  }
}
