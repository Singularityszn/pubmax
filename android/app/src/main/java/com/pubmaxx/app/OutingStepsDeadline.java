package com.pubmaxx.app;

import java.util.function.LongSupplier;

final class OutingStepsDeadline {

    enum Verdict {
        OK,
        INVALID,
        EXPIRED
    }

    static final long MAX_SPAN_MS = 12L * 60L * 60L * 1000L;
    private static final long CLOCK_SLACK_MS = 60_000L;

    private final LongSupplier wallClock;
    private final LongSupplier elapsedClock;
    private boolean armed;
    private long since;
    private long deadlineElapsed;
    private long expiredSince;

    OutingStepsDeadline(LongSupplier wallClock, LongSupplier elapsedClock) {
        this.wallClock = wallClock;
        this.elapsedClock = elapsedClock;
    }

    Verdict admit(long windowSince, long windowUntil) {
        long now = wallClock.getAsLong();
        if (windowSince <= 0 || windowUntil < windowSince || windowUntil - windowSince > MAX_SPAN_MS
            || windowSince > now + CLOCK_SLACK_MS || windowUntil > now + CLOCK_SLACK_MS) {
            return Verdict.INVALID;
        }
        if (windowSince == expiredSince) return Verdict.EXPIRED;
        if (armed && windowSince == since) return expired() ? Verdict.EXPIRED : Verdict.OK;
        long remaining = windowSince + MAX_SPAN_MS - now;
        if (remaining <= 0) {
            expiredSince = windowSince;
            disarm();
            return Verdict.EXPIRED;
        }
        armed = true;
        since = windowSince;
        deadlineElapsed = elapsedClock.getAsLong() + Math.min(remaining, MAX_SPAN_MS);
        return Verdict.OK;
    }

    boolean armed() {
        return armed;
    }

    boolean expired() {
        return armed && elapsedClock.getAsLong() >= deadlineElapsed;
    }

    long remainingMs() {
        return armed ? Math.max(0L, deadlineElapsed - elapsedClock.getAsLong()) : 0L;
    }

    void expire() {
        if (armed) expiredSince = since;
        disarm();
    }

    void disarm() {
        armed = false;
        since = 0L;
        deadlineElapsed = 0L;
    }
}
