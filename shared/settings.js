/* Default settings shared by the service worker, popup and content scripts. */
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = {
    lang: 'auto',                 // auto | ru | en
    currency: 0,                  // 0 = Steam wallet currency
    priceSources: ['steam'],      // steam, skinport, markettm, waxpeer
    primarySource: 'steam',       // used on item tiles, in totals and in trades
    convertCurrency: true,        // convert marketplace and store prices to the user currency
    priceCacheMinutes: 60,
    valuationCacheHours: 12,      // max price age for inventory valuation
    requestDelayMs: 3000,         // between Steam Market requests (avoids 429)

    inventoryTools: true,
    autoLoadSelectedPrice: true,
    autoValuate: true,
    showItemPrices: true,
    sellStrategy: 'lowest',       // lowest | median | buyorder | manual
    undercutCents: 1,
    sellDelayMs: 1500,
    sellFreshMinutes: 10,         // younger cached prices are reused when selling
    marketCompare: true,
    confirmSell: true,

    marketQuickBuy: true,
    confirmBuy: true,
    marketHistoryStats: true,
    marketBulkListings: true,

    tradePrices: true,
    tradeAddMultiple: true,
    quickAccept: true,
    tradeOfferValues: true,

    storeHistory: true,
    itadKey: '',                  // user own IsThereAnyDeal key, enables the history chart

    notifyEnabled: true,
    notifyDesktop: true,
    notifyIntervalMin: 5
  };

  function merge(stored) {
    const s = Object.assign({}, DEFAULT_SETTINGS, stored || {});
    // Migration from the old single `priceSource` setting.
    if (stored && stored.priceSource && !stored.priceSources) {
      s.priceSources = stored.priceSource === 'steam' ? ['steam'] : ['steam', stored.priceSource];
      s.primarySource = stored.priceSource;
    }
    delete s.priceSource;
    if (!Array.isArray(s.priceSources) || !s.priceSources.length) s.priceSources = ['steam'];
    s.priceSources = s.priceSources.slice();
    if (!s.priceSources.includes(s.primarySource)) s.primarySource = s.priceSources[0];
    return s;
  }

  const api = { DEFAULT_SETTINGS, merge };
  root.OIHSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
