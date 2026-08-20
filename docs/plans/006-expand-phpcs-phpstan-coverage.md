# Plan 006: Expand PHPCS and PHPStan coverage to includes/

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 313481a..HEAD -- phpcs.xml phpstan.neon includes/`
> If `phpcs.xml` or `phpstan.neon` changed since this plan was written,
> compare the "Current state" excerpts against the live files before
> proceeding; on a mismatch, treat it as a STOP condition. If files under
> `includes/` changed (e.g. plans 001/004/005 landed first), that's expected
> and fine — just be aware new violations may surface from those changes
> too.

## Status

- **Priority**: P2
- **Effort**: S (config change) but expect M-sized follow-up if many
  violations surface — see "STOP conditions" for how to handle that
- **Risk**: LOW
- **Depends on**: none (but ideally lands AFTER plans 001/003/004/005, so
  their changes are linted too — not a hard dependency)
- **Category**: tooling / tech-debt
- **Planned at**: commit `313481a`, 2026-06-12
- **Issue**: none (found during /improve audit)

## Why this matters

This plugin underwent a v1.1.0 "internal modularization" (PRs #21, #22,
#24): a 1450-line main file and a 614-line `render.php` were split into 14
files totaling ~5700 lines under `includes/` (`includes/shortcodes/`,
`includes/preview/`, `includes/geocoder.php`, `includes/filetypes.php`,
`includes/editor-assets.php`, `includes/tgm-config.php`). However,
`phpcs.xml` and `phpstan.neon` were never updated to include these new
files — they still only check `blocks-for-leaflet-map.php` and
`src/leaflet-map-block/render.php` (2 files, ~200 lines combined). The CI
workflow (`.github/workflows/ci.yml`) runs `composer lint` and `composer
phpstan`, which respect these configs — so ~5700 lines of the plugin
(96% of the modularized code) currently have ZERO static analysis coverage
in CI.

Ahead of a WordPress.org submission, this matters because: (a) WordPress.org
reviewers manually scan for WPCS violations across the WHOLE plugin, not
just the files a local config happens to cover, and (b) PHPStan catching
type errors in `includes/` now is much cheaper than a reviewer (or a user)
finding them later.

## Current state

`phpcs.xml` (full file):

```xml
<?xml version="1.0"?>
<ruleset name="Blocks for Leaflet Map">
    <description>WordPress Coding Standards for blocks-for-leaflet-map.</description>

    <!-- Files to analyse -->
    <file>blocks-for-leaflet-map.php</file>
    <file>src/leaflet-map-block/render.php</file>

    <!-- Exclude build output and vendor -->
    <exclude-pattern>build/*</exclude-pattern>
    <exclude-pattern>vendor/*</exclude-pattern>
    <exclude-pattern>node_modules/*</exclude-pattern>

    <!-- WordPress Coding Standards -->
    <rule ref="WordPress">
        <!-- Plugin-specific text domain -->
        <properties>
            <property name="text_domain" type="array">
                <element value="blocks-for-leaflet-map"/>
            </property>
        </properties>
    </rule>

    <!-- Minimum supported WordPress version (for deprecated function checks) -->
    <config name="minimum_supported_wp_version" value="6.0"/>

    <!-- PHP 7.4+ compatibility -->
    <config name="testVersion" value="7.4-"/>

    <!-- Allow short array syntax -->
    <rule ref="Generic.Arrays.DisallowShortArraySyntax.Found">
        <severity>0</severity>
    </rule>
</ruleset>
```

`phpstan.neon` (full file):

```neon
includes:
    - vendor/szepeviktor/phpstan-wordpress/extension.neon

parameters:
    level: 5
    paths:
        - blocks-for-leaflet-map.php
        - src/leaflet-map-block/render.php
    excludePaths:
        - vendor
        - node_modules
        - build
    bootstrapFiles:
        - vendor/php-stubs/wordpress-stubs/wordpress-stubs.php
        - includes/class-tgm-plugin-activation.php
```

Note: `phpstan.neon` ALREADY bootstraps
`includes/class-tgm-plugin-activation.php` (it's loaded for its class
definitions used by `tgm-config.php`), but does not ANALYSE anything under
`includes/`.

The current `includes/` directory contents (all should be added to scope,
EXCEPT the vendored TGM library):

```
includes/class-tgm-plugin-activation.php   (3870 lines — VENDORED, exclude)
includes/tgm-config.php                    (46 lines)
includes/filetypes.php                     (60 lines)
includes/geocoder.php                      (112 lines)
includes/editor-assets.php                 (56 lines)
includes/preview/input.php                 (109 lines)
includes/preview/template.php              (639 lines)
includes/preview/endpoint.php              (34 lines)
includes/shortcodes/attrs.php              (179 lines)
includes/shortcodes/map.php                (99 lines)
includes/shortcodes/marker.php             (123 lines)
includes/shortcodes/line.php               (123 lines)
includes/shortcodes/circle.php             (80 lines)
includes/shortcodes/layer.php              (101 lines)
includes/shortcodes/overlay.php            (66 lines)
```

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install composer deps (if `vendor/` absent) | `composer install --no-interaction --prefer-dist` | exit 0, creates `vendor/` |
| Run PHPCS | `composer lint` (= `phpcs`) | exit 0, or a manageable list of NEW violations to fix |
| Run PHPStan | `composer phpstan` (= `phpstan analyse`) | exit 0, or a manageable list of NEW errors to fix |
| PHP syntax check (fallback if composer unavailable) | `find includes -name '*.php' ! -name 'class-tgm-plugin-activation.php' -exec php -l {} \;` | `No syntax errors detected` for each file |

**Note**: This checkout does not currently have `vendor/` installed (it's
gitignored/distignored, standard for a composer-managed dev dependency). If
`composer install` is unavailable or fails in your environment (no network
access), proceed with the config changes (Steps 1-2) and the PHP syntax
check as a fallback, then report that PHPCS/PHPStan could not be run locally
— the CI workflow will run them on push.

## Scope

**In scope**:
- `phpcs.xml` — add `includes/` to the `<file>` list, with an
  `<exclude-pattern>` for the vendored TGM library.
- `phpstan.neon` — add `includes/` to `paths`, with an `excludePaths` entry
  for the vendored TGM library.
- Fixing any NEW violations/errors that surface in `includes/` files AS A
  RESULT of the expanded scope — but see "STOP conditions" for the size
  limit on this.

**Out of scope**:
- `includes/class-tgm-plugin-activation.php` — vendored upstream library
  (TGMPA 2.6.1), marked `// phpcs:ignoreFile` and "DO NOT MODIFY" per this
  repo's CLAUDE.md. MUST be excluded from both configs, not just left
  unfixed.
- `src/leaflet-map-block/edit.js` and other JS files — JS linting
  (`npm run lint:js` / `npm run lint:css`) already runs separately in CI and
  is unaffected by this plan.
- `build/` — already excluded, must remain excluded.
- Any logic changes beyond what's needed to satisfy PHPCS/PHPStan (e.g. do
  not refactor function signatures for style reasons beyond what the tools
  flag).

## Git workflow

- Branch: `chore/expand-static-analysis-coverage`
- Commit 1: config changes only (`phpcs.xml`, `phpstan.neon`).
- Commit 2+ (if needed): fixes for violations found, grouped sensibly (e.g.
  one commit per file or per violation type — use judgment, but keep commits
  reviewable).
- Commit message style (conventional commits): `chore: expand PHPCS/PHPStan coverage to includes/`
- Do NOT push or open a PR unless explicitly instructed.

## Steps

### Step 1: Update `phpcs.xml`

Add `includes/` to the files analyzed, and exclude the vendored TGM library.
Target shape (changes marked):

```xml
<?xml version="1.0"?>
<ruleset name="Blocks for Leaflet Map">
    <description>WordPress Coding Standards for blocks-for-leaflet-map.</description>

    <!-- Files to analyse -->
    <file>blocks-for-leaflet-map.php</file>
    <file>src/leaflet-map-block/render.php</file>
    <file>includes</file>

    <!-- Exclude build output and vendor -->
    <exclude-pattern>build/*</exclude-pattern>
    <exclude-pattern>vendor/*</exclude-pattern>
    <exclude-pattern>node_modules/*</exclude-pattern>
    <exclude-pattern>includes/class-tgm-plugin-activation.php</exclude-pattern>

    <!-- ... rest unchanged ... -->
</ruleset>
```

**Verify**: `grep -n "includes\b" phpcs.xml` → shows both the new `<file>includes</file>`
line AND the new `<exclude-pattern>includes/class-tgm-plugin-activation.php</exclude-pattern>`
line.

### Step 2: Update `phpstan.neon`

Add `includes` to `paths`, and `includes/class-tgm-plugin-activation.php` to
`excludePaths` (it's currently only in `bootstrapFiles`, which is fine and
should remain — `bootstrapFiles` and `excludePaths` serve different
purposes: bootstrap loads class definitions for type-checking other files,
excludePaths skips analyzing the file itself).

Target shape:

```neon
includes:
    - vendor/szepeviktor/phpstan-wordpress/extension.neon

parameters:
    level: 5
    paths:
        - blocks-for-leaflet-map.php
        - src/leaflet-map-block/render.php
        - includes
    excludePaths:
        - vendor
        - node_modules
        - build
        - includes/class-tgm-plugin-activation.php
    bootstrapFiles:
        - vendor/php-stubs/wordpress-stubs/wordpress-stubs.php
        - includes/class-tgm-plugin-activation.php
```

**Verify**: `grep -n "includes" phpstan.neon` → shows `includes` under
`paths`, `includes/class-tgm-plugin-activation.php` under `excludePaths`,
AND the existing `includes/class-tgm-plugin-activation.php` under
`bootstrapFiles` is still present (3 total occurrences of "includes" as a
substring, across 3 different config keys).

### Step 3: Run PHPCS and triage violations

```bash
composer install --no-interaction --prefer-dist   # if vendor/ absent
composer lint
```

**Verify / triage**:
- If exit 0: done, no violations. Proceed to Step 5.
- If violations are reported: read the output. Each violation has a
  `file:line` and a rule code. For each violation:
  - If it's auto-fixable, try `composer run lint:fix` (= `phpcbf`) first,
    then re-run `composer lint` to confirm.
  - For remaining violations, fix them individually following WPCS
    conventions (the same conventions already applied in
    `blocks-for-leaflet-map.php` and `render.php`, which currently pass).
  - Common WPCS findings in newly-linted files tend to be: missing/incorrect
    docblocks, spacing/alignment, `Yoda conditions`, short ternary, or
    `WordPress.WP.I18n` text-domain issues. Fix each according to the rule's
    message — do not add blanket `// phpcs:ignore` suppressions unless a
    violation is a genuine false positive (and if so, document WHY with a
    comment, matching the existing `// phpcs:ignore
    WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted shortcode
    output, same rationale as render.php.` pattern already used in
    `includes/preview/template.php`).

### Step 4: Run PHPStan and triage errors

```bash
composer phpstan
```

**Verify / triage**: same approach as Step 3 — fix genuine errors (missing
type hints, possibly-undefined array keys, etc.) following the existing
typed style in this codebase (note: most `includes/` files already use
typed function signatures like `function bflm_build_marker_shortcodes( array
$markers ): string` — PHPStan level 5 should mostly pass cleanly given this,
but verify).

### Step 5: Final full run

```bash
composer lint && composer phpstan
```

**Verify**: both exit 0.

## Test plan

Not applicable — this plan changes tooling configuration and fixes
style/type issues, not behavior. No new tests. If plans 009/010 (PHPUnit
tests under `tests/includes/`) have landed before this plan, ensure
`phpcs.xml`/`phpstan.neon` either include or appropriately exclude
`tests/` — check `.distignore` already excludes `tests/` from the
distribution zip, but PHPCS/PHPStan may still want to lint test files for
consistency. If `tests/` exists when you run this plan, decide based on
whether `composer lint`/`composer phpstan` already error on `tests/` files
(if PHPUnit test files don't follow the same WPCS rules, e.g. they may need
`WordPress.Files.FileName` exceptions for test class naming — handle
pragmatically and note the decision in your report).

## Done criteria

ALL must hold:

- [ ] `phpcs.xml` includes `<file>includes</file>` and
      `<exclude-pattern>includes/class-tgm-plugin-activation.php</exclude-pattern>`.
- [ ] `phpstan.neon` includes `includes` in `paths` and
      `includes/class-tgm-plugin-activation.php` in `excludePaths` (in
      addition to the existing `bootstrapFiles` entry, which stays).
- [ ] `composer lint` exits 0 (or `vendor/` unavailable — see fallback note
      below).
- [ ] `composer phpstan` exits 0 (or `vendor/` unavailable — see fallback
      note below).
- [ ] `includes/class-tgm-plugin-activation.php` is NOT modified (`git diff
      --stat | grep class-tgm` → empty).
- [ ] Any fixes made to `includes/*.php` files preserve existing behavior —
      spot-check by reading the diff for each fixed file; changes should be
      style-only (docblocks, spacing, type hints) unless a STOP condition
      below was triggered.
- [ ] `plans/README.md` status row for plan 006 updated to DONE.

**Fallback note**: if `composer install` cannot run (no network/registry
access in the executor's environment), mark the config-file changes (Steps
1-2) as done, run the PHP syntax check fallback from "Commands you will
need" to confirm no fatal syntax errors were introduced, commit the config
changes, and set the status to DONE with a note: "PHPCS/PHPStan not run
locally (vendor/ unavailable) — will run in CI on push." Do not mark BLOCKED
for this reason alone, since the config change itself is the core
deliverable and CI will validate it.

## STOP conditions

Stop and report back (do not improvise) if:

- `phpcs.xml` or `phpstan.neon` do not match the "Current state" excerpts —
  the configs may have changed since this plan was written (e.g. if plan
  001/003/004/005 already touched these files, which they shouldn't have,
  per their own "Out of scope" sections — but verify).
- `composer lint` or `composer phpstan` report MORE THAN ~30 total
  violations/errors across `includes/`. That volume suggests either a
  config mistake (e.g. accidentally including `build/` or `node_modules/`
  due to a glob issue) or a genuinely large cleanup effort that should be
  its own separate plan rather than silently absorbed here. In that case:
  commit the config changes from Steps 1-2 only, do NOT attempt to fix all
  violations, and report the violation count + a summary of the most common
  rule codes — the operator can decide whether to scope a follow-up plan.
- Any violation/error fix would require changing a function's PUBLIC
  signature in a way that affects callers in `src/leaflet-map-block/render.php`
  or `includes/preview/template.php` (i.e., the shared `bflm_build_*_shortcodes()`
  builders) — these are cross-file contracts; report instead of changing
  signatures.

## Maintenance notes

- Going forward, any NEW file added under `includes/` is automatically
  covered by both configs (since they now reference the directory, not
  individual files) — no further config updates needed for new files in
  `includes/`.
- If `src/leaflet-map-block/edit.js` is ever split into PHP-adjacent helper
  files (unlikely — it's JS), or if a new top-level PHP directory is added
  (e.g. `admin/`), remember to add it to both configs following this same
  pattern.
- A reviewer should scrutinize: did any "fix" change behavior, not just
  style? Particularly around `WordPress.Security.EscapeOutput` /
  `WordPress.Security.ValidatedSanitizedInput` rules — these sometimes
  prompt adding `esc_*()`/`sanitize_*()` calls that ARE behavior changes
  (output encoding). If PHPCS flags something in `includes/preview/template.php`
  or the shortcode builders related to escaping, cross-check against plans
  003/004/005 (security hardening) to avoid duplicate/conflicting fixes.
