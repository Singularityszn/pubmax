package com.pubmaxx.app;

import android.Manifest;
import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/**
 * Reads the hardware step counter, which counts from zero at each boot. The
 * listener stays registered between readings because some phones only count
 * while a listener is active. A reading reports whether this listener ran
 * without a break since the previous one, so the page can mark a possible gap.
 */
@CapacitorPlugin(
    name = "OutingSteps",
    permissions = { @Permission(alias = "activity", strings = { Manifest.permission.ACTIVITY_RECOGNITION }) }
)
public class OutingStepsPlugin extends Plugin implements SensorEventListener {

    private static final long FIRST_READING_WAIT_MS = 1500;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<PluginCall> waiting = new ArrayList<>();
    private SensorManager sensors;
    private Sensor counter;
    private boolean listening;
    private boolean continuous;
    private Long latest;

    @Override
    public void load() {
        sensors = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        counter = sensors == null ? null : sensors.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
    }

    private String permission() {
        // Before Android 10 the step counter needs no runtime permission.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "granted";
        PermissionState state = getPermissionState("activity");
        if (state == PermissionState.GRANTED) return "granted";
        return state == PermissionState.DENIED ? "denied" : "prompt";
    }

    private JSObject status() {
        JSObject result = new JSObject();
        result.put("available", counter != null);
        result.put("permission", permission());
        return result;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (counter == null || !"prompt".equals(permission())) {
            call.resolve(status());
            return;
        }
        requestPermissionForAlias("activity", call, "permissionResult");
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void sample(PluginCall call) {
        if (counter == null) {
            call.reject("This phone does not count steps.", "unavailable");
            return;
        }
        if (!"granted".equals(permission())) {
            call.reject("Physical activity access is off.", "denied");
            return;
        }
        main.post(() -> {
            if (!listening) {
                if (!sensors.registerListener(this, counter, SensorManager.SENSOR_DELAY_NORMAL)) {
                    call.reject("Steps could not be read.", "failed");
                    return;
                }
                listening = true;
                continuous = false;
                latest = null;
            }
            if (latest != null) {
                resolveReading(call);
                return;
            }
            waiting.add(call);
            main.postDelayed(() -> {
                if (waiting.remove(call)) resolveReading(call);
            }, FIRST_READING_WAIT_MS);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            release();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        main.post(this::release);
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() != Sensor.TYPE_STEP_COUNTER || event.values.length == 0) return;
        latest = (long) event.values[0];
        List<PluginCall> ready = new ArrayList<>(waiting);
        waiting.clear();
        for (PluginCall call : ready) resolveReading(call);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}

    private void resolveReading(PluginCall call) {
        JSObject result = new JSObject();
        result.put("platform", "android");
        result.put("counter", latest == null ? JSONObject.NULL : latest);
        result.put("bootCount", Settings.Global.getInt(getContext().getContentResolver(), Settings.Global.BOOT_COUNT, -1));
        result.put("continuous", continuous);
        call.resolve(result);
        // A reading only counts as continuous once a previous one came from this same listener.
        if (listening) continuous = true;
    }

    private void release() {
        if (listening && sensors != null) sensors.unregisterListener(this);
        listening = false;
        continuous = false;
        latest = null;
        List<PluginCall> pending = new ArrayList<>(waiting);
        waiting.clear();
        for (PluginCall call : pending) resolveReading(call);
    }
}
