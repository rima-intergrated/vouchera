import mongoose from 'mongoose';

// 404 + central error formatter. Never leaks stack traces in production.
export const notFound = (req, res, next) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  let status = err.status || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  // Normalize common Mongoose/Mongo errors
  if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err?.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `${field} already exists`;
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    message = `Invalid ${err.path}`;
  }

  if (status === 500 && process.env.NODE_ENV !== 'development') {
    message = 'Internal server error';
    details = undefined;
  }

  if (status >= 500) console.error('[api:error]', err);
  res.status(status).json({ error: message, ...(details ? { details } : {}) });
};
