import { validationResult } from 'express-validator';
import { ApiError } from '../utils/ApiError.js';

// Collects express-validator errors into a single 400 response.
export const validate = (req, res, next) => {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const details = result.array().map((e) => ({ field: e.path, message: e.msg }));
  return next(ApiError.badRequest('Validation failed', details));
};
