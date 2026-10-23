# Recorded battle tests

`scripts/cut_check.py` scores saved evidence without making network requests.
It replaces an unavailable external `cut_check.py`. It does not reproduce that script's unknown scoring rules.

Run:

```sh
python3 scripts/cut_check.py --evidence-dir artifacts/run --expected-sha FULL_COMMIT_SHA
```

The command writes `cut-check.json` in the evidence directory.
Exit code 0 means PASS. Exit code 1 means FAIL or UNVERIFIED. Exit code 2 means invalid evidence.

Save the unmodified response bodies as `api-version.json`, `api-pint-drops.json`, and `api-out.json`.
Request `/api/out` for the tested Tonight window.
The report counts canonical pub-matched rows before display grouping. Unmatched events do not contribute to that count.
The scorer does not infer rendered cards from raw event totals.

Record browser assertions in `browser-checks.json`:

```json
{
  "checks": {
    "map.desktop": {
      "passed": true,
      "viewport": [1280, 800],
      "evidence": ["desktop-map.png", "desktop-observations.json"]
    }
  }
}
```

Provide `map`, `pint`, and `tonight` entries for both `desktop` and `mobile`.
The mobile viewport is `[390, 844]`. Record its UA and DPR in the observations.
Every entry must reference existing evidence files inside that run's directory.
Missing evidence remains UNVERIFIED. A recorded failed assertion remains FAIL.
Assertions must include the pack's required checks, not just a successful page load.

The scorer trusts the recorded browser assertions. It cannot authenticate a screenshot or prove a user action itself.
Keep fixture, local, hosted, emulation, and physical-device evidence separate.
Never reuse another deployment's evidence to complete a run.
