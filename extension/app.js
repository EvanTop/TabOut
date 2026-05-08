'use strict';

// Flip to true while debugging to surface caught errors in the console.
const DEBUG = false;

// Dashboard URL is safari-web-extension://<UUID>/index.html at runtime.
// (theme-init.js in <head> has already set data-theme before this runs.)
const DASHBOARD_URL = chrome.runtime.getURL('index.html');

let openTabs = [];

async function fetchOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      favIconUrl: t.favIconUrl,
      windowId: t.windowId,
      active: t.active,
      isTabOut: t.url === DASHBOARD_URL,
    }));
  } catch {
    openTabs = [];
  }
}

// Closes all tabs matching `predicate`, except any returned by `selectKeepers`.
// `selectKeepers(matches)` is called with the matched tabs and returns an array
// of tabs to spare. If omitted, all matching tabs are closed.
async function closeTabsWhere(predicate, selectKeepers = null) {
  const allTabs = await chrome.tabs.query({});
  const matching = allTabs.filter(predicate);
  const keeperIds = selectKeepers
    ? new Set(selectKeepers(matching).map(t => t.id))
    : new Set();
  const toClose = matching.filter(t => !keeperIds.has(t.id)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

// Closes tabs whose hostname matches any url in `urls`. file:// URLs (which
// have no hostname) are matched exactly instead.
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;
  const hostnames = [];
  const exactUrls = new Set();
  for (const u of urls) {
    if (u.startsWith('file://')) exactUrls.add(u);
    else try { hostnames.push(new URL(u).hostname); } catch {}
  }
  await closeTabsWhere(tab => {
    const url = tab.url || '';
    if (url.startsWith('file://')) return exactUrls.has(url);
    try {
      const host = new URL(url).hostname;
      return host && hostnames.includes(host);
    } catch { return false; }
  });
}

// Closes tabs with an exact URL match. Used for landing pages so closing
// "Gmail inbox" doesn't also close individual email threads.
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  await closeTabsWhere(t => urlSet.has(t.url));
}

async function closeDuplicateTabs(urls, keepOne = true) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  await closeTabsWhere(
    t => urlSet.has(t.url),
    keepOne
      ? matches => urls.map(url => {
          const group = matches.filter(t => t.url === url);
          return group.find(t => t.active) || group[0];
        }).filter(Boolean)
      : null
  );
}

async function closeTabOutDupes() {
  const currentWindow = await chrome.windows.getCurrent();
  await closeTabsWhere(
    t => t.url === DASHBOARD_URL,
    matches => matches.length === 0 ? [] : [
      matches.find(t => t.active && t.windowId === currentWindow.id) ||
      matches.find(t => t.active) ||
      matches[0]
    ]
  );
}

async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  let matches = allTabs.filter(t => t.url === url);
  if (matches.length === 0) {
    try {
      const host = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === host; } catch { return false; }
      });
    } catch {}
  }
  if (matches.length === 0) return;

  // Prefer a match in another window so switching is visible.
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}


// ─── Saved-for-later storage (chrome.storage.local, key: "deferred") ────────

async function saveTabForLater(tab) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id: Date.now().toString(),
    url: tab.url,
    title: tab.title,
    favIconUrl: tab.favIconUrl || '',
    savedAt: new Date().toISOString(),
    completed: false,
    dismissed: false,
  });
  await chrome.storage.local.set({ deferred });
}

async function getSavedTabs() {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred.filter(t => !t.dismissed);
  return {
    active: visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

async function checkOffSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

async function dismissSavedTab(id) {
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.dismissed = true;
    await chrome.storage.local.set({ deferred });
  }
}


// ─── UI helpers ─────────────────────────────────────────────────────────────

// Synthesized swoosh via Web Audio — filtered noise sweeping high→low pitch.
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);
    setTimeout(() => ctx.close(), 500);
  } catch {}
}

const CONFETTI_COLORS = ['#c8713a', '#e8a070', '#5a7a62', '#8aaa92', '#5a6b7a', '#8a9baa', '#d4b896', '#b35a5a'];

function shootConfetti(x, y) {
  for (let i = 0; i < 17; i++) {
    const el = document.createElement('div');
    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6;
    const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];

    el.style.cssText = `
      position: fixed; left: ${x}px; top: ${y}px;
      width: ${size}px; height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none; z-index: 9999;
      transform: translate(-50%, -50%); opacity: 1;
    `;
    document.body.appendChild(el);

    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 120;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 80;     // bias upward
    const gravity = 200;
    const startTime = performance.now();
    const duration = 700 + Math.random() * 200;

    function frame(now) {
      const elapsed = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);
      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
}

function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  updateDashboardCounts();
  setTimeout(() => {
    // Remove the slot wrapper too — otherwise its padding stays behind
    // as a 12px phantom and pushes following cards out of alignment.
    (card.closest('.mission-slot') || card).remove();
    checkAndShowEmptyState();
  }, 300);
}

function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;
  if (missionsEl.querySelectorAll('.mission-card:not(.closing)').length > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">${ICONS.checkmark}</div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>
  `;
  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 domains';
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const then = new Date(dateStr);
  const mins = Math.floor((now - then) / 60000);
  const hours = Math.floor((now - then) / 3600000);
  const days = Math.floor((now - then) / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  if (hours < 24) return hours + ' hr' + (hours !== 1 ? 's' : '') + ' ago';
  if (days === 1) return 'yesterday';
  return days + ' days ago';
}

// Recomputes all counts on a card from its currently-rendered chips — tab-count
// badge, duplicate badge, "Close all N tabs" button, "Close N duplicates" button.
// Removes the dupe badge + dupe button entirely when no duplicates remain.
function updateCardCounts(card) {
  if (!card) return;
  const chips = card.querySelectorAll('.page-chip[data-action="focus-tab"]');
  let total = 0;
  let dupeExtras = 0;
  for (const chip of chips) {
    const dupeEl = chip.querySelector('.chip-dupe-badge');
    const match = dupeEl && dupeEl.textContent.match(/(\d+)x/);
    const count = match ? parseInt(match[1], 10) : 1;
    total += count;
    if (count > 1) dupeExtras += count - 1;
  }

  const plural = n => n !== 1 ? 's' : '';
  const badges = card.querySelectorAll('.open-tabs-badge');
  const tabBadge = badges[0];
  const dupeBadge = [...badges].find(b => b.textContent.includes('duplicate'));
  const closeAllBtn = card.querySelector('.action-btn.close-tabs');
  const dupeBtn = card.querySelector('.action-btn[data-action="dedup-keep-one"]');

  if (tabBadge) tabBadge.innerHTML = `${ICONS.tabs} ${total} tab${plural(total)} open`;
  if (closeAllBtn) closeAllBtn.innerHTML = `${ICONS.close} Close all ${total} tab${plural(total)}`;

  if (dupeExtras > 0) {
    if (dupeBadge) dupeBadge.textContent = `${dupeExtras} duplicate${plural(dupeExtras)}`;
    if (dupeBtn) dupeBtn.textContent = `Close ${dupeExtras} duplicate${plural(dupeExtras)}`;
  } else {
    if (dupeBadge) dupeBadge.remove();
    if (dupeBtn) dupeBtn.remove();
    card.classList.remove('has-amber-bar');
    card.classList.add('has-neutral-bar');
  }
}

// Recomputes the dashboard-wide "N domains · Close all N tabs" header and the
// footer's tab-count stat, based on the currently-visible (non-closing) cards.
function updateDashboardCounts() {
  const cards = document.querySelectorAll('#openTabsMissions .mission-card:not(.closing)');
  let totalTabs = 0;
  for (const card of cards) {
    const badge = card.querySelector('.open-tabs-badge');
    const match = badge && badge.textContent.match(/(\d+)\s+tab/);
    if (match) totalTabs += parseInt(match[1], 10);
  }
  const domainCount = cards.length;
  const plural = n => n !== 1 ? 's' : '';

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) {
    countEl.innerHTML = `${domainCount} domain${plural(domainCount)} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs action-btn--compact" data-action="close-all-open-tabs">${ICONS.close} Close all ${totalTabs} tab${plural(totalTabs)}</button>`;
  }

  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = totalTabs;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getDateDisplay() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}


// ─── Domain & title cleanup ─────────────────────────────────────────────────


const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


// ─── Icons ──────────────────────────────────────────────────────────────────

const svg = (sw, d) => `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="${sw}" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;

const ICONS = {
  tabs:      svg(2,   'M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18'),
  close:     svg(2,   'M6 18 18 6M6 6l12 12'),
  chipClose: svg(2.5, 'M6 18 18 6M6 6l12 12'),
  archive:   svg(2,   'M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z'),
  focus:     svg(2,   'm4.5 19.5 15-15m0 0H8.25m11.25 0v11.25'),
  bookmark:  svg(2,   'M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z'),
  checkmark: svg(1.5, 'm4.5 12.75 6 6 9-13.5'),
  sun:       svg(1.5, 'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z'),
};


// ─── Settings storage ───────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  logoUrl: '',
  defaultPage: false,
  showTabList: true,
  tabListItems: [],
};

async function getSettings() {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(partial) {
  try {
    const current = await getSettings();
    const next = { ...current, ...partial };
    await chrome.storage.local.set({ settings: next });
    return next;
  } catch (err) {
    if (DEBUG) console.error('[tab-out] Failed to save settings:', err);
    return null;
  }
}

// ─── Nav list helpers ───────────────────────────────────────────────────────

function parseTabListItems(rawText) {
  if (!rawText) return [];
  return rawText
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .map(url => {
      try {
        const u = new URL(url);
        return { url, title: u.hostname.replace(/^www\./, '') };
      } catch {
        return { url, title: url };
      }
    });
}

function tabListItemsToText(items) {
  if (!items || items.length === 0) return '';
  return items.map(i => i.url).join('\n');
}

let _navListResizeBound = false;
let _navListExpanded = false;

async function renderTabList() {
  const section = document.getElementById('tabListSection');
  const container = document.getElementById('tabListContainer');
  if (!section || !container) return;

  const settings = await getSettings();
  if (!settings.showTabList || settings.tabListItems.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  // Render all chips + the More button (hidden initially)
  const allItems = settings.tabListItems;
  let html = allItems.map(item => {
    let hostname = '';
    try { hostname = new URL(item.url).hostname; } catch {}
    const faviconUrl = faviconFor(hostname, '');
    const safeUrl = item.url.replace(/"/g, '&quot;');
    const safeTitle = (item.title || item.url).replace(/"/g, '&quot;');
    return `<a href="${safeUrl}" target="_blank" rel="noopener" class="tab-list-chip" title="${safeTitle}">
      ${faviconUrl ? `<span class="chip-favicon" style="background-image:url('${faviconUrl}')" aria-hidden="true"></span>` : ''}
      <span class="chip-text">${safeTitle}</span>
    </a>`;
  }).join('');

  html += `<div class="tab-list-more" id="tabListMore" role="button" tabindex="0" aria-label="More bookmarks" title="More" style="display:none">
    <span>More</span>
  </div>`;

  container.innerHTML = html;

  // Bind More button click: toggle expanded multi-line view
  const moreBtn = document.getElementById('tabListMore');
  if (moreBtn) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      _navListExpanded = !_navListExpanded;
      _reflowNavList();
    });
  }

  // Bind chip clicks: collapse back to single line when expanded
  const chips = container.querySelectorAll('.tab-list-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (_navListExpanded) {
        _navListExpanded = false;
        _reflowNavList();
      }
    });
  });

  // Measure and reflow after the browser paints
  requestAnimationFrame(() => {
    _reflowNavList();
  });

  // Bind resize listener once
  if (!_navListResizeBound) {
    _navListResizeBound = true;
    let t = null;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        _navListExpanded = false;
        _reflowNavList();
      }, 100);
    });
  }
}

function _reflowNavList() {
  const container = document.getElementById('tabListContainer');
  const moreBtn = document.getElementById('tabListMore');
  if (!container || !moreBtn) return;

  const chips = Array.from(container.querySelectorAll('.tab-list-chip'));
  if (chips.length === 0) {
    moreBtn.style.display = 'none';
    container.classList.remove('expanded');
    return;
  }

  // Expanded mode: show all chips in multi-line layout
  if (_navListExpanded) {
    container.classList.add('expanded');
    chips.forEach(c => { c.style.display = 'inline-flex'; });
    moreBtn.style.display = 'inline-flex';
    return;
  }

  container.classList.remove('expanded');

  const containerWidth = container.clientWidth;
  const gap = 8;

  // First pass: assume no More button, count how many fit
  let totalWidth = 0;
  let visibleCount = 0;
  for (let i = 0; i < chips.length; i++) {
    totalWidth += chips[i].offsetWidth + (i > 0 ? gap : 0);
    if (totalWidth > containerWidth) break;
    visibleCount++;
  }

  // If everything fits, hide More and show all
  if (visibleCount >= chips.length) {
    chips.forEach(c => { c.style.display = 'inline-flex'; });
    moreBtn.style.display = 'none';
    return;
  }

  // Need More button: temporarily show it to measure its width
  moreBtn.style.visibility = 'hidden';
  moreBtn.style.display = 'inline-flex';
  const moreWidth = moreBtn.offsetWidth + gap;
  moreBtn.style.visibility = '';

  // Second pass: reserve space for More button
  totalWidth = 0;
  visibleCount = 0;
  for (let i = 0; i < chips.length; i++) {
    totalWidth += chips[i].offsetWidth + (i > 0 ? gap : 0);
    if (totalWidth > containerWidth - moreWidth) break;
    visibleCount++;
  }

  // Ensure at least one chip is hidden when More is shown
  if (visibleCount >= chips.length) visibleCount = chips.length - 1;
  if (visibleCount < 0) visibleCount = 0;

  chips.forEach((chip, i) => {
    chip.style.display = i < visibleCount ? 'inline-flex' : 'none';
  });
  moreBtn.style.display = 'inline-flex';
}


// ─── Tab grouping ───────────────────────────────────────────────────────────

let domainGroups = [];

function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return !url.startsWith('chrome://')
      && !url.startsWith('chrome-extension://')
      && !url.startsWith('safari-web-extension://')
      && !url.startsWith('about:')
      && !url.startsWith('edge://')
      && !url.startsWith('brave://');
  });
}

// Shows a banner when more than one Tab Out dashboard tab is open.
function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
  const banner = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;
  if (tabOutTabs.length > 1) {
    if (countEl) countEl.textContent = tabOutTabs.length;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


// ─── Card rendering ─────────────────────────────────────────────────────────

// Returns a favicon URL. Prefers the browser-supplied favIconUrl (Chrome has
// this for open tabs); falls back to DuckDuckGo's icon service for Safari and
// for saved items that were stored without a favicon.
function faviconFor(hostname, supplied) {
  if (supplied) return supplied;
  if (!hostname) return '';
  return `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
}

// Builds one "page chip" — a favicon + title row with save/close buttons.
function renderPageChip(tab, urlCounts, groupDomain = '') {
  let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), groupDomain);
  let hostname = '';
  try {
    const parsed = new URL(tab.url);
    hostname = parsed.hostname;
    if (hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
  } catch {}

  const count = urlCounts[tab.url] || 1;
  const dupeTag = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
  const chipClass = count > 1 ? ' chip-has-dupes' : '';
  const safeUrl = (tab.url || '').replace(/"/g, '&quot;');
  const safeTitle = label.replace(/"/g, '&quot;');
  const faviconUrl = faviconFor(hostname, tab.favIconUrl);

  return `<div class="page-chip clickable${chipClass}" role="button" tabindex="0" data-action="focus-tab" data-tab-url="${safeUrl}" aria-label="Open ${safeTitle}" title="${safeTitle}">
    ${faviconUrl ? `<span class="chip-favicon" style="background-image:url('${faviconUrl}')" aria-hidden="true"></span>` : ''}
    <span class="chip-text">${label}</span>${dupeTag}
    <div class="chip-actions">
      <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" aria-label="Save ${safeTitle} for later" title="Save for later">${ICONS.bookmark}</button>
      <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" aria-label="Close ${safeTitle}" title="Close this tab">${ICONS.chipClose}</button>
    </div>
  </div>`;
}

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => renderPageChip(tab, urlCounts)).join('');
  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
}

function renderDomainCard(group) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''} open
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent-amber);background:rgba(200,113,58,0.08);">
        ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => renderPageChip(tab, urlCounts, group.domain)).join('')
    + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      Close all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
    </button>`;

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </button>`;
  }

  return `
    <div class="mission-slot">
      <div class="mission-card domain-card ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}">
        <div class="status-bar"></div>
        <div class="mission-content">
          <div class="mission-top">
            <span class="mission-name">${isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain))}</span>
            ${tabBadge}
            ${dupeBadge}
          </div>
          <div class="mission-pages">${pageChips}</div>
          <div class="actions">${actionsHtml}</div>
        </div>
        <div class="mission-meta">
          <div class="mission-page-count">${tabCount}</div>
          <div class="mission-page-label">tabs</div>
        </div>
      </div>
    </div>`;
}


// ─── Saved-for-later column ─────────────────────────────────────────────────

/**
 * renderDeferredColumn()
 * Renders the right-side checklist of saved tabs. Hides the column when
 * there are no active or archived items.
 */
async function renderDeferredColumn() {
  const column = document.getElementById('deferredColumn');
  const list = document.getElementById('deferredList');
  const empty = document.getElementById('deferredEmpty');
  const countEl = document.getElementById('deferredCount');
  const archiveEl = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList = document.getElementById('archiveList');
  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      return;
    }
    column.style.display = 'block';

    if (active.length > 0) {
      countEl.textContent = `${active.length} item${active.length !== 1 ? 's' : ''}`;
      list.innerHTML = `
        <div class="bulk-actions">
          <button class="action-btn" data-action="open-all-deferred">${ICONS.focus} Open all</button>
          <button class="action-btn" data-action="clear-all-deferred">${ICONS.close} Clear all</button>
        </div>
        ${active.map(renderDeferredItem).join('')}
      `;
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = `
        <div class="bulk-actions">
          <button class="action-btn" data-action="open-all-archive">${ICONS.focus} Open all ${archived.length}</button>
          <button class="action-btn" data-action="clear-all-archive">${ICONS.close} Clear all</button>
        </div>
        ${archived.map(renderArchiveItem).join('')}
      `;
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }
  } catch (err) {
    if (DEBUG) console.warn('[tab-out] Could not load saved tabs:', err);
    column.style.display = 'none';
  }
}

function renderDeferredItem(item) {
  let hostname = '';
  try { hostname = new URL(item.url).hostname; } catch {}
  const domain = hostname.replace(/^www\./, '');
  const faviconUrl = faviconFor(hostname, item.favIconUrl);
  const ago = timeAgo(item.savedAt);

  const safeTitle = (item.title || item.url).replace(/"/g, '&quot;');
  return `
    <div class="deferred-item" data-deferred-id="${item.id}">
      <input type="checkbox" class="deferred-checkbox" data-action="check-deferred" data-deferred-id="${item.id}" aria-label="Mark ${safeTitle} as done">
      <div class="deferred-info">
        <a href="${item.url}" target="_blank" rel="noopener" class="deferred-title" title="${safeTitle}">
          ${faviconUrl ? `<span class="deferred-favicon" style="background-image:url('${faviconUrl}')" aria-hidden="true"></span>` : ''}${item.title || item.url}
        </a>
        <div class="deferred-meta">
          <span>${domain}</span>
          <span>${ago}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" aria-label="Dismiss ${safeTitle}" title="Dismiss">${ICONS.close}</button>
    </div>`;
}

function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  return `
    <div class="archive-item" data-deferred-id="${item.id}">
      <a href="${item.url}" target="_blank" rel="noopener" class="archive-item-title" title="${(item.title || '').replace(/"/g, '&quot;')}">
        ${item.title || item.url}
      </a>
      <span class="archive-item-date">${ago}</span>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${item.id}" aria-label="Remove ${(item.title || item.url).replace(/"/g, '&quot;')} from archive" title="Remove from archive">${ICONS.close}</button>
    </div>`;
}


// ─── Main dashboard render ──────────────────────────────────────────────────

async function renderStaticDashboard() {
  const greetingEl = document.getElementById('greeting');
  const dateEl = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl) dateEl.textContent = getDateDisplay();

  await fetchOpenTabs();
  const realTabs = getRealTabs();

  // Landing pages (Gmail inbox, X home) get their own group so closing them
  // doesn't close content tabs that live on the same hostname.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/', '/home'] },
    { hostname: 'twitter.com',         pathExact: ['/', '/home'] },
    { hostname: 'www.twitter.com',     pathExact: ['/', '/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/', '/feed/'] },
    { hostname: 'github.com',          pathExact: ['/', '/dashboard'] },
    { hostname: 'www.github.com',      pathExact: ['/', '/dashboard'] },
    { hostname: 'www.youtube.com',     pathExact: ['/', '/feed/subscriptions'] },
    { hostname: 'music.youtube.com',   pathExact: ['/'] },
    { hostname: 'www.reddit.com',      pathExact: ['/'] },
    { hostname: 'reddit.com',          pathExact: ['/'] },
    { hostname: 'old.reddit.com',      pathExact: ['/'] },
    { hostname: 'www.facebook.com',    pathExact: ['/'] },
    { hostname: 'www.instagram.com',   pathExact: ['/'] },
    { hostname: 'bsky.app',            pathExact: ['/'] },
    { hostname: 'news.ycombinator.com', pathExact: ['/', '/news'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function matchesHostnameRule(parsed, rule) {
    if (rule.hostname) return parsed.hostname === rule.hostname;
    if (rule.hostnameEndsWith) return parsed.hostname.endsWith(rule.hostnameEndsWith);
    return false;
  }

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        if (!matchesHostnameRule(parsed, p)) return false;
        if (p.test) return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact) return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        if (!matchesHostnameRule(parsed, r)) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true;
      }) || null;
    } catch { return null; }
  }

  domainGroups = [];
  const groupMap = {};
  const landingTabs = [];

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) { landingTabs.push(tab); continue; }

      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      const hostname = tab.url && tab.url.startsWith('file://')
        ? 'local-files'
        : new URL(tab.url).hostname;
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {}
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  const isLandingDomain = domain =>
    landingHostnames.has(domain) || landingSuffixes.some(s => domain.endsWith(s));

  // Sort: the landing-pages group first, then landing-domain hosts, then by tab count.
  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;
    const aPri = isLandingDomain(a.domain);
    const bPri = isLandingDomain(b.domain);
    if (aPri !== bPri) return aPri ? -1 : 1;
    return b.tabs.length - a.tabs.length;
  });

  const openTabsSection = document.getElementById('openTabsSection');
  const openTabsMissionsEl = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 && openTabsSection) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Open tabs';
    openTabsMissionsEl.innerHTML = domainGroups.map(renderDomainCard).join('');
    openTabsSection.style.display = 'block';
    updateDashboardCounts();
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  checkTabOutDupes();
  await renderDeferredColumn();
}

const renderDashboard = renderStaticDashboard;


// ─── Event delegation: one click listener for the whole document ────────────

// Keyboard activation for non-button elements that use role="button" (chips).
// Native <button>/<input> handle their own keys; only fire when focus is on
// the role-button element itself, not a descendant.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target;
  if (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'A') return;
  if (!t.matches?.('[role="button"][data-action]')) return;
  e.preventDefault();
  t.click();
});

document.addEventListener('click', async (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === 'close-tabout-dupes') {
    await closeTabOutDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra Tab Out tabs');
    return;
  }

  const card = actionEl.closest('.mission-card');

  if (action === 'expand-chips') {
    const overflow = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflow) {
      overflow.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // Close every open tab matching this URL, so duplicates vanish together.
    const allTabs = await chrome.tabs.query({});
    const matchIds = allTabs.filter(t => t.url === tabUrl).map(t => t.id);
    if (matchIds.length > 0) await chrome.tabs.remove(matchIds);
    await fetchOpenTabs();
    playCloseSound();

    const chip = actionEl.closest('.page-chip');
    const parentCard = chip ? chip.closest('.mission-card') : null;
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity = '0';
      chip.style.transform = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          } else {
            updateCardCounts(c);
          }
        });
        updateDashboardCounts();
      }, 200);
    }

    showToast('Tab closed');
    return;
  }

  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabUrl = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    try {
      const liveTab = openTabs.find(t => t.url === tabUrl);
      await saveTabForLater({
        url: tabUrl,
        title: tabTitle,
        favIconUrl: liveTab?.favIconUrl || '',
      });
    } catch (err) {
      if (DEBUG) console.error('[tab-out] Failed to save tab:', err);
      showToast('Failed to save tab');
      return;
    }

    // Save the URL once, close every open tab matching it.
    const allTabs = await chrome.tabs.query({});
    const matchIds = allTabs.filter(t => t.url === tabUrl).map(t => t.id);
    if (matchIds.length > 0) await chrome.tabs.remove(matchIds);
    await fetchOpenTabs();

    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity = '0';
      chip.style.transform = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          } else {
            updateCardCounts(c);
          }
        });
        updateDashboardCounts();
      }, 200);
    }

    showToast('Saved for later');
    await renderDeferredColumn();
    return;
  }

  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;
    await checkOffSavedTab(id);
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => { item.remove(); renderDeferredColumn(); }, 300);
      }, 800);
    }
    return;
  }

  if (action === 'open-all-deferred' || action === 'open-all-archive') {
    const { active, archived } = await getSavedTabs();
    const items = action === 'open-all-deferred' ? active : archived;
    if (items.length === 0) return;
    for (const item of items) {
      await chrome.tabs.create({ url: item.url, active: false });
    }
    await fetchOpenTabs();
    await renderDashboard();
    const label = action === 'open-all-deferred' ? 'saved' : 'archived';
    showToast(`Opened ${items.length} ${label} tab${items.length !== 1 ? 's' : ''}`);
    return;
  }

  if (action === 'clear-all-deferred' || action === 'clear-all-archive') {
    const { active, archived } = await getSavedTabs();
    const items = action === 'clear-all-deferred' ? active : archived;
    if (items.length === 0) return;
    const noun = action === 'clear-all-deferred' ? 'saved tab' : 'archived item';
    const plural = items.length !== 1 ? 's' : '';
    if (!confirm(`Clear all ${items.length} ${noun}${plural}? This can't be undone.`)) return;

    const { deferred = [] } = await chrome.storage.local.get('deferred');
    const targetIds = new Set(items.map(i => i.id));
    for (const t of deferred) {
      if (targetIds.has(t.id)) t.dismissed = true;
    }
    await chrome.storage.local.set({ deferred });
    await renderDeferredColumn();
    showToast(`Cleared ${items.length} ${noun}${plural}`);
    return;
  }

  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;
    await dismissSavedTab(id);
    const item = actionEl.closest('.deferred-item, .archive-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => { item.remove(); renderDeferredColumn(); }, 300);
    }
    return;
  }

  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group = domainGroups.find(g =>
      'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId
    );
    if (!group) return;

    const urls = group.tabs.map(t => t.url);
    // Landing pages and custom groups share a hostname with other tabs, so we
    // must match exactly — not by hostname — to avoid closing unrelated tabs.
    const useExact = group.domain === '__landing-pages__' || !!group.label;
    if (useExact) await closeTabsExact(urls);
    else await closeTabsByUrls(urls);

    if (card) { playCloseSound(); animateCardOut(card); }

    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const label = group.domain === '__landing-pages__'
      ? 'Homepages'
      : (group.label || friendlyDomain(group.domain));
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${label}`);
    return;
  }

  if (action === 'dedup-keep-one') {
    const urls = (actionEl.dataset.dupeUrls || '').split(',')
      .map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await closeDuplicateTabs(urls, true);
    playCloseSound();

    if (card) {
      // Fade out the (Nx) chip badges first so updateCardCounts sees unique-only.
      const fadeOut = els => els.forEach(el => {
        el.style.transition = 'opacity 0.2s';
        el.style.opacity = '0';
      });
      fadeOut(card.querySelectorAll('.chip-dupe-badge'));
      setTimeout(() => {
        card.querySelectorAll('.chip-dupe-badge').forEach(b => b.remove());
        card.querySelectorAll('.chip-has-dupes').forEach(c => c.classList.remove('chip-has-dupes'));
        updateCardCounts(card);
        updateDashboardCounts();
      }, 200);
    }

    showToast('Closed duplicates, kept one copy each');
    return;
  }

  if (action === 'close-all-open-tabs') {
    const allUrls = getRealTabs().map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      const r = c.getBoundingClientRect();
      shootConfetti(r.left + c.offsetWidth / 2, r.top + c.offsetHeight / 2);
      animateCardOut(c);
    });
    showToast('All tabs closed. Fresh start.');
    return;
  }
});

// Archive toggle — expand/collapse archived saved-tabs section
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('#archiveToggle');
  if (!toggle) return;
  toggle.classList.toggle('open');
  const body = document.getElementById('archiveBody');
  if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
});

// Archive search — debounced so fast typists don't thrash storage reads.
let archiveSearchTimer = null;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'archiveSearch') return;
  const q = e.target.value.trim().toLowerCase();
  clearTimeout(archiveSearchTimer);
  archiveSearchTimer = setTimeout(() => runArchiveSearch(q), 150);
});

async function runArchiveSearch(q) {
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;
  try {
    const { archived } = await getSavedTabs();
    if (q.length < 2) {
      archiveList.innerHTML = archived.map(renderArchiveItem).join('');
      return;
    }
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url || '').toLowerCase().includes(q)
    );
    archiveList.innerHTML = results.map(renderArchiveItem).join('')
      || '<div class="archive-no-results">No results</div>';
  } catch (err) {
    if (DEBUG) console.warn('[tab-out] Archive search failed:', err);
  }
}

// ─── Theme toggle ───────────────────────────────────────────────────────────

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem('theme');
  }
}

(function initThemeToggle() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.innerHTML = ICONS.sun;
  btn.addEventListener('click', () => {
    const attr = document.documentElement.getAttribute('data-theme');
    const isDark = attr === 'dark'
      || (!attr && matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(isDark ? 'light' : 'dark');
  });
})();


// ─── Settings modal ─────────────────────────────────────────────────────────

(function initSettings() {
  const modal = document.getElementById('settingsModal');
  const btn = document.getElementById('settingsBtn');
  const close = document.getElementById('settingsClose');
  const backdrop = document.getElementById('settingsBackdrop');
  const logoInput = document.getElementById('logoUrl');
  const defaultToggle = document.getElementById('defaultPageToggle');
  const showTabListToggle = document.getElementById('showTabListToggle');
  const tabListTextarea = document.getElementById('tabListItems');

  if (!modal || !btn) return;

  async function loadSettingsIntoUI() {
    const settings = await getSettings();
    if (logoInput) logoInput.value = settings.logoUrl || '';
    if (defaultToggle) defaultToggle.checked = !!settings.defaultPage;
    if (showTabListToggle) showTabListToggle.checked = settings.showTabList !== false;
    if (tabListTextarea) tabListTextarea.value = tabListItemsToText(settings.tabListItems);
  }

  function openModal() {
    loadSettingsIntoUI();
    modal.style.display = 'flex';
  }

  function closeModal() {
    modal.style.display = 'none';
  }

  btn.addEventListener('click', openModal);
  if (close) close.addEventListener('click', closeModal);
  if (backdrop) backdrop.addEventListener('click', closeModal);

  async function commitSettings() {
    const next = {
      logoUrl: logoInput ? logoInput.value.trim() : '',
      defaultPage: defaultToggle ? defaultToggle.checked : false,
      showTabList: showTabListToggle ? showTabListToggle.checked : true,
      tabListItems: parseTabListItems(tabListTextarea ? tabListTextarea.value : ''),
    };
    await saveSettings(next);
    await renderTabList();
    showToast('Settings saved');
  }

  // Apply custom logo on load if set
  function applyLogo(url) {
    const logo = document.getElementById('customLogo');
    if (!logo) return;
    if (url) {
      logo.src = url;
      logo.style.display = 'block';
      logo.onerror = () => { logo.style.display = 'none'; };
    } else {
      logo.style.display = 'none';
      logo.src = '';
    }
  }

  getSettings().then(settings => {
    applyLogo(settings.logoUrl);
  });

  if (logoInput) {
    logoInput.addEventListener('change', async () => {
      await commitSettings();
      applyLogo(logoInput.value.trim());
    });
  }
  if (defaultToggle) {
    defaultToggle.addEventListener('change', async () => {
      await commitSettings();
      if (defaultToggle.checked) {
        showToast('Please enable "Allow on all sites" in extension details for new-tab override.');
      }
    });
  }
  if (showTabListToggle) {
    showTabListToggle.addEventListener('change', commitSettings);
  }
  if (tabListTextarea) {
    let t = null;
    tabListTextarea.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(commitSettings, 600);
    });
  }
})();


// ─── Live tab listeners — auto-refresh when tabs change ────────────────────

let _tabRefreshTimer = null;
let _initialRenderDone = false;

function scheduleRefresh() {
  clearTimeout(_tabRefreshTimer);
  _tabRefreshTimer = setTimeout(() => {
    // Suppress entrance animations on re-renders so cards don't flicker.
    if (_initialRenderDone) document.body.classList.add('no-entrance-anim');
    renderDashboard();
  }, 300);
}

if (typeof chrome !== 'undefined' && chrome.tabs) {
  chrome.tabs.onCreated.addListener(scheduleRefresh);
  chrome.tabs.onRemoved.addListener(scheduleRefresh);
  chrome.tabs.onUpdated.addListener((_id, changeInfo) => {
    // Ignore noisy intermediate events (favicon fetch, loading states).
    if (changeInfo.status === 'complete' || changeInfo.url) scheduleRefresh();
  });
  // Only refresh when switching BACK to the Tab Out tab, not on every tab switch.
  const extensionOrigin = chrome.runtime.getURL('');
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && tab.url.startsWith(extensionOrigin)) scheduleRefresh();
    } catch {}
  });
}

renderDashboard().then(() => { _initialRenderDone = true; renderTabList(); });
