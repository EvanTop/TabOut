/**
 * background.js — Service Worker
 *
 * Two jobs:
 *   1. Toolbar click / keyboard shortcut → open or focus the Tab Out dashboard.
 *   2. Keep the toolbar badge showing the current open-tab count.
 *
 * Cross-browser: uses chrome.* APIs, which Safari 14+ aliases to browser.*.
 *
 * Badge color coding:
 *   Green  (#3d7a4a) → 1–10 tabs  (focused, manageable)
 *   Amber  (#b8892e) → 11–20 tabs (getting busy)
 *   Red    (#b35a5a) → 21+ tabs   (time to cull!)
 */

// ─── Open / focus the dashboard ──────────────────────────────────────────────

/**
 * openDashboard()
 *
 * If a Tab Out tab already exists, switch to it.
 * Otherwise create a new tab pointing at the dashboard.
 */
async function openDashboard() {
  const dashboardUrl = chrome.runtime.getURL('index.html');

  // Query all tabs and filter manually — tabs.query({url}) matching on extension
  // URLs is inconsistent across browsers (and would need a match-pattern permission).
  const all = await chrome.tabs.query({});
  const existing = all.find(t => t.url === dashboardUrl);

  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    if (typeof existing.windowId === 'number') {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url: dashboardUrl });
}

// Toolbar icon click AND the ⌘⇧Y shortcut (via _execute_action in manifest).
chrome.action.onClicked.addListener(openDashboard);


// ─── New tab override (dynamic, respects settings.defaultPage) ─────────────

const DASHBOARD_URL = chrome.runtime.getURL('index.html');

// Intercept new-tab creation. When a tab navigates to chrome://newtab/ and
// the user has "default page" enabled, redirect to the Tab Out dashboard.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only act when the URL changes to a new-tab page
  if (!changeInfo.url) return;
  const url = changeInfo.url;
  const isNewTab = url === 'chrome://newtab/' || url === 'chrome://newtab' || url.startsWith('chrome://newtab');
  if (!isNewTab) return;

  chrome.storage.local.get('settings', ({ settings }) => {
    if (settings && settings.defaultPage === true) {
      chrome.tabs.update(tabId, { url: DASHBOARD_URL });
    }
  });
});


// ─── Badge updater ───────────────────────────────────────────────────────────

/**
 * isInternalUrl(url) — returns true for browser-internal pages that shouldn't
 * count toward the user's "real" tab count.
 */
function isInternalUrl(url) {
  const u = url || '';
  return (
    u.startsWith('chrome://') ||
    u.startsWith('chrome-extension://') ||
    u.startsWith('safari-web-extension://') ||
    u.startsWith('about:') ||
    u.startsWith('edge://') ||
    u.startsWith('brave://')
  );
}

/**
 * updateBadge()
 *
 * Counts open "real" tabs and updates the extension's toolbar badge.
 */
async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});
    const count = tabs.filter(t => !isInternalUrl(t.url)).length;

    // Don't show "0" — an empty badge is cleaner
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });

    if (count === 0) return;

    let color;
    if (count <= 10) color = '#3d7a4a';      // Green — you're in control
    else if (count <= 20) color = '#b8892e'; // Amber — piling up
    else color = '#b35a5a';                  // Red — time to cull

    await chrome.action.setBadgeBackgroundColor({ color });
  } catch {
    // If something goes wrong, clear the badge rather than show stale data
    try { await chrome.action.setBadgeText({ text: '' }); } catch {}
  }
}

// ─── Event listeners ─────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
chrome.tabs.onCreated.addListener(updateBadge);
chrome.tabs.onRemoved.addListener(updateBadge);
chrome.tabs.onUpdated.addListener(updateBadge);

// Initial run when the service worker first loads
updateBadge();
