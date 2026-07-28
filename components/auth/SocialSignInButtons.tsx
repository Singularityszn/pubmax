"use client";

import type { SocialAuthProviderAvailability } from "@/lib/authProviderAvailability";

function GoogleMark(): React.JSX.Element {
  return (
    <svg className="authProviderMark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

function MicrosoftMark(): React.JSX.Element {
  return (
    <svg className="authProviderMark" viewBox="0 0 23 23" aria-hidden="true" focusable="false">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

function ProviderLabel({
  name,
  fullLabels,
}: {
  name: "Google" | "Microsoft";
  fullLabels: boolean;
}): React.JSX.Element {
  if (fullLabels) return <>Continue with {name}</>;
  return (
    <>
      <span className="authSignInLabelFull" aria-hidden="true">
        Continue with {name}
      </span>
      <span className="authSignInLabelShort" aria-hidden="true">
        {name}
      </span>
    </>
  );
}

export default function SocialSignInButtons({
  availability,
  disabled,
  onGoogle,
  onMicrosoft,
  className,
  fullLabels = false,
}: {
  availability: SocialAuthProviderAvailability;
  disabled: boolean;
  onGoogle: () => void | Promise<void>;
  onMicrosoft: () => void | Promise<void>;
  className?: string;
  fullLabels?: boolean;
}): React.JSX.Element | null {
  if (!availability.google && !availability.microsoft) return null;

  const classes = ["authProviders", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      {availability.google ? (
        <button
          type="button"
          className="authSignIn"
          onClick={() => void onGoogle()}
          disabled={disabled}
          aria-label="Continue with Google"
        >
          <GoogleMark />
          <ProviderLabel name="Google" fullLabels={fullLabels} />
        </button>
      ) : null}
      {availability.microsoft ? (
        <button
          type="button"
          className="authSignIn"
          onClick={() => void onMicrosoft()}
          disabled={disabled}
          aria-label="Continue with Microsoft"
        >
          <MicrosoftMark />
          <ProviderLabel name="Microsoft" fullLabels={fullLabels} />
        </button>
      ) : null}
    </div>
  );
}
