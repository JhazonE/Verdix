# Verdix POS User Manual — Regeneration

This directory contains the Verdix POS User Manual and the build system for regenerating it.

## Scripts

Three npm scripts manage the manual:

| Script | Purpose |
|--------|---------|
| `npm run manual:build` | Assemble the Word document from `content.ts` + committed PNGs. **Offline, no database required.** Common case: edit prose or figures, then rebuild. |
| `npm run manual:capture` | Playwright script; screenshot all 34 screens to `docs/manual/images/`. **Requires dev server running on port 3100 + test database.** Full run takes ~25 minutes. |
| `npm run manual` | Run both: capture, then build. Regenerates the entire manual from live app screens. |

## Quick Rebuild (Offline)

Most edits to manual prose do not require a full capture:

```powershell
# PowerShell
npm run manual:build
```

```bash
# Bash
npm run manual:build
```

This reads `scripts/manual/content.ts` and the existing PNGs in `docs/manual/images/`, assembles them into a Word document, and writes `VerdixPOS-User-Manual.docx`. **No database or server needed.**

On first open in Microsoft Word, the document will prompt you to update the table of contents. Accept the prompt (or press **F9**) so page numbers populate correctly. This is normal and expected.

## Full Rebuild (Capturing New Screenshots)

To capture fresh screenshots — for example, after a major UI redesign — you need:

1. **MySQL running** with the local `verdix` database
2. **The test database seeded** with fixtures
3. **A dev server running on port 3100** (separate from your own dev server on port 3000)

### Setup

First, seed the test database once:

```powershell
npm run test:e2e:db
```

Then, in a separate terminal, start a dev server on port 3100 against the test database:

**PowerShell:**
```powershell
$env:DB_NAME='verdix_test'; $env:NEXT_PUBLIC_API_BASE_URL='http://localhost:3100/api'; $env:NEXT_DIST_DIR='.next-test'; npx next dev -p 3100
```

**Bash:**
```bash
DB_NAME='verdix_test' NEXT_PUBLIC_API_BASE_URL='http://localhost:3100/api' NEXT_DIST_DIR='.next-test' npx next dev -p 3100
```

### Capture

In a third terminal (back in the repo), run:

```powershell
npm run manual:capture
```

This script:
- Visits each screen in `scripts/manual/screens.ts`
- Overlays numbered red callout badges (if defined)
- Saves PNGs to `docs/manual/images/<slug>.png`
- Continues on partial failure (e.g., if one screen times out, the rest still capture)
- Reports missing captures at the end

A full run takes approximately 25 minutes. Progress is logged to the console.

### Then Build

Once capture completes:

```powershell
npm run manual:build
```

The DOCX is now fresh. Screenshots are committed on purpose — the next developer can rebuild the document without a database.

## Important Notes

- **Port 3000 is your own dev server.** Your personal edits and database go there. Never point screenshot capture at port 3000, or the manual will contain your real store data.
- **Port 3100 is the test database server.** Screenshot capture always runs against port 3100 and the seeded fixtures (`verdix_test` database).
- **Screenshots show test data.** Figures feature test products like "Test Coffee 3-in-1" and the store name "Verdix Test Store" — intentional, to avoid leaking real customer/inventory data into a published manual.
- **Committed PNGs are the source of truth.** The build process depends on them. Do not delete `docs/manual/images/`.

## Adding a New Screen

To document a new feature or interface:

1. **Add a screen definition** to `SCREENS` in `scripts/manual/screens.ts`:
   ```typescript
   { slug: 'unique-slug', route: '/path/to/page', title: 'Caption text', auth: 'admin' }
   ```
   The `slug` must be unique; it becomes the PNG filename and the figure reference key.

2. **Add a figure block** to the appropriate chapter in `scripts/manual/content.ts`:
   ```typescript
   { kind: 'figure', slug: 'unique-slug' }
   ```

3. **Regenerate** (capture + build):
   ```powershell
   npm run manual
   ```
   Or, if only rebuilding from an existing PNG:
   ```powershell
   npm run manual:build
   ```

### Validation

- Unit tests in `npm run test:unit` verify both directions of the slug/screen relationship: every figure block's slug must have a matching entry in `SCREENS`, and every entry in `SCREENS` must be referenced by at least one figure block in content.
- Missing PNGs do not abort the build. The document includes a shaded placeholder (`[SCREENSHOT MISSING: slug]`) and logs which images to recapture.
- If you add a figure to content but forget to add it to SCREENS (or vice versa — register a screen but never reference it), `npm run test:unit` will fail with a clear message.

## Troubleshooting

**"Failed to connect to http://localhost:3100"**  
→ Start the dev server on port 3100 (see Setup, above). Ensure `npm run test:e2e:db` has seeded the test database first.

**"Port 3100 already in use"**  
→ Stop any other Next.js processes. Use `netstat -ano | findstr :3100` (Windows) or `lsof -i :3100` (macOS/Linux) to find the process.

**"Screenshot timed out after waiting for [selector]"**  
→ The screen may have changed or the selector is stale. Check the app, update `screens.ts`, and re-run capture.

**Word document won't open**  
→ If the build fails mid-document, try deleting `docs/manual/VerdixPOS-User-Manual.docx` and rebuilding.

## References

- `scripts/manual/screens.ts` — Registry of all 34 screens, slugs, and callout badges.
- `scripts/manual/content.ts` — All manual prose: 9 chapters, 34 figures, 23-row report index.
- `scripts/manual/build-docx.ts` — Word document assembly (figures, TOC, formatting).
- `scripts/manual/capture.ts` — Playwright screenshot capture with overlay rendering.
- `scripts/manual/overlay.ts` — Callout badge styling and rendering.
- `tests/unit/manual-*.test.ts` — Unit tests for screens, content, overlay, and build integrity.
