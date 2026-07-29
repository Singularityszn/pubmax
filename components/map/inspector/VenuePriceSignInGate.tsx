"use client";

import SignInButton from "@/components/auth/SignInButton";

export default function VenuePriceSignInGate({
  venueName,
  loading,
}: {
  venueName: string;
  loading: boolean;
}) {
  return (
    <section
      className="venuePriceSignInGate"
      role="region"
      aria-labelledby="venuePriceSignInTitle"
    >
      <h3 id="venuePriceSignInTitle" tabIndex={-1}>
        {loading ? "Checking your account" : "Sign in to add a price"}
      </h3>
      {loading ? (
        <p>Checking whether you&rsquo;re signed in.</p>
      ) : (
        <>
          <p>
            You need an account to add a price. Sign in here and we&rsquo;ll
            bring you back to {venueName}.
          </p>
          <SignInButton />
        </>
      )}
    </section>
  );
}
