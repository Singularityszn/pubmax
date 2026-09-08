package com.pubmaxx.app;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Arrays;
import java.util.List;

/** Holds one failed document in memory. Callback credentials must never be replayed. */
final class OfflineRetryDestination {
    private static final URI RETRY_BUTTON = URI.create("https://pubmaxxing.com/");
    private static final List<String> CREDENTIAL_KEYS = Arrays.asList(
        "code", "access_token", "refresh_token", "id_token", "token", "token_hash",
        "authorization_code", "provider_token", "provider_refresh_token", "error_description"
    );
    private final URI origin;
    private final String root;
    private final String errorPage;
    private String failedDestination;

    OfflineRetryDestination(String serverUrl, String errorPage) {
        origin = parse(serverUrl);
        root = origin == null ? RETRY_BUTTON.toString() : origin.resolve("/").toString();
        this.errorPage = errorPage;
    }

    void recordFailure(String url, boolean mainFrame) {
        if (mainFrame) failedDestination = isSafe(url) ? url : null;
    }

    String retryTarget(String currentUrl, String requestedUrl, boolean mainFrame) {
        URI requested = parse(requestedUrl);
        if (!mainFrame || errorPage == null || !errorPage.equals(currentUrl)
            || !sameOrigin(RETRY_BUTTON, requested) || !isRoot(requested)) return null;
        String target = failedDestination == null ? root : failedDestination;
        failedDestination = null;
        return target;
    }

    void pageStarted(String url) {
        if (errorPage == null || !errorPage.equals(url)) failedDestination = null;
    }

    private boolean isSafe(String url) {
        URI candidate = parse(url);
        if (!sameOrigin(origin, candidate) || url.equals(errorPage)) return false;
        String path = candidate.normalize().getPath().toLowerCase(Locale.ROOT);
        if (path.equals("/auth/callback") || path.startsWith("/auth/callback/")) return false;
        return !hasCredential(candidate.getRawQuery()) && !hasCredential(candidate.getRawFragment());
    }

    private static boolean hasCredential(String parameters) {
        if (parameters == null) return false;
        for (String parameter : parameters.split("[&;]")) {
            String key = parameter.split("=", 2)[0];
            try {
                key = URLDecoder.decode(key, StandardCharsets.UTF_8.name()).toLowerCase(Locale.ROOT);
            } catch (java.io.UnsupportedEncodingException | IllegalArgumentException error) {
                return true;
            }
            if (CREDENTIAL_KEYS.contains(key)) return true;
        }
        return false;
    }

    private static boolean isRoot(URI url) {
        return (url.getPath().isEmpty() || url.getPath().equals("/"))
            && url.getRawQuery() == null && url.getRawFragment() == null;
    }

    private static boolean sameOrigin(URI left, URI right) {
        return left != null && right != null
            && left.getScheme().equalsIgnoreCase(right.getScheme())
            && left.getHost().equalsIgnoreCase(right.getHost()) && port(left) == port(right);
    }

    private static int port(URI url) {
        return url.getPort() >= 0 ? url.getPort() : (url.getScheme().equalsIgnoreCase("https") ? 443 : 80);
    }

    private static URI parse(String value) {
        if (value == null) return null;
        try {
            URI url = new URI(value);
            if (url.getHost() == null || url.getRawUserInfo() != null
                || !("https".equalsIgnoreCase(url.getScheme()) || "http".equalsIgnoreCase(url.getScheme()))) return null;
            return url;
        } catch (URISyntaxException error) {
            return null;
        }
    }
}
