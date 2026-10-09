package com.pubmaxx.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.graphics.drawable.ColorDrawable;
import android.content.res.Configuration;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PageSystemBarsTest {
    @Test
    public void explicitPageThemePaintsBothWindowBandsAndSurvivesConfigurationChanges() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            applyAndAssert(scenario, "DARK", 0xFF0A0A0B);
            scenario.onActivity(activity -> {
                Configuration next = new Configuration(activity.getResources().getConfiguration());
                next.uiMode = (next.uiMode & ~Configuration.UI_MODE_NIGHT_MASK) | Configuration.UI_MODE_NIGHT_NO;
                activity.onConfigurationChanged(next);
            });
            scenario.onActivity(activity -> assertEquals(0xFF0A0A0B,
                ((ColorDrawable) activity.getWindow().getDecorView().getBackground()).getColor()));
            applyAndAssert(scenario, "LIGHT", 0xFFF8F2EC);
            applyAndAssert(scenario, "DARK", 0xFF0A0A0B);
        }
    }

    private void applyAndAssert(ActivityScenario<MainActivity> scenario, String style, int expected) throws Exception {
        CountDownLatch complete = new CountDownLatch(1);
        int[] actual = new int[1];
        scenario.onActivity(activity -> {
            JSObject options = new JSObject();
            options.put("style", style);
            PluginCall call = new PluginCall(null, "SystemBars", PluginCall.CALLBACK_ID_DANGLING, "setStyle", options) {
                @Override
                public void resolve() {
                    actual[0] = ((ColorDrawable) activity.getWindow().getDecorView().getBackground()).getColor();
                    complete.countDown();
                }
            };
            activity.getBridge().callPluginMethod("SystemBars", "setStyle", call);
        });
        assertTrue("SystemBars must resolve", complete.await(10, TimeUnit.SECONDS));
        assertEquals("Window bands must follow the page theme", expected, actual[0]);
    }
}
