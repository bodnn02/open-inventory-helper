/*
 * Steam Community Market fees and price helpers. The algorithm is ported from
 * economy_common.js (CalculateFeeAmount / CalculateAmountToSendForDesiredReceivedAmount),
 * so the numbers match what Steam shows.
 *
 * All amounts are in minor currency units ("cents"), as in the Steam API.
 */
(function (root) {
  'use strict';

  const DEFAULT_WALLET = {
    wallet_fee: 1,
    wallet_fee_percent: '0.05',
    wallet_fee_minimum: 1,
    wallet_fee_base: 0,
    wallet_publisher_fee_percent_default: '0.10'
  };

  function wallet(w) {
    return Object.assign({}, DEFAULT_WALLET, w || {});
  }

  function publisherFeeOf(w, publisherFee) {
    if (publisherFee === undefined || publisherFee === null || publisherFee === '') {
      return parseFloat(w.wallet_publisher_fee_percent_default);
    }
    return parseFloat(publisherFee);
  }

  /** What the buyer pays for the seller to receive `received`. */
  function amountToSend(received, walletInfo, publisherFee) {
    const w = wallet(walletInfo);
    const pub = publisherFeeOf(w, publisherFee);
    if (!parseInt(w.wallet_fee, 10)) {
      return { steam_fee: 0, publisher_fee: 0, fees: 0, amount: received };
    }
    const steamFee = Math.floor(
      Math.max(received * parseFloat(w.wallet_fee_percent), parseInt(w.wallet_fee_minimum, 10)) +
      parseInt(w.wallet_fee_base, 10)
    );
    const publisherFeeAmount = Math.floor(pub > 0 ? Math.max(received * pub, 1) : 0);
    return {
      steam_fee: steamFee,
      publisher_fee: publisherFeeAmount,
      fees: steamFee + publisherFeeAmount,
      amount: received + steamFee + publisherFeeAmount
    };
  }

  /** Fees included in the buyer price `amount`. */
  function feesFromBuyerPrice(amount, walletInfo, publisherFee) {
    const w = wallet(walletInfo);
    const pub = publisherFeeOf(w, publisherFee);
    if (!parseInt(w.wallet_fee, 10)) {
      return { steam_fee: 0, publisher_fee: 0, fees: 0, amount };
    }
    let iterations = 0;
    let estimate = Math.trunc(
      (amount - parseInt(w.wallet_fee_base, 10)) / (parseFloat(w.wallet_fee_percent) + pub + 1)
    );
    let everUndershot = false;
    let fees = amountToSend(estimate, w, pub);
    while (fees.amount !== amount && iterations < 10) {
      if (fees.amount > amount) {
        if (everUndershot) {
          fees = amountToSend(estimate - 1, w, pub);
          fees.steam_fee += amount - fees.amount;
          fees.fees += amount - fees.amount;
          fees.amount = amount;
          break;
        }
        estimate--;
      } else {
        everUndershot = true;
        estimate++;
      }
      fees = amountToSend(estimate, w, pub);
      iterations++;
    }
    return fees;
  }

  /** What the seller receives when the buyer pays `buyerPrice`. */
  function sellerReceives(buyerPrice, walletInfo, publisherFee) {
    if (!buyerPrice || buyerPrice <= 0) return 0;
    return Math.max(0, buyerPrice - feesFromBuyerPrice(buyerPrice, walletInfo, publisherFee).fees);
  }

  /** What the buyer pays when the seller receives `sellerPrice`. */
  function buyerPays(sellerPrice, walletInfo, publisherFee) {
    return amountToSend(sellerPrice, walletInfo, publisherFee).amount;
  }

  /**
   * Parses a Steam price string into cents: "$1.23", "1,23€", "1 234,56 pуб.",
   * "5,--€", "¥ 1,234", "R$ 12,00". Returns null when there are no digits.
   */
  function parsePrice(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : null;
    let s = String(value).replace(/&nbsp;|\s| | /g, '');
    s = s.replace(/[^\d.,]/g, '').replace(/^[.,]+|[.,]+$/g, '');
    if (!/\d/.test(s)) return null;
    const m = s.match(/[.,](\d{1,2})$/);
    let intPart = s;
    let frac = 0;
    if (m) {
      intPart = s.slice(0, m.index);
      frac = m[1].length === 1 ? Number(m[1]) * 10 : Number(m[1]);
    }
    intPart = intPart.replace(/[.,]/g, '');
    return parseInt(intPart || '0', 10) * 100 + frac;
  }

  /** Steam wallet currency id -> ISO 4217. */
  const CURRENCIES = {
    1: 'USD', 2: 'GBP', 3: 'EUR', 4: 'CHF', 5: 'RUB', 6: 'PLN', 7: 'BRL', 8: 'JPY',
    9: 'NOK', 10: 'IDR', 11: 'MYR', 12: 'PHP', 13: 'SGD', 14: 'THB', 15: 'VND',
    16: 'KRW', 17: 'TRY', 18: 'UAH', 19: 'MXN', 20: 'CAD', 21: 'AUD', 22: 'NZD',
    23: 'CNY', 24: 'INR', 25: 'CLP', 26: 'PEN', 27: 'COP', 28: 'ZAR', 29: 'HKD',
    30: 'TWD', 31: 'SAR', 32: 'AED', 34: 'ARS', 35: 'ILS', 37: 'KZT', 38: 'KWD',
    39: 'QAR', 40: 'CRC', 41: 'UYU'
  };

  function currencyCode(id) {
    return CURRENCIES[id] || 'USD';
  }

  function formatPrice(cents, code, locale) {
    if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
    try {
      return new Intl.NumberFormat(locale || undefined, { style: 'currency', currency: code || 'USD' })
        .format(cents / 100);
    } catch (e) {
      return (cents / 100).toFixed(2) + ' ' + (code || '');
    }
  }

  const api = {
    DEFAULT_WALLET, CURRENCIES,
    amountToSend, feesFromBuyerPrice, sellerReceives, buyerPays,
    parsePrice, currencyCode, formatPrice
  };

  root.OIHFees = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
