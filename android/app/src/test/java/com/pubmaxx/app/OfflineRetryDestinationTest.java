package com.pubmaxx.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class OfflineRetryDestinationTest {
    private static final String ORIGIN = "https://pubmaxxing.com";
    private static final String ERROR_PAGE = "https://localhost/offline.html";
    private static final String VENUE = ORIGIN + "/map?sel=venue-122cuu1#overview";

    private OfflineRetryDestination policy() {
        return new OfflineRetryDestination(ORIGIN, ERROR_PAGE);
    }

    @Test
    public void retryRestoresTheFailedVenueIncludingItsQueryAndFragment() {
        OfflineRetryDestination policy = policy();
        policy.recordFailure(VENUE, true);
        assertEquals(VENUE, policy.retryTarget(ERROR_PAGE, ORIGIN, true));
    }

    @Test
    public void retryAlsoRestoresAnAreaOrPlanDestination() {
        for (String path : new String[] { "/near?patch=soho", "/plan/example#stops" }) {
            OfflineRetryDestination policy = policy();
            policy.recordFailure(ORIGIN + path, true);
            assertEquals(ORIGIN + path, policy.retryTarget(ERROR_PAGE, ORIGIN, true));
        }
    }

    @Test
    public void retryIsLimitedToTheErrorDocumentAndItsMainFrameButtonNavigation() {
        OfflineRetryDestination policy = policy();
        policy.recordFailure(VENUE, true);
        assertNull(policy.retryTarget(VENUE, ORIGIN, true));
        assertNull(policy.retryTarget(ERROR_PAGE + "?other=1", ORIGIN, true));
        assertNull(policy.retryTarget(ERROR_PAGE, ORIGIN + "/out", true));
        assertNull(policy.retryTarget(ERROR_PAGE, ORIGIN, false));
        assertEquals(VENUE, policy.retryTarget(ERROR_PAGE, ORIGIN, true));
    }

    @Test
    public void subresourceFailureDoesNotReplaceTheMainFrameDestination() {
        OfflineRetryDestination policy = policy();
        policy.recordFailure(VENUE, true);
        policy.recordFailure(ORIGIN + "/tile.png", false);
        assertEquals(VENUE, policy.retryTarget(ERROR_PAGE, ORIGIN, true));
    }

    @Test
    public void missingOrConsumedDestinationUsesTheConfiguredRoot() {
        OfflineRetryDestination policy = policy();
        assertEquals(ORIGIN + "/", policy.retryTarget(ERROR_PAGE, ORIGIN, true));
        policy.recordFailure(VENUE, true);
        assertEquals(VENUE, policy.retryTarget(ERROR_PAGE, ORIGIN, true));
        assertEquals(ORIGIN + "/", policy.retryTarget(ERROR_PAGE, ORIGIN, true));
    }

    @Test
    public void aRepeatedOfflineFailureCanBeRetriedAgain() {
        OfflineRetryDestination policy = policy();
        policy.recordFailure(VENUE, true);
        assertEquals(VENUE, policy.retryTarget(ERROR_PAGE, ORIGIN, true));
        policy.recordFailure(VENUE, true);
        assertEquals(VENUE, policy.retryTarget(ERROR_PAGE, ORIGIN, true));
    }

    @Test
    public void startingAnotherNavigationClearsTheOldFailure() {
        OfflineRetryDestination policy = policy();
        policy.recordFailure(VENUE, true);
        policy.pageStarted(ORIGIN + "/tonight");
        assertEquals(ORIGIN + "/", policy.retryTarget(ERROR_PAGE, ORIGIN, true));
    }

    @Test
    public void loadingTheErrorDocumentKeepsTheFailureAvailable() {
        OfflineRetryDestination policy = policy();
        policy.recordFailure(VENUE, true);
        policy.pageStarted(ERROR_PAGE);
        assertEquals(VENUE, policy.retryTarget(ERROR_PAGE, ORIGIN, true));
    }

    @Test
    public void anHttpErrorCommitDoesNotDiscardTheFailedDestination() {
        OfflineRetryDestination policy = policy();
        String requestUrl = ORIGIN + "/map?sel=venue-122cuu1";
        policy.pageStarted(VENUE);
        policy.recordFailure(requestUrl, true);
        policy.pageStarted(requestUrl);
        policy.pageStarted(ERROR_PAGE);
        assertEquals(VENUE, policy.retryTarget(ERROR_PAGE, ORIGIN, true));
    }

    @Test
    public void aFailureAtAnotherDocumentNeverBorrowsThePreviousFragment() {
        OfflineRetryDestination policy = policy();
        policy.pageStarted(VENUE);
        policy.recordFailure(ORIGIN + "/near?patch=soho", true);
        policy.pageStarted(ORIGIN + "/near?patch=soho");
        policy.pageStarted(ERROR_PAGE);
        assertEquals(ORIGIN + "/near?patch=soho", policy.retryTarget(ERROR_PAGE, ORIGIN, true));
    }

    @Test
    public void strippedRequestFragmentsCannotHideCallbackCredentials() {
        OfflineRetryDestination policy = policy();
        policy.pageStarted(ORIGIN + "/map#access_token=secret");
        policy.recordFailure(ORIGIN + "/map", true);
        policy.pageStarted(ERROR_PAGE);
        assertEquals(ORIGIN + "/", policy.retryTarget(ERROR_PAGE, ORIGIN, true));
    }

    @Test
    public void untrustedMainFrameFailureCannotReplayAnEarlierVenue() {
        for (String url : new String[] {
            "https://pubmaxxing.com.evil.example/map",
            "https://evil.example/map",
            "https://pubmaxxing.com:444/map",
            "http://pubmaxxing.com/map",
            "https://person:secret@pubmaxxing.com/map",
            "javascript:alert(1)",
            "file:///map",
            "https://pubmaxxing.com/%",
            ERROR_PAGE
        }) {
            OfflineRetryDestination policy = policy();
            policy.recordFailure(VENUE, true);
            policy.recordFailure(url, true);
            assertEquals(ORIGIN + "/", policy.retryTarget(ERROR_PAGE, ORIGIN, true));
        }
    }

    @Test
    public void callbackAndCredentialUrlsAreNeverRetainedForReplay() {
        for (String path : new String[] {
            "/auth/callback",
            "/auth/callback?code=secret",
            "/login?code=secret",
            "/map?access_token=secret",
            "/map?refresh_token=secret",
            "/map?token_hash=secret",
            "/map?%63ode=secret",
            "/map?CODE=secret",
            "/map#access_token=secret&refresh_token=secret",
            "/map#error_description=private",
            "/map?provider_token=secret",
            "/map?provider_refresh_token=secret",
            "/map?id_token=secret",
            "/map?authorization_code=secret"
        }) {
            OfflineRetryDestination policy = policy();
            policy.recordFailure(ORIGIN + path, true);
            assertEquals(ORIGIN + "/", policy.retryTarget(ERROR_PAGE, ORIGIN, true));
        }
    }

    @Test
    public void localReviewBuildRetriesOnlyItsConfiguredOrigin() {
        String local = "http://10.0.2.2:3811";
        OfflineRetryDestination policy = new OfflineRetryDestination(local, ERROR_PAGE);
        policy.recordFailure(local + "/map?sel=example", true);
        assertEquals(local + "/map?sel=example", policy.retryTarget(ERROR_PAGE, ORIGIN, true));
        policy.recordFailure("http://10.0.2.2:3812/map", true);
        assertEquals(local + "/", policy.retryTarget(ERROR_PAGE, ORIGIN, true));
    }

    @Test
    public void defaultHttpsPortAndHostnameCaseStillIdentifyTheSameOrigin() {
        OfflineRetryDestination policy = policy();
        String destination = "https://PUBMAXXING.COM:443/map?sel=example";
        policy.recordFailure(destination, true);
        assertEquals(destination, policy.retryTarget(ERROR_PAGE, ORIGIN + "/", true));
    }
}
