# In-app feedback publication

Prepared on 22 October 2026 from the 20 October feedback implementation.

The account support row links to `/feedback`. The page opens an email draft using the existing monitored contact address. It provides a selectable address when a mail client is unavailable. The draft includes no URL, query, account or location values.

This independent PR contains no Updates link or Realtime changes. Sitemap discovery and the route budget belong to the feedback page. The route inventory grows by one.

The retained screenshots show the 20 October implementation. `account-before.png` shows the missing entry before implementation. `feedback-after.png` and `feedback-production-phone.png` show the resulting page. They are historical evidence, not a current-head test result.

The original production-build measurement at 3449404bd recorded five samples under the tracked performance method. Median LCP was 400 ms, decoded JavaScript was 771 KB and request count was 36. These measurements describe that build.

The existing feedback unit and Playwright tests cover navigation, keyboard operation, the address fallback and rejection of private-looking URL context. Fresh publication validation must bind to this PR head.
