# Phone sign-in runbook

Phone sign-in sends a code by text message to a UK mobile number. The code is
typed on the same page. The code is in `lib/phoneSignIn.ts` and
`components/auth/PhoneSignIn.tsx`, and the rule is in
[`docs/rules/lib-identity-accounts-and-sessions.md`](rules/lib-identity-accounts-and-sessions.md#a-text-code-is-a-sign-in-door-for-uk-mobiles-and-it-answers-like-the-email-link).

The phone form shows on `/login` only when phone sign-in is on in Supabase.
Until then, nobody sees it and no text is sent.

## What the captain does

Do these steps in this order. Each text message costs money, so do step 2
before step 3.

1. **Make a Twilio account.** Twilio is the company that sends the texts.
   Buy a UK number or make a Messaging Service. Write down the Account SID,
   the Auth Token and the Messaging Service SID.
2. **Allow texts to the UK only.** In the Twilio console, open
   Messaging, then Settings, then Geo permissions. Turn off every country
   except the United Kingdom. This step stops "SMS pumping", a scam where a
   script asks for codes to expensive foreign numbers and we pay the bill.
   The app accepts UK mobiles only, but a script can call Supabase directly,
   so this Twilio setting is the real fence.
3. **Turn on phone sign-in in Supabase.** In the Supabase dashboard, open
   Authentication, then Sign In / Providers, then Phone. Turn it on, choose
   Twilio, and paste the three values from step 1.
4. **Set a low SMS limit.** In Supabase, open Authentication, then Rate
   Limits. Set the SMS limit per hour to a number you are happy to pay for,
   for example 30.
5. **Check it.** Open `/login`. The "Sign in with your phone number" button
   shows within five minutes (the provider list is cached for five minutes).
   Sign in with your own mobile.

The names of the menus can change a little. If a menu is not where this page
says, search the Supabase or Twilio docs for "phone auth" or "geo permissions".

## How to turn it off

Turn off Phone in Supabase (step 3). The button goes away within five
minutes. Accounts made by phone stay, but they cannot sign in by text until
phone sign-in is on again.

## What the app does not do

- It does not accept numbers outside the UK.
- It does not show a phone number to anybody.
- It does not say whether a number already has an account.
