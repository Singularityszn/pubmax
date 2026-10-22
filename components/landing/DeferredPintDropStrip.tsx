"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import PintDropStripLoading from "./PintDropStripLoading";

const PintDropStrip = dynamic(() => import("./PintDropStrip"), {
  ssr: false,
  loading: PintDropStripLoading,
});

export default function DeferredPintDropStrip() {
  const target = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!target.current) return;
    if (typeof IntersectionObserver === "undefined") {
      const fallback = window.setTimeout(() => setVisible(true), 0);
      return () => window.clearTimeout(fallback);
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      setVisible(true);
    }, { rootMargin: "240px 0px" });
    observer.observe(target.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="lpDrops" ref={target}>
      {visible ? <PintDropStrip /> : <PintDropStripLoading />}
    </div>
  );
}
