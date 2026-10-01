"use client";

import { useEffect, useRef, useState } from "react";

import { errorMessageFrom, offlineOrMessage } from "@/lib/apiErrorMessage";
import { normalizeHandle } from "@/lib/handleNormalize";
import { discardBody } from "@/lib/responseBody";

export type MessageRecipient = {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
};

type SearchState = {
  revision: number;
  matches: MessageRecipient[];
  error: string;
};

const SEARCH_FAILURE = "Couldn't search people. Try again.";

/** Only public profile fields enter the picker. */
export function recipientRows(value: unknown, viewer: string): MessageRecipient[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set([viewer]);
  const rows: MessageRecipient[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as Record<string, unknown>;
    const handle = normalizeHandle(row.handle);
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    rows.push({
      handle,
      ...(typeof row.displayName === "string" ? { displayName: row.displayName } : {}),
      ...(typeof row.avatarUrl === "string" ? { avatarUrl: row.avatarUrl } : {}),
    });
  }
  return rows;
}

export function useMessageRecipientSearch(viewer: string) {
  const [input, setInput] = useState({ query: "", revision: 0 });
  const [answer, setAnswer] = useState<SearchState | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const { query, revision } = input;
  const prefix = normalizeHandle(query);

  useEffect(() => {
    if (prefix.length < 2) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    let live = true;
    const publish = (matches: MessageRecipient[], error: string) => {
      if (live && !controller.signal.aborted) {
        setAnswer({ revision, matches, error });
      }
    };
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/profiles/search?q=${encodeURIComponent(prefix)}`,
            { cache: "no-store", signal: controller.signal },
          );
          if (!live || controller.signal.aborted) {
            discardBody(response);
            return;
          }
          const body: unknown = await response.json().catch(() => null);
          if (!response.ok) {
            publish([], offlineOrMessage(errorMessageFrom(body, SEARCH_FAILURE)));
            return;
          }
          if (!body || typeof body !== "object" ||
              !Array.isArray((body as { matches?: unknown }).matches)) {
            publish([], SEARCH_FAILURE);
            return;
          }
          publish(recipientRows((body as { matches: unknown }).matches, viewer), "");
        } catch {
          publish([], offlineOrMessage(SEARCH_FAILURE));
        }
      })();
    }, 220);
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [prefix, revision, viewer]);

  const current = answer?.revision === revision ? answer : null;
  const status = prefix.length < 2 ? "idle" : !current ? "loading" :
    current.error ? "error" : "ready";
  return {
    query,
    prefix,
    status,
    matches: current?.matches ?? [],
    error: current?.error ?? "",
    changeQuery: (value: string) => setInput((previous) => ({
      query: value,
      revision: previous.revision + 1,
    })),
    retry: () => setInput((previous) => ({
      ...previous,
      revision: previous.revision + 1,
    })),
    abort: () => controllerRef.current?.abort(),
  };
}
