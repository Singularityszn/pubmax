package com.pubmaxx.app;

import android.graphics.Bitmap;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import org.json.JSONObject;

final class OfflineRetryWebViewClient extends BridgeWebViewClient {
    private final OfflineRetryDestination destination;

    OfflineRetryWebViewClient(Bridge bridge) {
        super(bridge);
        destination = new OfflineRetryDestination(bridge.getServerUrl(), bridge.getErrorUrl());
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        destination.recordFailure(request.getUrl().toString(), request.isForMainFrame());
        super.onReceivedError(view, request, error);
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        // Capacitor replaces every main-frame HTTP error with its error page.
        // Keep the site's response for errors a retry cannot fix, such as 404.
        if (destination.recordHttpFailure(request.getUrl().toString(), request.isForMainFrame(), response.getStatusCode())) {
            super.onReceivedHttpError(view, request, response);
        }
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        String target = destination.retryTarget(view.getUrl(), request.getUrl().toString(), request.isForMainFrame());
        if (target == null) return super.shouldOverrideUrlLoading(view, request);
        view.evaluateJavascript("location.replace(" + JSONObject.quote(target) + ")", null);
        return true;
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        // A failed document can still commit before Capacitor opens the error page.
        destination.pageStarted(url);
        super.onPageStarted(view, url, favicon);
    }
}
