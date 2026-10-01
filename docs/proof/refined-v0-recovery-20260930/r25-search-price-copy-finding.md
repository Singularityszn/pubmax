# Resident search price copy finding

Status: reproduced, source proposal held. No source edit while current regression source is frozen. Search module overlaps another active integration task.

At 390 and 1440, native A→B→A selected Sydney Arms after showing dated Rioja quotes £5.25 / 125ml and £10.50 / 250ml. The resident Sydney Arms option still rendered “No listed price”. Its actual option ID, text, time, bounds and subsequent selected-price GET ownership appear in [the final native report](r25-price-native-final/report.json). The [phone sheet screenshot](r25-price-native-final/390-A-return.png) shows the published quotes; the diagnostic did not take a screenshot of the option itself.

Current `components/map/MapSearchSuggest.tsx` hardcodes that badge for every base option. The [held one-line patch](r25-search-price-copy-held.patch.txt) removes the badge. Name, address, distance and native activation remain. This makes no positive price claim, adds no request, and changes no pin authority, sorting or serving classification. It does not alter the overlapping delayed-focus handler.

After ownership reconciliation, verify fresh phone and desktop native A→B→A: option keeps correct ID/name/address/distance and no false missing-price claim; selected sheet retains exact amount/measure/source/date, B never borrows A prices, one selected-price GET per pub, and native keyboard/activation/focus behavior remains intact. Capture option pixels before activation. Rerun appropriate source and browser gates on that changed candidate. Current full-suite outcome cannot validate an unapplied patch.
