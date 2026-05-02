# File Bookmarks

A Brave/Chrome extension that bookmarks websites and syncs them to a JSON file in a GitHub repository on every save.

## How it works

Bookmarks are stored in two places:

1. **Local browser storage** — a cache inside the extension, used for instant reads (e.g. pre-filling the popup when you revisit a saved URL)
2. **GitHub** — the source of truth. On every save the extension pulls the current file from GitHub, merges your change on top, and pushes it back as a commit

There is no backend, no native app to install, and no file system access required.

---

## Data structure

Bookmarks are stored as a JSON object keyed by URL:

```json
{
  "https://example.com/article": {
    "title": "Some Article",
    "category": "Research",
    "notes": "interesting point about X",
    "read": false,
    "savedAt": "2026-04-11 10:30:00"
  },
  "https://another.com": {
    "title": "Another Page",
    "category": "Tools",
    "notes": "",
    "read": true,
    "savedAt": "2026-04-11 11:00:00",
    "updatedAt": "2026-04-11 12:00:00"
  }
}
```

- `savedAt` — local timestamp of first save, format `YYYY-MM-DD HH:MM:SS`
- `updatedAt` — local timestamp of last overwrite (only present if the entry was ever updated), same format
- Entries are always written in descending order by `updatedAt ?? savedAt`
- UTM parameters (`utm_source`, `utm_medium`, etc.) are automatically stripped from URLs before saving. Other tracking params (`fbclid`, `gclid`, `ref`, etc.) are not stripped and remain in the storage key.

---

## Features

- **Categories** — select from a dropdown of previously used categories, or click `+` to add a new one using the same input field. Categories are saved locally and sorted alphabetically.
- **Read / Unread** — checkbox on each bookmark.
- **Overwrite detection** — if the current tab's URL is already in your bookmarks, the popup pre-fills all fields with the existing entry and shows a warning banner. Saving requires a two-step confirmation; on confirm, `updatedAt` is set.
- **GitHub sync** — every save pulls the remote file first (to get the current SHA and merge any remote changes), then pushes the updated file as a commit. If sync fails, the bookmark is still saved locally and a warning is shown.
- **Commit messages** — `Add bookmark: {title}` for new entries, `Update bookmark: {title}` for overwrites.

---

## File structure

```
saveme!/
└── extension/
    ├── manifest.json   # Manifest V3, declares storage + api.github.com host permission
    ├── background.js   # Service worker — manages the ★ badge on the extension icon
    ├── popup.html/js   # Bookmark popup — shown when you click the extension icon
    └── options.html/js # Settings page — GitHub config and connection test
```

---

## Setup

### 1. Generate a GitHub Personal Access Token

Create a **fine-grained PAT** scoped to only the repository you want to use:

- Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
- Set repository access to **Only select repositories** and pick your target repo
- Under **Repository permissions**, set **Contents** to **Read and write**
- Leave everything else at **No access**

### 2. Load the extension in Brave

1. Go to `brave://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` folder
4. Pin the extension from the puzzle-piece icon in the toolbar

### 3. Configure Settings

Click the extension icon → **Settings** and fill in:

| Field | Example | Notes |
|---|---|---|
| GitHub PAT | `github_pat_...` | Fine-grained, Contents read/write only |
| Owner | `aswanipranjal` | Your GitHub username |
| Repository | `saveme` | The target repo |
| Branch | `main` | Must already exist |
| File path | `bookmarks.json` | Created on first save if absent |

Click **Test connection** to verify the PAT, repo, and branch are all reachable before saving.

### 4. Save your first bookmark

Navigate to any page, click the extension icon, fill in the fields, and click **Save Bookmark**. The extension will save locally and push a commit to GitHub.

---

## Known limitations / Roadmap

- **No delete** — bookmarks can't be removed from the extension yet; edit the JSON file on GitHub directly in the meantime
- **No sync retry** — if GitHub sync fails, the bookmark is saved locally but not pushed; local and remote can diverge until the next successful save on the same URL
- **No quick read toggle** — marking a bookmark as read requires going through the full overwrite confirmation flow
- **No extension icon** — the toolbar shows a default grey icon; a proper icon set hasn't been added yet
- **Cross-device bootstrap** — on a new device, opening the popup for the first time triggers a silent pull from GitHub to populate the local bookmark cache and rebuild the category dropdown from the bookmark entries. If the fetch fails (no network, expired PAT), the popup opens with empty state and recovers on the next successful save.
- **PAT stored in plaintext** — the GitHub Personal Access Token is stored unencrypted in the browser profile. Treat it as a low-privilege secret and use a fine-grained PAT scoped to a single repo with Contents access only.
- **Auto-close may be too fast** — after a successful save the popup closes automatically. It may disappear before you've had time to read the confirmation.
- **No way to edit without overwrite confirmation** — updating a note or changing a category requires going through the full two-step overwrite flow even for minor edits. Inline editing without confirmation would be more ergonomic.
- **Test connection doesn't verify write access** — the Settings page tests that the repo and branch exist but doesn't confirm the PAT has write permission. A read-only PAT passes the test and then fails silently on the first save.
- **Editing the URL field bypasses overwrite detection** — the overwrite warning is set on popup open based on the current tab's URL. If you manually edit the URL field to a URL that's already bookmarked, no warning is shown and it will silently overwrite the existing entry.
- **Badge may occasionally miss a tab switch** — the background service worker can be terminated by the browser when idle. The badge will catch up on the next tab event, but there is a brief window where it may not reflect the current tab's bookmark status.
- **PAT expiration causes silent save failures** — GitHub fine-grained PATs can be configured with an expiry date. Once expired, every save will fail at the GitHub sync step with an auth error. The extension has no proactive warning for this; if saves start failing unexpectedly, check whether the PAT has expired and generate a new one.
- **Concurrent saves from two devices** — if two devices save the same URL at roughly the same time, the second save wins and overwrites the first. Saves to different URLs from different devices merge safely.

---

## Reloading after edits

Go to `brave://extensions`, find File Bookmarks, and click the refresh icon. No reinstall needed.
