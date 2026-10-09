package com.pubmaxx.app;

import android.content.Context;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.plugin.SystemBars;

/** Keep Capacitor's inset handling, but paint its window bands with the page theme. */
@CapacitorPlugin(name = "SystemBars")
public class PageSystemBars extends SystemBars {
    private String pageStyle = "DEFAULT";

    @Override
    @PluginMethod
    public void setStyle(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            pageStyle = call.getString("style", "DEFAULT");
            super.setStyle(call);
        });
    }

    @Override
    public int getThemeColor(Context context, int attribute) {
        if (attribute == android.R.attr.windowBackground) {
            if ("DARK".equals(pageStyle)) return context.getColor(R.color.pubmaxx_page_dark);
            if ("LIGHT".equals(pageStyle)) return context.getColor(R.color.pubmaxx_page_light);
        }
        return super.getThemeColor(context, attribute);
    }
}
