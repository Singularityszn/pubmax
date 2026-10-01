# Drawer failure diagnosis before correction

Source and actual R23 failure-context review only. No corrective runtime has run, and source inspection does not establish real-frame causation.

Desktop exchange fails at `desktop-map-chrome-fit.spec.ts:423`: venue x 785.600830078125 against an intermediate assertion greater than 800. The sample is selected while the separate planner spring still crosses. The venue entrance intentionally permits overshoot (`SpringDrawer.tsx`, damping 0.75 from `sheetSnap.ts`; only damping at least 1 clamps crossings in `springMotion.ts`). The captured page contains Three Sheets Soho and Back/Home controls. Retarget, settled ownership and Back restoration assertions had not run. The earlier list-identity focus failure is separate.

Responsive exit fails at `landmark-and-sheet.spec.ts:402`: after the 900 px Home action, expected one Inspector, actual zero. This phase does not wait for Inspector presence before closing, and separate protocol calls can miss the retained-content interval after a valid spring finishes. The artifact cannot distinguish early close from completed exit. Source retains open children until onRest. The four existing stepped-clock left/right exit tests at 700 and 900 px passed this R23 run.

Proposed correction uses the existing browser-clock idiom: establish mounted content, pause animation time, preserve original native controls, capture ownership/content/geometry together, then step bounded frames to rest. Keep exact geometry, content lifecycle and composed Back state assertions. Remove the existing conditional skip of mid-exchange checks. No production spring change, retry, tolerance increase or count waiver. Temporary proposal remains unrun until the frozen suite ends.
