(() => {
  'use strict';
  const { DEFAULT_SETTINGS, merge } = window.OIHSettings;
  const { CURRENCIES } = window.OIHFees;
  const { SOURCES, ORDER } = window.OIHSources;
  const form = document.getElementById('form');
  const hasChrome = typeof chrome !== 'undefined' && chrome.storage;

  const EN = {
    tabGeneral: 'General', tabPrices: 'Prices', tabInventory: 'Inventory', tabMarket: 'Market',
    tabTrades: 'Trades', tabStore: 'Store',
    interfaceSec: 'Interface', lang: 'Language', currency: 'Currency',
    convertCurrency: 'Convert prices to my currency', convertHint: 'Marketplace and store prices in another currency are converted at Augmented Steam API rates',
    privacyTitle: 'Privacy',
    privacy: 'No ads, no analytics. The extension talks only to steamcommunity.com and to the public APIs of services you enable yourself (Skinport, Market.CSGO, Waxpeer, Augmented Steam, IsThereAnyDeal). Settings and cache stay in your browser.',
    sourcesSec: 'Price sources', sourcesHint: 'Marketplaces other than Steam return the whole CS2, Dota 2, TF2 and Rust price list in one request. The browser will ask for access to their public API.',
    primarySource: 'Primary source', primaryHint: 'Prices on item tiles, in the inventory value and in trades',
    cacheSec: 'Cache and requests', cacheMin: 'Price cache, minutes', cacheHint: 'A price fetched on any page is reused everywhere until it expires',
    valCache: 'Price cache for valuation, hours', delay: 'Delay between requests, ms', delayHint: 'Protects from Steam rate limits (429)',
    clearCacheTitle: 'Saved prices', clearCacheHint: 'Remove cached prices, rates and store lows', clearCache: 'Clear',
    displaySec: 'Display', inventoryTools: 'Inventory toolbar', autoValuate: 'Calculate inventory value automatically',
    showItemPrices: 'Prices on item tiles', autoLoad: 'Load buy orders for the selected item',
    sellingSec: 'Selling', strategy: 'Price strategy',
    stLowest: 'Lowest − undercut', stMedian: 'Median', stBuyorder: 'Highest buy order', stManual: 'Manual',
    undercut: 'Undercut from lowest, cents', sellFresh: 'Price freshness when selling, minutes',
    sellFreshHint: 'Fresher prices come from the cache without a new request',
    sellDelay: 'Delay between listings, ms', confirmSell: 'Ask before selling',
    itemPageSec: 'Item page', history: 'Price history stats', quickBuy: 'Quick buy button', confirmBuy: 'Ask before buying',
    myListingsSec: 'My listings and buy orders', marketCompare: 'Compare with the market', bulk: 'Bulk remove listings and buy orders',
    tradeWindowSec: 'Trade window', tradePrices: 'Prices and side totals', addMultiple: 'Add multiple items',
    offersSec: 'Trade offers list', tradeOfferValues: 'Value of offers', quickAccept: '“Accept now” button',
    notifySec: 'Notifications', notify: 'Incoming trades badge on the icon', notifyDesktop: 'Desktop notifications for new trades',
    interval: 'Check every, minutes',
    storeSec: 'Steam Store', storeHistory: 'Historical lows', storeHistoryHint: 'Games, DLC, packages and bundles; Augmented Steam API data',
    itadKey: 'IsThereAnyDeal key', itadSave: 'Save',
    itadHint: 'Optional: enables the price history chart when hovering a price. The key is free and stays in your browser.',
    itadHowTitle: 'How to get a key', itadStep1: 'Sign in to isthereanydeal.com (Steam sign-in works).',
    itadStep2: 'On the “My Apps” page click “Register app” and enter any name.',
    itadStep3: 'Copy the “API Key” into the field above and click “Save”.', itadOpen: 'Open My Apps on IsThereAnyDeal',
    walletCur: 'Steam wallet currency', saved: 'Saved', cleared: 'Removed: {0}', keySaved: 'Key saved',
    offers: 'Incoming trade offers: {0}', loggedOut: 'Not logged in to steamcommunity.com', statusUnknown: 'Open steamcommunity.com to update the trade status', permDenied: 'Access to the API was not granted'
  };
  // Russian UI text lives in the markup; these are the strings set from code.
  const RU = {
    walletCur: 'Валюта кошелька Steam', saved: 'Сохранено', cleared: 'Удалено записей: {0}', keySaved: 'Ключ сохранён',
    offers: 'Входящих обменов: {0}', loggedOut: 'Вы не вошли на steamcommunity.com', statusUnknown: 'Откройте steamcommunity.com, чтобы обновить статус обменов', permDenied: 'Доступ к API не выдан'
  };

  let settings = merge();
  const lang = () => (settings.lang === 'auto' ? (navigator.language.startsWith('ru') ? 'ru' : 'en') : settings.lang);
  const tr = (key, arg) => ((lang() === 'en' ? EN[key] : RU[key]) || '').replace('{0}', arg ?? '');

  function applyI18n() {
    const en = lang() === 'en';
    document.querySelectorAll('[data-i18n]').forEach((n) => {
      if (!n.dataset.ru) n.dataset.ru = n.textContent;
      n.textContent = en && EN[n.dataset.i18n] ? EN[n.dataset.i18n] : n.dataset.ru;
    });
    document.documentElement.lang = lang();
    const first = document.querySelector('#currency option[value="0"]');
    if (first) first.textContent = tr('walletCur');
  }

  /* ---------------- tabs ---------------- */

  const TAB_KEY = 'oih-popup-tab';

  function showTab(id) {
    document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== id; });
    try { localStorage.setItem(TAB_KEY, id); } catch (e) { /* storage unavailable */ }
  }

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) showTab(b.dataset.tab);
  });

  /* ---------------- form ---------------- */

  function fillCurrencies() {
    const sel = document.getElementById('currency');
    sel.append(new Option(tr('walletCur'), '0'));
    for (const [id, code] of Object.entries(CURRENCIES)) sel.append(new Option(code, id));
  }

  function fillSources() {
    const box = document.getElementById('sources');
    for (const id of ORDER) {
      const label = document.createElement('label');
      label.className = 'row';
      const span = document.createElement('span');
      span.textContent = SOURCES[id].label;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'switch';
      cb.dataset.source = id;
      label.append(span, cb);
      box.append(label);
    }
  }

  function writeSources() {
    const sel = document.getElementById('primarySource');
    document.querySelectorAll('#sources input[data-source]').forEach((cb) => {
      cb.checked = settings.priceSources.includes(cb.dataset.source);
      cb.disabled = cb.checked && settings.priceSources.length === 1; // at least one source
    });
    sel.replaceChildren(...settings.priceSources.map((id) => new Option(SOURCES[id] ? SOURCES[id].label : id, id)));
    sel.value = settings.primarySource;
  }

  const readSources = () => [...document.querySelectorAll('#sources input[data-source]:checked')].map((cb) => cb.dataset.source);

  function writeForm() {
    writeSources();
    for (const [k, v] of Object.entries(settings)) {
      if (k === 'priceSources') continue;
      const field = form.elements[k];
      if (!field) continue;
      if (field.type === 'checkbox') field.checked = !!v;
      else field.value = String(v);
    }
  }

  function readForm() {
    const out = { priceSources: readSources() };
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (k === 'priceSources') continue;
      const field = form.elements[k];
      if (!field) continue;
      if (field.type === 'checkbox') out[k] = field.checked;
      else if (typeof DEFAULT_SETTINGS[k] === 'number') {
        const n = Number(field.value);
        out[k] = Number.isFinite(n) ? n : DEFAULT_SETTINGS[k];
      } else out[k] = field.value;
    }
    return out;
  }

  let flashTimer = null;
  function flash(text) {
    const s = document.getElementById('saved');
    s.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { s.textContent = ''; }, 2000);
  }

  async function save() {
    settings = merge(readForm());
    writeSources();
    if (hasChrome) await chrome.storage.sync.set({ settings });
    applyI18n();
    flash(tr('saved'));
  }

  form.addEventListener('submit', (e) => e.preventDefault());

  form.addEventListener('change', async (e) => {
    if (e.target.name === 'itadKey') return;
    const id = e.target.dataset && e.target.dataset.source;
    if (id && e.target.checked && SOURCES[id].origins.length && hasChrome) {
      // Must be requested straight from the user gesture.
      const granted = await chrome.permissions.request({ origins: SOURCES[id].origins });
      if (!granted) {
        e.target.checked = false;
        flash(tr('permDenied'));
        return;
      }
    }
    save();
  });

  document.getElementById('itadSave').addEventListener('click', async () => {
    const key = document.getElementById('itadKey').value.trim();
    if (key && hasChrome) {
      const ok = await chrome.permissions.request({ origins: ['https://api.isthereanydeal.com/*'] });
      if (!ok) {
        flash(tr('permDenied'));
        return;
      }
    }
    await save();
    flash(tr('keySaved'));
  });

  document.getElementById('clearCache').addEventListener('click', async () => {
    if (!hasChrome) return;
    const r = await chrome.runtime.sendMessage({ method: 'cache.clear' });
    flash(tr('cleared', r?.data?.removed ?? 0));
  });

  async function init() {
    if (hasChrome) {
      const stored = await chrome.storage.sync.get('settings');
      settings = merge(stored.settings);
      document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;
    }
    fillCurrencies();
    fillSources();
    writeForm();
    applyI18n();
    let tab = new URLSearchParams(location.search).get('tab');
    try { tab = tab || localStorage.getItem(TAB_KEY); } catch (e) { /* storage unavailable */ }
    showTab(document.querySelector(`[data-panel="${tab}"]`) ? tab : 'general');
    if (hasChrome) {
      const trades = document.getElementById('trades');
      try {
        const r = await chrome.runtime.sendMessage({ method: 'trades.check' });
        const d = r?.data || {};
        trades.textContent = d.loggedIn ? tr('offers', d.count) : d.unknown ? tr('statusUnknown') : tr('loggedOut');
      } catch (e) {
        trades.textContent = '';
      }
    } else {
      document.getElementById('trades').textContent = '';
    }
  }

  init();
})();
