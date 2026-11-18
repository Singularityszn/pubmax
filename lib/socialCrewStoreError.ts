export class SocialCrewStoreError extends Error {
  constructor(
    public readonly code: "INVALID" | "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE",
    public readonly status: 400 | 404 | 409 | 422 | 503,
    message: string,
    /** A closed refusal word the page may act on, sent as `details.reason`. */
    public readonly reason?: string,
  ) {
    super(message);
  }
}
