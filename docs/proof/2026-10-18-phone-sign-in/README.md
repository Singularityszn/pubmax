# Phone sign-in on /login, 18 October 2026

Shots at 390px wide, from `next dev` with a placeholder Supabase URL. The
browser answered `/api/auth/providers` with `phone: true` and the Supabase
`otp` call with an empty success, so no text was sent.

- `login-phone-door.png`: the closed door, under the email form.
- `login-phone-number.png`: the number step, with a UK mobile typed.
- `login-phone-code.png`: the code step after "Text me a code", with the
  neutral sent line, the number read back and the 60 second resend wait.

Before this change the page had no phone door. With `phone: false`, or no
answer from the providers route, the page is unchanged.
