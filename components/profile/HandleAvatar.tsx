"use client";

import { getImageProps } from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { avatarInitialFromHandle } from "@/lib/profiles";
import { useReconnectRecovery } from "@/lib/useReconnectRecovery";

// Keep the installed Next insertion behavior without an Image component.
const useImageInsertionEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type HandleAvatarProps = {
  handle: string;
  avatarUrl?: string | null;
  displayName?: string;
  /** Fallback letters a surface already shows beside this avatar, kept identical. */
  initials?: string;
  className?: string;
  imageClassName?: string;
  size?: number;
};

/**
 * Handle-backed avatar with initials fallback on missing, hidden, or broken images.
 */
export default function HandleAvatar({
  handle,
  avatarUrl,
  displayName,
  initials,
  className,
  imageClassName,
  size = 40,
}: HandleAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const insertedImageRef = useRef<HTMLImageElement | null>(null);
  const initial = initials ?? avatarInitialFromHandle(handle, displayName);
  const showImage = Boolean(avatarUrl) && failedUrl !== avatarUrl;

  useReconnectRecovery(
    Boolean(avatarUrl) && failedUrl === avatarUrl,
    () => setFailedUrl(null),
  );

  useImageInsertionEffect(() => {
    const image = imageRef.current;
    if (!image || insertedImageRef.current === image) return;
    // React does not replay an image error from before hydration. Reassigning
    // the source retries that same request after the onError handler attaches.
    // eslint-disable-next-line no-self-assign
    image.src = image.src;
    insertedImageRef.current = image;
  }, [avatarUrl, showImage]);

  if (showImage) {
    const { props } = getImageProps({
      className: imageClassName ?? className,
      src: avatarUrl!,
      alt: "",
      width: size,
      height: size,
      unoptimized: true,
    });
    const { loading, width, height, decoding, className: imageClass, style, sizes, srcSet, src, ...rest } = props;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Next generates the exact unoptimized attributes through its public API.
      <img
        key={avatarUrl}
        {...rest}
        loading={loading}
        width={width}
        height={height}
        decoding={decoding}
        data-nimg="1"
        className={imageClass}
        style={style}
        sizes={sizes}
        srcSet={srcSet}
        src={src}
        ref={imageRef}
        onError={() => setFailedUrl(avatarUrl ?? null)}
      />
    );
  }

  // `size` is the IMAGE's box and nothing else. The initials fallback wears the
  // consumer's own class, so its stylesheet owns the circle - an inline width
  // here would beat every one of them, including the profile hero's responsive
  // clamp and the feed row's 36px.
  return (
    <span className={className} aria-hidden="true">
      {initial}
    </span>
  );
}
