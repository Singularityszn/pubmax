package com.pubmaxx.app;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    /**
     * THE OFFLINE PAGE CANNOT RELEASE THE SPLASH ON ANDROID, SO THE SHELL DOES.
     *
     * The launch splash stands until a page paints (lib/nativeSplash.ts) or its
     * 12s ceiling. When the first load cannot reach the origin, Capacitor loads
     * its errorPath page, native/web-stub/offline.html, from https://localhost.
     * On Android that page gets no bridge: Capacitor injects its script only for
     * the app URL's origin, so window.Capacitor is undefined there (measured
     * over the WebView DevTools socket on 13 September 2026) and the page's own
     * SplashScreen.hide() reaches nothing. iOS gives the page the bridge.
     *
     * So once the error page has loaded, the shell releases the splash itself.
     *
     * The same page's "Try again" goes to the site root, which would drop the
     * reader's destination. OfflineRetryWebViewClient remembers the one failed
     * main-frame URL and sends the retry back to it.
     */
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) return;
        bridge.setWebViewClient(new OfflineRetryWebViewClient(bridge));
        OfflineSplashRelease release = new OfflineSplashRelease(
            bridge::getErrorUrl,
            () -> bridge.callPluginMethod("SplashScreen", "hide", new ShellCall("SplashScreen", "hide"))
        );
        bridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    release.onPageLoaded(webView.getUrl());
                }
            }
        );
    }

    /**
     * A plugin call the shell makes itself. No page is waiting on its answer and
     * the bridge exposes no response handler, so the answer goes nowhere.
     */
    private static final class ShellCall extends PluginCall {

        ShellCall(String pluginId, String methodName) {
            super(null, pluginId, PluginCall.CALLBACK_ID_DANGLING, methodName, new JSObject());
        }

        @Override
        public void resolve() {}

        @Override
        public void resolve(JSObject data) {}

        @Override
        public void errorCallback(String msg) {}
    }
}
