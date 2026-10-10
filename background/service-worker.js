/*
 * Background service worker:
 *  - one request queue for the Steam Market shared by all tabs (common rate limit);
 *  - the price cache in chrome.storage.local, shared by every feature and tab;
 *  - optional marketplace price lists (public APIs, no keys);
 *  - store lows (Augmented Steam) and price history (IsThereAnyDeal, user key);
 *  - incoming trade offers badge.
 *
 * No telemetry: requests go only to steamcommunity.com and to the services the user enabled.
 */
import '../shared/settings.js';
import '../shared/fees.js';
import '../shared/sources.js';

const { merge } = globalThis.OIHSettings;
const Fees = globalThis.OIHFees;
const Sources = globalThis.OIHSources;

const STEAM = 'https://steamcommunity.com';
const ALARM = 'oih-poll';
// A price fetched less than this long ago is served from the cache even on an explicit refresh.
const MIN_REFRESH_MS = 60_000;

/* ---------------- settings ---------------- */

let settingsCache = null;

async function getSettings() {
  if (!settingsCache) {
    const { settings } = await chrome.storage.sync.get('settings');
    settingsCache = merge(settings);
  }
  return settingsCache;
}

// Sync area only: local changes carry whole marketplace price lists.
chrome.storage.sync.onChanged.addListener((changes) => {
  if (changes.settings) {
    settingsCache = merge(changes.settings.newValue);
    setupAlarm();
  }
});

/* ---------------- request queue ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const queue = [];
let pumping = false;
let lastRequestAt = 0;
let pausedUntil = 0;

/*
 * Every queued request has a requester { owners, high }: the pages (documentIds) waiting
 * for it and whether any of them is interactive (item card, sell dialog). Interactive
 * requests go first; requests whose pages are all gone are dropped, so a closed market
 * page does not hold up the inventory.
 */
const deadDocs = new Set();

// ctx is either a message context { doc, high } or the requester of an outer request.
function requester(ctx) {
  if (ctx && ctx.owners) return ctx;
  return { owners: new Set([(ctx && ctx.doc) || null]), high: !!(ctx && ctx.high) };
}

function join(rq, ctx) {
  const other = requester(ctx);
  if (other === rq) return;
  other.owners.forEach((d) => rq.owners.add(d));
  if (other.high) rq.high = true;
}

const alive = (rq) => !rq || [...rq.owners].some((d) => d === null || !deadDocs.has(d));

class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.cancelled = true;
  }
}

function dropDead() {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!alive(queue[i].rq)) queue.splice(i, 1)[0].reject(new CancelledError());
  }
}

function enqueue(fn, rq) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, rq, resolve, reject });
    pump();
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const { requestDelayMs } = await getSettings();
      const wait = Math.max(lastRequestAt + Math.max(500, requestDelayMs), pausedUntil) - Date.now();
      if (wait > 0) await sleep(wait);
      // Picked after the pause: a request that arrived meanwhile may be more urgent.
      dropDead();
      if (!queue.length) break;
      const i = Math.max(0, queue.findIndex((j) => j.rq && j.rq.high));
      const job = queue.splice(i, 1)[0];
      try {
        job.resolve(await job.fn());
      } catch (e) {
        job.reject(e);
      }
      lastRequestAt = Date.now();
    }
  } finally {
    pumping = false;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  const doc = port.name === 'oih-page' && port.sender && port.sender.documentId;
  if (!doc) return;
  deadDocs.delete(doc); // a page restored from the back/forward cache reconnects
  port.onDisconnect.addListener(() => {
    deadDocs.add(doc);
    if (deadDocs.size > 1000) deadDocs.delete(deadDocs.values().next().value);
    dropDead();
  });
});

class HttpError extends Error {
  constructor(status, message) {
    super(message || 'HTTP ' + status);
    this.status = status;
  }
}

/** Steam Market GET through the queue; backs off on 429. */
function steamGet(url, as, rq) {
  return enqueue(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { credentials: 'include' });
      if (res.status === 429) {
        pausedUntil = Date.now() + 60_000 * (attempt + 1);
        await sleep(pausedUntil - Date.now());
        continue;
      }
      if (!res.ok) throw new HttpError(res.status);
      return as === 'json' ? res.json() : res.text();
    }
    throw new HttpError(429, 'Steam rate limit (429). Try later.');
  }, rq);
}

/* ---------------- cache ---------------- */

const memCache = new Map();
const inflight = new Map();
const CACHE_PREFIXES = ['pc:', 'ph:', 'bp2:', 'asp:', 'itad:', 'fx:', 'nid:'];
const LEGACY_PREFIXES = ['gh:', 'cs:', 'sp:', 'bp:'];

/**
 * Returns the cache entry { t, v }. `force` refetches unless the entry is younger
 * than MIN_REFRESH_MS. Concurrent callers of one key share a single request;
 * `ctx` ({ doc, high }) adds the caller to that request's requester.
 */
async function cachedEntry(key, ttlMs, loader, force, ctx) {
  let entry = memCache.get(key);
  if (!entry) {
    entry = (await chrome.storage.local.get(key))[key];
    if (entry) memCache.set(key, entry);
  }
  const maxAge = force ? Math.min(ttlMs, MIN_REFRESH_MS) : ttlMs;
  if (entry && Date.now() - entry.t < maxAge) return entry;
  const running = inflight.get(key);
  if (running) {
    join(running.rq, ctx);
    return running.p;
  }
  const rq = requester(ctx);
  const p = (async () => {
    try {
      const fresh = { t: Date.now(), v: await loader(rq) };
      memCache.set(key, fresh);
      await chrome.storage.local.set({ [key]: fresh });
      return fresh;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, { p, rq });
  return p;
}

async function cached(key, ttlMs, loader, force, ctx) {
  return (await cachedEntry(key, ttlMs, loader, force, ctx)).v;
}

/** Value plus `fetchedAt` — the time of the real request, not of this read. */
async function withTime(key, ttlMs, loader, force, ctx) {
  const e = await cachedEntry(key, ttlMs, loader, force, ctx);
  return Object.assign({}, e.v, { fetchedAt: e.t });
}

async function ttl() {
  return (await getSettings()).priceCacheMinutes * 60_000;
}

/** Caller's maxAgeMin (hours for valuation, minutes for selling) or the settings default. */
async function ttlFor(maxAgeMin, fallbackMs) {
  if (maxAgeMin !== undefined && maxAgeMin !== null && Number(maxAgeMin) > 0) return Number(maxAgeMin) * 60_000;
  return fallbackMs !== undefined ? fallbackMs : ttl();
}

async function purgeOldCache() {
  const all = await chrome.storage.local.get(null);
  // item_nameid never changes, so it is kept.
  const expired = (k) => !k.startsWith('nid:') && Date.now() - (all[k]?.t || 0) > 7 * 86400_000;
  const old = Object.keys(all).filter((k) =>
    LEGACY_PREFIXES.some((p) => k.startsWith(p)) || (CACHE_PREFIXES.some((p) => k.startsWith(p)) && expired(k)));
  if (old.length) await chrome.storage.local.remove(old);
}

async function clearCache() {
  memCache.clear();
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => CACHE_PREFIXES.some((p) => k.startsWith(p)));
  await chrome.storage.local.remove(keys);
  return { removed: keys.length };
}

/* ---------------- Steam Market prices ---------------- */

/** priceoverview: lowest price, median and 24h volume. */
async function priceOverview({ appid, name, currency, maxAgeMin, force }, ctx) {
  const key = `pc:${currency}:${appid}:${name}`;
  return withTime(key, await ttlFor(maxAgeMin), async (rq) => {
    const url = `${STEAM}/market/priceoverview/?appid=${appid}&currency=${currency}` +
      `&market_hash_name=${encodeURIComponent(name)}`;
    const data = await steamGet(url, 'json', rq);
    if (!data || !data.success) return { lowest: null, median: null, volume: 0 };
    return {
      lowest: Fees.parsePrice(data.lowest_price),
      median: Fees.parsePrice(data.median_price),
      volume: data.volume ? parseInt(String(data.volume).replace(/\D/g, ''), 10) : 0
    };
  }, force, ctx);
}

/** item_nameid is required for the order book and never changes. */
async function itemNameId(appid, name, rq) {
  return cached(`nid:${appid}:${name}`, Infinity, async (own) => {
    const html = await steamGet(`${STEAM}/market/listings/${appid}/${encodeURIComponent(name)}`, 'text', own);
    const m = html.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\)/);
    if (!m) throw new Error('item_nameid not found');
    return m[1];
  }, false, rq);
}

/** Order book: highest buy order and lowest sell listing. */
async function priceHistogram({ appid, name, currency, maxAgeMin, force }, ctx) {
  const key = `ph:${currency}:${appid}:${name}`;
  const ttlMs = await ttlFor(maxAgeMin, Math.min(await ttl(), 10 * 60_000));
  return withTime(key, ttlMs, async (rq) => {
    const nameId = await itemNameId(appid, name, rq);
    const url = `${STEAM}/market/itemordershistogram?country=US&language=english` +
      `&currency=${currency}&item_nameid=${nameId}&two_factor=0`;
    const data = await steamGet(url, 'json', rq);
    if (!data || data.success !== 1) return { highestBuy: null, lowestSell: null, buyCount: 0, sellCount: 0 };
    const int = (v) => (v === null || v === undefined || v === '' ? null : parseInt(v, 10));
    const count = (v) => (v ? parseInt(String(v).replace(/\D/g, ''), 10) : 0);
    return {
      highestBuy: int(data.highest_buy_order),
      lowestSell: int(data.lowest_sell_order),
      buyCount: count(data.buy_order_summary?.match?.(/>([\d,.\s]+)</)?.[1]),
      sellCount: count(data.sell_order_summary?.match?.(/>([\d,.\s]+)</)?.[1])
    };
  }, force, ctx);
}

/* ---------------- marketplace price lists (optional) ---------------- */

/**
 * The whole price list of a game in one request, in the wallet currency when the
 * marketplace supports it, otherwise in USD (pages convert it if enabled).
 */
async function bulkPrices({ source, appid, currency, force, names }) {
  const src = Sources.SOURCES[source];
  appid = Number(appid);
  if (!src || !src.bulk) return { error: 'unknown source' };
  if (!Sources.supports(source, appid)) return { unsupported: true };
  const granted = await chrome.permissions.contains({ origins: src.origins });
  if (!granted) return { error: 'no-permission' };
  const code = Sources.currencyFor(source, Fees.currencyCode(currency));
  // Marketplaces rebuild their lists every few minutes, so keep at least 10 minutes.
  const key = `bp2:${source}:${appid}:${code}`;
  const ttlMs = Math.max(await ttl(), 10 * 60_000);
  const e = await cachedEntry(key, ttlMs, async () => {
    const res = await fetch(src.url(appid, code), { credentials: 'omit', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new HttpError(res.status, `${src.label}: HTTP ${res.status}`);
    return src.parse(await res.json());
  }, force);
  let { prices, urls = {} } = e.v;
  // Send back only the requested items: a full CS2 list has tens of thousands of entries.
  if (names) {
    const p = {};
    const u = {};
    for (const n of String(names).split('\n')) {
      if (n in prices) p[n] = prices[n];
      if (urls[n]) u[n] = urls[n];
    }
    prices = p;
    urls = u;
  }
  return { source, currency: code, prices, urls, fetchedAt: e.t };
}

/* ---------------- item names by classid (trade offers list) ---------------- */

/*
 * The trade offers list only exposes classid/instanceid. The name comes from the same
 * hover Steam itself shows (/economy/itemclasshover); class descriptions never change.
 */
let classQueue = Promise.resolve();

function extractHoverJson(html) {
  const i = html.indexOf('BuildHover(');
  if (i < 0) return null;
  const start = html.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, j + 1));
  }
  return null;
}

async function itemClassInfo({ appid, classid, instanceid }) {
  appid = String(appid).replace(/\D/g, '');
  classid = String(classid).replace(/\D/g, '');
  instanceid = String(instanceid || '0').replace(/\D/g, '') || '0';
  if (!appid || !classid) throw new Error('bad item');
  return cached(`ci:${appid}:${classid}:${instanceid}`, Infinity, () => {
    // Sequential with a pause so a long offers list does not burst requests to Steam.
    const job = classQueue.then(async () => {
      const res = await fetch(`${STEAM}/economy/itemclasshover/${appid}/${classid}/${instanceid}?content_only=1&omit_owner=1&l=english`,
        { credentials: 'include' });
      await sleep(250);
      if (!res.ok) throw new HttpError(res.status);
      const j = extractHoverJson(await res.text());
      if (!j) throw new Error('no item info');
      return { name: j.market_hash_name || j.name || '', marketable: !!Number(j.marketable), icon: j.icon_url || '' };
    });
    classQueue = job.catch(() => {});
    return job;
  });
}

/* ---------------- Steam Store: historical lows and price history ---------------- */

/*
 * Lows come from the Augmented Steam API (IsThereAnyDeal data, no key); only the ids
 * on the page and the country are sent. The full history needs the user's own ITAD key.
 */
const AUGMENTED_STEAM = 'https://api.augmentedsteam.com';
const ITAD = 'https://api.isthereanydeal.com';
const ITAD_STEAM_SHOP = 61;

const priceInt = (x) => (x && Number.isFinite(x.amountInt) ? x.amountInt : null);

async function storePrices({ country, ids }) {
  const cc = /^[A-Z]{2}$/.test(country || '') ? country : 'US';
  const list = [...new Set(String(ids || '').split(',').filter((x) => /^(app|sub|bundle)\/\d+$/.test(x)))].slice(0, 100);
  const out = {};
  if (!list.length) return out;
  const ttlMs = 6 * 3600_000;
  const missing = [];
  for (const id of list) {
    const key = `asp:${cc}:${id}`;
    const e = memCache.get(key) || (await chrome.storage.local.get(key))[key];
    if (e && Date.now() - e.t < ttlMs) {
      memCache.set(key, e);
      out[id] = e.v;
    } else {
      missing.push(id);
    }
  }
  if (missing.length) {
    const body = { country: cc, apps: [], subs: [], bundles: [], voucher: true, shops: [ITAD_STEAM_SHOP] };
    for (const id of missing) {
      const [type, num] = id.split('/');
      body[type === 'app' ? 'apps' : type === 'sub' ? 'subs' : 'bundles'].push(Number(num));
    }
    const res = await fetch(`${AUGMENTED_STEAM}/prices/v2`, {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!res.ok) throw new HttpError(res.status, 'Augmented Steam: HTTP ' + res.status);
    const j = await res.json();
    const prices = (j && j.prices) || {};
    const now = Date.now();
    const writes = {};
    for (const id of missing) {
      const x = prices[id];
      const v = x ? {
        current: x.current ? { p: priceInt(x.current.price), r: priceInt(x.current.regular), c: x.current.cut || 0, cur: x.current.price && x.current.price.currency } : null,
        lowest: x.lowest ? { p: priceInt(x.lowest.price), r: priceInt(x.lowest.regular), c: x.lowest.cut || 0, cur: x.lowest.price && x.lowest.price.currency, t: Date.parse(x.lowest.timestamp) || null } : null,
        historyUrl: x.urls && x.urls.history ? x.urls.history : null,
        // The ITAD game id is part of the history URL: .../game/id:<uuid>/history/
        itadId: x.urls && x.urls.history ? ((x.urls.history.match(/\/game\/id:([0-9a-f-]{36})\//i) || [])[1] || null) : null
      } : null;
      out[id] = v;
      const entry = { t: now, v };
      memCache.set(`asp:${cc}:${id}`, entry);
      writes[`asp:${cc}:${id}`] = entry;
    }
    await chrome.storage.local.set(writes);
  }
  return out;
}

/** Exchange rates to `to` (Augmented Steam): { rates: { FROM: rate }, fetchedAt }. */
async function ratesTo({ to }) {
  to = String(to || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(to)) throw new Error('bad currency');
  const e = await cachedEntry(`fx:${to}`, 6 * 3600_000, async () => {
    const res = await fetch(`${AUGMENTED_STEAM}/rates/v1?to=${to}`, { credentials: 'omit' });
    if (!res.ok) throw new HttpError(res.status, 'Augmented Steam rates: HTTP ' + res.status);
    const j = await res.json();
    const out = { [to]: 1 };
    for (const [from, map] of Object.entries(j || {})) {
      if (map && Number.isFinite(map[to])) out[from] = map[to];
    }
    return out;
  });
  return { rates: e.v, fetchedAt: e.t };
}

/** Full Steam price history for the chart (IsThereAnyDeal, user key). */
async function storeHistory({ itadId, country }) {
  const s = await getSettings();
  if (!s.itadKey) return { error: 'no-key' };
  if (!(await chrome.permissions.contains({ origins: [`${ITAD}/*`] }))) return { error: 'no-permission' };
  if (!/^[0-9a-f-]{36}$/i.test(itadId || '')) return { error: 'no-id' };
  const cc = /^[A-Z]{2}$/.test(country || '') ? country : 'US';
  const e = await cachedEntry(`itad:h:${itadId}:${cc}`, 6 * 3600_000, async () => {
    const r = await fetch(`${ITAD}/games/history/v2?key=${encodeURIComponent(s.itadKey)}&id=${itadId}&country=${cc}` +
      `&shops=${ITAD_STEAM_SHOP}&since=${encodeURIComponent('2010-01-01T00:00:00Z')}`, { credentials: 'omit' });
    if (!r.ok) throw new HttpError(r.status, 'IsThereAnyDeal: HTTP ' + r.status);
    return ((await r.json()) || []).map((x) => ({
      t: Date.parse(x.timestamp),
      p: priceInt(x.deal && x.deal.price),
      r: priceInt(x.deal && x.deal.regular),
      c: (x.deal && x.deal.cut) || 0
    })).filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p)).sort((a, b) => a.t - b.t);
  });
  return { points: e.v, fetchedAt: e.t };
}

/* ---------------- trade offer notifications ---------------- */

async function setupAlarm() {
  const s = await getSettings();
  await chrome.alarms.clear(ALARM);
  if (s.notifyEnabled) {
    chrome.alarms.create(ALARM, { periodInMinutes: Math.max(1, Number(s.notifyIntervalMin) || 5), delayInMinutes: 0.1 });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

/*
 * The background request may be rejected by Steam (401) even with an active session, so
 * steamcommunity.com pages also report the count they get with a same-site request
 * (content/bridge.js). A recent page report is used when the background request fails.
 */
const REPORT_MAX_AGE_MS = 30 * 60_000;

async function fetchOfferCount() {
  try {
    const res = await fetch(`${STEAM}/actions/GetNotificationCounts`, { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    const n = Number(data?.notifications?.['1']);
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    return null; // offline, or a login page instead of JSON
  }
}

async function applyOfferCount(count) {
  const s = await getSettings();
  const { lastOfferCount = 0 } = await chrome.storage.local.get('lastOfferCount');
  chrome.action.setBadgeBackgroundColor({ color: '#4c8b2b' });
  chrome.action.setBadgeText({ text: s.notifyEnabled && count > 0 ? String(count) : '' });
  if (s.notifyEnabled && s.notifyDesktop && count > lastOfferCount) {
    chrome.notifications.create('oih-trades', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Open Inventory Helper',
      message: s.lang === 'en' || (s.lang === 'auto' && !navigator.language.startsWith('ru'))
        ? `Incoming trade offers: ${count}`
        : `Входящих предложений обмена: ${count}`
    });
  }
  await chrome.storage.local.set({ lastOfferCount: count });
}

/** { loggedIn: true, count } | { loggedIn: false } | { unknown: true } */
async function checkTradeOffers() {
  const count = await fetchOfferCount();
  if (count !== null) {
    await applyOfferCount(count);
    return { loggedIn: true, count };
  }
  const { tradeReport } = await chrome.storage.local.get('tradeReport');
  if (tradeReport && Date.now() - tradeReport.at < REPORT_MAX_AGE_MS) {
    if (!tradeReport.loggedIn) {
      chrome.action.setBadgeText({ text: '' });
      return { loggedIn: false };
    }
    if (tradeReport.count !== null) return { loggedIn: true, count: tradeReport.count };
  }
  return { unknown: true };
}

async function reportTrades({ loggedIn, count }) {
  const n = Number(count);
  const report = { loggedIn: !!loggedIn, count: loggedIn && Number.isFinite(n) && n >= 0 ? n : null, at: Date.now() };
  await chrome.storage.local.set({ tradeReport: report });
  if (!report.loggedIn) chrome.action.setBadgeText({ text: '' });
  else if (report.count !== null) await applyOfferCount(report.count);
  return true;
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) checkTradeOffers();
});

chrome.notifications.onClicked.addListener((id) => {
  if (id === 'oih-trades') {
    chrome.tabs.create({ url: `${STEAM}/my/tradeoffers/` });
    chrome.notifications.clear(id);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
  purgeOldCache();
});
chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
  purgeOldCache();
});

/* ---------------- RPC ---------------- */

const handlers = {
  'settings.get': () => getSettings(),
  'price.overview': (p, ctx) => priceOverview(p, ctx),
  'price.histogram': (p, ctx) => priceHistogram(p, ctx),
  'price.bulk': (p) => bulkPrices(p),
  'store.prices': (p) => storePrices(p),
  'store.history': (p) => storeHistory(p),
  'item.classinfo': (p) => itemClassInfo(p),
  'rates.get': (p) => ratesTo(p),
  'wallet.remember': async ({ currency }) => {
    if (currency) await chrome.storage.local.set({ walletCurrency: Number(currency) });
    return true;
  },
  'wallet.get': async () => (await chrome.storage.local.get('walletCurrency')).walletCurrency || 0,
  'cache.clear': () => clearCache(),
  'trades.check': () => checkTradeOffers(),
  'trades.report': (p) => reportTrades(p),
  'queue.size': () => queue.length
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only our own popup and content scripts.
  if (sender.id !== chrome.runtime.id) return false;
  const handler = handlers[msg?.method];
  if (!handler) {
    sendResponse({ error: 'unknown method' });
    return false;
  }
  const params = msg.params || {};
  const ctx = { doc: sender.documentId || null, high: params.priority === 'high' };
  Promise.resolve()
    .then(() => handler(params, ctx))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ error: e?.message || String(e), status: e?.status, cancelled: !!e?.cancelled }));
  return true;
});
