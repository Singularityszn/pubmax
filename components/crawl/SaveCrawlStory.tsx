"use client";

import { BookMarked, Check, Copy } from "lucide-react";
import { useState } from "react";

import { encodeCrawlStory, VIBE_TAGS, type VibeTag } from "@/lib/crawlStory";

// A self-contained "Save as story" control. Decoupled from the Venue type on
// purpose: it accepts the minimal stop shape so it can be dropped anywhere a
// crawl exists. Opens a small inline panel (title / caption / vibe chips),
// encodes a /crawls?s=... link and copies it to the clipboard.

type SaveCrawlStoryStop = {
  venueId: string;
  name: string;
  priceGbp?: number | null;
};

type SaveCrawlStoryProps = {
  stops: SaveCrawlStoryStop[];
  defaultTitle?: string;
};

export default function SaveCrawlStory({ stops, defaultTitle }: SaveCrawlStoryProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState<VibeTag[]>([]);
  const [copied, setCopied] = useState(false);

  function toggleTag(tag: VibeTag) {
    setCopied(false);
    setTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
    );
  }

  function buildLink(): string {
    const encoded = encodeCrawlStory({
      title: title.trim() || defaultTitle || "My London crawl",
      caption: caption.trim(),
      vibeTags: tags,
      stops: stops.map((stop) => ({
        venueId: stop.venueId,
        name: stop.name,
        priceGbp: stop.priceGbp ?? null,
      })),
      createdAt: new Date().toISOString().slice(0, 10),
    });
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/crawls?s=${encoded}`;
  }

  async function copyStoryLink() {
    const link = buildLink();
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied (permissions / insecure origin) — no-op, no crash.
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="addStopBtn"
        style={{ marginTop: 0, marginBottom: "12px" }}
        onClick={() => setOpen(true)}
      >
        <BookMarked size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
        Save as story
      </button>
    );
  }

  return (
    <section
      aria-label="Save this crawl as a shareable story"
      style={{
        marginBottom: "12px",
        padding: "12px",
        border: "1px solid var(--line)",
        borderRadius: "10px",
        background: "var(--panel)",
        display: "grid",
        gap: "10px",
      }}
    >
      <label style={{ display: "grid", gap: "4px" }}>
        <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>Story title</span>
        <input
          type="text"
          value={title}
          maxLength={80}
          placeholder={defaultTitle || "Name this crawl"}
          onChange={(event) => {
            setCopied(false);
            setTitle(event.target.value);
          }}
          style={{
            padding: "8px 10px",
            border: "1px solid var(--line)",
            borderRadius: "8px",
            background: "var(--panel-raised)",
            color: "var(--ink)",
            fontSize: "14px",
          }}
        />
      </label>

      <label style={{ display: "grid", gap: "4px" }}>
        <span style={{ fontSize: "12px", color: "var(--ink-soft)" }}>Caption</span>
        <textarea
          value={caption}
          maxLength={280}
          rows={2}
          placeholder="What made this crawl worth walking?"
          onChange={(event) => {
            setCopied(false);
            setCaption(event.target.value);
          }}
          style={{
            padding: "8px 10px",
            border: "1px solid var(--line)",
            borderRadius: "8px",
            background: "var(--panel-raised)",
            color: "var(--ink)",
            fontSize: "14px",
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />
      </label>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {VIBE_TAGS.map((tag) => {
          const active = tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={active}
              onClick={() => toggleTag(tag)}
              style={{
                padding: "4px 10px",
                borderRadius: "999px",
                border: `1px solid ${active ? "var(--brass)" : "var(--line)"}`,
                background: active ? "var(--brass)" : "var(--panel-raised)",
                color: active ? "var(--panel-raised)" : "var(--ink-soft)",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              {tag}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <button type="button" className="addStopBtn" style={{ marginTop: 0 }} onClick={copyStoryLink}>
          {copied ? (
            <Check size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          ) : (
            <Copy size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          )}
          {copied ? "Copied!" : "Copy share link"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            background: "none",
            border: "none",
            color: "var(--ink-soft)",
            fontSize: "13px",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Close
        </button>
      </div>
    </section>
  );
}
