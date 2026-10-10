/*
 * Inventory page, built into the Steam layout:
 *  - a toolbar under the filters: inventory value, select mode, bulk selling, overview;
 *  - prices on item tiles;
 *  - market data and quick selling inside the selected item card.
 */
(async () => {
  'use strict';
  const OIH = window.OIH;
  if (!OIH || window.__oihInventory) return;
  window.__oihInventory = true;

  await OIH.ready();
  if (!OIH.settings.inventoryTools) return;
  try {
    await OIH.waitFor(() => window.g_ActiveInventory && document.getElementById('active_inventory_page'), 30000);
  } catch (e) {
    return; // private or not loaded
  }

  const { t, el, btn, fmt } = OIH;
  const inv = () => window.g_ActiveInventory;

  /* ---------------- items ---------------- */

  function ownerSteamId() {
    const i = inv();
    return (i && i.m_owner && i.m_owner.strSteamId) ||
      (i && i.m_steamid) ||
      (location.pathname.match(/\/profiles\/(\d{17})/) || [])[1] ||
      null;
  }

  function isOwn() {
    if (window.g_bViewingOwnProfile) return true;
    const owner = ownerSteamId();
    return !!(owner && window.g_steamID && String(owner) === String(window.g_steamID));
  }

  /** Normalizes a Steam item (CAsset or an /inventory/ answer). */
  function norm(it) {
    if (!it) return null;
    const d = it.description || it;
    if (!d) return null;
    const assetid = String(it.assetid || it.id || '');
    if (!assetid) return null;
    return {
      appid: Number(it.appid || d.appid),
      contextid: String(it.contextid || d.contextid || (inv() && inv().contextid)),
      assetid,
      amount: Number(it.amount || 1),
      name: d.market_hash_name || '',
      displayName: d.market_name || d.name || d.market_hash_name || '',
      marketable: !!Number(d.marketable),
      tradable: !!Number(d.tradable),
      icon: d.icon_url,
      color: d.name_color,
      fee: d.market_fee
    };
  }

  const keyOf = (it) => `${it.appid}_${it.contextid}_${it.assetid}`;
  const elementOf = (it) => document.getElementById(keyOf(it));
  const isListed = (it) => { const n = elementOf(it); return !!(n && n.classList.contains('oih-listed')); };

  /* ---------------- inventory state (loading and valuation) ---------------- */

  const states = new Map();

  function activeContext() {
    const i = inv();
    const steamid = ownerSteamId();
    if (!i || !steamid || !i.appid) return null;
    // Context 0 is the combined view of a game (e.g. the Steam tab = contexts 6 and 7);
    // the API answers 404 for it, so every real context is loaded separately.
    let contexts = [String(i.contextid)];
    if (contexts[0] === '0') {
      const byApp = (i.m_owner && i.m_owner.rgContextIdsByApp && i.m_owner.rgContextIdsByApp[i.appid]) || [];
      contexts = byApp.map(String).filter((c) => c !== '0');
      if (!contexts.length && Array.isArray(i.m_rgChildInventories)) {
        contexts = i.m_rgChildInventories.map((c) => c && String(c.contextid)).filter((c) => c && c !== '0');
      }
      if (!contexts.length) return null; // contexts unknown yet, retry on the next tick
    }
    const contextid = contexts.join('-');
    return { steamid, appid: Number(i.appid), contexts, contextid, inventory: i, key: `${steamid}_${i.appid}_${contextid}` };
  }

  function getState(ctx) {
    if (!states.has(ctx.key)) {
      states.set(ctx.key, Object.assign({}, ctx, {
        items: null, groups: null, sources: {},
        loading: null, error: null, listeners: new Set()
      }));
    }
    return states.get(ctx.key);
  }

  let emitTimer = null;
  function emit(st) {
    clearTimeout(emitTimer);
    emitTimer = setTimeout(() => st.listeners.forEach((fn) => fn(st)), 120);
  }

  function httpError(status) {
    const key = { 403: 'errPrivate', 429: 'errRateLimit' }[status];
    return new Error(key ? t(key) : 'HTTP ' + status);
  }

  async function loadContext(st, contextid, assets, descs, totals) {
    let startAssetId = null;
    const lang = window.g_strLanguage || 'english';
    for (let page = 0; page < 100; page++) {
      const url = `https://steamcommunity.com/inventory/${st.steamid}/${st.appid}/${contextid}?l=${lang}&count=1000` +
        (startAssetId ? `&start_assetid=${startAssetId}` : '');
      let res = await fetch(url, { credentials: 'include' });
      if (res.status === 429) {
        await OIH.sleep(30000);
        res = await fetch(url, { credentials: 'include' });
      } else if (res.status >= 500) {
        // Some inventories answer 500 to large pages; retry with 75 like Steam does.
        await OIH.sleep(1500);
        res = await fetch(url.replace('count=1000', 'count=75'), { credentials: 'include' });
      }
      if (!res.ok) throw httpError(res.status);
      const j = await res.json();
      if (j && j.success === false) throw new Error(j.Error || t('error'));
      (j.assets || []).forEach((a) => assets.push(a));
      (j.descriptions || []).forEach((d) => descs.set(d.classid + '_' + d.instanceid, d));
      totals[contextid] = j.total_inventory_count || 0;
      st.loadedCount = assets.length;
      st.totalCount = OIH.sum(Object.values(totals), (n) => n) || assets.length;
      emit(st);
      if (!j.more_items || !j.last_assetid) break;
      startAssetId = j.last_assetid;
      await OIH.sleep(800);
    }
  }

  /**
   * Preferred loader: Steam's own CInventory.LoadCompleteInventory, which works wherever
   * Steam itself can show the inventory.
   */
  function steamSubInventories(i) {
    const kids = i.m_rgChildInventories && Object.values(i.m_rgChildInventories).filter(Boolean);
    return kids && kids.length ? kids : [i];
  }

  function loadViaSteam(st) {
    const i = st.inventory;
    if (!i || typeof i.LoadCompleteInventory !== 'function') return Promise.reject(new Error('no loader'));
    return new Promise((resolve, reject) => {
      const progress = setInterval(() => {
        // m_rgAssets is sparse (indexed by asset id): count keys only.
        const subs = steamSubInventories(i);
        st.loadedCount = OIH.sum(subs, (x) => Object.keys(x.m_rgAssets || {}).length);
        st.totalCount = OIH.sum(subs, (x) => Number(x.m_cItems) || 0);
        emit(st);
      }, 1000);
      const finish = (fn, v) => { clearInterval(progress); clearTimeout(timer); fn(v); };
      const timer = setTimeout(() => finish(reject, new Error('timeout')), 180000);
      let d;
      try {
        d = i.LoadCompleteInventory();
      } catch (e) {
        return finish(reject, e);
      }
      const collect = () => {
        const out = [];
        for (const sub of steamSubInventories(i)) {
          for (const a of Object.values(sub.m_rgAssets || {})) {
            const it = norm(a);
            if (it) out.push(it);
          }
        }
        if (!out.length && Number(i.m_cItems) > 0) return finish(reject, new Error('empty'));
        finish(resolve, out);
      };
      if (d && typeof d.done === 'function') {
        d.done(collect);
        if (typeof d.fail === 'function') d.fail(() => finish(reject, new Error('steam loader failed')));
      } else {
        Promise.resolve(d).then(collect, (e) => finish(reject, e));
      }
    });
  }

  /** Fallback: the /inventory/ API directly. */
  async function loadFullInventory(st) {
    const assets = [];
    const descs = new Map();
    const totals = {};
    let lastError = null;
    let okContexts = 0;
    for (const contextid of st.contexts) {
      try {
        await loadContext(st, contextid, assets, descs, totals);
        okContexts++;
      } catch (e) {
        lastError = e; // one empty or failing context must not break the others
      }
    }
    if (!okContexts && lastError) throw lastError;
    return assets
      .map((a) => norm(Object.assign({}, a, { description: descs.get(a.classid + '_' + a.instanceid) })))
      .filter(Boolean);
  }

  function ensureLoaded(st) {
    if (!st.loading) {
      st.error = null;
      st.loading = loadViaSteam(st).catch(() => loadFullInventory(st)).then((items) => {
        st.items = items;
        st.groups = new Map();
        for (const it of items) {
          const k = it.name || it.displayName;
          if (!st.groups.has(k)) {
            st.groups.set(k, { key: k, name: it.name, displayName: it.displayName, icon: it.icon, color: it.color, items: [], marketableItems: [], checked: false, qty: 0 });
          }
          const g = st.groups.get(k);
          g.items.push(it);
          if (it.marketable && it.name) g.marketableItems.push(it);
        }
        emit(st);
        return st;
      }).catch((e) => {
        st.error = e.message;
        st.loading = null;
        emit(st);
        throw e;
      });
    }
    return st.loading;
  }

  const groupCount = (g) => OIH.sum(g.items, (it) => it.amount || 1);

  /*
   * Valuation by several sources, each with its own prices, currency and status.
   * Steam Market is priced item by item through the queue, marketplaces with one price
   * list request. The primary source feeds the tiles and the total; others are for comparison.
   */
  function src(st, id) {
    if (!st.sources[id]) {
      st.sources[id] = { id, prices: new Map(), currency: OIH.currencyCode(), status: 'idle', error: null, done: 0, todo: 0, fetchedAt: 0, ctl: null };
    }
    return st.sources[id];
  }

  const primaryId = (st) => OIH.primarySource(st.appid);
  const primary = (st) => src(st, primaryId(st));

  function stats(st, id) {
    const out = { items: 0, unique: 0, marketable: 0, priced: 0, toPrice: 0, total: 0 };
    if (!st.groups) return out;
    const prices = src(st, id || primaryId(st)).prices;
    for (const g of st.groups.values()) {
      const c = groupCount(g);
      out.items += c;
      out.unique++;
      if (!g.marketableItems.length) continue;
      out.marketable += g.marketableItems.length;
      out.toPrice++;
      const p = prices.get(g.name);
      if (p !== undefined) out.priced++;
      if (p) out.total += p * c;
    }
    return out;
  }

  const isValuating = (st) => Object.values(st.sources).some((s) => s.status === 'loading');

  function startValuation(st, force) {
    if (!st.groups || isValuating(st)) return;
    const marketable = [...st.groups.values()].filter((g) => g.marketableItems.length)
      .sort((a, b) => groupCount(b) - groupCount(a));
    for (const id of OIH.enabledSources()) {
      const s = src(st, id);
      if (!OIHSources.supports(id, st.appid)) {
        s.status = 'unsupported';
        continue;
      }
      if (force) s.prices.clear();
      if (id === 'steam') startSteam(st, s, marketable, force);
      else startBulk(st, s, marketable, force);
    }
    emit(st);
  }

  function startSteam(st, s, marketable, force) {
    const names = marketable.filter((g) => !s.prices.has(g.name)).map((g) => g.name);
    if (!names.length) {
      s.status = 'done';
      return;
    }
    s.status = 'loading';
    s.done = 0;
    s.todo = names.length;
    s.ctl = OIH.valuate(st.appid, names, (name, cents, currency) => {
      s.currency = currency || s.currency;
      s.prices.set(name, cents);
      s.done++;
      s.fetchedAt = Date.now();
      emit(st);
    }, () => {
      if (s.status === 'loading') s.status = 'done';
      emit(st);
    }, force);
  }

  function startBulk(st, s, marketable, force) {
    if (!force && s.status === 'done' && s.prices.size) return;
    s.status = 'loading';
    s.error = null;
    OIH.bulkPrices(s.id, st.appid, force, marketable.map((g) => g.name)).then((r) => {
      if (r.unsupported) {
        s.status = 'unsupported';
      } else if (r.error) {
        s.status = 'error';
        s.error = r.error === 'no-permission' ? t('errNoPermission') : r.error;
      } else {
        s.currency = r.currency;
        s.converted = r.converted || null;
        s.fetchedAt = r.fetchedAt;
        s.urls = new Map(Object.entries(r.urls || {}));
        for (const g of marketable) s.prices.set(g.name, r.prices[g.name] ?? null);
        s.status = 'done';
      }
      emit(st);
    }).catch((e) => {
      s.status = 'error';
      s.error = e.message;
      emit(st);
    });
  }

  function stopValuation(st) {
    if (!st) return;
    for (const s of Object.values(st.sources)) {
      if (s.id === 'steam' && s.status === 'loading' && s.ctl) {
        s.ctl.cancel();
        s.status = 'done';
      }
    }
    emit(st);
  }

  /* ---------------- toolbar under the filters ---------------- */

  const selected = new Map(); // key -> item
  let selectMode = false;

  const bar = {};
  bar.value = el('span', { class: 'oih-bar-value', text: '—' });
  bar.meta = el('span', { class: 'oih-muted' });
  bar.sources = el('div', { class: 'oih-invbar-sources' });
  bar.progress = el('div', { class: 'oih-progress' }, el('div', { class: 'oih-progress-fill' }));
  bar.refresh = btn(t('loadPrices'), onRefreshClick);
  bar.mode = btn(t('selectModeOff'), () => setSelectMode(!selectMode), 'oih-btn-toggle');
  bar.mode.title = t('selectModeHint');
  bar.hint = el('span', { class: 'oih-select-hint', text: t('selectHint') });
  bar.selCount = el('span', { class: 'oih-muted', text: t('selectedCount', 0) });
  bar.sell = btn(t('sellSelected'), () => openSellDialog([...selected.values()]), 'oih-btn-primary');
  bar.clear = btn(t('clear'), clearSelection);
  bar.root = el('div', { class: 'oih-root oih-invbar' },
    el('div', { class: 'oih-invbar-main' },
      el('div', { class: 'oih-invbar-value' },
        el('span', { class: 'oih-muted', text: t('totalValue') + ':' }), bar.value, bar.meta),
      el('div', { class: 'oih-row' }, bar.refresh, btn(t('overview'), openOverview))),
    bar.sources,
    bar.progress,
    el('div', { class: 'oih-invbar-sel' }, bar.mode, bar.selCount, bar.sell, bar.clear, bar.hint));

  function placeBar() {
    if (bar.root.isConnected) return;
    const page = document.getElementById('active_inventory_page');
    if (page && page.parentNode) page.parentNode.insertBefore(bar.root, page);
  }
  placeBar();

  let barState = null;

  /** "Steam Market: 12,30 € (40/52)" for every enabled source. */
  function sourceChips(st) {
    const pid = primaryId(st);
    return OIH.enabledSources().map((id) => {
      const s = src(st, id);
      const label = OIH.sourceLabel(id);
      let text;
      if (s.status === 'unsupported') text = t('srcUnsupported');
      else if (s.status === 'error') text = t('error') + ': ' + s.error;
      else if (s.status === 'idle') text = '—';
      else {
        const x = stats(st, id);
        text = (s.converted ? '≈ ' : '') + fmt(x.total, s.currency) + (s.status === 'loading'
          ? (id === 'steam' ? ` · ${s.done}/${s.todo}` : ' · ' + t('loading'))
          : (x.toPrice ? ` (${x.priced}/${x.toPrice})` : ''));
      }
      const chip = el('span', { class: 'oih-src-chip' + (id === pid ? ' oih-src-primary' : ''),
        title: [s.fetchedAt ? `${t('updated')}: ${OIH.when(s.fetchedAt)}` : '', OIH.rateNote(s.converted)].filter(Boolean).join(' · ') },
        OIH.sourceLink(id, st.appid, label, 'oih-muted'), el('span', { class: 'oih-muted', text: ': ' }), el('b', { text }));
      return chip;
    });
  }

  function renderBar(st) {
    if (st !== barState) return;
    const p = primary(st);
    const s = stats(st);
    const valuating = isValuating(st);
    bar.refresh.textContent = valuating ? t('stop') : (s.priced ? t('refreshPrices') : t('loadPrices'));
    if (st.error) {
      bar.value.textContent = '—';
      bar.meta.textContent = t('error') + ': ' + st.error;
    } else if (!st.items) {
      bar.value.textContent = '…';
      bar.meta.textContent = st.totalCount ? `${t('loading')} ${st.loadedCount} / ${st.totalCount}` : t('loading');
    } else {
      bar.value.textContent = p.status === 'unsupported' ? '—' : fmt(s.total, p.currency);
      const parts = [`${t('items')}: ${s.items}`, `${t('marketable')}: ${s.marketable}`];
      if (s.toPrice) parts.push(`${t('pricedOf', s.priced, s.toPrice)}`);
      bar.meta.textContent = parts.join(' · ');
    }
    // With a single source the list would only repeat the total.
    const many = OIH.enabledSources().length > 1;
    bar.sources.style.display = many && st.items ? '' : 'none';
    if (many && st.items) bar.sources.replaceChildren(...sourceChips(st));

    const steam = st.sources.steam;
    const steamLoading = steam && steam.status === 'loading';
    const pct = steamLoading && steam.todo ? Math.round((steam.done / steam.todo) * 100) : (valuating ? 50 : 0);
    bar.progress.style.display = valuating ? '' : 'none';
    bar.progress.firstChild.style.width = pct + '%';
    bar.progress.title = steamLoading ? t('etaSteam', Math.round((Number(OIH.settings.requestDelayMs) || 3000) / 1000)) : '';
    decorateGrid();
  }

  function onRefreshClick() {
    if (!barState) return;
    if (isValuating(barState)) {
      stopValuation(barState);
      return;
    }
    const s = stats(barState);
    const force = s.priced > 0 && s.priced >= s.toPrice;
    ensureLoaded(barState).then(() => startValuation(barState, force)).catch(() => {});
  }

  function switchInventory() {
    const ctx = activeContext();
    if (!ctx) return;
    if (barState && barState.key === ctx.key) return;
    if (barState) {
      stopValuation(barState);
      barState.listeners.delete(renderBar);
    }
    barState = getState(ctx);
    barState.listeners.add(renderBar);
    clearSelection();
    renderBar(barState);
    ensureLoaded(barState).then((st) => {
      if (OIH.settings.autoValuate && st === barState) startValuation(st, false);
    }).catch(() => {});
  }

  // A newly enabled source is valued right away.
  OIH.onSettings(() => {
    if (barState && barState.groups) {
      startValuation(barState, false);
      renderBar(barState);
    }
  });

  /* ---------------- prices on tiles ---------------- */

  function decorateGrid() {
    if (!OIH.settings.showItemPrices || !barState) return;
    const st = barState;
    const p = primary(st);
    const prefixes = st.contexts.map((c) => `${st.appid}_${c}_`);
    const container = (inv() && inv().m_$Inventory && inv().m_$Inventory[0]) || document.getElementById('inventories');
    if (!container) return;
    container.querySelectorAll('.item').forEach((node) => {
      if (!prefixes.some((x) => node.id.startsWith(x))) return;
      const it = norm(node.rgItem);
      const price = it && it.name ? p.prices.get(it.name) : undefined;
      let badge = node.querySelector(':scope > .oih-badge');
      if (!price) {
        if (badge) badge.remove();
        return;
      }
      if (!badge) {
        badge = el('span', { class: 'oih-badge' });
        node.append(badge);
      }
      const text = fmt(price, p.currency);
      if (badge.textContent !== text) badge.textContent = text;
    });
  }

  /* ---------------- market data inside Steam's item card ---------------- */
  // No separate panel: lines go into Steam's market section ("Starting at / Sold in 24h /
  // View in Community Market") and buttons reuse Steam's button classes and data-accent-color.

  const mkt = {
    median: el('div'),
    buy: el('div'),
    others: el('div'), // other marketplaces
    age: el('div'),
    actions: el('div', { class: 'oih-root oih-mkt-actions' }),
    quick: el('span', { class: 'oih-root oih-quick' }), // quick/instant sell next to Steam's Sell
    brk: el('span', { class: 'oih-root oih-break' }), // line break after the button row
    btnClass: null,
    lineClass: '',
    item: null,
    ov: null,
    hist: null,
    loading: false,
    customPrice: null // user input survives re-renders
  };
  const mktLines = [mkt.median, mkt.buy, mkt.others, mkt.age];

  function visibleItemInfo() {
    return ['iteminfo0', 'iteminfo1']
      .map((id) => document.getElementById(id))
      .find((n) => n && n.offsetParent !== null && getComputedStyle(n).display !== 'none' && getComputedStyle(n).opacity !== '0');
  }

  /** Market link of the selected item itself: descriptions may link to other items. */
  function marketLink(host, item) {
    const want = `/market/listings/${item.appid}/${item.name}`;
    return [...host.querySelectorAll('a[href*="/market/listings/"]')].find((a) => {
      if (a.closest('.oih-root')) return false;
      try {
        return decodeURIComponent(a.pathname) === want;
      } catch (e) {
        return false;
      }
    }) || null;
  }

  function detachMarket() {
    for (const n of mktLines.concat(mkt.actions, mkt.quick, mkt.brk)) if (n.isConnected) n.remove();
  }

  // Steam's Sell button in all Steam languages: the React markup has no stable classes.
  const SELL_WORDS = ['sell', 'продать', 'продати', 'продай', 'verkaufen', 'vendre', 'vender', 'vendi', 'sprzedaj',
    'prodat', 'predať', 'sat', 'satış', '出售', '販売', '판매', 'verkopen', 'sälj', 'myy', 'sælg', 'selg', 'eladás',
    'vinde', 'ขาย', 'bán', 'πώληση', 'продаване'];

  function findSellButton(host) {
    return [...host.querySelectorAll('a, button')].find((n) => {
      if (n.closest('.oih-root') || n.classList.contains('oih-steam-btn')) return false;
      const text = (n.textContent || '').trim().toLowerCase();
      return text.length < 24 && SELL_WORDS.includes(text) && n.offsetParent !== null;
    }) || null;
  }

  /** Puts quick buttons right after Steam's Sell; the React node is never moved, the row is built with CSS. */
  function placeQuick(host) {
    const sellBtn = isOwn() ? findSellButton(host) : null;
    if (!sellBtn) {
      if (mkt.brk.isConnected) mkt.brk.remove();
      if (mkt.quick.parentElement !== mkt.actions) mkt.actions.prepend(mkt.quick);
      return null;
    }
    sellBtn.classList.add('oih-sell-btn');
    if (sellBtn.parentElement) sellBtn.parentElement.classList.add('oih-sell-row');
    if (sellBtn.nextElementSibling !== mkt.quick) sellBtn.after(mkt.quick);
    if (mkt.quick.nextElementSibling !== mkt.brk) mkt.quick.after(mkt.brk);
    return sellBtn;
  }

  function placeMarket(item) {
    const host = visibleItemInfo();
    if (!host || !item || !item.marketable) return detachMarket();
    const link = marketLink(host, item);
    if (!link) {
      // The market section is not rendered yet: append to the card for now.
      const root = (host.firstElementChild && host.firstElementChild.firstElementChild) || host;
      for (const n of mktLines.concat(mkt.actions)) if (n.parentElement !== root) root.append(n);
      placeQuick(host);
      return;
    }
    const section = link.parentElement;
    // Steam's text lines ("Starting at…") are the first own div before the link.
    let textBlock = null;
    for (const c of section.children) {
      if (c === link) break;
      if (c.tagName === 'DIV' && !c.classList.contains('oih-root') && !c.classList.contains('oih-sell-btn')) {
        textBlock = c;
        break;
      }
    }
    const first = textBlock && textBlock.firstElementChild;
    if (first && !first.classList.contains('oih-mkt-line')) mkt.lineClass = first.className;
    for (const n of mktLines) {
      n.className = (mkt.lineClass + ' oih-mkt-line').trim();
      if (textBlock) {
        if (n.parentElement !== textBlock) textBlock.append(n);
      } else if (n.parentElement !== section) {
        section.insertBefore(n, link);
      }
    }
    mkt.others.classList.add('oih-root', 'oih-mkt-others');
    if (mkt.actions.parentElement !== section || mkt.actions.nextElementSibling !== link) section.insertBefore(mkt.actions, link);
    const sellBtn = placeQuick(host);
    // Button classes from Steam's Sell button, otherwise from "View in Community Market".
    const cls = (sellBtn && sellBtn.className.replace(/\boih-sell-btn\b/, '').trim()) || link.className;
    if (mkt.btnClass !== cls) {
      mkt.btnClass = cls;
      renderMarket();
    }
  }

  function steamBtn(text, accent, onclick) {
    return el('a', {
      class: (mkt.btnClass || 'oih-btn') + ' oih-steam-btn',
      href: '#',
      'data-accent-color': accent,
      text,
      onclick: (e) => {
        e.preventDefault();
        onclick();
      }
    });
  }

  function renderAge() {
    const e = mkt.item && OIH.storedPrice(mkt.item.appid, mkt.item.name);
    let ts = 0;
    if (e) ts = Math.min(e.ovAt || Infinity, e.histAt || Infinity);
    const refresh = el('a', {
      class: 'oih-link', href: '#', text: '↻ ' + t('refresh'),
      onclick: (ev) => {
        ev.preventDefault();
        if (mkt.item && !mkt.loading) showSelected(mkt.item, true);
      }
    });
    mkt.age.replaceChildren(`${t('updated')}: `,
      mkt.loading ? t('loading') : OIH.timeEl(Number.isFinite(ts) ? ts : 0), ' · ', refresh);
  }

  /* --- other marketplaces for the selected item --- */

  /** Shared page cache first (valuation fills it), otherwise a batched request. */
  function otherPrice(id, item) {
    const hit = OIH.peekBulk(id, item.appid, item.name);
    if (hit) return hit;
    OIH.bulkPrice(id, item.appid, item.name).then(() => {
      if (mkt.item && mkt.item.name === item.name) renderOthers();
    });
    return 'loading';
  }

  function renderOthers() {
    const item = mkt.item;
    const ids = item ? OIH.enabledSources().filter((id) => id !== 'steam' && OIHSources.supports(id, item.appid)) : [];
    if (!ids.length) {
      mkt.others.style.display = 'none';
      return;
    }
    mkt.others.style.display = '';
    const steamLowest = mkt.hist && mkt.hist.lowestSell != null ? mkt.hist.lowestSell : mkt.ov && mkt.ov.lowest;
    const chips = ids.map((id) => {
      const d = otherPrice(id, item);
      const label = el('span', { class: 'oih-other-label', text: OIH.sourceLabel(id).replace(/\s*\(.*\)$/, '') });
      if (d === 'loading') return el('span', { class: 'oih-other' }, label, el('span', { class: 'oih-muted', text: '…' }));
      if (!d || d.error || d.price == null) {
        return el('span', { class: 'oih-other oih-other-na' }, label, OIH.priceLink(id, item.appid, item.name, '—'));
      }
      const parts = [label, OIH.priceLink(id, item.appid, item.name, (d.converted ? '≈' : '') + fmt(d.price, d.currency), d.url, 'oih-other-price')];
      // The difference only makes sense in the same currency.
      if (steamLowest && d.currency === OIH.currencyCode()) {
        const pct = Math.round(((d.price - steamLowest) / steamLowest) * 100);
        parts.push(el('span', { class: 'oih-other-diff ' + (pct < 0 ? 'oih-down' : pct > 0 ? 'oih-up' : ''), text: (pct > 0 ? '+' : '') + pct + '%' }));
      }
      const chip = el('span', { class: 'oih-other' }, ...parts);
      chip.title = [OIH.sourceLabel(id), d.fetchedAt ? `${t('updated')}: ${OIH.when(d.fetchedAt)}` : '', OIH.rateNote(d.converted)].filter(Boolean).join(' · ');
      return chip;
    });
    mkt.others.replaceChildren(el('span', { class: 'oih-muted', text: t('otherMarkets') + ':' }), ...chips);
  }

  /* --- suggested prices: a click fills the price field --- */

  function recommendations(ov, hist) {
    const lowest = hist && hist.lowestSell != null ? hist.lowestSell : ov && ov.lowest;
    const undercut = Math.max(0, Number(OIH.settings.undercutCents) || 0);
    const out = [];
    if (lowest) {
      if (undercut) out.push({ label: t('recUndercut', fmt(undercut)), price: Math.max(3, lowest - undercut) });
      out.push({ label: t('recLowest'), price: lowest });
    }
    if (ov && ov.median) out.push({ label: t('recMedian'), price: ov.median });
    if (hist && hist.highestBuy) out.push({ label: t('recBuy'), price: hist.highestBuy });
    return out;
  }

  function recRow(ov, hist, onPick) {
    const recs = recommendations(ov, hist);
    if (!recs.length) return null;
    return el('div', { class: 'oih-root oih-rec' },
      el('span', { class: 'oih-muted', text: t('recommended') + ':' }),
      ...recs.map((r) => el('button', {
        type: 'button', class: 'oih-rec-chip', title: t('clickToUse'),
        onclick: (e) => {
          e.preventDefault();
          onPick(r.price);
        }
      }, el('span', { class: 'oih-muted', text: r.label + ' ' }), el('b', { text: fmt(r.price) }))));
  }

  function renderMarket() {
    const { item, ov, hist } = mkt;
    if (!item) return;
    mkt.median.textContent = `${t('median')}: ${ov ? fmt(ov.median) : '…'}`;
    mkt.buy.textContent = `${t('buyOrder')}: ${hist ? fmt(hist.highestBuy) : (OIH.settings.autoLoadSelectedPrice && mkt.loading ? '…' : '—')}`;
    renderOthers();
    renderAge();

    // Quick buttons already placed next to Steam's Sell stay there.
    const quickParent = mkt.quick.parentElement;
    mkt.actions.replaceChildren();
    mkt.quick.replaceChildren();
    if (!isOwn()) {
      mkt.actions.style.display = 'none';
      mkt.quick.style.display = 'none';
      return;
    }
    mkt.actions.style.display = '';
    mkt.quick.style.display = '';
    const lowest = hist && hist.lowestSell != null ? hist.lowestSell : ov && ov.lowest;
    const undercut = Math.max(0, Number(OIH.settings.undercutCents) || 0);
    if (lowest) {
      const price = Math.max(3, lowest - undercut);
      mkt.quick.append(steamBtn(`${t('quickSell')}: ${fmt(price)}`, 'green', () => sellOne(item, price)));
    }
    if (hist && hist.highestBuy) {
      mkt.quick.append(steamBtn(`${t('instantSell')}: ${fmt(hist.highestBuy)}`, 'blue', () => sellOne(item, hist.highestBuy)));
    }
    if (!quickParent || quickParent === mkt.actions) mkt.actions.append(mkt.quick);

    const initial = mkt.customPrice != null ? mkt.customPrice : (lowest ? ((Math.max(3, lowest - undercut)) / 100).toFixed(2) : '');
    const input = el('input', { class: 'oih-input oih-price-input', placeholder: t('sellFor'), value: initial });
    const hint = el('span', { class: 'oih-muted' });
    const updateHint = () => {
      const p = OIH.Fees.parsePrice(input.value);
      hint.textContent = p ? `${t('youReceive')} ${fmt(OIH.sellerReceives(p, item.fee))}` : '';
    };
    input.addEventListener('input', () => {
      mkt.customPrice = input.value;
      updateHint();
    });
    updateHint();
    mkt.actions.append(el('div', { class: 'oih-row' }, input,
      steamBtn(t('sellFor'), 'dull', () => {
        const p = OIH.Fees.parsePrice(input.value);
        if (p) sellOne(item, p);
      }), hint));
    const rec = recRow(ov, hist, (price) => {
      input.value = (price / 100).toFixed(2);
      mkt.customPrice = input.value;
      updateHint();
      input.focus();
    });
    if (rec) mkt.actions.append(rec);
  }

  let currentKey = null;
  let renderToken = 0;

  async function showSelected(item, force) {
    const token = ++renderToken;
    const sameItem = mkt.item && item && mkt.item.name === item.name && mkt.item.assetid === item.assetid;
    mkt.item = item && item.marketable && item.name ? item : null;
    if (!sameItem) mkt.customPrice = null;
    mkt.ov = null;
    mkt.hist = null;
    if (!mkt.item) {
      detachMarket();
      return;
    }
    // A recent price from valuation, selling or an earlier selection is reused.
    const opts = force ? { force: true, priority: 'high' } : { maxAgeMin: OIH.freshMinutes(), priority: 'high' };
    mkt.loading = true;
    renderMarket();
    try {
      mkt.ov = await OIH.priceOverview(item.appid, item.name, opts);
    } catch (e) {
      mkt.ov = null;
    }
    if (token !== renderToken) return;
    renderMarket();
    if (OIH.settings.autoLoadSelectedPrice) {
      try {
        mkt.hist = await OIH.priceHistogram(item.appid, item.name, opts);
      } catch (e) {
        mkt.hist = null;
      }
      if (token !== renderToken) return;
    }
    mkt.loading = false;
    renderMarket();
  }

  // The selected item got a new price elsewhere on the page.
  OIH.onPriceUpdate((appid, name) => {
    if (!mkt.item || mkt.loading || mkt.item.appid !== appid || mkt.item.name !== name) return;
    const e = OIH.storedPrice(appid, name);
    if (!e) return;
    if (e.ov) mkt.ov = e.ov;
    if (e.hist) mkt.hist = e.hist;
    renderMarket();
  });

  /* --- suggestions in Steam's own sell dialog --- */

  function decorateSteamSellDialog() {
    const input = document.getElementById('market_sell_buyercurrency_input');
    if (!input || input.offsetParent === null || !mkt.item) return;
    const key = mkt.item.assetid + '|' + (mkt.ov ? mkt.ov.fetchedAt : 0) + '|' + (mkt.hist ? mkt.hist.fetchedAt : 0);
    const existing = document.getElementById('oih_steam_sell_rec');
    if (existing && existing.dataset.key === key) return;
    if (existing) existing.remove();
    const row = recRow(mkt.ov, mkt.hist, (price) => {
      input.value = (price / 100).toFixed(2);
      // Steam recalculates "you receive" on input/key events.
      for (const type of ['input', 'keyup', 'change']) input.dispatchEvent(new Event(type, { bubbles: true }));
      input.focus();
    });
    if (!row) return;
    row.id = 'oih_steam_sell_rec';
    row.dataset.key = key;
    const anchor = input.closest('.market_sell_dialog_input_group') || input.parentElement;
    anchor.after(row);
  }

  async function sellOne(item, buyerPrice) {
    const receive = OIH.sellerReceives(buyerPrice, item.fee);
    if (receive < 1) return OIH.toast(t('error'), 'error');
    if (OIH.settings.confirmSell && !(await OIH.confirm(t('confirmSell', item.displayName, fmt(buyerPrice), fmt(receive))))) return;
    try {
      const r = await OIH.sellItem(item, receive);
      markListed(item);
      OIH.toast(t('listed') + (r.requires_confirmation ? '. ' + t('needConfirm') : ''), 'success', 7000);
    } catch (e) {
      OIH.toast(t('error') + ': ' + e.message, 'error', 8000);
    }
  }

  function markListed(item) {
    const node = elementOf(item);
    if (node) {
      node.classList.add('oih-listed');
      node.classList.remove('oih-selected');
    }
    selected.delete(keyOf(item));
    updateSelectionUi();
  }

  /* ---------------- main loop: active inventory and selected item ---------------- */

  function tick() {
    placeBar();
    switchInventory();
    const i = inv();
    const it = norm(i && i.selectedItem);
    const key = it ? keyOf(it) : null;
    if (key !== currentKey) {
      currentKey = key;
      showSelected(it);
    }
    placeMarket(it);
    decorateSteamSellDialog();
  }
  setInterval(tick, 400);
  setInterval(decorateGrid, 1500);
  tick();

  /* ---------------- select mode ---------------- */

  function setSelectMode(on) {
    selectMode = on;
    bar.mode.textContent = on ? t('selectModeOn') : t('selectModeOff');
    bar.mode.classList.toggle('oih-btn-on', on);
    bar.mode.setAttribute('aria-pressed', on ? 'true' : 'false');
    bar.root.classList.toggle('oih-selecting', on);
    document.body.classList.toggle('oih-select-mode', on);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectMode && !document.querySelector('.oih-overlay')) setSelectMode(false);
  });

  function updateSelectionUi() {
    bar.selCount.textContent = t('selectedCount', selected.size);
    bar.sell.disabled = !selected.size || !isOwn();
    bar.clear.disabled = !selected.size;
  }
  updateSelectionUi();

  function clearSelection() {
    for (const it of selected.values()) {
      const node = elementOf(it);
      if (node) node.classList.remove('oih-selected');
    }
    selected.clear();
    updateSelectionUi();
  }

  function itemFromElement(node) {
    const fromRg = norm(node.rgItem);
    if (fromRg) return fromRg;
    const m = node.id && node.id.match(/^(\d+)_(\d+)_(\d+)$/);
    if (!m) return null;
    const assets = (inv() && inv().m_rgAssets) || [];
    const asset = Object.values(assets).find((a) => a && String(a.assetid) === m[3]);
    return norm(asset) || { appid: +m[1], contextid: m[2], assetid: m[3], amount: 1, name: '', displayName: m[3], marketable: false };
  }

  function setSelected(item, on) {
    const node = elementOf(item);
    if (on) selected.set(keyOf(item), item);
    else selected.delete(keyOf(item));
    if (node) node.classList.toggle('oih-selected', on);
  }

  /** All items of the inventory: the full loaded list, otherwise what Steam has loaded. */
  function allItems() {
    if (barState && barState.items) return barState.items;
    const out = [];
    for (const a of Object.values((inv() && inv().m_rgAssets) || [])) {
      const it = norm(a);
      if (it) out.push(it);
    }
    return out;
  }

  document.addEventListener('click', (e) => {
    if (!selectMode) return;
    const node = e.target.closest && e.target.closest('#inventories .item');
    if (!node) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const item = itemFromElement(node);
    if (!item) return;
    if (e.shiftKey && item.name) {
      const on = !selected.has(keyOf(item));
      for (const it of allItems()) {
        if (it.name === item.name && it.appid === item.appid && !isListed(it)) setSelected(it, on);
      }
    } else {
      setSelected(item, !selected.has(keyOf(item)));
    }
    updateSelectionUi();
  }, true);

  /* ---------------- bulk selling ---------------- */

  /*
   * Prices come from the shared cache: anything younger than "price freshness when selling"
   * is not requested again, stale prices are refreshed before selling starts. The order book
   * is only requested for the buy order strategy, which halves the requests.
   */
  function openSellDialog(items) {
    if (!isOwn()) return OIH.toast(t('notOwn'), 'error');
    const sellable = items.filter((it) => it.marketable && it.name);
    if (!sellable.length) return OIH.toast(t('notMarketable'), 'error');

    const groups = new Map();
    for (const it of sellable) {
      const k = it.appid + '|' + it.name;
      if (!groups.has(k)) {
        groups.set(k, {
          name: it.name, displayName: it.displayName, appid: it.appid, fee: it.fee, items: [],
          lowest: null, median: null, buy: null, ovAt: 0, histAt: 0, price: null, manual: false, busy: false
        });
      }
      groups.get(k).items.push(it);
    }
    const rows = [...groups.values()];
    const freshMs = () => OIH.freshMinutes() * 60000;

    const strategy = el('select', { class: 'oih-input' },
      el('option', { value: 'lowest', text: t('stLowest', fmt(Number(OIH.settings.undercutCents) || 0)) }),
      el('option', { value: 'median', text: t('stMedian') }),
      el('option', { value: 'buyorder', text: t('stBuyorder') }),
      el('option', { value: 'manual', text: t('stManual') }));
    strategy.value = OIH.settings.sellStrategy || 'lowest';
    const needHist = () => strategy.value === 'buyorder';

    const tbody = el('tbody');
    const totalEl = el('b');
    const progress = el('div', { class: 'oih-muted' });
    const log = el('div', { class: 'oih-log' });

    function priceFor(g) {
      const undercut = Math.max(0, Number(OIH.settings.undercutCents) || 0);
      switch (strategy.value) {
        case 'lowest': return g.lowest ? Math.max(3, g.lowest - undercut) : null;
        case 'median': return g.median || null;
        case 'buyorder': return g.buy || null;
        default: return g.price;
      }
    }

    /** Age of the price the current strategy is based on. */
    function priceTime(g) {
      if (needHist()) return g.histAt;
      return g.ovAt || g.histAt;
    }

    function recalcTotal() {
      let sum = 0;
      for (const g of rows) if (g.price) sum += OIH.sellerReceives(g.price, g.fee) * g.items.length;
      totalEl.textContent = fmt(sum);
    }

    function fillFromStore(g) {
      const e = OIH.storedPrice(g.appid, g.name);
      if (!e) return;
      if (e.ov) {
        g.lowest = e.ov.lowest;
        g.median = e.ov.median;
        g.ovAt = e.ovAt || 0;
      }
      if (e.hist) {
        g.buy = e.hist.highestBuy;
        g.histAt = e.histAt || 0;
        // The order book is more precise than priceoverview unless older.
        if (e.hist.lowestSell != null && g.histAt >= g.ovAt) g.lowest = e.hist.lowestSell;
      }
    }

    function renderRow(g) {
      g.cells.lowest.textContent = fmt(g.lowest);
      g.cells.median.textContent = fmt(g.median);
      g.cells.buy.textContent = g.buy != null ? fmt(g.buy) : (needHist() ? '…' : '—');
      const ts = priceTime(g);
      if (g.busy) {
        delete g.cells.ageText.dataset.oihTs;
        g.cells.ageText.textContent = t('loading');
      } else {
        OIH.setTime(g.cells.ageText, ts, 'ago');
      }
      g.cells.ageText.classList.toggle('oih-stale', !g.busy && (!ts || Date.now() - ts > freshMs()));
      g.cells.refresh.disabled = g.busy;
      if (!g.manual) {
        g.price = priceFor(g);
        g.input.value = g.price ? (g.price / 100).toFixed(2) : '';
      }
      g.cells.receive.textContent = g.price ? fmt(OIH.sellerReceives(g.price, g.fee)) : '—';
    }

    for (const g of rows) {
      g.cells = {
        lowest: el('td'),
        median: el('td'),
        buy: el('td'),
        ageText: el('span'),
        refresh: el('button', { class: 'oih-icon-btn', type: 'button', title: t('refresh'), text: '↻', onclick: () => loadPrices([g], true) }),
        receive: el('td')
      };
      // Clicking lowest / median / buy order uses it as the row price.
      const pick = (field) => () => {
        if (g[field] == null) return;
        g.manual = true;
        g.price = g[field];
        g.input.value = (g.price / 100).toFixed(2);
        g.cells.receive.textContent = fmt(OIH.sellerReceives(g.price, g.fee));
        recalcTotal();
      };
      for (const [cell, field] of [[g.cells.lowest, 'lowest'], [g.cells.median, 'median'], [g.cells.buy, 'buy']]) {
        cell.classList.add('oih-pick');
        cell.title = t('clickToUse');
        cell.addEventListener('click', pick(field));
      }
      g.input = el('input', { class: 'oih-input oih-price-input' });
      g.input.addEventListener('input', () => {
        g.manual = true;
        g.price = OIH.Fees.parsePrice(g.input.value);
        g.cells.receive.textContent = g.price ? fmt(OIH.sellerReceives(g.price, g.fee)) : '—';
        recalcTotal();
      });
      tbody.append(el('tr', null,
        el('td', { class: 'oih-name-cell', text: g.displayName }),
        el('td', { text: String(g.items.length) }),
        g.cells.lowest, g.cells.median, g.cells.buy,
        el('td', { class: 'oih-age-cell' }, g.cells.ageText, g.cells.refresh),
        el('td', null, g.input), g.cells.receive));
      fillFromStore(g);
      renderRow(g);
    }

    function applyStrategy() {
      for (const g of rows) {
        g.manual = false;
        renderRow(g);
      }
      recalcTotal();
    }

    let closed = false;
    let stopSelling = false;
    let running = false;

    /** force refetches; otherwise anything younger than the selling freshness is reused. */
    async function loadPrices(list, force) {
      const opts = force ? { force: true, priority: 'high' } : { maxAgeMin: OIH.freshMinutes(), priority: 'high' };
      for (const g of list) {
        if (closed) return;
        if (g.busy) continue;
        g.busy = true;
        renderRow(g);
        try {
          const ov = await OIH.priceOverview(g.appid, g.name, opts);
          g.lowest = ov.lowest;
          g.median = ov.median;
          g.ovAt = ov.fetchedAt || Date.now();
        } catch (e) { /* keep previous values */ }
        if (needHist() || (force && g.histAt)) {
          try {
            const h = await OIH.priceHistogram(g.appid, g.name, opts);
            g.buy = h.highestBuy;
            g.histAt = h.fetchedAt || Date.now();
            if (h.lowestSell != null) g.lowest = h.lowestSell;
          } catch (e) { /* ignore */ }
        }
        g.busy = false;
        renderRow(g);
        recalcTotal();
      }
    }

    const isStale = (g) => {
      const ts = priceTime(g);
      return !ts || Date.now() - ts > freshMs();
    };

    async function start() {
      if (running) return;
      running = true;
      stopSelling = false;
      startBtn.disabled = true;

      // Refresh only stale automatic prices; manual ones are kept.
      const stale = rows.filter((g) => !g.manual && isStale(g));
      if (stale.length) {
        progress.textContent = t('loading');
        await loadPrices(stale, false);
        recalcTotal();
      }

      const jobs = [];
      for (const g of rows) {
        const receive = g.price ? OIH.sellerReceives(g.price, g.fee) : 0;
        for (const it of g.items) if (!isListed(it)) jobs.push({ g, it, receive });
      }
      const valid = jobs.filter((j) => j.receive >= 1);
      if (!valid.length || closed) {
        running = false;
        startBtn.disabled = false;
        progress.textContent = '';
        return;
      }
      const sum = OIH.sum(valid, (j) => j.receive);
      if (OIH.settings.confirmSell &&
        !(await OIH.confirm(t('confirmBulk', valid.length, fmt(OIH.sum(valid, (j) => j.g.price)), fmt(sum))))) {
        running = false;
        startBtn.disabled = false;
        progress.textContent = '';
        return;
      }

      let ok = 0;
      let fail = 0;
      let needConfirm = false;
      for (let i = 0; i < jobs.length; i++) {
        if (stopSelling || closed) break;
        const { g, it, receive } = jobs[i];
        progress.textContent = t('progress', i + 1, jobs.length);
        if (receive < 1) {
          log.prepend(el('div', { class: 'oih-muted', text: `${g.displayName}: ${t('skipNoPrice')}` }));
          continue;
        }
        try {
          const r = await OIH.sellItem(it, receive);
          if (r.requires_confirmation) needConfirm = true;
          ok++;
          markListed(it);
          log.prepend(el('div', { class: 'oih-ok', text: `✔ ${g.displayName} — ${fmt(g.price)} (${fmt(receive)})` }));
        } catch (e) {
          fail++;
          log.prepend(el('div', { class: 'oih-error', text: `✖ ${g.displayName}: ${e.message}` }));
        }
        if (i < jobs.length - 1) await OIH.sleep(Math.max(300, Number(OIH.settings.sellDelayMs) || 1500));
      }
      running = false;
      startBtn.disabled = false;
      progress.textContent = t('done', ok, fail);
      if (needConfirm) OIH.toast(t('needConfirm'), 'success', 10000);
    }

    strategy.addEventListener('change', () => {
      applyStrategy();
      if (needHist()) loadPrices(rows.filter((g) => !g.histAt || Date.now() - g.histAt > freshMs()), false);
    });

    const startBtn = btn(t('start'), start, 'oih-btn-primary');
    const modal = OIH.modal({
      title: t('sellDialog'),
      wide: true,
      body: [
        el('div', { class: 'oih-row' }, el('span', { text: t('strategy') + ':' }), strategy,
          btn(t('apply'), applyStrategy),
          btn('↻ ' + t('refreshAll'), () => loadPrices(rows, true))),
        el('div', { class: 'oih-table-wrap' },
          el('table', { class: 'oih-table' },
            el('thead', null, el('tr', null,
              ...[t('name'), t('count'), t('lowest'), t('median'), t('buyOrder'), t('updated'), t('buyerPays'), t('youReceive')].map((h) => el('th', { text: h })))),
            tbody)),
        el('div', { class: 'oih-row' }, el('span', { text: t('totalReceive') + ':' }), totalEl, progress),
        log
      ],
      footer: [btn(t('stop'), () => { stopSelling = true; }), startBtn]
    });
    const ageTimer = setInterval(() => rows.forEach(renderRow), 30000);
    modal.onClose = () => {
      closed = true;
      clearInterval(ageTimer);
    };
    recalcTotal();
    loadPrices(rows.filter(isStale), false);
  }


  /* ---------------- inventory overview ---------------- */

  async function openOverview() {
    const st = barState;
    if (!st) return OIH.toast(t('error'), 'error');
    const own = isOwn();
    // A price column per enabled source; sorting and the total use the primary one.
    const ids = OIH.enabledSources();
    const pid = primaryId(st);

    const status = el('div', { class: 'oih-muted' });
    const summary = el('div', { class: 'oih-summary' });
    const tbody = el('tbody');
    const search = el('input', { class: 'oih-input', placeholder: t('search') });
    const onlyMkt = el('input', { type: 'checkbox' });
    const sort = el('select', { class: 'oih-input' },
      el('option', { value: 'value', text: t('sortValue') }),
      el('option', { value: 'price', text: t('sortPrice') }),
      el('option', { value: 'count', text: t('sortCount') }),
      el('option', { value: 'name', text: t('sortName') }));
    const loadBtn = btn(t('loadPrices'), onRefreshClick, 'oih-btn-primary');
    const sellBtn = btn(t('sellSelected'), sellChecked, 'oih-btn-primary');
    sellBtn.disabled = !own;

    const priceHeaders = ids.map((id) => el('th', { class: id === pid ? 'oih-th-primary' : '' }, OIH.sourceLink(id, st.appid)));
    const modal = OIH.modal({
      title: t('invTitle'),
      wide: true,
      body: [
        summary,
        el('div', { class: 'oih-row' }, search, el('label', { class: 'oih-check' }, onlyMkt, t('onlyMarketable')), sort,
          loadBtn, btn(t('exportCsv'), exportCsv)),
        status,
        el('div', { class: 'oih-table-wrap oih-table-tall' },
          el('table', { class: 'oih-table' },
            el('thead', null, el('tr', null, el('th'), el('th'),
              el('th', { text: t('name') }), el('th', { text: t('count') }),
              ...priceHeaders,
              el('th', { text: `${t('total')} (${OIH.sourceLabel(pid)})` }), el('th', { text: t('toSell') }))),
            tbody))
      ],
      footer: [sellBtn]
    });

    function statLine(label, value, cls) {
      return el('div', { class: 'oih-stat ' + (cls || '') }, el('span', { class: 'oih-muted', text: label }), el('b', { text: value }));
    }

    function renderSummary() {
      const s = stats(st);
      const valuating = isValuating(st);
      loadBtn.textContent = valuating ? t('stop') : t('loadPrices');
      const lines = [
        statLine(t('items'), String(s.items)),
        statLine(t('unique'), String(s.unique)),
        statLine(t('marketable'), String(s.marketable))
      ];
      for (const id of ids) {
        const x = src(st, id);
        const v = stats(st, id);
        const text = x.status === 'unsupported' ? t('srcUnsupported')
          : x.status === 'error' ? t('error') : `${fmt(v.total, x.currency)}  (${v.priced}/${v.toPrice})`;
        const line = statLine(OIH.sourceLabel(id), text, 'oih-src-stat' + (id === pid ? ' oih-stat-primary' : ''));
        line.firstChild.replaceWith(OIH.sourceLink(id, st.appid, null, 'oih-muted'));
        const [from, to] = updatedRange(id);
        if (from) {
          // Steam prices are fetched per item at different times: show the oldest and the newest.
          line.append(el('span', { class: 'oih-stat-time oih-muted' }, `${t('updated')}: `, OIH.timeEl(from),
            to && to - from > 60000 ? el('span', null, ' … ', OIH.timeEl(to, 'ago')) : null));
        }
        lines.push(line);
      }
      summary.replaceChildren(el('div', { class: 'oih-summary-counts' }, ...lines.slice(0, 3)),
        el('div', { class: 'oih-summary-sources' }, ...lines.slice(3)));
      const steam = st.sources.steam;
      status.textContent = steam && steam.status === 'loading' ? `Steam Market: ${steam.done} / ${steam.todo}` : '';
    }

    const priceIn = (g, id) => src(st, id).prices.get(g.name);
    const priceTs = (g, id) => (id === 'steam' ? (OIH.storedPrice(st.appid, g.name) || {}).ovAt : src(st, id).fetchedAt) || 0;

    function updatedRange(id) {
      if (id !== 'steam') return [src(st, id).fetchedAt || 0, 0];
      let min = Infinity;
      let max = 0;
      for (const g of (st.groups || new Map()).values()) {
        if (priceIn(g, id) === undefined) continue;
        const ts = priceTs(g, id);
        if (!ts) continue;
        min = Math.min(min, ts);
        max = Math.max(max, ts);
      }
      return Number.isFinite(min) ? [min, max] : [0, 0];
    }
    const price = (g) => priceIn(g, pid);

    function render() {
      if (!st.groups) return;
      const q = search.value.trim().toLowerCase();
      const list = [...st.groups.values()];
      const rows = list.filter((g) => (!onlyMkt.checked || g.marketableItems.length) &&
        (!q || g.displayName.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)));
      const val = (g) => (price(g) ? price(g) * groupCount(g) : -1);
      rows.sort({
        value: (a, b) => val(b) - val(a) || groupCount(b) - groupCount(a),
        price: (a, b) => (price(b) || -1) - (price(a) || -1),
        count: (a, b) => groupCount(b) - groupCount(a),
        name: (a, b) => a.displayName.localeCompare(b.displayName)
      }[sort.value]);
      tbody.replaceChildren(...rows.map((g) => {
        if (!g.ovRow || g.ovIds !== ids.join()) {
          g.ovIds = ids.join();
          g.priceCells = ids.map((id) => el('td', { class: id === pid ? 'oih-td-primary' : '' }));
          g.totalCell = el('td');
          const disabled = !own || !g.marketableItems.length;
          const cb = el('input', { type: 'checkbox', disabled, checked: !!g.checked });
          const qty = el('input', { class: 'oih-input oih-qty', type: 'number', min: '0', max: String(g.marketableItems.length), value: String(g.marketableItems.length), disabled });
          cb.addEventListener('change', () => { g.checked = cb.checked; });
          qty.addEventListener('input', () => { g.qty = Math.min(g.marketableItems.length, Math.max(0, parseInt(qty.value, 10) || 0)); });
          g.qty = g.marketableItems.length;
          g.ovRow = el('tr', null,
            el('td', null, cb),
            el('td', null, g.icon ? el('img', { class: 'oih-icon', src: OIH.iconUrl(g.icon, '48fx48f'), loading: 'lazy', alt: '' }) : null),
            el('td', { class: 'oih-name-cell', style: { color: g.color ? '#' + g.color : '' }, text: g.displayName }),
            el('td', { text: String(groupCount(g)) }),
            ...g.priceCells, g.totalCell,
            el('td', null, qty));
        }
        ids.forEach((id, i) => {
          const p = priceIn(g, id);
          const cell = g.priceCells[i];
          if (p === undefined) {
            cell.replaceChildren();
            cell.dataset.k = '';
            return;
          }
          const x = src(st, id);
          const ts = priceTs(g, id);
          const text = p === null ? '—' : fmt(p, x.currency);
          const k = text + '|' + ts;
          if (cell.dataset.k === k) return;
          cell.dataset.k = k;
          // The price links to the item on the source site; the tooltip says when it was fetched.
          const a = OIH.priceLink(id, st.appid, g.name, text, x.urls && x.urls.get(g.name));
          a.title = [OIH.sourceLabel(id), ts ? `${t('updated')}: ${OIH.when(ts)}` : '', OIH.rateNote(x.converted)].filter(Boolean).join(' · ');
          cell.replaceChildren(a);
        });
        const p = price(g);
        g.totalCell.textContent = p ? fmt(p * groupCount(g), src(st, pid).currency) : '';
        return g.ovRow;
      }));
    }

    function sellChecked() {
      const chosen = [];
      for (const g of st.groups.values()) {
        if (!g.checked || !g.qty) continue;
        chosen.push(...g.marketableItems.filter((it) => !isListed(it)).slice(0, g.qty));
      }
      if (!chosen.length) return;
      modal.close();
      openSellDialog(chosen);
    }

    function exportCsv() {
      if (!st.groups) return;
      const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
      const head = ['market_hash_name', 'name', 'count', 'marketable'];
      for (const id of ids) head.push(`${id}_price`, `${id}_currency`);
      const lines = [head.join(',')];
      for (const g of st.groups.values()) {
        const row = [esc(g.name), esc(g.displayName), groupCount(g), g.marketableItems.length];
        for (const id of ids) {
          const p = priceIn(g, id);
          row.push(p ? (p / 100).toFixed(2) : '', src(st, id).currency);
        }
        lines.push(row.join(','));
      }
      OIH.downloadText(`inventory_${st.steamid}_${st.appid}_${st.contextid}.csv`, lines.join('\n'));
    }

    let renderTimer = null;
    const onUpdate = () => {
      renderSummary();
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, 400);
    };
    st.listeners.add(onUpdate);
    modal.onClose = () => st.listeners.delete(onUpdate);
    search.addEventListener('input', render);
    onlyMkt.addEventListener('change', render);
    sort.addEventListener('change', render);

    renderSummary();
    status.textContent = t('loading');
    try {
      await ensureLoaded(st);
    } catch (e) {
      status.textContent = t('error') + ': ' + e.message;
      return;
    }
    renderSummary();
    render();
  }
})();
