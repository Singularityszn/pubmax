import { describe, expect, it } from "vitest";
import type { CaptureResult } from "posthog-js";

import {
  posthogBrowserConfig,
  sanitizePosthogEvent,
} from "@/lib/posthogClient";

const UUID = "018f47a2-8e71-7a7a-9f18-8b953d45b2da";

describe("PostHog browser privacy boundary", () => {
  it("drops every browser SDK event outside exception autocapture", () => {
    const event: CaptureResult = {
      uuid: UUID,
      event: "$pageview",
      properties: {
        token: "phc_public",
        distinct_id: UUID,
        $current_url: "https://pubmaxxing.com/map?email=person@example.com",
      },
    };

    expect(sanitizePosthogEvent(event)).toBeNull();
  });

  it("removes exception messages, stack traces, URLs, person props, and arbitrary context", () => {
    const event: CaptureResult = {
      uuid: UUID,
      event: "$exception",
      timestamp: new Date("2026-07-26T12:00:00.000Z"),
      properties: {
        token: "phc_public",
        distinct_id: UUID,
        $device_id: UUID,
        $current_url: "https://pubmaxxing.com/map?token=secret",
        $exception_message: "Failed for person@example.com",
        $exception_list: [
          {
            type: "TypeError",
            value: "Account person@example.com failed",
            stacktrace: {
              frames: [
                {
                  filename: "https://pubmaxxing.com/private/person@example.com",
                  function: "load-person@example.com",
                },
              ],
            },
          },
          {
            type: "person@example.com",
            value: "secret",
          },
        ],
        account_id: "supabase-user-id",
        email: "person@example.com",
      },
      $set: { email: "person@example.com" },
    };

    expect(sanitizePosthogEvent(event)).toEqual({
      uuid: UUID,
      event: "$exception",
      timestamp: new Date("2026-07-26T12:00:00.000Z"),
      properties: {
        token: "phc_public",
        distinct_id: UUID,
        $device_id: UUID,
        $exception_list: [
          { type: "TypeError", value: "Redacted" },
          { type: "Error", value: "Redacted" },
        ],
        $process_person_profile: false,
      },
    });
  });

  it("drops exceptions without an SDK-generated anonymous distinct id", () => {
    const event: CaptureResult = {
      uuid: UUID,
      event: "$exception",
      properties: {
        token: "phc_public",
        distinct_id: "account-person@example.com",
        $exception_list: [{ type: "Error", value: "secret" }],
      },
    };

    expect(sanitizePosthogEvent(event)).toBeNull();
  });

  it("disables every automatic collection surface except scrubbed exceptions", () => {
    expect(posthogBrowserConfig).toMatchObject({
      api_host: "/ingest",
      ui_host: "https://eu.posthog.com",
      capture_exceptions: true,
      autocapture: false,
      rageclick: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_external_dependency_loading: false,
      request_batching: false,
      persistence: "memory",
      save_campaign_params: false,
      save_referrer: false,
      opt_in_site_apps: false,
      person_profiles: "never",
      advanced_disable_flags: true,
      opt_out_capturing_by_default: true,
      opt_out_persistence_by_default: true,
      respect_dnt: true,
    });
    expect(posthogBrowserConfig.before_send).toBe(sanitizePosthogEvent);
  });
});
