function cleanUrl(raw) {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_')) url.searchParams.delete(key);
    }
    return url.toString();
  } catch { return raw; }
}

async function updateBadge(tabId, url) {
  if (!url || url.startsWith('chrome://') || url.startsWith('brave://') || url.startsWith('chrome-extension://')) {
    chrome.action.setBadgeText({ text: '', tabId });
    return;
  }

  const { bookmarks } = await chrome.storage.local.get(['bookmarks']);
  const saved = (bookmarks || {})[cleanUrl(url)];

  if (saved) {
    chrome.action.setBadgeText({ text: '★', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#30d158', tabId });
  } else {
    chrome.action.setBadgeText({ text: '', tabId });
  }
}

// Tab switched
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  updateBadge(tabId, tab.url);
});

// URL navigated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    updateBadge(tabId, tab.url);
  }
});

// Window focused
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab) updateBadge(tab.id, tab.url);
});
