package com.pubmaxx.app;

import java.util.function.Supplier;

/**
 * Releases the launch splash when the page that loaded is Capacitor's error
 * page, native/web-stub/offline.html. Any other page leaves the splash to
 * lib/nativeSplash.ts or to its 12s ceiling.
 */
final class OfflineSplashRelease {

    private final Supplier<String> errorUrl;
    private final Runnable hideSplash;

    OfflineSplashRelease(Supplier<String> errorUrl, Runnable hideSplash) {
        this.errorUrl = errorUrl;
        this.hideSplash = hideSplash;
    }

    void onPageLoaded(String loadedUrl) {
        String error = errorUrl.get();
        if (error == null || loadedUrl == null || !loadedUrl.equals(error)) return;
        hideSplash.run();
    }
}
