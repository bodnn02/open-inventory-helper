/*
 * Community Market:
 *  - item page: price history stats, quick buy;
 *  - market home: comparison with the market, bulk removal of listings and buy orders.
 */
(async () => {
  'use strict';
  const OIH = window.OIH;
  if (!OIH || window.__oihMarket) return;
  window.__oihMarket = true;

  await OIH.ready();
  const { t, el, btn, fmt } = OIH;
  const path = location.pathname;

  if (/^\/market\/listings\/\d+\/.+/.test(path)) {
    if (OIH.settings.marketHistoryStats) historyStats();
    if (OIH.settings.marketQuickBuy) quickBuy();
  } else if (/^\/market\/?$/.test(path)) {
    if (OIH.settings.marketBulkListings) myListings();
  }

  /* ---------------- price history ---------------- */

  function historyStats() {
    const line = window.line1;
    if (!Array.isArray(line) || !line.length) return;
    const points = [];
    for (const p of line) {
      // "Oct 01 2026 01: +0" -> "Oct 01 2026 01:00 GMT+0000"
      const ts = Date.parse(String(p[0]).replace(/: \+0$/, ':00 GMT+0000'));
      if (!Number.isFinite(ts)) continue;
      points.push({ ts, price: Math.round(Number(p[1]) * 100), vol: parseInt(p[2], 10) || 0 });
    }
    if (!points.length) return;
    const now = Date.now();
    const windows = [['h24', 86400e3], ['d7', 7 * 86400e3], ['d30', 30 * 86400e3]];
    const cells = windows.map(([key, span]) => {
      const pts = points.filter((p) => now - p.ts <= span);
      if (!pts.length) return el('div', { class: 'oih-hist-col' }, el('b', { text: t(key) }), el('div', { class: 'oih-muted', text: '—' }));
      const vol = OIH.sum(pts, (p) => p.vol);
      const avg = vol ? Math.round(OIH.sum(pts, (p) => p.price * p.vol) / vol) : Math.round(OIH.sum(pts, (p) => p.price) / pts.length);
      let min = Infinity;
      let max = -Infinity;
      for (const p of pts) { min = Math.min(min, p.price); max = Math.max(max, p.price); }
      return el('div', { class: 'oih-hist-col' },
        el('b', { text: t(key) }),
        el('div', null, `${t('avg')}: `, el('b', { text: fmt(avg) })),
        el('div', null, `${t('min')} / ${t('max')}: ${fmt(min)} / ${fmt(max)}`),
        el('div', null, `${t('sold')}: ${vol}`),
        el('div', { class: 'oih-muted' }, `${t('youReceive')}: ${fmt(OIH.sellerReceives(avg))}`));
    });
    const panel = el('div', { class: 'oih-root oih-panel' },
      el('div', { class: 'oih-section-title', text: t('history') }),
      el('div', { class: 'oih-hist' }, cells));
    const anchor = document.querySelector('.market_listing_nav_container') || document.querySelector('#mainContents');
    if (anchor && anchor.id === 'mainContents') anchor.prepend(panel);
    else if (anchor) anchor.after(panel);
  }

  /* ---------------- quick buy ---------------- */

  function quickBuy() {
    const decorate = () => {
      const info = window.g_rgListingInfo || {};
      const wallet = window.g_rgWalletInfo || {};
      document.querySelectorAll('.market_listing_row[id^="listing_"]:not([data-oih])').forEach((row) => {
        row.dataset.oih = '1';
        const id = row.id.replace('listing_', '');
        const li = info[id];
        if (!li || li.converted_price === undefined) return;
        const walletCurrency = Number(wallet.wallet_currency);
        if (Number(li.converted_currencyid) - 2000 !== walletCurrency) return;
        const total = Number(li.converted_price) + Number(li.converted_fee);
        const b = btn(t('quickBuy'), () => buy(id, li, total, b), 'oih-btn-primary oih-btn-small');
        const target = row.querySelector('.market_listing_buy_button') || row.querySelector('.market_listing_price_listings_block');
        if (target) target.append(b);
      });
    };
    decorate();
    let timer = null;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(decorate, 250);
    }).observe(document.body, { childList: true, subtree: true });
  }

  async function buy(id, li, total, button) {
    const wallet = window.g_rgWalletInfo || {};
    if (wallet.wallet_balance !== undefined && Number(wallet.wallet_balance) < total) {
      return OIH.toast(t('notEnoughFunds'), 'error');
    }
    if (OIH.settings.confirmBuy && !(await OIH.confirm(t('confirmBuy', fmt(total))))) return;
    button.disabled = true;
    try {
      const r = await OIH.post(`https://steamcommunity.com/market/buylisting/${id}`, {
        currency: wallet.wallet_currency,
        subtotal: li.converted_price,
        fee: li.converted_fee,
        total,
        quantity: 1,
        billing_state: '',
        save_my_address: 0
      });
      if (r.wallet_info) {
        window.g_rgWalletInfo = Object.assign(window.g_rgWalletInfo || {}, r.wallet_info);
      }
      button.textContent = t('bought');
      OIH.toast(r.need_confirmation ? t('needConfirm') : t('bought') + ': ' + fmt(total), 'success');
    } catch (e) {
      button.disabled = false;
      OIH.toast(t('error') + ': ' + e.message, 'error', 8000);
    }
  }

  /* ---------------- my listings and buy orders ---------------- */

  function myListings() {
    // Steam re-renders the listings (sometimes with the container) on paging and on
    // "Show N", so the container is looked up again and the toolbar restored each time.
    const findContainer = () => document.querySelector('#tabContentsMyListings') || document.querySelector('#myListings');
    if (!findContainer()) return;

    const info = el('span', { class: 'oih-muted' });
    const overBtn = btn(t('selectOverpriced'), toggleOverpriced, 'oih-btn-danger');
    overBtn.disabled = true;
    const cmpInfo = el('span', { class: 'oih-muted' });
    const status = el('span', { class: 'oih-muted' });
    const refreshBtn = OIH.settings.marketCompare ? btn(t('refreshAll'), refreshAll) : null;
    const toolbar = el('div', { class: 'oih-root oih-panel' },
      el('div', { class: 'oih-row' },
        refreshBtn,
        btn(t('selectAll'), selectAll),
        overBtn,
        btn(t('removeSelected'), removeSelected),
        btn(t('removeAll'), removeAll, 'oih-btn-danger'),
        btn(t('cancelOrders'), cancelAllOrders, 'oih-btn-danger'),
        status),
      info, cmpInfo);

    function placeToolbar() {
      if (toolbar.isConnected) return;
      const container = findContainer();
      if (container && container.parentNode) container.parentNode.insertBefore(toolbar, container);
    }
    placeToolbar();

    const listingRows = () => [...document.querySelectorAll('.market_listing_row[id^="mylisting_"]')];
    const orderRows = () => [...document.querySelectorAll('.market_listing_row[id^="mybuyorder_"]')];

    function decorate() {
      for (const row of listingRows().concat(orderRows())) {
        if (row.querySelector('.oih-row-check')) continue;
        row.prepend(el('input', { type: 'checkbox', class: 'oih-row-check', title: 'OIH' }));
      }
      let buyer = 0;
      let seller = 0;
      let n = 0;
      for (const row of listingRows()) {
        const spans = row.querySelectorAll('.market_listing_price span[title]');
        if (spans.length >= 2) {
          buyer += OIH.Fees.parsePrice(spans[0].textContent) || 0;
          seller += OIH.Fees.parsePrice(spans[1].textContent) || 0;
          n++;
        }
      }
      // Write only on change, or the MutationObserver loops on our own edits.
      const text = n ? t('onPage', n, fmt(buyer), fmt(seller)) : '';
      if (info.textContent !== text) info.textContent = text;
      if (OIH.settings.marketCompare) compareRows();
    }

    /* ---- comparison with the market: overpriced listings, outbid buy orders ---- */

    const marketCache = new Map(); // kind|appid|name -> Promise
    const verdicts = new Map(); // row id -> true (ok) / false (overpriced)

    function itemOf(row) {
      const a = row.querySelector('a.market_listing_item_name_link, .market_listing_item_name a');
      if (!a) return null;
      let path;
      try {
        path = decodeURIComponent(a.pathname);
      } catch (e) {
        return null;
      }
      const m = path.match(/^\/market\/listings\/(\d+)\/(.+)$/);
      return m ? { appid: Number(m[1]), name: m[2] } : null;
    }

    function listingPrice(row) {
      const spans = row.querySelectorAll('.market_listing_price span[title]');
      if (spans.length) return OIH.Fees.parsePrice(spans[0].textContent);
      const cell = row.querySelector('.market_listing_my_price .market_listing_price');
      return cell ? OIH.Fees.parsePrice(cell.textContent.split('(')[0]) : null;
    }

    function orderPrice(row) {
      const cell = row.querySelector('.market_listing_my_price .market_listing_price') || row.querySelector('.market_listing_my_price');
      if (!cell) return null;
      const copy = cell.cloneNode(true);
      copy.querySelectorAll('.market_listing_inline_buyorder_qty').forEach((n) => n.remove());
      const text = copy.textContent.includes('@') ? copy.textContent.split('@').pop() : copy.textContent;
      return OIH.Fees.parsePrice(text);
    }

    /** refresh: false — reuse fresh prices, 'all' — refetch in the background, 'one' — refetch now. */
    function fetchPrice(kind, item, refresh) {
      const key = kind + '|' + item.appid + '|' + item.name;
      if (refresh || !marketCache.has(key)) {
        const opts = refresh ? { force: true, priority: refresh === 'one' ? 'high' : undefined } : { maxAgeMin: OIH.freshMinutes() };
        const p = kind === 'ov' ? OIH.priceOverview(item.appid, item.name, opts) : OIH.priceHistogram(item.appid, item.name, opts);
        marketCache.set(key, p);
        p.catch(() => marketCache.delete(key));
      }
      return marketCache.get(key);
    }

    /** A line under the item name; the price cell (line-height 50px) is left alone. */
    function badge(row) {
      let b = row.querySelector('.oih-cmp-line');
      if (!b) {
        const block = row.querySelector('.market_listing_item_name_block') || row;
        b = el('div', { class: 'oih-root oih-cmp-line' });
        const anchor = block.querySelector('.market_listing_listed_date_combined');
        if (anchor) block.insertBefore(b, anchor);
        else block.append(b);
      }
      return b;
    }

    function setVerdict(row, good, lines) {
      row.classList.toggle('oih-row-good', good === true);
      row.classList.toggle('oih-row-bad', good === false);
      // Tint the price itself: "buyer pays" for listings, the whole cell for buy orders.
      const priceEl = row.querySelector('.market_listing_price span[title]') || row.querySelector('.market_listing_my_price .market_listing_price');
      if (priceEl) {
        priceEl.classList.toggle('oih-price-good', good === true);
        priceEl.classList.toggle('oih-price-bad', good === false);
      }
      badge(row).replaceChildren(...lines);
      if (good !== null) verdicts.set(row.id, good);
      // Summary of the listings currently on the page only.
      const present = new Set(listingRows().map((r) => r.id));
      const listed = [...verdicts.entries()].filter(([id]) => present.has(id));
      const bad = listed.filter(([, v]) => v === false).length;
      const summary = listed.length ? t('cmpSummary', bad, listed.length) : '';
      if (cmpInfo.textContent !== summary) cmpInfo.textContent = summary;
      updateOverBtn();
    }

    /** Price age and the refresh button at the end of the comparison line. */
    function tail(row, fetchedAt) {
      return el('span', { class: 'oih-cmp-tail' },
        fetchedAt ? OIH.timeEl(fetchedAt, 'ago') : null,
        el('button', {
          type: 'button', class: 'oih-icon-btn', title: t('refresh'), text: '↻',
          onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            checkRow(row, 'one');
          }
        }));
    }

    function checkRow(row, refresh) {
      const isOrder = row.id.startsWith('mybuyorder_');
      const item = itemOf(row);
      const mine = isOrder ? orderPrice(row) : listingPrice(row);
      if (!item || !mine) return Promise.resolve();
      row.dataset.oihCmp = '1';
      setVerdict(row, null, [el('span', { class: 'oih-cmp-wait', text: t('checking') })]);
      return fetchPrice(isOrder ? 'hist' : 'ov', item, refresh).then((r) => {
        const done = (good, ...lines) => setVerdict(row, good, [...lines, tail(row, r && r.fetchedAt)]);
        if (isOrder) {
          const best = r && r.highestBuy;
          if (!best) return done(null);
          if (mine >= best) return done(true, el('span', { class: 'oih-cmp-good', text: t('cmpBuyBest') }));
          return done(false, el('span', { class: 'oih-cmp-bad', text: t('cmpBuyBelow', fmt(best)) }));
        }
        const lowest = r && r.lowest;
        if (!lowest) return done(null);
        if (mine <= lowest) return done(true, el('span', { class: 'oih-cmp-good', text: t('cmpLowest') }));
        const diff = mine - lowest;
        return done(false,
          el('span', { class: 'oih-cmp-bad', text: t('cmpAbove', fmt(diff), '+' + Math.round((diff / lowest) * 100) + '%') }),
          el('span', { class: 'oih-cmp-min', text: t('cmpMin', fmt(lowest)) }));
      }).catch(() => setVerdict(row, null, [tail(row, 0)]));
    }

    function compareRows() {
      for (const row of listingRows().concat(orderRows())) {
        if (!row.dataset.oihCmp) checkRow(row, false);
      }
    }

    async function refreshAll() {
      refreshBtn.disabled = true;
      await Promise.all(listingRows().concat(orderRows()).map((row) => checkRow(row, 'all')));
      refreshBtn.disabled = false;
    }

    decorate();
    let timer = null;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        placeToolbar();
        decorate();
      }, 250);
    }).observe(document.body, { childList: true, subtree: true });

    function overpricedBoxes() {
      return listingRows().filter((r) => r.classList.contains('oih-row-bad'))
        .map((r) => r.querySelector('.oih-row-check')).filter(Boolean);
    }

    function updateOverBtn() {
      const boxes = overpricedBoxes();
      const allOn = boxes.length && boxes.every((b) => b.checked);
      const text = allOn ? t('unselectOverpriced') : t('selectOverpriced');
      const label = boxes.length ? `${text} (${boxes.length})` : text;
      if (overBtn.textContent !== label) overBtn.textContent = label;
      overBtn.disabled = !boxes.length;
    }

    function toggleOverpriced() {
      const boxes = overpricedBoxes();
      const on = !boxes.every((b) => b.checked);
      boxes.forEach((b) => { b.checked = on; });
      updateOverBtn();
    }

    document.addEventListener('change', (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('oih-row-check')) updateOverBtn();
    });

    function selectAll() {
      const boxes = listingRows().map((r) => r.querySelector('.oih-row-check')).filter(Boolean);
      const on = boxes.some((b) => !b.checked);
      boxes.forEach((b) => { b.checked = on; });
      updateOverBtn();
    }

    async function removeIds(ids) {
      let ok = 0;
      let fail = 0;
      for (let i = 0; i < ids.length; i++) {
        status.textContent = t('progress', i + 1, ids.length);
        try {
          await OIH.post(`https://steamcommunity.com/market/removelisting/${ids[i]}`, {});
          ok++;
          const row = document.getElementById('mylisting_' + ids[i]);
          if (row) row.classList.add('oih-removed');
        } catch (e) {
          fail++;
          if (e.status === 429) {
            OIH.toast(t('error') + ': 429', 'error');
            break;
          }
        }
        await OIH.sleep(350);
      }
      status.textContent = t('done', ok, fail);
    }

    async function removeSelected() {
      const ids = listingRows()
        .filter((r) => r.querySelector('.oih-row-check:checked'))
        .map((r) => r.id.replace('mylisting_', ''));
      if (!ids.length) return;
      if (!(await OIH.confirm(t('confirmRemoveSel', ids.length)))) return;
      await removeIds(ids);
    }

    async function collectAllListingIds() {
      const ids = new Set(listingRows().map((r) => r.id.replace('mylisting_', '')));
      let start = 0;
      for (let page = 0; page < 200; page++) {
        status.textContent = `${t('collecting')} ${ids.size}`;
        const res = await fetch(`https://steamcommunity.com/market/mylistings/render/?query=&start=${start}&count=100`, { credentials: 'include' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        const html = j.results_html || '';
        const re = /id="mylisting_(\d+)"/g;
        let m;
        let found = 0;
        while ((m = re.exec(html))) { ids.add(m[1]); found++; }
        start += 100;
        if (!found || start >= (j.total_count || 0)) break;
        await OIH.sleep(500);
      }
      return [...ids];
    }

    async function removeAll() {
      let ids;
      try {
        ids = await collectAllListingIds();
      } catch (e) {
        status.textContent = t('error') + ': ' + e.message;
        return;
      }
      status.textContent = '';
      if (!ids.length) return;
      if (!(await OIH.confirm(t('confirmRemoveAll', ids.length)))) return;
      await removeIds(ids);
    }

    async function cancelAllOrders() {
      const rows = orderRows().filter((r) => /^mybuyorder_\d+$/.test(r.id));
      const ids = rows.map((r) => r.id.replace('mybuyorder_', ''));
      if (!ids.length) return;
      if (!(await OIH.confirm(t('confirmCancelOrders', ids.length)))) return;
      let ok = 0;
      let fail = 0;
      for (let i = 0; i < ids.length; i++) {
        status.textContent = t('progress', i + 1, ids.length);
        try {
          await OIH.post('https://steamcommunity.com/market/cancelbuyorder/', { buy_orderid: ids[i] });
          ok++;
          rows[i].classList.add('oih-removed');
        } catch (e) {
          fail++;
        }
        await OIH.sleep(350);
      }
      status.textContent = t('done', ok, fail);
    }
  }
})();
