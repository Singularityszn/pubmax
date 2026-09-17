"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);
  return (
    <html lang="en">
      <body>
        <main
          role="alert"
          style={{
            minHeight: "100svh",
            display: "grid",
            placeItems: "center",
            padding: "24px",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div style={{ maxWidth: "34rem", textAlign: "center" }}>
            <h1 style={{ margin: "0 0 14px", fontSize: "1.8rem" }}>
              Something went wrong
            </h1>
            <p style={{ margin: "0 0 28px", color: "var(--ink-soft, #666)", lineHeight: 1.6 }}>
              An unexpected error occurred. Try again or head back to the front
              page.
            </p>
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={reset}
                style={{
                  minHeight: "44px",
                  padding: "0 20px",
                  borderRadius: "8px",
                  border: "none",
                  background: "var(--ink-deep, #0f1c16)",
                  color: "#fdfaf2",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Try again
              </button>
              <a
                href="/"
                style={{
                  minHeight: "44px",
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "0 20px",
                  borderRadius: "8px",
                  border: "1px solid var(--line, #ddd)",
                  color: "var(--ink, #333)",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                Back to the front page
              </a>
            </div>
            {error.digest ? (
              <p style={{ marginTop: "20px", color: "#999", fontSize: "0.76rem" }}>
                Reference: {error.digest}
              </p>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  );
}
