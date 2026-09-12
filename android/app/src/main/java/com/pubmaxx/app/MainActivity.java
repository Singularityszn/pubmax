package com.pubmaxx.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WindowTheme.class);
        super.onCreate(savedInstanceState);
        if (bridge != null) bridge.setWebViewClient(new OfflineRetryWebViewClient(bridge));
    }
}
