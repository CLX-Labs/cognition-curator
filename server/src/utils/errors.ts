export class NotFoundError extends Error {
  status = 404;
  code = 'not_found';
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends Error {
  status = 400;
  code = 'bad_request';
  constructor(message = 'Bad request') {
    super(message);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends Error {
  status = 401;
  code = 'unauthorized';
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  status = 403;
  code = 'forbidden';
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}
