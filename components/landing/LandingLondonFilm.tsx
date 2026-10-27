"use client";

import { useCallback, useState } from "react";
import { useClientReady } from "@/lib/useClientReady";
import "./landingLondonFilm.css";

/** Mount the media only after a deliberate request, including with reduced motion. */
export default function LandingLondonFilm() {
  const ready = useClientReady();
  const [requested, setRequested] = useState(false);
  const [failed, setFailed] = useState(false);
  const focusVideo = useCallback((node: HTMLVideoElement | null) => node?.focus(), []);
  const focusRetry = useCallback((node: HTMLButtonElement | null) => {
    if (failed) node?.focus();
  }, [failed]);

  return (
    <section className="lpFilm" aria-labelledby="london-film-title">
      <div className="lpFilmCopy">
        <h2 id="london-film-title">London, day to night</h2>
        <p id="london-film-description">
          Southwark, Clerkenwell, Leadenhall Market and Canary Wharf.
          Four photographs by the PUBMAXX founder, in a silent 12-second film.
        </p>
        {failed ? <p role="status">The film could not load. You can try it again below.</p> : null}
      </div>
      <div className="lpFilmFrame">
        {requested ? (
          <video
            src="/landing/london-film/london.mp4"
            poster="/landing/london-collage/southwark-shard-640.webp"
            width={720}
            height={960}
            controls
            tabIndex={0}
            ref={focusVideo}
            autoPlay
            muted
            playsInline
            preload="none"
            aria-label="London, day to night"
            aria-describedby="london-film-description"
            onError={() => { setFailed(true); setRequested(false); }}
          >
            <track kind="captions" src="/landing/london-film/places.vtt" srcLang="en" label="Places" default />
            <a href="/landing/london-film/london.mp4">Open the London film</a>
          </video>
        ) : (
          <button
            type="button"
            className="lpFilmPlay"
            disabled={!ready}
            ref={focusRetry}
            onClick={() => { setFailed(false); setRequested(true); }}
            aria-describedby="london-film-description"
          >
            <picture>
              <source type="image/avif" srcSet="/landing/london-collage/southwark-shard-640.avif" />
            <img
              src="/landing/london-collage/southwark-shard-640.webp"
              width={640}
              height={853}
              alt=""
              loading="lazy"
              decoding="async"
            />
            </picture>
            <span>{failed ? "Try the film again" : "Play London film"}<small>12 seconds · No sound</small></span>
          </button>
        )}
      </div>
    </section>
  );
}
