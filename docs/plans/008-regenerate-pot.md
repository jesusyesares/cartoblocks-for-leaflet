# Plan 008: Regenerate the translation template (languages/blocks-for-leaflet-map.pot)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 313481a..HEAD -- languages/blocks-for-leaflet-map.pot blocks-for-leaflet-map.php package.json`
> If `blocks-for-leaflet-map.php` or `package.json` (version number) changed
> since this plan was written, the regenerated `.pot` header should reflect
> the CURRENT version, not necessarily `1.0.7` — read the current
> `BFLM_VERSION` / `package.json` version before regenerating.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (but for best results, run this AFTER plans
  001-006, so any new/changed user-facing strings from those plans are
  captured — none of plans 001-007 are expected to add translatable
  strings, but plan 006 may touch `includes/` files for style fixes that
  happen to wrap previously-bare strings in `__()`)
- **Category**: i18n / docs
- **Planned at**: commit `313481a`, 2026-06-12
- **Issue**: none (found during /improve audit)

## Why this matters

`languages/blocks-for-leaflet-map.pot` is the translation template consumed
by translators and by WordPress.org's translation platform. Its header
currently reads:

```
"Project-Id-Version: Blocks for Leaflet Map 0.10.0\n"
```

...while the plugin's actual current version is `1.0.7` (per
`blocks-for-leaflet-map.php`'s `BFLM_VERSION` constant and
`package.json`). The `.pot` file is **at least 7 version-bumps stale**
(0.10.0 → 1.0.0 → 1.0.1 → ... → 1.0.7), meaning it was last regenerated
before the entire v1.0.x feature-parity series and the v1.1.0 modularization
landed. Any user-facing strings added or changed across all of those releases
are missing from or stale in the template. WordPress.org's translation
tooling and reviewers check that the shipped `.pot` reflects the current
codebase.

`package.json` already defines the regeneration command:

```json
"make-pot": "wp i18n make-pot . languages/blocks-for-leaflet-map.pot --domain=blocks-for-leaflet-map --exclude=node_modules,vendor,build"
```

This plan simply runs it and commits the result.

## Current state

`languages/blocks-for-leaflet-map.pot`, header (first 10 lines):

```
# Copyright (C) 2026 Jesús Yesares García
# This file is distributed under the GPL-2.0-or-later.
msgid ""
msgstr ""
"Project-Id-Version: Blocks for Leaflet Map 0.10.0\n"
"Report-Msgid-Bugs-To: https://wordpress.org/support/plugin/blocks-for-leaflet-map\n"
"Last-Translator: FULL NAME <EMAIL@ADDRESS>\n"
"Language-Team: LANGUAGE <LL@li.org>\n"
"MIME-Version: 1.0\n"
"Content-Type: text/plain; charset=UTF-8\n"
```

`blocks-for-leaflet-map.php` currently declares `Version: 1.0.7` and
`define( 'BFLM_VERSION', '1.0.7' );` (confirm this is still current per the
drift check — if plan 002 already ran and the version changed, use whatever
the current version is).

The `make-pot` script requires `wp-cli` with the `i18n` command available
(`wp i18n make-pot`). Confirm availability before running.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Check wp-cli i18n availability | `wp i18n make-pot --help` | shows help text, not "command not found" |
| Regenerate the .pot file | `npm run make-pot` | exit 0, `languages/blocks-for-leaflet-map.pot` rewritten |
| Confirm version in header | `head -10 languages/blocks-for-leaflet-map.pot` | `Project-Id-Version: Blocks for Leaflet Map <current version>` |
| Confirm string count changed | `grep -c '^msgid "' languages/blocks-for-leaflet-map.pot` (before and after) | count increases (more strings now present than the stale 0.10.0-era template) |

## Scope

**In scope**:
- `languages/blocks-for-leaflet-map.pot` — regenerate via `npm run make-pot`
  and commit the result.

**Out of scope**:
- Any `.po` / `.mo` translation files (this repo currently has none beyond
  the `.pot` template, per `ls languages/`) — if any exist, do not
  hand-edit them; they'd need re-merging by a translator/tool, which is
  beyond this plan.
- Adding/changing `__()`/`_e()`/etc. calls in source code to wrap untranslated
  strings — `make-pot` only EXTRACTS what's already wrapped. If you notice
  obviously-untranslated user-facing strings while reviewing the diff,
  report them as a follow-up finding (do not fix them as part of this plan —
  that's a separate i18n-completeness effort referenced in this repo's
  CLAUDE.md roadmap for v1.3.0).
- Bumping the plugin version — this plan only regenerates the `.pot` to
  match the CURRENT version, it does not change `BFLM_VERSION` /
  `package.json` / etc.

## Git workflow

- Branch: `chore/regenerate-pot`
- One commit.
- Commit message style: `chore: regenerate translation template (.pot)`
- Do NOT push or open a PR unless explicitly instructed.

## Steps

### Step 1: Confirm wp-cli i18n is available

```bash
wp i18n make-pot --help
```

**Verify**: prints usage/help text for `wp i18n make-pot`. If this command
is not found (`wp-cli` not installed, or the `i18n` package not available),
STOP and report — see "STOP conditions".

### Step 2: Record the before-state

```bash
head -10 languages/blocks-for-leaflet-map.pot
grep -c '^msgid "' languages/blocks-for-leaflet-map.pot
```

**Verify**: confirms the stale `0.10.0` version string and records the
current string count (for comparison after regeneration).

### Step 3: Regenerate

```bash
npm run make-pot
```

This runs:
```
wp i18n make-pot . languages/blocks-for-leaflet-map.pot --domain=blocks-for-leaflet-map --exclude=node_modules,vendor,build
```

**Verify**: exit 0. The command should scan the whole plugin directory
(excluding `node_modules`, `vendor`, `build` as configured) for
`__()`/`_e()`/`_n()`/`_x()`/etc. calls with the `blocks-for-leaflet-map` text
domain, in both PHP and JS files.

### Step 4: Confirm the regenerated header

```bash
head -10 languages/blocks-for-leaflet-map.pot
```

**Verify**: `Project-Id-Version: Blocks for Leaflet Map <X.Y.Z>\n` where
`<X.Y.Z>` matches the CURRENT `BFLM_VERSION` (e.g. `1.0.7`, or whatever the
drift check confirmed) — NOT `0.10.0`.

### Step 5: Confirm string count is plausible

```bash
grep -c '^msgid "' languages/blocks-for-leaflet-map.pot
```

**Verify**: the count should be SIGNIFICANTLY HIGHER than the before-state
count from Step 2 (the codebase has grown enormously since the 0.10.0-era
`.pot` — e.g. `edit.js` alone has 318 `__()`-family calls). An equal or lower
count would be suspicious — see "STOP conditions".

### Step 6: Review the diff for anything unexpected

```bash
git diff --stat languages/blocks-for-leaflet-map.pot
git diff languages/blocks-for-leaflet-map.pot | head -100
```

**Verify**: the diff is entirely additions/updates of `msgid`/`msgstr`/
`#: file:line` comment entries and the header block — no unrelated file
changes, no garbage/binary content.

## Test plan

Not applicable — this is a generated-file regeneration, not a code change.
No new tests. The verification IS the regeneration succeeding with a
plausible, non-stale output (Steps 4-6).

## Done criteria

ALL must hold:

- [ ] `languages/blocks-for-leaflet-map.pot` header `Project-Id-Version`
      shows the CURRENT plugin version (matching `BFLM_VERSION` in
      `blocks-for-leaflet-map.php` at the time this plan runs), not `0.10.0`.
- [ ] `grep -c '^msgid "' languages/blocks-for-leaflet-map.pot` is
      significantly higher than the before-regeneration count recorded in
      Step 2.
- [ ] `git diff --stat` shows only `languages/blocks-for-leaflet-map.pot`
      changed.
- [ ] `plans/README.md` status row for plan 008 updated to DONE.

## STOP conditions

Stop and report back (do not improvise) if:

- `wp i18n make-pot --help` fails (command not found, or `i18n` package not
  installed for wp-cli). Do not attempt to install wp-cli packages as a
  workaround unless that's clearly safe and reversible in your environment —
  report the missing tooling instead.
- After regeneration, the string count (Step 5) is EQUAL TO OR LOWER THAN
  the before-state count. This would suggest `make-pot` scanned the wrong
  directory, or excluded something it shouldn't have (e.g. if `--exclude`
  accidentally matched `includes/` or `src/` due to a path issue) — do not
  commit a regression; report the counts and investigate the `--exclude`
  pattern against the actual directory structure before proceeding.
- The regenerated `.pot` is missing strings from `src/leaflet-map-block/edit.js`
  specifically (spot-check: `grep -c "edit.js" languages/blocks-for-leaflet-map.pot`
  should be > 0, since this file alone has 318 i18n calls) — if `edit.js`
  strings are absent, `wp i18n make-pot`'s JS-parsing may not be working as
  expected; report rather than proceeding.

## Maintenance notes

- This repo's CLAUDE.md roadmap notes "Full internationalisation required
  (all user-facing strings)" as outstanding before WordPress.org submission
  (v1.3.0 milestone). This plan regenerates the template to match CURRENT
  `__()`-wrapped strings — it does NOT audit whether all user-facing strings
  ARE wrapped. If, while reviewing the diff in Step 6, you notice the
  regenerated `.pot` seems to be missing strings you'd expect to be
  user-facing (e.g. error messages in `includes/geocoder.php`, which per a
  separate audit pass already use `__()` correctly), that's a signal those
  strings genuinely aren't wrapped yet — note it in your report as a
  candidate for the v1.3.0 i18n-completeness work, but do not attempt to fix
  it here.
- Going forward, `npm run make-pot` should be run as part of the release
  checklist (alongside the 5-location version bump) whenever new
  user-facing strings are added — consider whether this repo's "Development
  Protocol" (in CLAUDE.md) should mention it explicitly. That's a
  documentation suggestion, not part of this plan's scope.
