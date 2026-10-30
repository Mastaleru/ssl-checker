// The errors the notary answers with: an HTTP status plus a protocol error code
// (the codes are listed in README.md).

export class NotaryError extends Error {
  constructor(status, code, message, headers = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export const errorBody = (code, message) => ({ version: 1, error: { code, message } });
