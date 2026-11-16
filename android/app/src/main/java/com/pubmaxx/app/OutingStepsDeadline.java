package com.pubmaxx.app;

import java.util.function.LongSupplier;
import java.util.regex.Pattern;

final class OutingStepsDeadline {

    enum Verdict {
        OK,
        INVALID,
        EXPIRED
    }

    static final long MAX_SPAN_MS = 12L * 60L * 60L * 1000L;
    private static final long CLOCK_SLACK_MS = 60_000L;
    private static final Pattern SESSION = Pattern.compile("[A-Za-z0-9-]{16,64}");

    private final LongSupplier wallClock;
    private final LongSupplier elapsedClock;
    private boolean armed;
    private long since;
    private String session;
    private long deadlineElapsed;
    private String expiredSession;

    OutingStepsDeadline(LongSupplier wallClock, LongSupplier elapsedClock) {
        this.wallClock = wallClock;
        this.elapsedClock = elapsedClock;
    }

    static boolean validSession(String value) {
        return value != null && SESSION.matcher(value).matches();
    }

    Verdict admit(long windowSince, long windowUntil, String windowSession) {
        long now = wallClock.getAsLong();
        if (!validSession(windowSession) || windowSince <= 0 || windowUntil < windowSince || windowUntil - windowSince > MAX_SPAN_MS) {
            return Verdict.INVALID;
        }
        if (windowSession.equals(expiredSession)) return Verdict.EXPIRED;
        if (armed && windowSession.equals(session)) {
            if (windowSince != since) return Verdict.INVALID;
            if (expired()) return Verdict.EXPIRED;
        }
        if (windowSince > now + CLOCK_SLACK_MS || windowUntil > now + CLOCK_SLACK_MS) return Verdict.INVALID;
        if (armed && windowSession.equals(session)) return Verdict.OK;
        long remaining = windowSince + MAX_SPAN_MS - now;
        if (remaining <= 0) {
            expiredSession = windowSession;
            return Verdict.EXPIRED;
        }
        armed = true;
        since = windowSince;
        session = windowSession;
        deadlineElapsed = elapsedClock.getAsLong() + Math.min(remaining, MAX_SPAN_MS);
        return Verdict.OK;
    }

    boolean armed() {
        return armed;
    }

    boolean owns(String windowSession) {
        return armed && windowSession != null && windowSession.equals(session);
    }

    boolean expired() {
        return armed && elapsedClock.getAsLong() >= deadlineElapsed;
    }

    long remainingMs() {
        return armed ? Math.max(0L, deadlineElapsed - elapsedClock.getAsLong()) : 0L;
    }

    void expire() {
        if (armed) expiredSession = session;
        disarm();
    }

    void disarm() {
        armed = false;
        since = 0L;
        session = null;
        deadlineElapsed = 0L;
    }
}
