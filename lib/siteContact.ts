// The app's door onto the one public contact address.
//
// The address itself lives in lib/siteContact.mjs, which the plain-node scripts
// under scripts/ read for their crawler user-agent headers. This file exists so
// every app surface keeps importing "@/lib/siteContact" unchanged, and so there
// is still exactly ONE place the address is written down.
export { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/siteContact.mjs";
