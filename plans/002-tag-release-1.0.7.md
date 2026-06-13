# Plan 002: Tag and release v1.0.7

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 313481a..HEAD -- blocks-for-leaflet-map.php readme.txt package.json src/leaflet-map-block/block.json`
> If any of these files changed since this plan was written, re-read them
> before proceeding — version numbers may have moved further (e.g. to
> 1.0.8) and this plan's "1.0.7" references should track whatever the
> CURRENT version in those files is, not be force-set back to 1.0.7.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-fix-fitmarkers-oscillation.md (recommended — see
  "Why this matters")
- **Category**: tech-debt / release
- **Planned at**: commit `313481a`, 2026-06-12
- **Issue**: none (release housekeeping)

## Why this matters

`readme.txt` declares `Stable tag: 1.0.7` and `package.json` declares
`"version": "1.0.7"`, and commit `7b655e2` ("chore: bump version to 1.0.7")
already landed on `main` via PR #26 (merge commit `313481a`). However, `git
tag` shows the most recent tag is `v1.0.6` — there is **no `v1.0.7` git
tag**. WordPress.org's plugin directory requires the `Stable tag` value in
`readme.txt` to correspond to an actual tagged/released version; a mismatch
between declared version and release history is a common cause of review
rejection or SVN-sync confusion once the plugin is on WordPress.org.

This plan should land AFTER plan 001 (the issue #23 fix) so that the v1.0.7
tag represents a release without the editor-breaking oscillation bug. If
plan 001 has already been merged and its own version bump (if any) has
occurred, treat that as the version to tag instead — see the drift check
above.

## Current state

- `git tag` (most recent entries): `v1.0.4`, `v1.0.5`, `v1.0.6` — no
  `v1.0.7`.
- `git log --oneline -3` on `main` (at the time this plan was written):
  ```
  313481a Merge pull request #26 from jesusyesares/chore/bump-1.0.7
  7b655e2 chore: bump version to 1.0.7
  d508514 Merge pull request #25 from jesusyesares/refactor/docs-and-tgm-note
  ```
- The five version-bump locations (per this repo's CLAUDE.md "Version Bump
  Locations" section) were already updated to `1.0.7` in commit `7b655e2`:
  1. `blocks-for-leaflet-map.php` — plugin header `Version:` comment
  2. `blocks-for-leaflet-map.php` — `BFLM_VERSION` constant
  3. `src/leaflet-map-block/block.json`
  4. `readme.txt` — `Stable tag:`
  5. `package.json` — `"version"`

  This plan does NOT need to re-bump these — only confirm they already say
  `1.0.7` (or whatever the current `main` version is, per the drift check),
  then create the matching git tag.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Confirm current branch/state | `git status` | clean working tree, or only expected in-progress changes |
| Confirm version consistency | `grep -h "Version:\|BFLM_VERSION\|\"version\"\|Stable tag" blocks-for-leaflet-map.php src/leaflet-map-block/block.json readme.txt package.json` | all show the same version number |
| List existing tags | `git tag --list "v1.0.*"` | shows v1.0.0 through v1.0.6, no v1.0.7 |
| Confirm main is up to date | `git fetch origin && git log origin/main -1 --oneline` | matches local `main` HEAD |
| Create the tag | `git tag -a v1.0.7 -m "v1.0.7"` | exit 0 |
| Verify the tag | `git show v1.0.7 --stat | head -5` | shows the tag pointing at the version-bump merge commit |

## Scope

**In scope**:
- Creating an annotated git tag `v1.0.7` (or the current version per the
  drift check) pointing at the appropriate commit on `main`.

**Out of scope** (do NOT do these — they require explicit operator
authorization beyond this plan):
- Pushing the tag to the remote (`git push origin v1.0.7`) — STOP and report
  that the tag is ready locally; let the operator push it.
- Creating a GitHub Release from the tag.
- Running `npm run plugin-zip` or any distribution packaging.
- Bumping the version further (e.g. to 1.0.8) — if the current `main`
  version is NOT 1.0.7 (see drift check), STOP and report; do not guess
  which version to tag.
- Modifying any of the 5 version-bump files — they should already be correct
  per "Current state" above. If they are NOT consistent, that's a STOP
  condition (see below), not something to fix as part of this plan.

## Git workflow

- No new branch needed — tagging operates on an existing commit on `main`.
- Do NOT push the tag (see Out of scope). Report the tag is created locally
  and ready for the operator to push with `git push origin v1.0.7`.

## Steps

### Step 1: Confirm version consistency across the 5 locations

Run:
```bash
grep -n "Version:\s*1\.0\.7\|BFLM_VERSION.*1\.0\.7" blocks-for-leaflet-map.php
grep -n "\"version\":\s*\"1.0.7\"" src/leaflet-map-block/block.json
grep -n "Stable tag:\s*1\.0\.7" readme.txt
grep -n "\"version\":\s*\"1.0.7\"" package.json
```

**Verify**: all four commands return a match. If any does NOT match `1.0.7`
but the others do, or if they're all consistent but at a DIFFERENT version
(e.g. all say `1.0.8`), STOP and report — see "STOP conditions".

### Step 2: Confirm `main` is checked out and up to date

```bash
git rev-parse --abbrev-ref HEAD
git fetch origin
git log -1 --oneline
git log origin/main -1 --oneline
```

**Verify**: current branch is `main` (or the operator's equivalent default
branch), and the local HEAD commit matches `origin/main`'s HEAD. If you're
on a different branch, switch to `main` first (`git checkout main && git
pull`) — do not tag a commit on a feature branch.

### Step 3: Confirm `v1.0.7` does not already exist

```bash
git tag --list "v1.0.7"
```

**Verify**: empty output (no existing `v1.0.7` tag). If it already exists,
STOP — see "STOP conditions" (do not overwrite an existing tag).

### Step 4: Create the annotated tag

```bash
git tag -a v1.0.7 -m "v1.0.7"
```

**Verify**:
```bash
git tag --list "v1.0.7"
git show v1.0.7 --stat | head -5
```
Should show the tag exists and points at the commit containing the version
bump to 1.0.7 (commit `7b655e2` or the merge commit `313481a`, per "Current
state").

## Test plan

Not applicable — this is a release-process step, not a code change. No new
tests.

## Done criteria

ALL must hold:

- [ ] Step 1's four version-consistency checks all pass for the same version
      number.
- [ ] `git tag --list "v1.0.7"` (or the current-version equivalent) shows the
      new tag exists locally.
- [ ] `git show <tag> --stat | head -5` confirms the tag points at a commit
      on `main` containing the version-bump changes.
- [ ] The tag has NOT been pushed to `origin` (confirm with `git ls-remote
      --tags origin | grep v1.0.7` → empty).
- [ ] `plans/README.md` status row for plan 002 updated to DONE, with a note
      that the tag is created locally and awaiting operator push.

## STOP conditions

Stop and report back (do not improvise) if:

- The 5 version-bump locations are NOT all consistent with each other (e.g.
  `readme.txt` says `1.0.7` but `package.json` says `1.0.6`). This indicates
  an incomplete version bump that needs separate attention — do not "fix" it
  as part of this tagging plan.
- The consistent version across all 5 locations is something OTHER than
  `1.0.7` (e.g. `1.0.8` because plan 001's fix included its own version
  bump). In that case, report back with the actual version found — the tag
  to create should match that version (e.g. `v1.0.8`), but confirm with the
  operator before creating a tag for a version number not anticipated by
  this plan.
- A `v1.0.7` tag (or matching the current version) already exists.
- The current branch / `main` has uncommitted changes that would make
  tagging ambiguous (`git status` is not clean).
- `main` (local) and `origin/main` have diverged.

## Maintenance notes

- After the operator pushes this tag, the next step toward WordPress.org
  submission (per the audit's direction findings) is the i18n `.pot`
  regeneration (plan 008) and the security/tooling hardening plans
  (003-006) — none of which strictly depend on this tag existing, but doing
  the release tag first gives a clean checkpoint to diff future submission
  prep against.
- If this repo later adopts a release-automation workflow (e.g. a GitHub
  Action that tags on version-bump merge to `main`), this manual step can be
  retired — flag that as a DX improvement opportunity if you notice the
  pattern repeats for 1.0.8, 1.0.9, etc.
