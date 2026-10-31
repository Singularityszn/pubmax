# PUBMAXX roadmap

This is the current horizon order. It records sequence, not dates.

## Shipped

- Message attach sheet.
- Message attachments for useful, shareable Night Moments: venue-pin
  **Location** share, handle-card **Contact**, plan-card **Event** and **Poll**
  (`components/messages/MessageAttachmentPicker.tsx`).
- The public or private account toggle, set in the profile editor
  (`lib/accountVisibility.ts`, `components/profile/ProfileEditor.tsx`). Privacy
  is a visible account choice, not an implied property of a surface.
- The honest `/add` promise: an add link asks for an account first and makes the
  add on the way back (`lib/addLink.ts`).

## Building

### V0 fix - building

Stability and polish remain the immediate launch work. Deployment is Sol-gated.

### Messaging wave - building

- group threads formed around Plan Crews
- a continue-on-WhatsApp export
- AI images: parked

## Next

### Account-privacy wave - next

IG-shaped profiles, built on the shipped public or private toggle.

## Later

### Activity-history layer - later

Show follow activity for public accounts.

### B2B operator channel - later

Build the operator channel after the consumer and social foundations above. It
serves pubs, restaurants, and other places through the same ecosystem.
