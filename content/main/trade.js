/*
 * Trade offer window: item prices, side totals and the difference,
 * adding several items by name.
 */
(async () => {
  'use strict';
  const OIH = window.OIH;
  if (!OIH || window.__oihTrade) return;
  window.__oihTrade = true;

  await OIH.ready();
  const { t, el, btn } = OIH;
  const s = OIH.settings;
  if (!s.tradePrices && !s.tradeAddMultiple) return;

  try {
    await OIH.waitFor(() => document.querySelector('#your_slots, #trade_yours'), 20000);
  } catch (e) {
    return;
  }

  function norm(it) {
    if (!it) return null;
    const d = it.description || it;
    return {
      appid: Number(it.appid || d.appid),
      name: d.market_hash_name || '',
      displayName: d.market_name || d.name || '',
      marketable: !!Number(d.marketable),
      tradable: !!Number(d.tradable),
      amount: Number(it.amount || 1)
    };
  }

  /* ---------------- prices ---------------- */

  // Prices come from the primary source; each tag links to its marketplace.
  const values = new Map(); // appid|name -> 'pending' | info | null

  function valueOf(item) {
    const key = item.appid + '|' + item.name;
    if (!values.has(key)) {
      values.set(key, 'pending');
      OIH.itemValue(item.appid, item.name).then((v) => {
        values.set(key, v);
        refresh();
      });
    }
    return values.get(key);
  }

  /* ---------------- panel ---------------- */

  const giveEl = el('b');
  const getEl = el('b');
  const diffEl = el('b');
  const nameInput = el('input', { class: 'oih-input', placeholder: t('nameContains') });
  const qtyInput = el('input', { class: 'oih-input oih-qty', type: 'number', min: '1', value: '1' });

  // Totals go right under each side's slots, the difference under the partner's.
  const sumGive = el('div', { class: 'oih-root oih-trade-sum' }, el('span', { class: 'oih-muted', text: t('youGive') }), giveEl);
  const sumGet = el('div', { class: 'oih-root oih-trade-sum' },
    el('span', { class: 'oih-muted', text: t('youGet') }), getEl,
    el('span', { class: 'oih-muted', text: t('diff') }), diffEl);
  const addBox = el('div', { class: 'oih-root oih-panel' },
    el('div', { class: 'oih-section-title', text: t('addMultiple') }),
    el('div', { class: 'oih-row' }, nameInput, qtyInput, btn(t('add'), addMultiple, 'oih-btn-primary')));
  const dock = el('div', { class: 'oih-root oih-dock' });

  function placeAfter(node, anchor) {
    if (!anchor || !anchor.parentNode) return false;
    if (node.previousElementSibling !== anchor) anchor.after(node);
    return true;
  }

  function place() {
    let floating = false;
    if (s.tradePrices) {
      if (!placeAfter(sumGive, document.getElementById('your_slots'))) { dock.append(sumGive); floating = true; }
      if (!placeAfter(sumGet, document.getElementById('their_slots'))) { dock.append(sumGet); floating = true; }
    }
    if (s.tradeAddMultiple) {
      const filter = document.querySelector('#inventory_box .filter_ctn, #inventory_box .trade_rule, #inventory_displaycontrols');
      if (!placeAfter(addBox, filter)) { dock.append(addBox); floating = true; }
    }
    if (floating && !dock.isConnected) document.body.append(dock);
  }
  place();
  setInterval(place, 2000);

  function sideTotal(selector) {
    const totals = new Map(); // currency -> sum
    let n = 0;
    let unknown = 0;
    document.querySelectorAll(selector).forEach((node) => {
      const it = norm(node.rgItem);
      if (!it) return;
      n++;
      if (!it.marketable || !it.name) {
        unknown++;
        return;
      }
      const v = valueOf(it);
      OIH.priceBadge(node, v);
      if (v && v !== 'pending') totals.set(v.currency, (totals.get(v.currency) || 0) + v.price * it.amount);
      else unknown++;
    });
    return { totals, n, unknown };
  }

  function refresh() {
    if (!s.tradePrices) return;
    // An item removed from the trade returns to the inventory with its tag.
    document.querySelectorAll('#inventories .oih-badge').forEach((b) => b.remove());
    const give = sideTotal('#your_slots .item');
    const get = sideTotal('#their_slots .item');
    const fmtSide = (x) => `${OIH.fmtTotals(x.totals)} · ${x.n}${x.unknown ? ` (?${x.unknown})` : ''}`;
    giveEl.textContent = fmtSide(give);
    getEl.textContent = fmtSide(get);
    // The difference needs both sides in one currency.
    const curs = new Set([...give.totals.keys(), ...get.totals.keys()]);
    if (curs.size <= 1) {
      const cur = [...curs][0] || OIH.currencyCode();
      const diff = (get.totals.get(cur) || 0) - (give.totals.get(cur) || 0);
      diffEl.textContent = (diff > 0 ? '+' : '') + OIH.fmt(diff, cur);
      diffEl.className = diff > 0 ? 'oih-ok' : diff < 0 ? 'oih-error' : '';
    } else {
      diffEl.textContent = '—';
      diffEl.className = '';
    }
  }

  setInterval(refresh, 1000);
  refresh();

  /* ---------------- add multiple ---------------- */

  async function addMultiple() {
    const q = nameInput.value.trim().toLowerCase();
    let want = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    if (typeof window.MoveItemToTrade !== 'function') return OIH.toast(t('error'), 'error');
    const ctn = [...document.querySelectorAll('#inventories .inventory_ctn')].find((c) => c.offsetParent !== null);
    if (!ctn) return;
    const candidates = [...ctn.querySelectorAll('.itemHolder .item')].filter((node) => {
      const it = norm(node.rgItem);
      if (!it || !it.tradable) return false;
      if (!q) return true;
      return it.displayName.toLowerCase().includes(q) || it.name.toLowerCase().includes(q);
    });
    let added = 0;
    for (const node of candidates) {
      if (want <= 0) break;
      try {
        window.MoveItemToTrade(node);
        added++;
        want--;
      } catch (e) { /* skip */ }
      await OIH.sleep(40);
    }
    OIH.toast(t('added', added), added ? 'success' : 'info');
    refresh();
  }
})();
