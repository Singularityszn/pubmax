import {
  accountBoundFetch,
  type AccountAuthSnapshot,
  type AccountBoundRequest,
} from "@/lib/accountBoundFetch";

export function submitRoundSpendRequest(
  code: string,
  auth: AccountAuthSnapshot | null,
  body: unknown,
  request: AccountBoundRequest = fetch,
): Promise<Response> {
  const input = `/api/rounds/${code}`;
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
  return auth
    ? accountBoundFetch(auth, input, init, request)
    : request(input, init);
}
