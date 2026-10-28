# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome/Brave extension that bookmarks websites and syncs them to a JSON file in a GitHub repository. No build step, no dependencies, no bundler — all files are plain JS/HTML loaded directly by the browser.

To test changes: go to `brave://extensions` → find File Bookmarks → click the reload icon.

## Architecture

### Storage split

Two storage layers are kept in sync on successful saves:

- **`chrome.storage.local`** — local cache of the full bookmarks object and the categories list. Used for instant reads (popup pre-fill, badge check) without a network call.
- **`chrome.storage.sync`** — GitHub config only (PAT, owner, repo, branch, filePath).

The GitHub file is the source of truth. On every save, `syncToGitHub()` in `popup.js` pulls the remote file first (to get the current SHA and any remote-only changes), merges local changes on top, writes back, then updates `chrome.storage.local` with the merged result. This prevents SHA mismatch errors and handles multi-device edits.

**Categories are not stored as a first-class field in the GitHub file**, but they are derived from bookmark entries on every popup open and after every successful sync via `deriveCategories()` in `popup.js`. On popup open: if local bookmarks are empty and GitHub is configured, a silent GET bootstraps local storage first; then unique non-empty `category` values are extracted from all bookmark entries and merged into `chrome.storage.local.categories`. After every successful `syncToGitHub()` call, the same derivation runs on the merged result. This means categories are fully recoverable from GitHub on any device after one popup open.

### Data shape

The JSON file is a flat object keyed by **cleaned URL** (UTM params stripped). Each entry:

```json
{
  "https://example.com/article": {
    "title": "...", "category": "...", "notes": "...",
    "read": false,
    "savedAt": "2026-04-11 10:30:00",
    "updatedAt": "2026-04-11 12:00:00"
  }
}
```

`updatedAt` is only added on overwrite. Entries are always sorted descending by `updatedAt ?? savedAt` before writing (`sortedByDate()` in `popup.js`).

Timestamps are produced by `new Date().toLocaleString('sv')`, which gives `YYYY-MM-DD HH:MM:SS` in the local timezone (Swedish locale happens to produce an ISO-8601-like format). Anything parsing the JSON file should expect this format.

### URL cleaning

`cleanUrl()` is duplicated in both `popup.js` and `background.js` (no shared module — plain scripts don't support ES imports without `type="module"`). Any change to UTM-stripping logic must be made in both files.

`cleanUrl()` only strips keys starting with `utm_`. Other common tracking params (`fbclid`, `gclid`, `ref`, `mc_cid`, `_hsenc`, etc.) are left in the URL and become part of the storage key. Two visits to the same page with different non-UTM tracking params will be stored as separate entries.

`githubHeaders()` is similarly duplicated in `popup.js` and `options.js`. `popup.js` includes `Content-Type: application/json` for its `PUT`; `options.js` adds that header only for the write-access probe's `POST`. Keep shared headers (e.g. `Authorization`, `Accept`, `X-GitHub-Api-Version`) consistent.

### Badge

`background.js` is a service worker that listens to `tabs.onActivated`, `tabs.onUpdated`, and `windows.onFocusChanged` to show a green `★` badge on the extension icon when the active tab's URL is already saved. The badge is also set directly from `popup.js` immediately after a successful save to avoid waiting for a tab event. Both use `cleanUrl()` before looking up the bookmarks object.

### Category UI state machine

The category row in the popup has three states managed by `addingNewCategory` (boolean) in `popup.js`:

1. **No saved categories** — plain text input shown, dropdown and `+` button hidden
2. **Categories exist, not adding** — dropdown shown, `+` button shown, text input hidden
3. **Adding new** — `+` becomes `×`, dropdown hides, text input shows

`getCategory()` respects this state: text input value takes priority when `addingNewCategory` is true, otherwise returns the dropdown selection.

### Overwrite flow

On popup open, the URL field is set to `cleanUrl(tab.url)` and then looked up in local bookmarks using the same cleaned URL. If found, `isExisting = true`, fields are pre-filled, and the save button changes to "Update Bookmark". The first click on save shows a confirmation row (`#confirm-row`); the actual write only happens on the confirm button click.

### GitHub API

All GitHub calls use `https://api.github.com/repos/{owner}/{repo}/contents/{filePath}`:
- `GET ?ref={branch}` with `cache: 'no-store'` — fetch current SHA + base64 content
- `PUT` with `{ message, content, branch, sha }` — write updated file

The PAT is sent only in the `Authorization: Bearer` header. The `host_permissions` in `manifest.json` restricts fetch calls to `https://api.github.com/*`.

Base64 encoding uses `btoa(unescape(encodeURIComponent(...)))` to handle Unicode. Decoding uses the inverse `JSON.parse(decodeURIComponent(escape(atob(...))))`.

## Known gaps / TODO

- **No delete** — there is no way to remove a bookmark from the extension. Would need a delete button in the popup (overwrite flow already opens the entry, so delete could live there) that removes the URL key from both `chrome.storage.local` and the GitHub file, and clears the badge.
- **No sync retry** — if GitHub sync fails after a save, the bookmark is only in `chrome.storage.local`. There is no queue or retry mechanism, so local and remote can silently diverge. A pending-sync flag in storage + a retry on next popup open would fix this.
- **No quick read-toggle** — marking a bookmark as read requires going through the full overwrite confirmation flow. A one-click toggle (e.g. from the badge or a dedicated button in the popup) would be more ergonomic.
- **No extension icon** — `manifest.json` has no `icons` field. A 16/32/48/128px PNG set is needed for the toolbar and extensions page.
- **PAT stored in plaintext** — the GitHub PAT is stored unencrypted in `chrome.storage.sync`. Document this clearly and keep the PAT scoped as narrowly as possible (single repo, Contents read/write only). There is no encryption API available to MV3 extensions for storage.
- **800ms auto-close may be too short** — `persistEntry()` fully awaits `syncToGitHub()` before setting status to "Saved & synced!" and starting the close timer, so the popup never closes while sync is in-flight. The issue is ergonomic: 800ms may not be enough time to read the success message, and if the user wants to verify or copy something they can't. Consider making the delay longer or requiring a deliberate close.
- **No way to edit without triggering overwrite confirmation** — any change to title, notes, or category on an existing bookmark requires the two-step overwrite confirmation. Minor edits feel heavyweight. A "quick edit" path that skips confirmation for non-destructive field changes would improve ergonomics.
- **Test connection verifies token write permission, not branch rules** — after checking the repository and branch, `options.js` calls `POST /repos/{owner}/{repo}/git/blobs`, which requires Contents: write. The fixed-content blob is unattached: no files, refs, or commits change. Only a 201 response passes. Branch protections can still block actual bookmark commits.
- **URL field is editable but `isExisting` is set only on init** — the URL input can be changed after the popup opens. If the user edits it to a URL that is already bookmarked, no overwrite warning appears (the banner only fires during init). If they edit it away from a bookmarked URL, they still get the overwrite confirmation because `isExisting` is never re-evaluated. Fixing this requires a live lookup on URL input change.
- **GitHub API rate limit** — authenticated requests are capped at 5,000/hour. Each save makes 2 API calls (GET + PUT). Not a concern for normal use, but heavy bulk-saving could hit the limit; errors at that point will surface as generic GitHub error messages.
- **MV3 service worker termination** — `background.js` runs as a service worker and can be killed by the browser after ~30 seconds of inactivity. Persistent events (`tabs.onActivated`, `tabs.onUpdated`, `windows.onFocusChanged`) will wake it on next activity, but there is a window where a tab switch may not trigger a badge update if the worker was terminated mid-event. This is a known MV3 platform constraint with no clean workaround.
- **Merge direction: local always wins** — the merge in `syncToGitHub()` is `{ ...remoteData, ...localData }`, so local changes overwrite remote for any URL present in both. This is intentional (the current edit wins), but it means changes made to the same URL on another device since the last pull are silently discarded on every save, not just on simultaneous saves.
- **PAT expiration causes silent save failures** — GitHub fine-grained PATs can be configured with an expiry date. Once expired, every GitHub sync step will fail with a 401 auth error. There is no proactive warning in the extension; unexpected save failures after a period of working use are a signal to check PAT expiration.
- **Concurrent saves — last write wins** — because the merge is `{ ...remoteData, ...localData }`, if two devices save different changes to the same URL at roughly the same time, the second PUT wins and overwrites the first device's changes entirely. Different-URL edits from different devices merge safely.

## Key constraints

- **No `type="module"`** — `popup.js` and `options.js` are plain scripts. Do not add ES module imports.
- **`chrome.storage.sync` limits** — 8KB per key, 100KB total. The five config keys (PAT, owner, repo, branch, filePath) are tiny and well within limits.
- **Branch must exist** — the extension never creates branches. The GitHub API returns a 404 on GET (treated as "file doesn't exist yet, create it") vs a non-404 error (propagated to the user).
- **Brave blocks File System Access API pickers** (`showSaveFilePicker`, `showOpenFilePicker`) in extension pages — this was the reason for switching to GitHub sync. Do not attempt to re-introduce these.
