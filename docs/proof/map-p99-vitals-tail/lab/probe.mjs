export const PROBE = () => {
  const w = window;
  w.__lab = { shifts: [], longtasks: [], events: [] };
  const describe = (n) => {
    if (!n || !n.nodeType) return null;
    const el = n.nodeType === 1 ? n : n.parentElement;
    if (!el) return "#text";
    const parts = [];
    let e = el;
    for (let i = 0; e && i < 4; i++, e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) s += "#" + e.id;
      const cls = (typeof e.className === "string" ? e.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += "." + cls.join(".");
      parts.unshift(s);
    }
    return parts.join(">");
  };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      w.__lab.shifts.push({
        t: Math.round(e.startTime), v: e.value, input: e.hadRecentInput,
        src: (e.sources || []).map((s) => ({
          node: describe(s.node),
          prev: [s.previousRect.y, s.previousRect.height].map(Math.round),
          cur: [s.currentRect.y, s.currentRect.height].map(Math.round),
        })),
      });
    }
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) w.__lab.longtasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) });
  }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (!e.interactionId) continue;
      w.__lab.events.push({ id: e.interactionId, name: e.name, d: e.duration, t: Math.round(e.startTime), target: describe(e.target),
        inDelay: Math.round(e.processingStart - e.startTime), proc: Math.round(e.processingEnd - e.processingStart) });
    }
  }).observe({ type: "event", buffered: true, durationThreshold: 16 });
};

export function sessionCls(shifts) {
  let max = 0, cur = 0, first = -1, last = -1;
  for (const s of shifts) {
    if (s.input) continue;
    if (first >= 0 && s.t - last < 1000 && s.t - first < 5000) { cur += s.v; }
    else { cur = s.v; first = s.t; }
    last = s.t;
    max = Math.max(max, cur);
  }
  return max;
}

