export type XianErrorCode =
  | "INVALID_USER"
  | "ACCOUNT_DISABLED"
  | "LOGIN_EXPIRED"
  | "INVALID_NONCE"
  | "SYSTEM_ERROR";

export class XianApiError extends Error {
  constructor(
    public readonly code: XianErrorCode,
    message?: string,
  ) {
    super(message || code);
  }
}
