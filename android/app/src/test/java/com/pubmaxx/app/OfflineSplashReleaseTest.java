package com.pubmaxx.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * Android serves the offline page without the Capacitor bridge, so the page
 * cannot hide the splash and MainActivity does it. It must hide the splash for
 * that page only: a release on the app's own page would lift the mark before
 * the page has painted.
 */
public class OfflineSplashReleaseTest {

    private static final String ERROR_URL = "https://localhost/offline.html";

    private int hides;

    private OfflineSplashRelease releaseWithErrorUrl(String errorUrl) {
        return new OfflineSplashRelease(() -> errorUrl, () -> hides++);
    }

    @Test
    public void hidesTheSplashWhenTheErrorPageLoads() {
        releaseWithErrorUrl(ERROR_URL).onPageLoaded(ERROR_URL);
        assertEquals(1, hides);
    }

    @Test
    public void leavesTheSplashWhenTheAppPageLoads() {
        OfflineSplashRelease release = releaseWithErrorUrl(ERROR_URL);
        release.onPageLoaded("https://pubmaxxing.com/tonight");
        release.onPageLoaded("https://localhost/");
        release.onPageLoaded(null);
        assertEquals(0, hides);
    }

    @Test
    public void leavesTheSplashWhenTheShellHasNoErrorPage() {
        releaseWithErrorUrl(null).onPageLoaded(ERROR_URL);
        assertEquals(0, hides);
    }
}
