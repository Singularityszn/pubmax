/**
 * PostHog volume knobs for the EU project. Tuned for the free tier at current
 * traffic (~60 visitors / month): session replay is sampled, product events stay
 * on the closed registry, and heatmaps ride PostHog's click capture (not DOM
 * autocapture of arbitrary elements).
 *
 * Operator docs: docs/analytics/POSTHOG_SAMPLING.md
 */

/** Fraction of consented browser sessions that record replay (0–1). */
export const POSTHOG_SESSION_RECORDING_SAMPLE_RATE = 0.1;
