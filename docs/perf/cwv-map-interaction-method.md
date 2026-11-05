# Map camera reset in the CWV sweep

The `/map` route sample measures a camera reset through the controls a reader uses. Both profiles use keyboard input in the existing `chromium-cwv` project.

1. Wait for the map camera to settle and confirm that the controls start closed.
2. Send `Shift+ArrowLeft` to the focusable map canvas. Check that the bearing changed and that the camera is off its designed attitude.
3. On desktop, click **Layers**, then **Reset the map view of London**. On the phone layout, click **More map controls**, the **Layers** tab, then **Reset view**.
4. Keep the existing post-action paint wait and read the vitals. Check that the reset restored the designed bearing and pitch.
5. Close the controls through their visible close button after the read. On the phone, wait for the saved sheet state to clear. The next sample checks that the controls start closed.

The existing Event Timing probe takes the worst qualifying interaction in the measured document. It includes the rotation key and the clicks that open the controls and reset the camera when those inputs produce qualifying entries. The existing 16 ms floor still applies.

The warm arm makes an unmeasured priming load in the same browser context and omits the cold clear. Both arms intercept the map init script through `page.route()`. This disables HTTP caching. Closing the controls adds no cache or storage clear. [Playwright routing](https://playwright.dev/docs/api/class-page#page-route)

The run artifact identifies the `/map` sequence as `map-camera-attitude-reset-v1`. The sequence expands the work measured by the former single click. This repair leaves the checked-in numeric ceilings unchanged. The sweep reports Map ceiling breaches under the expanded method. Compare performance only between runs with the same method.

If reset verification or closing fails after the read, the diagnostic keeps the method and raw rejected reading apart from completed samples. The sweep stops before writing a normal run artifact or recording a baseline.

The sweep keeps five samples by default. It uses the same device profiles, routes, selected-venue action, and product clocks.

The focused check uses the sweep's route validator on a cold and a warm sample for each profile. Select `chromium-cwv`. Set `PUBMAX_CWV_MAP_ACTION_CHECK=1`. Filter by `CWV Map camera reset and warm start`.
