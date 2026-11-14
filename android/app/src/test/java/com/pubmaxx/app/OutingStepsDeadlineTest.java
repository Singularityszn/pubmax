package com.pubmaxx.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class OutingStepsDeadlineTest {

    private static final long HOUR = 60L * 60L * 1000L;
    private static final long START = 1_794_000_000_000L;

    private long wall = START;
    private long elapsed = 5 * HOUR;
    private final OutingStepsDeadline deadline = new OutingStepsDeadline(() -> wall, () -> elapsed);

    @Test
    public void expiresTwelveHoursOfElapsedTimeAfterTheStartEvenThroughSleep() {
        assertEquals(OutingStepsDeadline.Verdict.OK, deadline.admit(START, START));
        elapsed += 12 * HOUR - 1;
        assertFalse(deadline.expired());
        elapsed += 1;
        assertTrue(deadline.expired());
        wall += 2 * HOUR;
        assertEquals(OutingStepsDeadline.Verdict.EXPIRED, deadline.admit(START, START + HOUR));
    }

    @Test
    public void aWallClockMovedBackCannotExtendAnArmedSession() {
        deadline.admit(START, START);
        elapsed += 11 * HOUR;
        wall = START + HOUR;
        assertEquals(OutingStepsDeadline.Verdict.OK, deadline.admit(START, START + HOUR));
        elapsed += HOUR;
        assertTrue(deadline.expired());
        assertEquals(OutingStepsDeadline.Verdict.EXPIRED, deadline.admit(START, START + HOUR));
    }

    @Test
    public void anExpiredSessionStaysExpiredAfterReleaseEvenWithTheWallClockMovedBack() {
        deadline.admit(START, START);
        elapsed += 12 * HOUR;
        assertTrue(deadline.expired());
        deadline.expire();
        assertFalse(deadline.armed());
        wall = START + HOUR;
        assertEquals(OutingStepsDeadline.Verdict.EXPIRED, deadline.admit(START, START + HOUR));
        assertFalse(deadline.armed());
    }

    @Test
    public void armsOnlyTheTimeLeftWhenTheListenerStartsLate() {
        wall = START + 11 * HOUR;
        assertEquals(OutingStepsDeadline.Verdict.OK, deadline.admit(START, wall));
        assertEquals(HOUR, deadline.remainingMs());
        elapsed += HOUR;
        assertTrue(deadline.expired());
    }

    @Test
    public void refusesAWindowWhoseTwelveHoursHavePassed() {
        wall = START + 12 * HOUR;
        assertEquals(OutingStepsDeadline.Verdict.EXPIRED, deadline.admit(START, START + 12 * HOUR));
        assertFalse(deadline.armed());
    }

    @Test
    public void refusesAMalformedWindow() {
        assertEquals(OutingStepsDeadline.Verdict.INVALID, deadline.admit(START, START - 1));
        assertEquals(OutingStepsDeadline.Verdict.INVALID, deadline.admit(START - 13 * HOUR, START));
        assertEquals(OutingStepsDeadline.Verdict.INVALID, deadline.admit(START + HOUR, START + HOUR));
        assertEquals(OutingStepsDeadline.Verdict.INVALID, deadline.admit(0, 0));
        assertFalse(deadline.armed());
    }

    @Test
    public void aNewSessionRearmsAndDisarmForgetsTheOldOne() {
        deadline.admit(START, START);
        elapsed += 2 * HOUR;
        wall += 2 * HOUR;
        assertEquals(OutingStepsDeadline.Verdict.OK, deadline.admit(wall, wall));
        assertEquals(12 * HOUR, deadline.remainingMs());
        deadline.disarm();
        assertFalse(deadline.armed());
        assertFalse(deadline.expired());
    }
}
