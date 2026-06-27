# Plan 007: Pin @wordpress/* dependencies to semver ranges instead of "latest"

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 313481a..HEAD -- package.json package-lock.json`
> If these files changed since this plan was written, re-read `package.json`
> and re-resolve the "Current state" version numbers before proceeding —
> the currently-resolved versions of `"latest"` may differ from what's
> recorded below.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dependencies / tech-debt
- **Planned at**: commit `313481a`, 2026-06-12
- **Issue**: none (found during /improve audit)

## Why this matters

`package.json` pins three runtime dependencies to the literal string
`"latest"`:

```json
"dependencies": {
    "@wordpress/block-editor": "latest",
    "@wordpress/blocks": "latest",
    "@wordpress/i18n": "latest"
}
```

`"latest"` is not a semver range — every time `npm install` runs without an
existing `package-lock.json` (e.g. a fresh clone, or `npm install` after
deleting `package-lock.json`), npm resolves these to whatever the CURRENT
latest published version is at that moment, which could be a major-version
bump introducing breaking changes, with zero warning. The committed
`package-lock.json` mitigates this for `npm ci` (used in
`.github/workflows/ci.yml`), but `"latest"` in `package.json` is misleading
about the actual tested/supported version range and is flagged by dependency
auditing tools. The devDependency `@wordpress/scripts: "^31.8.0"` already
uses a proper semver range — this plan brings the three runtime deps in line
with that convention.

## Current state

`package.json`, `dependencies` section:

```json
"dependencies": {
    "@wordpress/block-editor": "latest",
    "@wordpress/blocks": "latest",
    "@wordpress/i18n": "latest"
},
"devDependencies": {
    "@wordpress/scripts": "^31.8.0"
}
```

Currently-resolved versions (from `package-lock.json`, at the time this plan
was written):

| Package | Resolved version |
|---|---|
| `@wordpress/block-editor` | `15.16.0` |
| `@wordpress/blocks` | `15.16.0` |
| `@wordpress/i18n` | `6.16.0` |

(Re-confirm these via the command in Step 1 — they may have drifted if
`package-lock.json` changed since this plan was written, per the drift
check.)

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Confirm currently-resolved versions | `node -e "const l=require('./package-lock.json'); ['@wordpress/block-editor','@wordpress/blocks','@wordpress/i18n'].forEach(p=>console.log(p, l.packages['node_modules/'+p]?.version))"` | prints 3 version numbers |
| Reinstall to update lockfile | `npm install` | exit 0, `package-lock.json` updated (if changed at all) |
| Build (confirm nothing broke) | `npm run build` | exit 0 |
| Lint JS | `npm run lint:js` | exit 0, or pre-existing warnings only |

## Scope

**In scope** (the only files you should modify):
- `package.json` — change the 3 `"latest"` entries to semver caret ranges.
- `package-lock.json` — will be updated automatically by `npm install`
  (do not hand-edit it).

**Out of scope**:
- `@wordpress/scripts` (devDependency) — already correctly pinned
  (`^31.8.0`), do not change.
- Any other dependency.
- Upgrading to a NEWER major version than what's currently resolved — this
  plan pins the CURRENT resolved versions as the floor of a caret range, it
  does not intentionally upgrade. If `npm install` happens to pull a newer
  patch/minor version within the new range, that's expected and fine (caret
  ranges allow that) — but do not manually bump the version numbers beyond
  what's currently resolved.

## Git workflow

- Branch: `chore/pin-wordpress-deps-semver`
- One commit covering both `package.json` and the resulting
  `package-lock.json` diff.
- Commit message style: `chore: pin @wordpress/* runtime deps to semver ranges`
- Do NOT push or open a PR unless explicitly instructed.

## Steps

### Step 1: Confirm currently-resolved versions

```bash
node -e "const l=require('./package-lock.json'); ['@wordpress/block-editor','@wordpress/blocks','@wordpress/i18n'].forEach(p=>console.log(p, l.packages['node_modules/'+p]?.version))"
```

**Verify**: prints 3 lines, each `<package-name> <version>`. Use these exact
versions (not the ones in "Current state" above, in case of drift) for Step
2.

### Step 2: Update `package.json`

Replace the `dependencies` block. Using the versions confirmed in Step 1
(shown here using the versions known at plan-writing time — substitute if
different):

```json
"dependencies": {
    "@wordpress/block-editor": "^15.16.0",
    "@wordpress/blocks": "^15.16.0",
    "@wordpress/i18n": "^6.16.0"
},
```

Use a `^` (caret) range — matches the convention already used for
`@wordpress/scripts`. Do not use `~` (tilde) or exact pins — caret is the
npm/WordPress ecosystem convention for these packages (allows minor/patch
updates, blocks major version jumps).

**Verify**: `grep -A3 '"dependencies"' package.json` → shows all three
`@wordpress/*` packages with `^<version>` (no `"latest"` remaining anywhere
in the dependencies block).

### Step 3: Refresh the lockfile

```bash
npm install
```

**Verify**: exit 0. `git diff package-lock.json` should show minimal or no
changes — since the caret ranges match the already-resolved versions, npm
should keep the same resolved versions (or bump to a newer compatible
patch/minor if one was published since `package-lock.json` was last
generated, which is fine).

### Step 4: Confirm the build still works

```bash
npm run build
```

**Verify**: exit 0, `build/leaflet-map-block/index.js` etc. are regenerated
without errors.

## Test plan

Not applicable — this is a dependency-pinning change with no behavior
change (the resolved versions are unchanged or only bumped within the new
caret range). `npm run build` (Step 4) and `npm test` (if it runs quickly and
without side effects) serve as the verification.

```bash
npm test
```

**Verify**: exits with the same result as before this change (if it was
passing before, it should still pass; if there's no test suite, it exits
quickly with "no tests found" — either is fine, just confirm it's
UNCHANGED from pre-change behavior).

## Done criteria

ALL must hold:

- [ ] `package.json`'s `dependencies` block has no remaining `"latest"`
      values — `grep -c '"latest"' package.json` → `0`.
- [ ] All three `@wordpress/block-editor`, `@wordpress/blocks`,
      `@wordpress/i18n` use `^<version>` semver ranges.
- [ ] `npm install` exits 0.
- [ ] `npm run build` exits 0.
- [ ] `npm run lint:js` exits 0 or shows only pre-existing warnings.
- [ ] No files outside `package.json` / `package-lock.json` are modified.
- [ ] `plans/README.md` status row for plan 007 updated to DONE.

## STOP conditions

Stop and report back (do not improvise) if:

- `npm install` resolves a DIFFERENT major version than what was recorded in
  "Current state" / Step 1 for any of the three packages (i.e., the caret
  range you wrote doesn't match what's actually in `package-lock.json`
  before your change — this would mean the lockfile and your assumed
  "current" version are out of sync). Report the discrepancy rather than
  guessing which version to pin.
- `npm run build` fails after the dependency change. This would indicate the
  resolved versions are NOT actually compatible with this codebase despite
  being currently locked — investigate whether `package-lock.json` was
  already stale/broken before this plan, and report findings rather than
  attempting to fix unrelated build issues.

## Maintenance notes

- Future `@wordpress/scripts` major-version upgrades (e.g. v32, v33) often
  bump the compatible `@wordpress/*` package versions too — when upgrading
  `@wordpress/scripts`, revisit these three caret ranges at the same time.
- A reviewer should scrutinize: `git diff package-lock.json` — it should be
  a small diff (ideally near-zero) since this plan pins to ALREADY-RESOLVED
  versions. A large lockfile diff would suggest `npm install` pulled in
  unrelated transitive dependency updates, which should be called out
  separately.
