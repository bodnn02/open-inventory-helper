/*
 * Price sources: public APIs without keys or login. Each host is an optional
 * permission requested only when the user enables the source.
 *
 * Steam Market is priced item by item (through the shared queue); the others return
 * the whole price list of a game in one request.
 * parse() returns { prices: { market_hash_name: cents }, urls?: { market_hash_name: url } }.
 */
(function (root) {
  'use strict';

  const TM_HOSTS = { 730: 'market.csgo.com', 570: 'market.dota2.net', 440: 'tf2.tm', 252490: 'rust.tm' };
  const WAXPEER_GAMES = { 730: 'csgo', 570: 'dota2', 440: 'tf2', 252490: 'rust' };

  const SOURCES = {
    steam: {
      id: 'steam',
      label: 'Steam Market',
      bulk: false,
      origins: [],
      apps: null, // any game
      currencies: null, // wallet currency
      itemUrl: (appid, name) => `https://steamcommunity.com/market/listings/${appid}/${encodeURIComponent(name)}`,
      homeUrl: (appid) => `https://steamcommunity.com/market/search?appid=${appid}`
    },
    skinport: {
      id: 'skinport',
      label: 'Skinport',
      bulk: true,
      origins: ['https://api.skinport.com/*'],
      apps: [730, 570, 440, 252490],
      currencies: ['USD', 'EUR', 'GBP', 'PLN', 'CZK', 'BRL', 'CAD', 'AUD', 'CNY', 'NOK', 'DKK', 'SEK', 'CHF'],
      url: (appid, code) => `https://api.skinport.com/v1/items?app_id=${appid}&currency=${code}&tradable=0`,
      parse: (json) => {
        const prices = {};
        const urls = {};
        for (const it of json || []) {
          const p = it.min_price ?? it.suggested_price ?? it.median_price;
          if (p !== null && p !== undefined) prices[it.market_hash_name] = Math.round(p * 100);
          if (it.item_page) urls[it.market_hash_name] = it.item_page;
        }
        return { prices, urls };
      },
      itemUrl: (appid, name) => `https://skinport.com/market?search=${encodeURIComponent(name)}`,
      homeUrl: () => 'https://skinport.com/market'
    },
    markettm: {
      id: 'markettm',
      label: 'Market.CSGO (TM)',
      bulk: true,
      origins: Object.values(TM_HOSTS).map((h) => `https://${h}/*`),
      apps: Object.keys(TM_HOSTS).map(Number),
      currencies: ['USD', 'EUR', 'RUB'],
      url: (appid, code) => `https://${TM_HOSTS[appid]}/api/v2/prices/${code}.json`,
      parse: (json) => {
        const prices = {};
        for (const it of (json && json.items) || []) {
          const p = parseFloat(it.price);
          if (it.market_hash_name && Number.isFinite(p)) prices[it.market_hash_name] = Math.round(p * 100);
        }
        return { prices };
      },
      itemUrl: (appid, name) => `https://${TM_HOSTS[appid] || TM_HOSTS[730]}/en/?search=${encodeURIComponent(name)}`,
      homeUrl: (appid) => `https://${TM_HOSTS[appid] || TM_HOSTS[730]}/en/`
    },
    waxpeer: {
      id: 'waxpeer',
      label: 'Waxpeer',
      bulk: true,
      origins: ['https://api.waxpeer.com/*'],
      apps: Object.keys(WAXPEER_GAMES).map(Number),
      currencies: ['USD'],
      url: (appid) => `https://api.waxpeer.com/v1/prices?game=${WAXPEER_GAMES[appid]}`,
      // Waxpeer prices are in thousandths of a dollar: 2363 = $2.363.
      parse: (json) => {
        const prices = {};
        for (const it of (json && json.items) || []) {
          if (it.name && Number.isFinite(it.min)) prices[it.name] = Math.round(it.min / 10);
        }
        return { prices };
      },
      itemUrl: (appid, name) => `https://waxpeer.com/?game=${WAXPEER_GAMES[appid] || 'csgo'}&search=${encodeURIComponent(name)}`,
      homeUrl: (appid) => `https://waxpeer.com/?game=${WAXPEER_GAMES[appid] || 'csgo'}`
    }
  };

  const ORDER = ['steam', 'skinport', 'markettm', 'waxpeer'];

  /** Currency of the source prices: the wallet currency if supported, otherwise USD. */
  function currencyFor(id, walletCode) {
    const s = SOURCES[id];
    if (!s || !s.currencies) return walletCode;
    return s.currencies.includes(walletCode) ? walletCode : 'USD';
  }

  function supports(id, appid) {
    const s = SOURCES[id];
    return !!s && (!s.apps || s.apps.includes(Number(appid)));
  }

  /** Item page from the API when known, otherwise a search by name. */
  function itemUrl(id, appid, name, apiUrl) {
    if (apiUrl) return apiUrl;
    const s = SOURCES[id];
    return s && s.itemUrl ? s.itemUrl(Number(appid), name) : null;
  }

  function homeUrl(id, appid) {
    const s = SOURCES[id];
    return s && s.homeUrl ? s.homeUrl(Number(appid)) : null;
  }

  const api = { SOURCES, ORDER, currencyFor, supports, itemUrl, homeUrl };
  root.OIHSources = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
