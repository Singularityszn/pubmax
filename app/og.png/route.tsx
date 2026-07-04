import { ImageResponse } from "next/og";

export const runtime = "edge";

const size = {
  width: 1200,
  height: 630,
};

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#111814",
          color: "#f8f0dc",
          padding: 72,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              fontSize: 32,
              fontWeight: 700,
            }}
          >
            <div
              style={{
                width: 58,
                height: 58,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 12,
                background: "#f5b84b",
                color: "#111814",
                fontSize: 34,
                fontWeight: 900,
              }}
            >
              P
            </div>
            PubMaxing
          </div>
          <div
            style={{
              border: "2px solid #e26d3d",
              color: "#ffdca2",
              borderRadius: 999,
              padding: "12px 22px",
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            London demo
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              color: "#f5b84b",
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: 0,
            }}
          >
            Price-aware. Story-led. Ready to crawl.
          </div>
          <div
            style={{
              maxWidth: 900,
              fontSize: 76,
              lineHeight: 0.98,
              fontWeight: 900,
              letterSpacing: 0,
            }}
          >
            Find better London pub routes in seconds.
          </div>
          <div
            style={{
              maxWidth: 820,
              color: "#d7c9a7",
              fontSize: 30,
              lineHeight: 1.35,
            }}
          >
            Compare pint prices, heritage stops, live Pint Drops, and crawl
            styles on one map.
          </div>
        </div>

        <div style={{ display: "flex", gap: 16 }}>
          {["Pint prices", "Heritage pubs", "Community drops"].map((label) => (
            <div
              key={label}
              style={{
                background: "#203126",
                border: "1px solid #47624d",
                borderRadius: 10,
                color: "#f8f0dc",
                padding: "14px 20px",
                fontSize: 24,
                fontWeight: 700,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
