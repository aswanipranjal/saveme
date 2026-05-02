const statusEl         = document.getElementById('status');
const syncHintEl       = document.getElementById('sync-hint');
const categorySelect = document.getElementById('category-select');
const categoryInput  = document.getElementById('category-input');
const addCatBtn      = document.getElementById('add-cat-btn');

let addingNewCategory = false;
const overwriteBanner  = document.getElementById('overwrite-banner');
const confirmRow       = document.getElementById('confirm-row');
const saveBtn          = document.getElementById('save-btn');

let isExisting = false;

function setStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = type;
}

function localTimestamp() {
  return new Date().toLocaleString('sv').replace('T', ' ');
}

function cleanUrl(raw) {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_')) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

document.getElementById('opts-link').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ── GitHub helpers ────────────────────────────────────────────────────────

function githubHeaders(pat) {
  return {
    'Authorization': `Bearer ${pat}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

function jsonToBase64(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2))));
}

function base64ToJson(b64) {
  return JSON.parse(decodeURIComponent(escape(atob(b64.replace(/\n/g, '')))));
}

function sortedByDate(data) {
  return Object.fromEntries(
    Object.entries(data).sort(([, a], [, b]) => {
      const dateA = a.updatedAt ?? a.savedAt ?? '';
      const dateB = b.updatedAt ?? b.savedAt ?? '';
      return dateB.localeCompare(dateA);
    })
  );
}

function deriveCategories(bookmarks) {
  const cats = new Set();
  for (const entry of Object.values(bookmarks || {})) {
    if (entry.category) cats.add(entry.category);
  }
  return [...cats].sort();
}

async function syncToGitHub(cfg, localData, title, isOverwrite) {
  const { pat, owner, repo, branch, filePath } = cfg;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

  // 1. Pull current remote state — bypass cache to always get the latest SHA
  let sha;
  let remoteData = {};
  const getRes = await fetch(`${apiUrl}?ref=${branch}`, {
    headers: githubHeaders(pat),
    cache: 'no-store',
  });
  if (getRes.ok) {
    const file = await getRes.json();
    sha = file.sha;
    try { remoteData = base64ToJson(file.content); } catch { remoteData = {}; }
  } else if (getRes.status !== 404) {
    const body = await getRes.json().catch(() => ({}));
    throw new Error(body.message || `GitHub read failed (${getRes.status})`);
  }

  // 2. Merge: remote as base, local changes on top, then sort descending
  const merged = sortedByDate({ ...remoteData, ...localData });

  // 3. Keep local storage in sync with the merged result
  const { categories: storedCats } = await chrome.storage.local.get(['categories']);
  const allCats = [...new Set([...(storedCats || []), ...deriveCategories(merged)])].sort();
  await chrome.storage.local.set({ bookmarks: merged, categories: allCats });

  // 4. Write merged file
  const commitMsg = isOverwrite
    ? `Update bookmark: ${title || 'untitled'}`
    : `Add bookmark: ${title || 'untitled'}`;

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: githubHeaders(pat),
    body: JSON.stringify({
      message: commitMsg,
      content: jsonToBase64(merged),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!putRes.ok) {
    const body = await putRes.json().catch(() => ({}));
    throw new Error(body.message || `GitHub write failed (${putRes.status})`);
  }
}

// ── Category UI ───────────────────────────────────────────────────────────

function showDropdown() {
  addingNewCategory = false;
  categorySelect.style.display = '';
  categoryInput.style.display = 'none';
  categoryInput.value = '';
  addCatBtn.textContent = '+';
}

function showNewInput() {
  addingNewCategory = true;
  categorySelect.style.display = 'none';
  categoryInput.style.display = '';
  categoryInput.placeholder = 'New category name...';
  addCatBtn.textContent = '×';
  categoryInput.focus();
}

addCatBtn.addEventListener('click', () => {
  addingNewCategory ? showDropdown() : showNewInput();
});

function buildCategoryUI(cats, selected = '') {
  addingNewCategory = false;
  categoryInput.value = '';

  if (cats.length > 0) {
    categorySelect.innerHTML = '<option value="">-- No category --</option>';
    cats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      if (c === selected) opt.selected = true;
      categorySelect.appendChild(opt);
    });
    categorySelect.style.display = '';
    categoryInput.style.display = 'none';
    addCatBtn.style.display = '';
    addCatBtn.textContent = '+';
  } else {
    // No categories yet — show text input directly, no dropdown or + button
    categorySelect.style.display = 'none';
    categoryInput.style.display = '';
    categoryInput.placeholder = 'Add category...';
    addCatBtn.style.display = 'none';
    if (selected) categoryInput.value = selected;
  }
}

function getCategory() {
  if (addingNewCategory) return categoryInput.value.trim();
  if (categorySelect.style.display !== 'none') return categorySelect.value;
  return categoryInput.value.trim();
}

// ── Init ──────────────────────────────────────────────────────────────────

confirmRow.style.display = 'none';

(async () => {
  const [tab, { bookmarks: localBookmarks, categories: localCats }, cfg] = await Promise.all([
    new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => r(t))),
    chrome.storage.local.get(['bookmarks', 'categories']),
    chrome.storage.sync.get(['pat', 'owner', 'repo', 'branch', 'filePath']),
  ]);

  if (tab) {
    document.getElementById('title').value = tab.title || '';
    document.getElementById('url').value   = cleanUrl(tab.url || '');
  }

  const { pat, owner, repo, branch, filePath } = cfg;
  if (pat && owner && repo) {
    syncHintEl.innerHTML =
      `Syncing to: <span>${owner}/${repo}</span> @ <span>${branch || 'main'}</span> → <span>${filePath || 'bookmarks.json'}</span>`;
  } else {
    syncHintEl.innerHTML = '<span style="color:#ffd60a">GitHub not configured — open Settings first</span>';
    saveBtn.disabled = true;
  }

  // Bootstrap: if local bookmarks are empty and GitHub is configured, pull from GitHub.
  // This populates a new device on first open without requiring a save first.
  let bookmarks = localBookmarks || {};
  if (pat && owner && repo && Object.keys(bookmarks).length === 0) {
    try {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath || 'bookmarks.json'}`;
      const res = await fetch(`${apiUrl}?ref=${branch || 'main'}`, {
        headers: githubHeaders(pat),
        cache: 'no-store',
      });
      if (res.ok) {
        const file = await res.json();
        try { bookmarks = base64ToJson(file.content); } catch { bookmarks = {}; }
        if (Object.keys(bookmarks).length > 0) {
          await chrome.storage.local.set({ bookmarks });
        }
      }
    } catch { /* silent — don't block popup on network error */ }
  }

  // Derive categories from bookmarks and merge with stored list.
  // Covers both new-device (just bootstrapped) and lost-categories-on-existing-device cases.
  const cats = [...new Set([...(localCats || []), ...deriveCategories(bookmarks)])].sort();
  if (cats.length > (localCats || []).length) {
    await chrome.storage.local.set({ categories: cats });
  }

  buildCategoryUI(cats);

  // Pre-fill if URL already bookmarked (use cleaned URL as that's what's stored)
  const cleanedTabUrl = cleanUrl(tab?.url || '');
  if (cleanedTabUrl && bookmarks?.[cleanedTabUrl]) {
    const entry = bookmarks[cleanedTabUrl];
    isExisting = true;
    overwriteBanner.style.display = '';
    if (entry.title) document.getElementById('title').value = entry.title;
    if (entry.notes) document.getElementById('notes').value = entry.notes;
    if (entry.read)  document.getElementById('read-checkbox').checked = true;
    document.getElementById('read-label').textContent = entry.read ? 'Marked as read' : 'Mark as read';
    buildCategoryUI(cats, entry.category || '');
    saveBtn.textContent = 'Update Bookmark';
  }
})();

document.getElementById('read-checkbox').addEventListener('change', function () {
  document.getElementById('read-label').textContent = this.checked ? 'Marked as read' : 'Mark as read';
});

// ── Save / overwrite flow ─────────────────────────────────────────────────

function collectFields() {
  return {
    title:    document.getElementById('title').value.trim(),
    url:      cleanUrl(document.getElementById('url').value.trim()),
    notes:    document.getElementById('notes').value.trim(),
    category: getCategory(),
    read:     document.getElementById('read-checkbox').checked,
  };
}

saveBtn.addEventListener('click', () => {
  const { url } = collectFields();
  if (!url) { setStatus('URL is required.', 'err'); return; }

  if (isExisting) {
    saveBtn.style.display = 'none';
    confirmRow.style.display = 'flex';
    setStatus('Confirm overwrite below.', 'warn');
  } else {
    persistEntry(false);
  }
});

document.getElementById('cancel-btn').addEventListener('click', () => {
  confirmRow.style.display = 'none';
  saveBtn.style.display = '';
  setStatus('');
});

document.getElementById('confirm-btn').addEventListener('click', () => {
  persistEntry(true);
});

async function persistEntry(isOverwrite) {
  const { title, url, notes, category, read } = collectFields();


  saveBtn.disabled = true;
  confirmRow.querySelectorAll('button').forEach(b => b.disabled = true);
  setStatus('Saving…', '');

  try {
    const [{ bookmarks, categories }, cfg] = await Promise.all([
      chrome.storage.local.get(['bookmarks', 'categories']),
      chrome.storage.sync.get(['pat', 'owner', 'repo', 'branch', 'filePath']),
    ]);

    const data = bookmarks || {};
    const now  = localTimestamp();

    if (isOverwrite && data[url]) {
      data[url] = { ...data[url], title, category, notes, read, updatedAt: now };
    } else {
      data[url] = { title, category, notes, read, savedAt: now };
    }

    const updates = { bookmarks: data };
    if (category) {
      const cats = categories || [];
      if (!cats.includes(category)) updates.categories = [...cats, category].sort();
    }

    // 1. Save locally first
    await chrome.storage.local.set(updates);

    // 2. Sync to GitHub
    setStatus('Syncing to GitHub…', '');
    await syncToGitHub(cfg, data, title, isOverwrite);

    // Update badge immediately without waiting for a tab event
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) {
        chrome.action.setBadgeText({ text: '★', tabId: tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#30d158', tabId: tab.id });
      }
    });

    setStatus('Saved & synced!', 'ok');
    setTimeout(() => window.close(), 800);
  } catch (err) {
    // Local save succeeded — warn but don't block
    if (err.message.includes('GitHub') || err.message.includes('fetch')) {
      setStatus('Saved locally. GitHub sync failed: ' + err.message, 'warn');
    } else {
      setStatus('Error: ' + err.message, 'err');
    }
    saveBtn.disabled = false;
    confirmRow.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}
