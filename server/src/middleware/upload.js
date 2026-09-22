import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

// Proof-of-payment uploads (TRANSFER top-ups). Memory transport only — the
// controller persists validated buffers to GridFS (see proofStorage.service),
// so nothing ever rests on ephemeral local disk.
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

const single = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return cb(new Error('Proof of payment must be a JPG, PNG or PDF'));
    }
    cb(null, true);
  },
}).single('proof');

// Multer errors arrive as plain Errors (→ 500) — normalize to 400 here.
export function proofUpload(req, res, next) {
  single(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(ApiError.badRequest('Proof of payment must be 5MB or smaller'));
    }
    return next(ApiError.badRequest(err.message || 'Invalid proof-of-payment file'));
  });
}
