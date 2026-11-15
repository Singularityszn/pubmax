package com.pubmaxx.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class OutingStepsDeadlineTest {

    private static final long HOUR = 60L * 60L * 1000L;
    private static final long START = 1_794_000_000_000L;
    private static final String A = "11111111-1111-4111-8111-111111111111";
    private static final String B = "22222222-2222-4222-8222-222222222222";

    private long wall = START;
    private long elapsed = 5 * HOUR;
    private final OutingStepsDeadline deadline = new OutingStepsDeadline(() -> wall, () -> elapsed);

    @Test
    public void expiresTwelveHoursOfElapsedTimeAfterTheStartEvenThroughSleep() {
        assertEquals(OutingStepsDeadline.Verdict.OK, deadline.admit(START, START, A));
        elapsed += 12 * HOUR - 1;
        assertFalse(deadline.expired());
        elapsed += 1;
        assertTrue(deadline.expired());
        wall += 2 * HOUR;
        assertEquals(OutingStepsDeadline.Verdict.EXPIRED, deadline.admit(START, START + HOUR, A));
    }

    @Test
    public void aWallClockMovedBackCannotExtendAnArmedSession() {
        deadline.admit(START, START, A);
        elapsed += 11 * HOUR;
        wall = START + HOUR;
        assertEquals(OutingStepsDeadline.Verdict.OK, deadline.admit(START, START + HOUR, A));
        elapsed += HOUR;
        assertTrue(deadline.expired());
        assertEquals(OutingStepsDeadline.Verdict.EXPIRED, deadline.admit(START, START + HOUR, A));
    }

    @Test
    public void anExpiredSessionStaysExpiredAfterReleaseEvenWithTheWallClockMovedBack() {
        deadline.admit(START, START, A);
        elapsed += 12 * HOUR;
        assertTrue(deadline.expired());
        deadline.expire();
        assertFalse(deadline.armed());
        wall = START + HOUR;
        assertEquals(OutingStepsDeadline.Verdict.EXPIRED, deadline.admit(START, START + HOUR, A));
        assertFalse(deadline.armed());
    }

    @Test
    public void expiredSessionRemainsExpiredWhenWallClockMovesBeforeStart() {
        deadline.admit(START, START, A);
        elapsed += 12 * HOUR;
        wall = START - HOUR;
        assertEquals(OutingStepsDeadline.Verdict.EXPIRED, deadline.admit(START, START, A));
        deadline.expire();
        assertEquals(OutingStepsDeadline.Verdict.EXPIRED, deadline.admit(START, START, A));
    }

    @Test
    public void onlyTheArmedSessionOwnsTheListener() {
        assertFalse(deadline.owns(A));
        deadline.admit(START, START, A);
        elapsed += HOUR;
        wall += HOUR;
        deadline.admit(wall, wall, B);
        assertFalse(deadline.owns(A));
        assertTrue(deadline.owns(B));
        deadline.disarm();
        assertFalse(deadline.owns(B));
    }

    @Test
    public void twoSessionsStartedOnTheSameMillisecondAreStillTwoSessions() {
        deadline.admit(START, START, A);
        assertEquals(OutingStepsDeadline.Verdict.OK, deadline.admit(START, START, B));
        assertFalse(deadline.owns(A));
        assertTrue(deadline.owns(B));
        elapsed += 12 * HOUR;
        wall += 2 * HOUR;
        deadline.expire();
        assertEquals(OutingStepsDeadline.Verdict.EXPIRED, deadline.admit(START, START + HOUR, B));
    }

    @Test
    public void refusesAMissingOrMalformedSession() {
        assertEquals(OutingStepsDeadline.Verdict.INVALID, deadline.admit(START, START, null));
        assertEquals(OutingStepsDeadline.Verdict.INVALID, deadline.admit(START, START, ""));
        assertEquals(OutingStepsDeadline.Verdict.INVALID, deadline.admit(START, START, "short"));
        assertFalse(deadline.owns(null));
        assertFalse(deadline.armed());
    }

    @Test
    public void armsOnlyTheTimeLeftWhenTheListenerStartsLate() {
        wall = START + 11 * HOUR;
        assertEquals(OutingStepsDeadline.Verdict.OK, deadline.admit(START, wall, A));
        assertEquals(HOUR, deadline.remainingMs());
        elapsed += HOUR;
        assertTrue(deadline.expired());
    }

    @Test
    public void refusesAWindowWhoseTwelveHoursHavePassed() {
        wall = START + 12 * HOUR;
        assertEquals(OutingStepsDeadline.Verdict.EXPIRED, deadline.admit(START, START + 12 * HOUR, A));
        assertFalse(deadline.armed());
    }

    @Test
    public void refusesAMalformedWindow() {
        assertEquals(OutingStepsDeadline.Verdict.INVALID, deadline.admit(START, START - 1, A));
        assertEquals(OutingStepsDeadline.Verdict.INVALID, deadline.admit(START - 13 * HOUR, START, A));
        assertEquals(OutingStepsDeadline.Verdict.INVALID, deadline.admit(START + HOUR, START + HOUR, A));
        assertEquals(OutingStepsDeadline.Verdict.INVALID, deadline.admit(0, 0, A));
        assertFalse(deadline.armed());
    }

    @Test
    public void aNewSessionRearmsAndDisarmForgetsTheOldOne() {
        deadline.admit(START, START, A);
        elapsed += 2 * HOUR;
        wall += 2 * HOUR;
        assertEquals(OutingStepsDeadline.Verdict.INVALID, deadline.admit(wall, wall, A));
        assertEquals(OutingStepsDeadline.Verdict.OK, deadline.admit(wall, wall, B));
        assertEquals(12 * HOUR, deadline.remainingMs());
        deadline.disarm();
        assertFalse(deadline.armed());
        assertFalse(deadline.expired());
    }
}
