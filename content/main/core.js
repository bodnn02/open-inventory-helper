/*
 * Shared core for Steam page scripts (world: MAIN): window.OIH with RPC to the extension,
 * settings, i18n, the page price store, Steam requests and small UI helpers.
 */
(() => {
  'use strict';
  if (window.OIH) return;

  const Fees = window.OIHFees;

  /* ---------------- i18n ---------------- */

  const STRINGS = {
    ru: {
      selected: 'Выбранный предмет',
      nothingSelected: 'Выберите предмет в инвентаре',
      notMarketable: 'Нельзя продать на торговой площадке',
      lowest: 'Мин. цена', median: 'Медиана', volume: 'Продано за 24ч', buyOrder: 'Лучший ордер',
      loading: 'Загрузка…', error: 'Ошибка', errPrivate: 'инвентарь скрыт настройками приватности', errRateLimit: 'Steam временно ограничил запросы (429), попробуйте позже',
      quickSell: 'Быстрая продажа', instantSell: 'Моментально', sellFor: 'Продать за',
      youReceive: 'вы получите', buyerPays: 'покупатель платит',
      selectMode: 'Режим выбора', selectModeHint: 'Клик — выбрать, Shift+клик — все такие же',
      overview: 'Обзор инвентаря', sellSelected: 'Продать выбранные', clear: 'Сбросить',
      selectedCount: 'Выбрано: {0}',
      confirmSell: 'Выставить «{0}» за {1} (вы получите {2})?',
      confirmBulk: 'Выставить предметов: {0} на сумму {1} (вы получите {2})?',
      listed: 'Выставлено на продажу', needConfirm: 'Подтвердите лоты в мобильном приложении Steam',
      notOwn: 'Это чужой инвентарь: продажа недоступна',
      invTitle: 'Обзор инвентаря', items: 'Предметов', unique: 'Уникальных', marketable: 'Продаваемых',
      totalValue: 'Стоимость инвентаря', loadPrices: 'Оценить инвентарь', refreshPrices: 'Обновить цены', pricedOf: 'оценено {0} из {1}', marketInfo: 'Торговая площадка', stop: 'Стоп', exportCsv: 'Экспорт CSV',
      search: 'Поиск…', onlyMarketable: 'только продаваемые',
      sortValue: 'по сумме', sortPrice: 'по цене', sortCount: 'по количеству', sortName: 'по названию',
      name: 'Название', count: 'Кол-во', price: 'Цена', total: 'Сумма', toSell: 'Продать',
      sellDialog: 'Продажа предметов', strategy: 'Стратегия цены',
      stLowest: 'мин. цена − {0}', stMedian: 'медиана', stBuyorder: 'лучший ордер на покупку', stManual: 'вручную',
      apply: 'Применить', start: 'Начать продажу', close: 'Закрыть', cancel: 'Отмена', ok: 'OK',
      totalReceive: 'Итого вы получите', progress: 'Выполнено {0} из {1}',
      done: 'Готово: успешно {0}, ошибок {1}', skipNoPrice: 'пропущено — нет цены',
      etaSteam: 'Цены Steam загружаются по одной (~{0} с на предмет), уже загруженные берутся из кэша.',
      sourceSkinport: 'Цены: Skinport ({0})', sourceSteam: 'Цены: Steam Market',
      quickBuy: 'Купить', confirmBuy: 'Купить за {0}?', bought: 'Куплено',
      notEnoughFunds: 'Недостаточно средств в кошельке',
      history: 'История цен', h24: '24 часа', d7: '7 дней', d30: '30 дней', avg: 'Средняя', min: 'Мин', max: 'Макс', sold: 'Продано',
      selectAll: 'Выбрать все', removeSelected: 'Снять выбранные', removeAll: 'Снять ВСЕ лоты',
      cancelOrders: 'Отменить все ордера', confirmRemoveAll: 'Снять с продажи все лоты ({0})?',
      confirmRemoveSel: 'Снять выбранные лоты ({0})?', confirmCancelOrders: 'Отменить все ордера на покупку ({0})?',
      onPage: 'На странице: {0} лотов, покупатели платят {1}, вы получите {2}',
      collecting: 'Сбор списка лотов…',
      youGive: 'Вы отдаёте', youGet: 'Вы получаете', diff: 'Разница',
      addMultiple: 'Добавить несколько', nameContains: 'название содержит…', add: 'Добавить',
      added: 'Добавлено: {0}',
      confirmTitle: 'Подтверждение', acceptNow: 'Принять сразу', confirmAccept: 'Принять предложение обмена {0}?', accepted: 'Обмен принят',
      reloadPage: 'Расширение обновлено — перезагрузите страницу',
      justNow: 'только что', minAgo: '{0} мин назад', hAgo: '{0} ч назад', updated: 'Обновлено',
      refresh: 'Обновить', refreshAll: 'Обновить все цены',
      srcUnsupported: 'нет этой игры', errNoPermission: 'нет разрешения — включите источник в настройках расширения',
      offerUnknown: 'без цены: {0}', convertedNote: 'пересчитано из {0} по курсу 1 {0} = {1}',
      otherMarkets: 'Другие площадки', recommended: 'Подставить', clickToUse: 'Нажмите, чтобы подставить цену',
      recUndercut: 'мин. − {0}', recLowest: 'мин.', recMedian: 'медиана', recBuy: 'ордер',
      selectOverpriced: 'Выбрать завышенные', unselectOverpriced: 'Снять выбор с завышенных',
      selectModeOn: 'Режим выбора: вкл', selectModeOff: 'Режим выбора: выкл',
      selectHint: 'Кликайте по предметам, чтобы выбрать. Shift+клик — все такие же. Esc — выйти.',
      cmpLowest: '✓ Ваша цена самая низкая', cmpAbove: '▲ Выше минимальной на {0} ({1})', cmpMin: 'мин. на рынке: {0}',
      cmpBuyBest: '✓ Ваш ордер лучший', cmpBuyBelow: '▼ Есть ордер выше: {0}',
      cmpSummary: 'Завышенная цена: {0} из {1} лотов', checking: 'проверка цены…'
    },
    en: {
      selected: 'Selected item',
      nothingSelected: 'Select an item in the inventory',
      notMarketable: 'Not marketable',
      lowest: 'Lowest', median: 'Median', volume: 'Sold in 24h', buyOrder: 'Highest buy order',
      loading: 'Loading…', error: 'Error', errPrivate: 'inventory is private', errRateLimit: 'Steam rate limit (429), try again later',
      quickSell: 'Quick sell', instantSell: 'Instant', sellFor: 'Sell for',
      youReceive: 'you receive', buyerPays: 'buyer pays',
      selectMode: 'Select mode', selectModeHint: 'Click to select, Shift+click to select all identical',
      overview: 'Inventory overview', sellSelected: 'Sell selected', clear: 'Clear',
      selectedCount: 'Selected: {0}',
      confirmSell: 'List “{0}” for {1} (you receive {2})?',
      confirmBulk: 'List {0} items for {1} in total (you receive {2})?',
      listed: 'Listed for sale', needConfirm: 'Confirm the listings in the Steam mobile app',
      notOwn: 'This is someone else’s inventory: selling is disabled',
      invTitle: 'Inventory overview', items: 'Items', unique: 'Unique', marketable: 'Marketable',
      totalValue: 'Inventory value', loadPrices: 'Value inventory', refreshPrices: 'Refresh prices', pricedOf: 'priced {0} of {1}', marketInfo: 'Community Market', stop: 'Stop', exportCsv: 'Export CSV',
      search: 'Search…', onlyMarketable: 'marketable only',
      sortValue: 'by total', sortPrice: 'by price', sortCount: 'by count', sortName: 'by name',
      name: 'Name', count: 'Qty', price: 'Price', total: 'Total', toSell: 'Sell',
      sellDialog: 'Sell items', strategy: 'Price strategy',
      stLowest: 'lowest − {0}', stMedian: 'median', stBuyorder: 'highest buy order', stManual: 'manual',
      apply: 'Apply', start: 'Start selling', close: 'Close', cancel: 'Cancel', ok: 'OK',
      totalReceive: 'You receive in total', progress: 'Done {0} of {1}',
      done: 'Finished: {0} succeeded, {1} failed', skipNoPrice: 'skipped — no price',
      etaSteam: 'Steam prices load one by one (~{0}s per item); cached prices are instant.',
      sourceSkinport: 'Prices: Skinport ({0})', sourceSteam: 'Prices: Steam Market',
      quickBuy: 'Buy', confirmBuy: 'Buy for {0}?', bought: 'Purchased',
      notEnoughFunds: 'Insufficient wallet funds',
      history: 'Price history', h24: '24 hours', d7: '7 days', d30: '30 days', avg: 'Avg', min: 'Min', max: 'Max', sold: 'Sold',
      selectAll: 'Select all', removeSelected: 'Remove selected', removeAll: 'Remove ALL listings',
      cancelOrders: 'Cancel all buy orders', confirmRemoveAll: 'Remove all listings ({0})?',
      confirmRemoveSel: 'Remove selected listings ({0})?', confirmCancelOrders: 'Cancel all buy orders ({0})?',
      onPage: 'On this page: {0} listings, buyers pay {1}, you receive {2}',
      collecting: 'Collecting listings…',
      youGive: 'You give', youGet: 'You get', diff: 'Difference',
      addMultiple: 'Add multiple', nameContains: 'name contains…', add: 'Add',
      added: 'Added: {0}',
      confirmTitle: 'Confirm', acceptNow: 'Accept now', confirmAccept: 'Accept trade offer {0}?', accepted: 'Trade accepted',
      reloadPage: 'Extension was updated — reload the page',
      justNow: 'just now', minAgo: '{0} min ago', hAgo: '{0} h ago', updated: 'Updated',
      refresh: 'Refresh', refreshAll: 'Refresh all prices',
      srcUnsupported: 'game not supported', errNoPermission: 'no permission — enable the source in extension settings',
      offerUnknown: 'no price: {0}', convertedNote: 'converted from {0} at 1 {0} = {1}',
      otherMarkets: 'Other markets', recommended: 'Use', clickToUse: 'Click to use this price',
      recUndercut: 'lowest − {0}', recLowest: 'lowest', recMedian: 'median', recBuy: 'buy order',
      selectOverpriced: 'Select overpriced', unselectOverpriced: 'Unselect overpriced',
      selectModeOn: 'Select mode: on', selectModeOff: 'Select mode: off',
      selectHint: 'Click items to select them. Shift+click selects all identical. Esc exits.',
      cmpLowest: '✓ Your price is the lowest', cmpAbove: '▲ Above the lowest by {0} ({1})', cmpMin: 'lowest on market: {0}',
      cmpBuyBest: '✓ Your buy order is the highest', cmpBuyBelow: '▼ Higher buy order exists: {0}',
      cmpSummary: 'Overpriced: {0} of {1} listings', checking: 'checking price…'
    }
  };

  /* ---------------- RPC ---------------- */

  let rpcSeq = 0;
  const pending = new Map();

  document.addEventListener('oih:res', (e) => {
    let msg;
    try {
      msg = JSON.parse(e.detail);
    } catch (err) {
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) {
      const err = new Error(msg.error);
      err.status = msg.status;
      p.reject(err);
    } else {
      p.resolve(msg.data);
    }
  });

  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++rpcSeq;
      pending.set(id, { resolve, reject });
      document.dispatchEvent(new CustomEvent('oih:req', { detail: JSON.stringify({ id, method, params }) }));
    });
  }

  /* ---------------- settings ---------------- */

  const OIH = {
    Fees,
    settings: {},
    rpc,
    _settingsListeners: []
  };

  OIH.lang = () => {
    const l = OIH.settings.lang;
    if (l === 'ru' || l === 'en') return l;
    return (navigator.language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
  };

  OIH.t = (key, ...args) => {
    const s = (STRINGS[OIH.lang()] || STRINGS.en)[key] || STRINGS.en[key] || key;
    return s.replace(/\{(\d+)\}/g, (_, i) => (args[i] !== undefined ? args[i] : ''));
  };

  OIH.onSettings = (fn) => OIH._settingsListeners.push(fn);

  document.addEventListener('oih:settings', (e) => {
    try {
      Object.assign(OIH.settings, JSON.parse(e.detail));
      OIH._settingsListeners.forEach((fn) => fn(OIH.settings));
    } catch (err) { /* ignore */ }
  });

  let readyPromise = null;
  OIH.ready = () => {
    if (!readyPromise) {
      readyPromise = (async () => {
        OIH.settings = await rpc('settings.get');
        OIH.rememberedCurrency = await rpc('wallet.get').catch(() => 0);
        const wc = window.g_rgWalletInfo && Number(window.g_rgWalletInfo.wallet_currency);
        if (wc) rpc('wallet.remember', { currency: wc }).catch(() => {});
        return OIH;
      })();
    }
    return readyPromise;
  };

  /* ---------------- currency and fees ---------------- */

  OIH.walletInfo = () => window.g_rgWalletInfo || null;

  OIH.currencyId = () =>
    Number(OIH.settings.currency) ||
    Number(window.g_rgWalletInfo && window.g_rgWalletInfo.wallet_currency) ||
    Number(OIH.rememberedCurrency) || 1;

  OIH.currencyCode = (id) => Fees.currencyCode(id || OIH.currencyId());

  OIH.fmt = (cents, code) => Fees.formatPrice(cents, code || OIH.currencyCode(), OIH.lang() === 'ru' ? 'ru-RU' : 'en-US');

  OIH.sellerReceives = (buyer, publisherFee) => Fees.sellerReceives(buyer, OIH.walletInfo(), publisherFee);
  OIH.buyerPays = (seller, publisherFee) => Fees.buyerPays(seller, OIH.walletInfo(), publisherFee);

  /* ---------------- Steam Market prices ---------------- */

  /*
   * The service worker cache is shared by all tabs; every answer carries fetchedAt.
   * opts.maxAgeMin — the oldest acceptable price, opts.force — refetch, opts.priority: 'high' —
   * skip the queue (something the user is waiting for right now). The page keeps the
   * latest answers in OIH.priceStore so valuation, the item card, selling and the market
   * compare reuse each other's prices without a round trip.
   */
  OIH.priceStore = new Map();
  const storeKey = (appid, name) => appid + '|' + name;
  const priceListeners = [];
  // Matches the service worker: a refresh never refetches a price younger than this.
  const MIN_REFRESH_MS = 60000;

  /** fn(appid, name) runs whenever a new price arrives from anywhere on the page. */
  OIH.onPriceUpdate = (fn) => priceListeners.push(fn);
  const notifyPrice = (appid, name) => priceListeners.forEach((fn) => {
    try { fn(Number(appid), name); } catch (e) { /* ignore */ }
  });

  OIH.freshMinutes = () => Math.max(1, Number(OIH.settings.sellFreshMinutes) || 10);
  OIH.valuationMinutes = () => (Number(OIH.settings.valuationCacheHours) || 12) * 60;

  function fromStore(appid, name, field, opts) {
    const e = OIH.priceStore.get(storeKey(appid, name));
    const at = e && e[field + 'At'];
    if (!at) return null;
    const maxAge = opts.force ? MIN_REFRESH_MS : (opts.maxAgeMin ? opts.maxAgeMin * 60000 : 0);
    return Date.now() - at < maxAge ? e[field] : null;
  }

  function remember(appid, name, field, r) {
    const key = storeKey(appid, name);
    const e = OIH.priceStore.get(key) || {};
    if (e[field + 'At'] === r.fetchedAt) return;
    e[field] = r;
    e[field + 'At'] = r.fetchedAt;
    OIH.priceStore.set(key, e);
    notifyPrice(appid, name);
  }

  OIH.priceOverview = async (appid, name, opts = {}) => {
    const hit = fromStore(appid, name, 'ov', opts);
    if (hit) return hit;
    const r = await rpc('price.overview', { appid, name, currency: OIH.currencyId(), maxAgeMin: opts.maxAgeMin, force: !!opts.force, priority: opts.priority });
    remember(appid, name, 'ov', r);
    return r;
  };

  OIH.priceHistogram = async (appid, name, opts = {}) => {
    const hit = fromStore(appid, name, 'hist', opts);
    if (hit) return hit;
    const r = await rpc('price.histogram', { appid, name, currency: OIH.currencyId(), maxAgeMin: opts.maxAgeMin, force: !!opts.force, priority: opts.priority });
    remember(appid, name, 'hist', r);
    return r;
  };

  OIH.storedPrice = (appid, name) => OIH.priceStore.get(storeKey(appid, name)) || null;

  /**
   * Lowest sell price for valuation and trades. A fresh order book from the item card is
   * as good as priceoverview here, so it is reused instead of a new request.
   */
  OIH.lowestPrice = async (appid, name, opts = {}) => {
    const hist = fromStore(appid, name, 'hist', opts);
    if (hist && hist.lowestSell != null) return { price: hist.lowestSell, fetchedAt: hist.fetchedAt };
    const ov = await OIH.priceOverview(appid, name, opts);
    return { price: ov.lowest ?? ov.median ?? null, fetchedAt: ov.fetchedAt };
  };

  /** "14:32" */
  OIH.clock = (ts) => (ts ? new Date(ts).toLocaleTimeString(OIH.lang() === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '');

  /** "14:32 · 5 min ago" */
  OIH.when = (ts) => (ts ? `${OIH.clock(ts)} · ${OIH.ago(ts)}` : '—');

  /** Time label that refreshes itself every 15 s. mode: 'when' | 'ago'. */
  OIH.timeEl = (ts, mode = 'when', prefix = '') => {
    const n = OIH.el('span', { class: 'oih-time' });
    OIH.setTime(n, ts, mode, prefix);
    return n;
  };
  OIH.setTime = (n, ts, mode = 'when', prefix = '') => {
    n.dataset.oihTs = ts ? String(ts) : '';
    n.dataset.oihMode = mode;
    n.dataset.oihPrefix = prefix;
    n.textContent = prefix + (mode === 'ago' ? (ts ? OIH.ago(ts) : '—') : OIH.when(ts));
    if (ts) n.title = new Date(ts).toLocaleString(OIH.lang() === 'ru' ? 'ru-RU' : 'en-US');
  };
  setInterval(() => {
    document.querySelectorAll('[data-oih-ts]').forEach((n) => {
      const ts = Number(n.dataset.oihTs);
      if (ts) OIH.setTime(n, ts, n.dataset.oihMode, n.dataset.oihPrefix);
    });
  }, 15000);

  OIH.ago = (ts) => {
    if (!ts) return '—';
    const min = Math.floor((Date.now() - ts) / 60000);
    if (min < 1) return OIH.t('justNow');
    if (min < 60) return OIH.t('minAgo', min);
    return OIH.t('hAgo', Math.floor(min / 60));
  };

  /* ---------------- price sources ---------------- */

  const Sources = window.OIHSources;

  /** Enabled sources in settings order (at least Steam). */
  OIH.enabledSources = () => {
    const list = (Array.isArray(OIH.settings.priceSources) ? OIH.settings.priceSources : ['steam'])
      .filter((id) => Sources.SOURCES[id]);
    return list.length ? list : ['steam'];
  };

  /** Primary source: prices on tiles, in the total and in trades. */
  OIH.primarySource = (appid) => {
    const list = OIH.enabledSources();
    const want = OIH.settings.primarySource;
    if (list.includes(want) && (appid === undefined || Sources.supports(want, appid))) return want;
    return list.find((id) => appid === undefined || Sources.supports(id, appid)) || 'steam';
  };

  OIH.sourceLabel = (id) => (Sources.SOURCES[id] ? Sources.SOURCES[id].label : id);

  const ratesCache = new Map(); // TO -> Promise<{rates, fetchedAt}>
  OIH.convertOn = () => OIH.settings.convertCurrency !== false;
  OIH.ratesTo = (to) => {
    if (!ratesCache.has(to)) {
      ratesCache.set(to, rpc('rates.get', { to }).catch((e) => {
        ratesCache.delete(to);
        throw e;
      }));
    }
    return ratesCache.get(to);
  };

  /** "converted from USD at 1 USD = 41.30 ₴" */
  OIH.rateNote = (conv) => (conv ? OIH.t('convertedNote', conv.from, OIH.fmt(Math.round(conv.rate * 100), conv.to)) : '');

  /*
   * Marketplace prices seen on this page, per item: { price, currency, url, fetchedAt, converted }
   * or { error }. Filled by every price-list answer, so valuation, the item card and trades
   * share them. Marketplaces rebuild their lists every few minutes.
   */
  const BULK_FRESH_MS = 10 * 60000;
  const ERROR_RETRY_MS = 60000;
  const bulkItems = new Map(); // source|appid|name -> entry
  const bulkKey = (source, appid, name) => `${source}|${Number(appid)}|${name}`;

  function rememberBulk(source, appid, names, r) {
    const at = (r && r.fetchedAt) || Date.now();
    for (const name of names) {
      bulkItems.set(bulkKey(source, appid, name), r && r.prices ? {
        price: r.prices[name] ?? null, currency: r.currency, url: r.urls && r.urls[name],
        fetchedAt: at, converted: r.converted, savedAt: Date.now()
      } : { error: (r && (r.error || (r.unsupported && 'unsupported'))) || 'n/a', savedAt: Date.now() });
    }
  }

  /**
   * Cached marketplace price of one item, or undefined when it has to be requested.
   * Age counts from the page receiving it: the service worker already enforces its own TTL.
   */
  OIH.peekBulk = (source, appid, name) => {
    const e = bulkItems.get(bulkKey(source, appid, name));
    if (!e) return undefined;
    return Date.now() - e.savedAt < (e.error ? ERROR_RETRY_MS : BULK_FRESH_MS) ? e : undefined;
  };

  /**
   * Marketplace price list, only the requested names. When conversion is on and the
   * marketplace answers in another currency, prices are converted: r.converted = { from, to, rate }.
   */
  OIH.bulkPrices = async (source, appid, force, names) => {
    const r = await rpc('price.bulk', {
      source, appid, currency: OIH.currencyId(), force: !!force,
      // A string, not an array: Prototype.js on Steam pages breaks JSON.stringify for arrays.
      names: names ? names.join('\n') : undefined
    });
    const to = OIH.currencyCode();
    if (r && r.prices && r.currency && r.currency !== to && OIH.convertOn()) {
      try {
        const { rates } = await OIH.ratesTo(to);
        const rate = rates[r.currency];
        if (rate) {
          for (const k of Object.keys(r.prices)) {
            if (r.prices[k] != null) r.prices[k] = Math.round(r.prices[k] * rate);
          }
          r.converted = { from: r.currency, to, rate };
          r.currency = to;
        }
      } catch (e) { /* no rate: keep the original currency */ }
    }
    if (names) rememberBulk(source, appid, names, r);
    return r;
  };

  // Single-item lookups made in the same tick are merged into one request per source and game.
  const bulkBatches = new Map(); // source|appid -> { names: Map<name, resolvers[]> }

  /** Marketplace price of one item (see OIH.peekBulk for the shape). */
  OIH.bulkPrice = (source, appid, name) => {
    const hit = OIH.peekBulk(source, appid, name);
    if (hit) return Promise.resolve(hit);
    const key = `${source}|${Number(appid)}`;
    let batch = bulkBatches.get(key);
    if (!batch) {
      batch = { names: new Map() };
      bulkBatches.set(key, batch);
      setTimeout(async () => {
        bulkBatches.delete(key);
        const names = [...batch.names.keys()];
        try {
          await OIH.bulkPrices(source, appid, false, names);
        } catch (e) {
          rememberBulk(source, appid, names, { error: e.message });
        }
        for (const [n, waiters] of batch.names) {
          const v = bulkItems.get(bulkKey(source, appid, n));
          waiters.forEach((resolve) => resolve(v));
        }
      }, 30);
    }
    return new Promise((resolve) => {
      if (!batch.names.has(name)) batch.names.set(name, []);
      batch.names.get(name).push(resolve);
    });
  };

  OIH.itemUrl = (source, appid, name, apiUrl) => Sources.itemUrl(source, appid, name, apiUrl);

  /** Source name linking to its market for this game. */
  OIH.sourceLink = (source, appid, text, extraClass) => {
    const href = Sources.homeUrl(source, appid);
    const label = text || OIH.sourceLabel(source);
    if (!href) return OIH.el('span', { class: extraClass || '', text: label });
    return OIH.el('a', {
      class: 'oih-source-link ' + (extraClass || ''), href, target: '_blank', rel: 'noopener noreferrer',
      title: href, text: label
    });
  };

  /** Price linking to the item on the source site, without a referrer. */
  OIH.priceLink = (source, appid, name, text, apiUrl, extraClass) => {
    const href = OIH.itemUrl(source, appid, name, apiUrl);
    if (!href) return OIH.el('span', { class: extraClass || '', text });
    return OIH.el('a', {
      class: 'oih-price-link ' + (extraClass || ''), href, target: '_blank', rel: 'noopener noreferrer',
      title: `${OIH.sourceLabel(source)}: ${name}`, text
    });
  };

  /**
   * Steam Market prices for valuation, one item at a time through the shared queue.
   * onPrice(name, cents, currency, error) fires as prices arrive; `fresh` refetches
   * (prices younger than MIN_REFRESH_MS are still reused). Returns { cancel, currency }.
   */
  OIH.valuate = (appid, names, onPrice, onDone, fresh) => {
    let cancelled = false;
    const ctl = { cancel: () => { cancelled = true; }, currency: OIH.currencyCode(), source: 'steam' };
    (async () => {
      for (const n of names) {
        if (cancelled) break;
        try {
          const p = await OIH.lowestPrice(appid, n, fresh ? { force: true } : { maxAgeMin: OIH.valuationMinutes() });
          if (cancelled) break;
          onPrice(n, p.price, ctl.currency);
        } catch (e) {
          onPrice(n, null, ctl.currency, e);
          if (e.status === 429) break;
        }
      }
      if (onDone) onDone(ctl);
    })();
    return ctl;
  };

  /* ---------------- item value for trades ---------------- */

  const itemValueCache = new Map(); // source|appid|name -> Promise<info|null>

  /**
   * Item price from the primary source, Steam Market when the marketplace lacks the game.
   * Returns { price, currency, source, url, fetchedAt, converted } or null.
   */
  OIH.itemValue = (appid, name) => {
    appid = Number(appid);
    const source = OIH.primarySource(appid);
    const key = `${source}|${appid}|${name}`;
    if (!itemValueCache.has(key)) {
      itemValueCache.set(key, (async () => {
        if (source !== 'steam') {
          const r = await OIH.bulkPrice(source, appid, name);
          if (r && !r.error && r.price != null) {
            return { price: r.price, currency: r.currency, source, url: OIH.itemUrl(source, appid, name, r.url), fetchedAt: r.fetchedAt, converted: r.converted };
          }
        }
        try {
          const p = await OIH.lowestPrice(appid, name, { maxAgeMin: OIH.valuationMinutes() });
          return p.price == null ? null : { price: p.price, currency: OIH.currencyCode(), source: 'steam', url: OIH.itemUrl('steam', appid, name), fetchedAt: p.fetchedAt };
        } catch (e) {
          return null;
        }
      })());
    }
    return itemValueCache.get(key);
  };

  /** Price tag on an item linking to the marketplace of the price. state: 'pending' | info | null. */
  OIH.priceBadge = (host, state) => {
    let b = host.querySelector(':scope > .oih-badge');
    if (!b) {
      b = OIH.el('a', { class: 'oih-badge oih-badge-link', target: '_blank', rel: 'noopener noreferrer' });
      // A click on the tag must not move the item in the trade window.
      for (const type of ['click', 'mousedown', 'mouseup', 'dblclick']) b.addEventListener(type, (e) => e.stopPropagation());
      host.append(b);
    }
    if (state === 'pending') {
      if (b.textContent !== '…') b.textContent = '…';
      b.removeAttribute('href');
      return b;
    }
    if (!state) {
      if (b.textContent !== '—') b.textContent = '—';
      b.removeAttribute('href');
      b.title = OIH.t('notMarketable');
      return b;
    }
    const text = OIH.fmt(state.price, state.currency);
    if (b.textContent !== text) b.textContent = text;
    if (state.url && b.getAttribute('href') !== state.url) b.setAttribute('href', state.url);
    b.title = `${OIH.sourceLabel(state.source)}${state.fetchedAt ? ` · ${OIH.t('updated')}: ${OIH.when(state.fetchedAt)}` : ''}` +
      (state.converted ? ` · ${OIH.rateNote(state.converted)}` : '');
    return b;
  };

  /** Totals per currency: "12,30 € + 4,50 $" — currencies are never mixed. */
  OIH.fmtTotals = (totals) => {
    const parts = [...totals.entries()].filter(([, v]) => v).map(([cur, v]) => OIH.fmt(v, cur));
    return parts.length ? parts.join(' + ') : OIH.fmt(0);
  };

  /* ---------------- Steam requests ---------------- */

  OIH.sessionId = () => window.g_sessionID;

  OIH.post = async (url, data, opts = {}) => {
    const body = new URLSearchParams(Object.assign({ sessionid: OIH.sessionId() }, data));
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
      referrer: opts.referrer || location.href,
      referrerPolicy: 'unsafe-url'
    });
    let json = null;
    try {
      json = await res.json();
    } catch (e) { /* not JSON */ }
    if (!res.ok || (json && (json.success === false || json.success === 0 || json.strError))) {
      const msg = (json && (json.message || json.strError)) || ('HTTP ' + res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.data = json;
      throw err;
    }
    return json || {};
  };

  /** Lists an item; priceSeller is what the seller receives per unit. */
  OIH.sellItem = ({ appid, contextid, assetid, amount = 1 }, priceSeller) =>
    OIH.post('https://steamcommunity.com/market/sellitem/', {
      appid, contextid, assetid, amount, price: priceSeller
    });

  OIH.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Prototype.js on Steam pages overrides Array#reduce and adds Array#toJSON in some
  // versions: sum with a loop and send only flat objects over RPC.
  OIH.sum = (arr, fn) => {
    let s = 0;
    for (const x of arr) s += fn(x) || 0;
    return s;
  };

  OIH.toSteamId64 = (accountId) => (BigInt(accountId) + 76561197960265728n).toString();

  OIH.iconUrl = (icon, size = '64fx64f') =>
    icon ? `https://community.fastly.steamstatic.com/economy/image/${icon}/${size}` : '';

  /* ---------------- UI ---------------- */

  OIH.el = (tag, attrs, ...children) => {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'text') node.textContent = v;
        else if (k in node && typeof v !== 'string') node[k] = v;
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  };

  let toastHost = null;
  OIH.toast = (text, type = 'info', ms = 4500) => {
    if (!toastHost) {
      toastHost = OIH.el('div', { class: 'oih-toasts' });
      document.body.append(toastHost);
    }
    const t = OIH.el('div', { class: 'oih-toast oih-toast-' + type, text });
    toastHost.append(t);
    setTimeout(() => t.remove(), ms);
  };

  OIH.modal = ({ title, body, footer, wide }) => {
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      if (api.onClose) api.onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const overlay = OIH.el('div', { class: 'oih-overlay', onmousedown: (e) => { if (e.target === overlay) close(); } },
      OIH.el('div', { class: 'oih-modal' + (wide ? ' oih-modal-wide' : '') },
        OIH.el('div', { class: 'oih-modal-head' },
          OIH.el('span', { text: title }),
          OIH.el('button', { class: 'oih-x', title: OIH.t('close'), onclick: close, text: '×' })),
        OIH.el('div', { class: 'oih-modal-body' }, body),
        footer ? OIH.el('div', { class: 'oih-modal-foot' }, footer) : null));
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    const api = { close, root: overlay, onClose: null };
    return api;
  };

  OIH.confirm = (text) => new Promise((resolve) => {
    let answered = false;
    const done = (v) => { answered = true; resolve(v); m.close(); };
    const m = OIH.modal({
      title: OIH.t('confirmTitle'),
      body: OIH.el('p', { class: 'oih-confirm-text', text }),
      footer: [
        OIH.el('button', { class: 'oih-btn oih-btn-primary', text: OIH.t('ok'), onclick: () => done(true) }),
        OIH.el('button', { class: 'oih-btn', text: OIH.t('cancel'), onclick: () => done(false) })
      ]
    });
    m.onClose = () => { if (!answered) resolve(false); };
    setTimeout(() => m.root.querySelector('.oih-btn-primary').focus(), 0);
  });

  OIH.btn = (text, onclick, cls = '') => OIH.el('button', { class: 'oih-btn ' + cls, text, onclick, type: 'button' });

  /** Resolves once fn() returns something truthy (a global or an element). */
  OIH.waitFor = (fn, timeout = 20000, interval = 200) => new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let v;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return resolve(v);
      if (Date.now() - start > timeout) return reject(new Error('timeout'));
      setTimeout(tick, interval);
    };
    tick();
  });

  OIH.downloadText = (filename, text, type = 'text/csv') => {
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: type + ';charset=utf-8' }));
    const a = OIH.el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  window.OIH = OIH;
})();
