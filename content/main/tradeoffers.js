/*
 * Trade offers list:
 *  - estimated value of both sides and the difference for every offer;
 *  - a price tag on every item linking to the marketplace of the price;
 *  - "Accept now" for incoming offers (confirmation stays in the Steam mobile app).
 */
(async () => {
  'use strict';
  const OIH = window.OIH;
  if (!OIH || window.__oihOffers) return;
  window.__oihOffers = true;

  await OIH.ready();
  const { t, el, btn } = OIH;
  const sentPage = /[?&]sent=1/.test(location.search) || /\/sent\/?$/.test(location.pathname);

  /* ---------------- offer values ---------------- */

  /** data-economy-item="classinfo/730/<classid>/<instanceid>" → { appid, classid, instanceid } */
  function parseEconomyItem(node) {
    const m = (node.getAttribute('data-economy-item') || '').match(/^classinfo\/(\d+)\/(\d+)(?:\/(\d+))?/);
    return m ? { appid: Number(m[1]), classid: m[2], instanceid: m[3] || '0' } : null;
  }

  const classCache = new Map(); // appid|classid|instanceid -> Promise<{name, marketable}|null>
  function classInfo(c) {
    const key = `${c.appid}|${c.classid}|${c.instanceid}`;
    if (!classCache.has(key)) {
      classCache.set(key, OIH.rpc('item.classinfo', c).catch(() => null));
    }
    return classCache.get(key);
  }

  async function valueSide(side) {
    const totals = new Map();
    let unknown = 0;
    const items = [...side.querySelectorAll('.trade_item')];
    await Promise.all(items.map(async (node) => {
      const c = parseEconomyItem(node);
      if (!c) {
        unknown++;
        return;
      }
      OIH.priceBadge(node, 'pending');
      const info = await classInfo(c);
      if (!info || !info.marketable || !info.name) {
        OIH.priceBadge(node, null);
        unknown++;
        return;
      }
      const v = await OIH.itemValue(c.appid, info.name);
      OIH.priceBadge(node, v);
      if (v) totals.set(v.currency, (totals.get(v.currency) || 0) + v.price);
      else unknown++;
    }));
    return { totals, count: items.length, unknown };
  }

  function sideLabel(x) {
    return `≈ ${OIH.fmtTotals(x.totals)} · ${x.count}${x.unknown ? ` (?${x.unknown})` : ''}`;
  }

  async function valueOffer(offer) {
    if (offer.dataset.oihValued) return;
    offer.dataset.oihValued = '1';
    // primary is the side of the offer author: the partner for incoming, you for sent.
    const primary = offer.querySelector('.tradeoffer_items.primary');
    const secondary = offer.querySelector('.tradeoffer_items.secondary');
    if (!primary || !secondary) return;
    const summary = el('div', { class: 'oih-root oih-offer-sum' }, el('span', { class: 'oih-muted', text: t('loading') }));
    const ctn = offer.querySelector('.tradeoffer_items_ctn') || primary.parentElement;
    ctn.after(summary);

    const [p, q] = await Promise.all([valueSide(primary), valueSide(secondary)]);
    for (const [side, x] of [[primary, p], [secondary, q]]) {
      const header = side.querySelector('.tradeoffer_items_header') || side;
      let tag = header.querySelector('.oih-offer-side');
      if (!tag) {
        tag = el('span', { class: 'oih-root oih-offer-side' });
        header.append(tag);
      }
      tag.textContent = sideLabel(x);
    }
    const get = sentPage ? q : p;
    const give = sentPage ? p : q;
    const curs = new Set([...get.totals.keys(), ...give.totals.keys()]);
    const parts = [
      el('span', { class: 'oih-muted', text: t('youGet') + ': ' }), el('b', { text: OIH.fmtTotals(get.totals) }),
      el('span', { class: 'oih-muted', text: ' · ' + t('youGive') + ': ' }), el('b', { text: OIH.fmtTotals(give.totals) })
    ];
    if (curs.size <= 1) {
      const cur = [...curs][0] || OIH.currencyCode();
      const diff = (get.totals.get(cur) || 0) - (give.totals.get(cur) || 0);
      parts.push(el('span', { class: 'oih-muted', text: ' · ' + t('diff') + ': ' }),
        el('b', { class: diff > 0 ? 'oih-ok' : diff < 0 ? 'oih-error' : '', text: (diff > 0 ? '+' : '') + OIH.fmt(diff, cur) }));
    }
    if (get.unknown || give.unknown) parts.push(el('span', { class: 'oih-muted', text: ' · ' + t('offerUnknown', get.unknown + give.unknown) }));
    summary.replaceChildren(...parts);
  }

  if (OIH.settings.tradeOfferValues !== false) {
    // One offer at a time to avoid a burst of requests.
    const offers = [...document.querySelectorAll('.tradeoffer[id^="tradeofferid_"]')];
    (async () => {
      for (const offer of offers) await valueOffer(offer);
    })();
  }

  /* ---------------- accept now ---------------- */

  if (!OIH.settings.quickAccept || sentPage) return;

  document.querySelectorAll('.tradeoffer[id^="tradeofferid_"]').forEach((offer) => {
    const id = offer.id.replace('tradeofferid_', '');
    const actions = offer.querySelector('.tradeoffer_footer_actions');
    if (!actions || !/^\d+$/.test(id)) return; // inactive offer
    const avatar = offer.querySelector('.tradeoffer_partner [data-miniprofile]');
    const accountId = avatar && avatar.getAttribute('data-miniprofile');
    if (!accountId) return;
    const partner = OIH.toSteamId64(accountId);

    const b = btn(t('acceptNow'), async () => {
      if (!(await OIH.confirm(t('confirmAccept', id)))) return;
      b.disabled = true;
      try {
        const r = await OIH.post(`https://steamcommunity.com/tradeoffer/${id}/accept`, {
          serverid: 1, tradeofferid: id, partner, captcha: ''
        }, { referrer: `https://steamcommunity.com/tradeoffer/${id}/` });
        const needConfirm = r.needs_mobile_confirmation || r.needs_email_confirmation;
        b.textContent = t('accepted');
        OIH.toast(needConfirm ? t('needConfirm') : t('accepted'), 'success', 8000);
        offer.classList.add('oih-accepted');
      } catch (e) {
        b.disabled = false;
        OIH.toast(t('error') + ': ' + e.message, 'error', 8000);
      }
    }, 'oih-btn-primary oih-btn-small');
    actions.prepend(b);
  });
})();
