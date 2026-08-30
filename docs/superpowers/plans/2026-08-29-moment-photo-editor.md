# Moment Photo Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Moment authors optionally crop, filter, add text, and draw on each attached photo before the existing private upload.

**Architecture:** Keep `MomentMediaDraft.blob` as the upload source of truth. Add a client-only editor sheet that is dynamically imported by `/moment` but rendered only for an explicit Edit action. Accept the editor's output only when it satisfies the current JPEG, PNG, WebP, and 5MB constraints, then replace the draft media item so the existing `FormData` and storage/moderation path remain unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `@unlayer/react-image-editor` 1.0.1, Vitest, Playwright, Chrome DevTools evidence.

**Spec:** Captain-approved launch brief in the task request.

## Global Constraints

- Attach photo -> Edit button -> editor modal/sheet -> edited image replaces original.
- Mobile-first at 390x844; interactive controls use 44px minimum tap targets.
- Lazy-load the editor wrapper and CDN runtime only after Edit; it must not enter map or landing bundles.
- Edited output must pass existing JPEG, PNG, WebP, and 5MB checks and use the existing upload/moderation path.
- Keep PUBMAXX copy minimal and do not add supporting copy below headings by default.
- Stop with needs-decision if peer dependencies, license, or bundle/runtime cost makes `@unlayer/react-image-editor` incompatible.

### Task 1: Add executable contracts for editor loading and media replacement

**Files:**
- Create: `__tests__/momentPhotoEditor.test.ts`
- Create: `__tests__/momentPhotoEditorWiring.test.ts`

**Interfaces:**
- The editor host accepts one `MomentMediaDraft`, returns an edited `Blob` or cancellation.
- The media replacement helper returns the current media item unchanged for invalid editor output and a new `File`-backed item for valid output.

- [x] **Step 1: Write the failing tests**

  Test that valid editor output replaces only the selected photo, preserves its alt text and id, and updates name/type/size/object URL. Test that an unsupported type or output over 5MB is refused. Test that the lazy loader is not invoked until an Edit action is rendered and tapped.

- [x] **Step 2: Run focused tests to verify they fail**

  Run: `npm test -- __tests__/momentPhotoEditor.test.ts __tests__/momentPhotoEditorWiring.test.ts`

  Expected: FAIL because the editor host and media replacement contract do not exist.

### Task 2: Install and integrate the Unlayer editor

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `components/moment/MomentImageEditor.tsx`
- Modify: `components/moment/MomentCapture.tsx`
- Modify: `components/moment/moment.css`
- Modify: `proxy.ts`
- Test: `__tests__/momentPhotoEditor.test.ts`, `__tests__/momentPhotoEditorWiring.test.ts`

**Interfaces:**
- `MomentImageEditor` renders `@unlayer/react-image-editor` with `offline: true`, no AI feature, and `onSave`, `onCancel`, and error callbacks.
- `MomentCapture` tracks `editingMediaId`, opens the editor for the selected object URL, and commits valid output through a focused media replacement helper.

- [x] **Step 1: Install the pinned compatible dependency**

  Run: `npm install --save-exact @unlayer/react-image-editor@1.0.1`

- [x] **Step 2: Implement the editor host and replacement helper**

  Add minimal sheet markup, a 44px Close control, and error handling. The editor owns its save and cancel controls. Keep the editor import in the dynamically loaded host. Convert a valid editor Blob to a `File`, retain the original filename stem, and update only the selected draft item.

- [x] **Step 3: Wire Edit controls into each photo preview**

  Add an Edit button beside Remove for each photo. Render the lazy host only when `editingMediaId` points to an existing item. Keep the original item until Use photo succeeds; Cancel or editor failure leaves it unchanged.

- [x] **Step 4: Permit only required CDN origins in CSP**

  Add `https://cdn.unlayer.com` to script, connect, and font sources used by the editor runtime. Keep the editor offline so it does not need product API calls. Do not widen any image or API upload policy.

- [x] **Step 5: Run focused tests to verify they pass**

  Run: `npm test -- __tests__/momentPhotoEditor.test.ts __tests__/momentPhotoEditorWiring.test.ts`

  Expected: PASS with no unhandled editor or React warnings.

### Task 3: Add browser proof and bundle boundary coverage

**Files:**
- Create: `e2e/moment-photo-editor.spec.ts`
- Create: `docs/proof/moment-photo-editor/` screenshot output during validation

**Interfaces:**
- The Playwright flow runs at 390x844, attaches a valid PNG, opens Edit, confirms the editor sheet, and captures evidence.
- The lazy boundary test observes no editor wrapper/CDN request before Edit and observes the editor request after Edit.

- [x] **Step 1: Add the browser contract**

  Use a deterministic repository PNG and assert the Edit control, editor sheet, Close control, and original preview preservation after closing. Capture the open editor sheet at 390x844.

- [x] **Step 2: Run the headed browser proof**

  Run: `PW_SKIP_WEBSERVER=1 PW_MOMENT_BASE_URL=http://127.0.0.1:3100 npx playwright test e2e/moment-photo-editor.spec.ts --headed --project=chromium`

  Expected: PASS and a screenshot at `docs/proof/moment-photo-editor/moment-editor-390.png`.

- [x] **Step 3: Check route bundle boundaries**

  Run the project bundle fence or `npm run verify` command that covers route chunks. Confirm `/map` and `/` do not reference the editor package or its dynamic chunk, while `/moment` loads it only after Edit.

### Task 4: Validate and commit

**Files:**
- Modify only files from Tasks 1-3.

- [x] **Step 1: Run local checks**

  Run: `npm run lint`, `npm run typecheck`, focused Vitest tests, and the headed Moment Playwright test.

- [x] **Step 2: Inspect the diff and status**

  Run: `git diff --check && git status --short && git diff --stat`.

- [x] **Step 3: Commit the feature**

  Run: `git add package.json package-lock.json components/moment proxy.ts __tests__/momentPhotoEditor.test.ts __tests__/momentPhotoEditorWiring.test.ts e2e/moment-photo-editor.spec.ts docs/superpowers/plans/2026-08-29-moment-photo-editor.md docs/proof/moment-photo-editor/moment-editor-390.png && git commit -m "feat: add optional Moment photo editing"`

## PR draft

**Title:** `feat: add optional Moment photo editing`

**Body:**

## What changed

- Added optional Unlayer editing after Moment photo attach.
- Supports crop, filters, draw, text, shapes, stickers, and frames through the editor.
- Keeps edited output on the existing JPEG, PNG, WebP, and 5MB upload path.
- Lazy-loads the editor wrapper and CDN runtime only after Edit.

## Evidence

- Mobile headed proof at 390x844: `docs/proof/moment-photo-editor/moment-editor-390.png`.
- Browser contract confirms no CDN runtime request before Edit and a request after Edit.
- Route manifest inspection confirms map and landing manifests do not include the editor runtime chunk.

## Validation

- Focused Vitest contracts pass: 65 tests.
- Changed-file ESLint passes with one expected ignored CSS-file warning.
- Full typecheck and build remain blocked by existing harvest and venue-index errors.

## Follow-ups

- Run `no-mistakes axi run` when Firstmate frees the validation slot.
- No storage, moderation, or upload pipeline changes are included.
