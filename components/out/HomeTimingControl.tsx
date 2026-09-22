"use client";

import { useEffect, useState } from "react";

const PRIVATE_HOME_TIME_KEY = "pubmaxx:private-home-time:v1";

/** A local-only return-time reminder; it never enters a shared URL. */
export function HomeTimingControl() {
  const [value, setValue] = useState("");

  useEffect(() => {
    try {
      setValue(window.localStorage.getItem(PRIVATE_HOME_TIME_KEY) ?? "");
    } catch {
      // Private reminder remains optional when storage is unavailable.
    }
  }, []);

  function update(next: string) {
    setValue(next);
    try {
      if (next) window.localStorage.setItem(PRIVATE_HOME_TIME_KEY, next);
      else window.localStorage.removeItem(PRIVATE_HOME_TIME_KEY);
    } catch {
      // Keep the current control usable even when storage is blocked.
    }
  }

  return (
    <label>
      Private home-time reminder
      <input name="homeTime" type="time" value={value} onChange={(event) => update(event.target.value)} />
    </label>
  );
}
