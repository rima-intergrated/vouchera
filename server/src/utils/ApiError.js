export class ApiError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }

  static badRequest(msg = 'Bad request', details) {
    return new ApiError(400, msg, details);
  }

  static unauthorized(msg = 'Unauthorized') {
    return new ApiError(401, msg);
  }

  static forbidden(msg = 'Forbidden') {
    return new ApiError(403, msg);
  }

  static notFound(msg = 'Not found') {
    return new ApiError(404, msg);
  }

  static conflict(msg = 'Conflict') {
    return new ApiError(409, msg);
  }

  static notImplemented(msg = 'Not implemented') {
    return new ApiError(501, msg);
  }

  static badGateway(msg = 'Bad gateway') {
    return new ApiError(502, msg);
  }
}
