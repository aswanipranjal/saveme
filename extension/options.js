const statusEl = document.getElementById('status');

function setStatus(msg, type = '', autoClear = true) {
  statusEl.textContent = msg;
  statusEl.className = type;
  if (autoClear) setTimeout(() => { statusEl.textContent = ''; statusEl.className = ''; }, 4000);
}

// ── Load saved config ─────────────────────────────────────────────────────

(async () => {
  const cfg = await chrome.storage.sync.get(['pat', 'owner', 'repo', 'branch', 'filePath']);
  if (cfg.pat)      document.getElementById('pat').value       = cfg.pat;
  if (cfg.owner)    document.getElementById('owner').value     = cfg.owner;
  if (cfg.repo)     document.getElementById('repo').value      = cfg.repo;
  if (cfg.branch)   document.getElementById('branch').value    = cfg.branch;
  if (cfg.filePath) document.getElementById('file-path').value = cfg.filePath;
})();

// ── PAT show / hide toggle ────────────────────────────────────────────────

document.getElementById('pat-toggle').addEventListener('click', () => {
  const input  = document.getElementById('pat');
  const toggle = document.getElementById('pat-toggle');
  const isHidden = input.type === 'password';
  input.type     = isHidden ? 'text' : 'password';
  toggle.textContent = isHidden ? 'hide' : 'show';
});

// ── Collect fields ────────────────────────────────────────────────────────

function collectConfig() {
  return {
    pat:      document.getElementById('pat').value.trim(),
    owner:    document.getElementById('owner').value.trim(),
    repo:     document.getElementById('repo').value.trim(),
    branch:   document.getElementById('branch').value.trim()   || 'main',
    filePath: document.getElementById('file-path').value.trim() || 'bookmarks.json',
  };
}

function validate(cfg) {
  if (!cfg.pat)    return 'PAT is required.';
  if (!cfg.owner)  return 'Owner is required.';
  if (!cfg.repo)   return 'Repository is required.';
  return null;
}

// ── Test connection ───────────────────────────────────────────────────────

document.getElementById('test-btn').addEventListener('click', async () => {
  const cfg = collectConfig();
  const err = validate(cfg);
  if (err) { setStatus(err, 'err'); return; }

  setStatus('Testing…', '', false);

  try {
    // Try to fetch the repo to verify auth + repo access
    const res = await fetch(
      `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`,
      { headers: githubHeaders(cfg.pat) }
    );

    if (res.status === 401) { setStatus('Auth failed — check your PAT.', 'err'); return; }
    if (res.status === 404) { setStatus(`Repo "${cfg.owner}/${cfg.repo}" not found.`, 'err'); return; }
    if (!res.ok)            { setStatus(`GitHub error: ${res.status}`, 'err'); return; }

    // Verify the branch exists
    const branchRes = await fetch(
      `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/branches/${cfg.branch}`,
      { headers: githubHeaders(cfg.pat) }
    );
    if (branchRes.status === 404) { setStatus(`Branch "${cfg.branch}" not found.`, 'err'); return; }
    if (!branchRes.ok)            { setStatus(`GitHub error: ${branchRes.status}`, 'err'); return; }

    setStatus(`Connected to ${cfg.owner}/${cfg.repo} @ ${cfg.branch}`, 'ok');
  } catch (e) {
    setStatus('Network error: ' + e.message, 'err');
  }
});

// ── Save settings ─────────────────────────────────────────────────────────

document.getElementById('save-btn').addEventListener('click', async () => {
  const cfg = collectConfig();
  const err = validate(cfg);
  if (err) { setStatus(err, 'err'); return; }

  await chrome.storage.sync.set(cfg);
  setStatus('Settings saved!', 'ok');
});

// ── Shared GitHub headers ─────────────────────────────────────────────────

function githubHeaders(pat) {
  return {
    'Authorization': `Bearer ${pat}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}
