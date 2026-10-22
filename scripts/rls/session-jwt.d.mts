/** Mint a short-lived JWT for the throwaway local RLS harness. */
export declare function createRlsSessionJwt(
  secret: string,
  sub: string,
  role?: string,
): string;
