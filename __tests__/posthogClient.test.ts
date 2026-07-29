import { describe, expect, it } from "vitest";
import type { CaptureResult } from "posthog-js";

import {
  posthogBrowserConfig,
  sanitizePosthogEvent,
} from "@/lib/posthogClient";

const UUID = "018f47a2-8e71-7a7a-9f18-8b953d45b2da";

describe("PostHog browser privacy boundary", () => {
  it("drops browser autocapture and unregistered custom events", () => {
    const event: CaptureResult = {
      uuid: UUID,
      event: "$autocapture",
      properties: {
        token: "phc_public",
        distinct_id: UUID,
        $current_url: "https://pubmaxxing.com/map?email=person@example.com",
      },
    };

    expect(sanitizePosthogEvent(event)).toBeNull();
    expect(sanitizePosthogEvent({
      ...event,
      event: "unregistered_product_event",
    })).toBeNull();
  });

  it("keeps standard device, screen, referrer, and campaign context on explicit pageviews", () => {
    const anonymousId = `anon_${UUID}`;
    const event: CaptureResult = {
      uuid: UUID,
      event: "$pageview",
      timestamp: new Date("2026-07-28T12:00:00.000Z"),
      properties: {
        token: "phc_public",
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $pubmaxx_anonymous_id: anonymousId,
        $pathname: "/map",
        $current_url: "https://pubmaxxing.com/map?utm_source=newsletter",
        $referrer: "https://example.com/pub-guide",
        $referring_domain: "example.com",
        $browser: "Safari",
        $browser_version: 18,
        $os: "Mac OS X",
        $os_version: "15.5",
        $device_type: "Desktop",
        $screen_width: 1512,
        $screen_height: 982,
        $viewport_width: 1280,
        $viewport_height: 820,
        utm_source: "newsletter",
        $set: { email: "person@example.com" },
        $set_once: { account_id: "supabase-user-id" },
        $screen_name: "person@example.com",
        account_id: "supabase-user-id",
      },
    };

    expect(sanitizePosthogEvent(event)).toEqual({
      uuid: UUID,
      event: "$pageview",
      timestamp: new Date("2026-07-28T12:00:00.000Z"),
      properties: {
        token: "phc_public",
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $pathname: "/map",
        $current_url: "https://pubmaxxing.com/map",
        $referrer: "https://example.com/pub-guide",
        $referring_domain: "example.com",
        $browser: "Safari",
        $browser_version: 18,
        $os: "Mac OS X",
        $os_version: "15.5",
        $device_type: "Desktop",
        $screen_width: 1512,
        $screen_height: 982,
        $viewport_width: 1280,
        $viewport_height: 820,
        utm_source: "newsletter",
      },
    });
  });

  it.each([
    ["/u/night_owl", "/u/[handle]"],
    ["/messages/private-thread", "/messages/[id]"],
    ["/rounds/secret-share-code", "/rounds/[code]"],
    ["/plan/6ab5ca40-836b-4970-9477-d1779fdd31ab", "/plan/[id]"],
  ])("coarsens dynamic pageview path %s before egress", (pathname, expected) => {
    const anonymousId = `anon_${UUID}`;
    const event: CaptureResult = {
      uuid: UUID,
      event: "$pageview",
      properties: {
        token: "phc_public",
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $pubmaxx_anonymous_id: anonymousId,
        $pathname: pathname,
      },
    };

    const sanitized = sanitizePosthogEvent(event);
    expect(sanitized?.properties.$pathname).toBe(expected);
    expect(JSON.stringify(sanitized)).not.toContain(pathname.split("/").at(-1));
  });

  it.each([
    "/map?sel=venue-secret#sheet",
    "/admin",
    "/admin/community-prices",
    "/unknown/private-value",
    "/u/night_owl%2Fprivate",
  ])("drops unsafe or unknown pageview path %s", (pathname) => {
    const anonymousId = `anon_${UUID}`;
    const event: CaptureResult = {
      uuid: UUID,
      event: "$pageview",
      properties: {
        token: "phc_public",
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $pubmaxx_anonymous_id: anonymousId,
        $pathname: pathname,
      },
    };

    expect(sanitizePosthogEvent(event)).toBeNull();
  });

  it("removes exception messages, stack traces, URLs, person props, and arbitrary context", () => {
    const anonymousId = `anon_${UUID}`;
    const event: CaptureResult = {
      uuid: UUID,
      event: "$exception",
      timestamp: new Date("2026-07-26T12:00:00.000Z"),
      properties: {
        token: "phc_public",
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $browser: "Chrome",
        $os: "Windows",
        $device_type: "Desktop",
        $screen_width: 1920,
        $screen_height: 1080,
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
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $browser: "Chrome",
        $os: "Windows",
        $device_type: "Desktop",
        $screen_width: 1920,
        $screen_height: 1080,
        $exception_list: [
          { type: "TypeError", value: "Redacted" },
          { type: "Error", value: "Redacted" },
        ],
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

  it("allows web vitals with standard device context", () => {
    const anonymousId = `anon_${UUID}`;
    const event: CaptureResult = {
      uuid: UUID,
      event: "$web_vitals",
      properties: {
        token: "phc_public",
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $browser: "Firefox",
        $os: "Linux",
        $device_type: "Desktop",
        $screen_width: 1440,
        $screen_height: 900,
        $pathname: "/map",
        $current_url: "https://pubmaxxing.com/map?memberToken=secret",
        $web_vitals_LCP_value: 1234,
        $web_vitals_LCP_event: {
          name: "LCP",
          value: 1234,
          rating: "good",
        },
      },
    };

    expect(sanitizePosthogEvent(event)).toEqual({
      ...event,
      properties: {
        ...event.properties,
        $current_url: "https://pubmaxxing.com/map",
      },
    });
  });

  it("seeds repeated SDK initializations from the same consent-created device id", () => {
    const anonymousId = `anon_${UUID}`;
    const values = new Map([["pubmaxx:analytics-id:v1", anonymousId]]);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
        },
      },
    });

    expect(posthogBrowserConfig.get_device_id?.("generated-first")).toBe(anonymousId);
    expect(posthogBrowserConfig.get_device_id?.("generated-after-reload")).toBe(anonymousId);

    delete (globalThis as { window?: unknown }).window;
  });

  it("enables standard product analytics while autocapture and recording stay off", () => {
    expect(posthogBrowserConfig).toMatchObject({
      api_host: "/ingest",
      ui_host: "https://eu.posthog.com",
      capture_exceptions: true,
      autocapture: false,
      rageclick: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: true,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_external_dependency_loading: false,
      request_batching: false,
      persistence: "localStorage+cookie",
      save_campaign_params: true,
      save_referrer: true,
      opt_in_site_apps: false,
      person_profiles: "always",
      advanced_disable_flags: true,
      opt_out_capturing_by_default: true,
      opt_out_persistence_by_default: true,
      respect_dnt: true,
    });
    expect(posthogBrowserConfig.before_send).toBe(sanitizePosthogEvent);
  });
});
