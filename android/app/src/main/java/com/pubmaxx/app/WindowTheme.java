package com.pubmaxx.app;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.drawable.ColorDrawable;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WindowTheme")
public class WindowTheme extends Plugin {
    private String theme;

    @PluginMethod
    public void setTheme(PluginCall call) {
        String requested = call.getString("theme");
        if (!"light".equals(requested) && !"dark".equals(requested)) {
            call.reject("Unknown theme.");
            return;
        }
        getBridge().executeOnMainThread(() -> {
            theme = requested;
            applyTheme();
            call.resolve();
        });
    }

    @Override
    protected void handleOnConfigurationChanged(Configuration configuration) {
        super.handleOnConfigurationChanged(configuration);
        if (theme != null) applyTheme();
    }

    private void applyTheme() {
        Configuration configuration = new Configuration(getContext().getResources().getConfiguration());
        int mode = "dark".equals(theme) ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO;
        configuration.uiMode = (configuration.uiMode & ~Configuration.UI_MODE_NIGHT_MASK) | mode;
        Context themed = getContext().createConfigurationContext(configuration);
        int color = themed.getColor(R.color.pubmaxx_window_background);
        getActivity().getWindow().setBackgroundDrawable(new ColorDrawable(color));
    }
}
