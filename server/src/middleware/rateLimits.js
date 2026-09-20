import rateLimit from 'express-rate-limit';

// Checkout-abuse limiter for scan validation, redemption, PDF and notify
// endpoints. Set above legit burst levels: tills behind one shared store
// egress IP must never be throttled during normal checkout, while automated
// voucher-code guessing and document-generation abuse are slowed down.
// (Code space itself is ~32^8 ≈ 1.1T, so guessing is infeasible regardless.)
export const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down and try again' },
});
