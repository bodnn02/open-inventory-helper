/*
 * Steam Store: historical lows and price history inside the Steam layout.
 *  - purchase blocks (game, packages, bundles): the low next to the current price,
 *    or a "Historical low right now" label above the title;
 *  - DLC rows: a compact low next to the price;
 *  - hovering a price opens the history chart (with an IsThereAnyDeal key) and details.
 *
 * Data: Augmented Steam API (lows, no key) and IsThereAnyDeal (chart, user key).
 */
(async () => {
  'use strict';
  if (window.__oihStore) return;
  window.__oihStore = true;

  const Fees = globalThis.OIHFees;
  let settings;
  try {
    settings = globalThis.OIHSettings.merge((await chrome.storage.sync.get('settings')).settings);
  } catch (e) {
    return;
  }
  if (!settings.storeHistory) return;

  const lang = settings.lang === 'ru' || settings.lang === 'en' ? settings.lang
    : ((navigator.language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en');
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  const STR = {
    ru: {
      histLow: 'Исторический минимум', atLow: 'Сейчас исторический минимум', low: 'мин.', atLowShort: 'ист. минимум',
      now: 'Сейчас', regular: 'Обычная цена', lowest: 'Исторический минимум', history: 'История цен',
      openHistory: 'Вся история на IsThereAnyDeal', loading: 'Загрузка истории…', cut: 'скидка {0}%',
      needKey: 'График истории появится, если добавить свой бесплатный ключ IsThereAnyDeal в настройках расширения.',
      noPermission: 'Нет разрешения на IsThereAnyDeal — сохраните ключ в настройках расширения ещё раз.',
      error: 'Не удалось загрузить историю', noHistory: 'История недоступна',
      source: 'Данные: IsThereAnyDeal (минимумы — через Augmented Steam API)', changes: 'изменений цены: {0}',
      regional: '≈ IsThereAnyDeal ведёт ваш регион в {0}, поэтому цены рассчитаны от обычной цены на странице с теми же скидками',
      converted: '≈ пересчитано из {0} по курсу 1 {0} = {1}: IsThereAnyDeal ведёт цены для вашего региона в {0}',
      otherCurrency: 'IsThereAnyDeal ведёт цены для вашего региона в {0}; включите конвертацию валют в настройках, чтобы видеть их в {1}'
    },
    en: {
      histLow: 'Historical low', atLow: 'Historical low right now', low: 'low', atLowShort: 'historical low',
      now: 'Now', regular: 'Regular price', lowest: 'Historical low', history: 'Price history',
      openHistory: 'Full history on IsThereAnyDeal', loading: 'Loading history…', cut: '{0}% off',
      needKey: 'Add your free IsThereAnyDeal API key in the extension settings to see the price history chart.',
      noPermission: 'No permission for IsThereAnyDeal — save the key in the extension settings again.',
      error: 'Could not load the history', noHistory: 'No history available',
      source: 'Data: IsThereAnyDeal (lows via Augmented Steam API)', changes: '{0} price changes',
      regional: '≈ IsThereAnyDeal tracks your region in {0}, so prices are derived from the regular price on this page with the same discounts',
      converted: '≈ converted from {0} at 1 {0} = {1}: IsThereAnyDeal tracks your region in {0}',
      otherCurrency: 'IsThereAnyDeal tracks your region in {0}; enable currency conversion in the settings to see {1}'
    }
  };
  const t = (k, ...a) => (STR[lang][k] || STR.en[k] || k).replace(/\{(\d+)\}/g, (_, i) => (a[i] !== undefined ? a[i] : ''));
  // Prices in the page currency are written exactly like Steam writes them ("1 537₴", "19,99€").
  const fmt = (cents, cur) => (cur && cur === pageCur && pageStyle && Number.isFinite(cents)
    ? steamFormat(cents, pageStyle) : Fees.formatPrice(cents, cur, locale));
  const date = (ts) => new Date(ts).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : String(c));
    return n;
  }
  const svg = (tag, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    return n;
  };
  const send = (method, params) => chrome.runtime.sendMessage({ method, params })
    .then((r) => (r && r.ok ? r.data : Promise.reject(new Error((r && r.error) || 'error'))));

  // Store currency of the page; data-price-final is in its minor units.
  const pageCur = ((document.querySelector('meta[itemprop="priceCurrency"]') || {}).content || '').toUpperCase() || null;

  /*
   * Learns Steam's price format from price texts on the page: prefix/suffix symbol,
   * thousands and decimal separators, and whether whole amounts keep decimals.
   */
  function learnStyle(samples) {
    let style = null;
    for (const raw of samples) {
      const m = String(raw || '').trim().match(/^(\D*?)(\d[\d\s.,  ]*\d|\d)(\D*)$/);
      if (!m || (style && (m[1] !== style.prefix || !m[3].endsWith(style.suffix)))) continue;
      const st = style || { prefix: m[1], suffix: m[3], thou: null, dec: null, decimals: false, dashes: false };
      let num = m[2];
      const dash = st.suffix.match(/^([.,])--/);
      if (dash) {
        st.dec = dash[1];
        st.dashes = true;
        st.suffix = st.suffix.slice(3);
      }
      const d = num.match(/([.,])(\d{2})$/);
      if (d) {
        st.dec = d[1];
        st.decimals = true;
        num = num.slice(0, -3);
      }
      const t = num.match(/\D/);
      if (t) st.thou = t[0];
      style = st;
    }
    if (!style) return null;
    if (!style.thou) style.thou = style.dec === '.' ? ',' : style.dec === ',' ? ' ' : ' ';
    if (!style.dec) style.dec = style.thou === ',' ? '.' : ',';
    return style;
  }

  function steamFormat(cents, s) {
    const abs = Math.abs(Math.round(cents));
    const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, s.thou);
    const frac = abs % 100;
    const tail = frac ? s.dec + String(frac).padStart(2, '0') : s.dashes ? s.dec + '--' : s.decimals ? s.dec + '00' : '';
    return (cents < 0 ? '−' : '') + s.prefix + whole + tail + s.suffix;
  }

  let pageStyle = null;

  let country = 'US';
  try {
    country = JSON.parse(document.getElementById('application_config').dataset.config).COUNTRY || 'US';
  } catch (e) { /* US */ }

  /* ---------------- page targets ---------------- */

  const cleanTitle = (s) => (s || '').replace(/\s+/g, ' ').trim();

  /** DLC name without Steam's highlight labels ("Recommended", ...). */
  function dlcName(row) {
    const n = row.querySelector('.game_area_dlc_name');
    if (!n) return '';
    const copy = n.cloneNode(true);
    copy.querySelectorAll('.dlc_highlight_reason_container').forEach((x) => x.remove());
    return cleanTitle(copy.textContent);
  }

  /** Regular (undiscounted) price shown on the page, in minor units. */
  function regularPrice(box, final) {
    const orig = box.querySelector('.discount_original_price');
    const parsed = orig && Fees.parsePrice(orig.textContent);
    if (parsed) return parsed;
    const pct = parseInt((box.matches('[data-discount]') ? box : box.querySelector('[data-discount]') || box).dataset.discount, 10);
    if (pct > 0 && pct < 100 && Number.isFinite(final)) return Math.round(final / (1 - pct / 100));
    return final;
  }

  function collectTargets() {
    const targets = [];
    for (const block of document.querySelectorAll('.game_area_purchase_game')) {
      if (block.dataset.oihSh) continue;
      const sub = block.querySelector('input[name="subid"]');
      const bundle = block.querySelector('input[name="bundleid"]') ||
        (block.closest('[data-ds-bundleid]') && { value: block.closest('[data-ds-bundleid]').dataset.dsBundleid });
      const id = sub ? `sub/${sub.value}` : bundle ? `bundle/${bundle.value}` : null;
      const priceNode = block.querySelector('.discount_block[data-price-final], .game_purchase_price[data-price-final]');
      if (!id || !priceNode) continue;
      const price = parseInt(priceNode.dataset.priceFinal, 10);
      targets.push({
        kind: 'block', id, node: block, hover: priceNode, price,
        regular: regularPrice(priceNode, price),
        priceText: cleanTitle((priceNode.querySelector('.discount_final_price') || priceNode).textContent),
        title: cleanTitle((block.querySelector('h2.title, h1, .game_area_purchase_game_title') || {}).textContent)
      });
    }
    for (const row of document.querySelectorAll('.game_area_dlc_row[data-ds-appid]')) {
      if (row.dataset.oihSh) continue;
      const priceBox = row.querySelector('.game_area_dlc_price');
      if (!priceBox) continue;
      const finalNode = priceBox.querySelector('[data-price-final]');
      const price = finalNode ? parseInt(finalNode.dataset.priceFinal, 10)
        : Fees.parsePrice((priceBox.querySelector('.discount_final_price') || priceBox).textContent);
      if (!price) continue; // free
      targets.push({
        kind: 'dlc', id: `app/${row.dataset.dsAppid}`, node: row, hover: priceBox, price,
        regular: regularPrice(priceBox, price),
        priceText: cleanTitle((priceBox.querySelector('.discount_final_price') || priceBox).textContent),
        title: dlcName(row)
      });
    }
    return targets;
  }

  /* ---------------- currency ---------------- */

  let ratesPromise = null;
  function rates() {
    if (!ratesPromise) ratesPromise = send('rates.get', { to: pageCur }).then((r) => r.rates).catch(() => null);
    return ratesPromise;
  }

  /*
   * IsThereAnyDeal tracks some regions in another currency (e.g. Ukraine in USD), and those
   * prices are a different regional price list, so an exchange rate gives nonsense (a "low"
   * above the current price). Steam discounts are the same percentage in every region, so
   * a price is re-derived as pageRegular × price / regular. The exchange rate is only a
   * fallback when the page has no regular price.
   */
  async function normalize(target, info) {
    if (!info || !info.lowest || info.lowest.p == null) return null;
    const src = (info.current && info.current.cur) || info.lowest.cur || pageCur;
    const out = Object.assign({}, info, { cur: src, mode: 'same', from: src });
    out.lowest = Object.assign({}, info.lowest);
    out.current = info.current ? Object.assign({}, info.current) : null;
    out.map = (p, r) => p;
    if (pageCur && src && src !== pageCur) {
      const itadRegular = (info.current && info.current.r) || info.lowest.r;
      if (target.regular > 0 && itadRegular > 0) {
        out.mode = 'regional';
        out.map = (p, r) => Math.round(target.regular * p / (r > 0 ? r : itadRegular));
      } else if (settings.convertCurrency !== false) {
        const map = await rates();
        const rate = map && map[src];
        if (rate) {
          out.mode = 'fx';
          out.rate = rate;
          out.map = (p) => Math.round(p * rate);
        }
      }
      if (out.mode === 'same') {
        out.mode = 'foreign';
      } else {
        out.cur = pageCur;
        for (const o of [out.lowest, out.current]) {
          if (!o) continue;
          const r = o.r;
          if (o.p != null) o.p = out.map(o.p, r);
          if (r != null) o.r = out.map(r, r);
        }
      }
    }
    // The page price is the truth: below the recorded low means a new low.
    if (out.mode !== 'foreign' && Number.isFinite(target.price) && target.price < out.lowest.p) {
      out.lowest = { p: target.price, r: target.regular, c: target.regular > target.price ? Math.round((1 - target.price / target.regular) * 100) : 0, t: Date.now() };
    }
    return out;
  }

  const approx = (info) => (info.mode === 'regional' || info.mode === 'fx' ? '≈ ' : '');

  function noteText(info) {
    if (info.mode === 'regional') return t('regional', info.from);
    if (info.mode === 'fx') return t('converted', info.from, fmt(Math.round(info.rate * 100), pageCur));
    if (info.mode === 'foreign') return t('otherCurrency', info.from, pageCur);
    return '';
  }

  /** Discounted now and not above the low; a game that was never discounted is not flagged. */
  function isAtLow(target, info) {
    if (info.mode === 'foreign') return !!(info.current && info.current.c > 0 && info.current.p <= info.lowest.p);
    if (!Number.isFinite(target.price) || !(target.regular > target.price)) return false;
    // Derived prices may be off by rounding.
    const slack = info.mode === 'same' ? 0 : Math.max(1, Math.round(info.lowest.p * 0.01));
    return target.price <= info.lowest.p + slack;
  }

  /* ---------------- markup inside Steam ---------------- */

  function annotate(target, info) {
    target.node.dataset.oihSh = '1';
    if (!info) return;
    const low = info.lowest;
    const cur = info.cur;
    const atLow = isAtLow(target, info);
    const lowText = approx(info) + fmt(low.p, cur);

    if (target.kind === 'block') {
      if (atLow) {
        const title = target.node.querySelector('h2.title, h1, .game_area_purchase_game_title');
        const flag = el('div', { class: 'oih-sh-flagline' }, el('span', { class: 'oih-sh-flag', text: t('atLow') }));
        bindHover(flag.firstChild, target, info);
        if (title) title.before(flag);
        else target.node.prepend(flag);
      }
      // A separate black bar left of Steam's price bar, like Steam's own "Bundle info".
      const tag = el('div', { class: 'oih-sh-low' },
        el('div', { class: 'oih-sh-low-label', text: t('histLow') }),
        el('div', { class: 'oih-sh-low-price' }, lowText, low.c ? el('span', { class: 'oih-sh-cut', text: ` −${low.c}%` }) : null));
      bindHover(tag, target, info);
      const bar = target.hover.closest('.game_purchase_action_bg');
      if (bar) bar.before(el('div', { class: 'game_purchase_action_bg oih-sh-lowbar' }, tag));
      else target.hover.before(tag);
    } else {
      const tag = el('span', { class: 'oih-sh-dlc' + (atLow ? ' oih-sh-dlc-low' : '') },
        atLow ? t('atLowShort') : `${t('low')} ${lowText}`);
      target.hover.prepend(tag);
    }
    bindHover(target.hover, target, info);
  }

  /* ---------------- history popup ---------------- */

  const pop = el('div', { class: 'oih-sh-pop', role: 'dialog' });
  document.body.append(pop);
  let hideTimer = null;
  let showTimer = null;
  let activeKey = null;
  const historyCache = new Map(); // itadId -> Promise<{points}|{error}>

  pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  pop.addEventListener('mouseleave', () => scheduleHide());

  function scheduleHide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      pop.classList.remove('oih-sh-open');
      activeKey = null;
    }, 200);
  }

  function bindHover(node, target, info) {
    node.classList.add('oih-sh-target');
    node.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      clearTimeout(showTimer);
      showTimer = setTimeout(() => open(node, target, info), 120);
    });
    node.addEventListener('mouseleave', scheduleHide);
  }

  function position(anchor) {
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, document.documentElement.clientWidth - w - 8));
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 8 && r.top - h - 8 > 0) top = r.top - h - 8;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  function stat(label, value, sub) {
    return el('div', { class: 'oih-sh-stat' }, el('span', { class: 'oih-sh-muted', text: label }), el('b', { text: value }),
      sub ? el('span', { class: 'oih-sh-muted oih-sh-sub', text: sub }) : null);
  }

  function open(anchor, target, info) {
    const key = target.id;
    if (activeKey === key && pop.classList.contains('oih-sh-open')) return position(anchor);
    activeKey = key;
    const low = info.lowest;
    const cur = info.cur;
    const chartBox = el('div', { class: 'oih-sh-chartbox' });
    const nowText = pageCur && Number.isFinite(target.price) ? fmt(target.price, pageCur) : target.priceText;
    const nowCut = target.regular > target.price ? Math.round((1 - target.price / target.regular) * 100) : 0;
    // The regular price on the page is exact; the ITAD one may be derived.
    const regularText = info.mode !== 'foreign' && target.regular > 0 ? fmt(target.regular, pageCur || cur)
      : ((info.current && info.current.r) || low.r) ? approx(info) + fmt((info.current && info.current.r) || low.r, cur) : null;
    const note = noteText(info);

    pop.replaceChildren(
      el('div', { class: 'oih-sh-head', text: target.title || t('history') }),
      chartBox,
      el('div', { class: 'oih-sh-stats' },
        stat(t('now'), nowText, nowCut ? t('cut', nowCut) : ''),
        stat(t('lowest'), approx(info) + fmt(low.p, cur), [low.t ? date(low.t) : '', low.c ? `−${low.c}%` : ''].filter(Boolean).join(' · ')),
        regularText ? stat(t('regular'), regularText) : null),
      note ? el('div', { class: 'oih-sh-note', text: note }) : '', // replaceChildren would print null
      el('div', { class: 'oih-sh-sources' },
        info.historyUrl ? el('a', { href: info.historyUrl, target: '_blank', rel: 'noopener noreferrer', text: t('openHistory') }) : null,
        el('span', { class: 'oih-sh-muted', text: t('source') })));
    pop.classList.add('oih-sh-open');
    position(anchor);
    fillChart(chartBox, target, info, anchor);
  }

  function fillChart(box, target, info, anchor) {
    if (!settings.itadKey) {
      box.replaceChildren(el('div', { class: 'oih-sh-hint', text: t('needKey') }));
      return;
    }
    if (!info.itadId) {
      box.replaceChildren(el('div', { class: 'oih-sh-hint', text: t('noHistory') }));
      return;
    }
    box.replaceChildren(el('div', { class: 'oih-sh-empty', text: t('loading') }));
    if (!historyCache.has(info.itadId)) {
      historyCache.set(info.itadId, send('store.history', { itadId: info.itadId, country }).catch((e) => ({ error: e.message })));
    }
    historyCache.get(info.itadId).then((h) => {
      if (activeKey !== target.id) return;
      if (h.error) {
        historyCache.delete(info.itadId);
        box.replaceChildren(el('div', { class: 'oih-sh-hint', text: h.error === 'no-permission' ? t('noPermission') : `${t('error')}: ${h.error}` }));
      } else if (!h.points || !h.points.length) {
        box.replaceChildren(el('div', { class: 'oih-sh-hint', text: t('noHistory') }));
      } else {
        const pts = info.mode === 'same' || info.mode === 'foreign' ? h.points
          : h.points.map((p) => ({ t: p.t, p: info.map(p.p, p.r), r: p.r == null ? p.r : info.map(p.r, p.r), c: p.c }));
        box.replaceChildren(chart(pts, info.mode === 'foreign' ? null : target.price, info.lowest, info.cur),
          el('div', { class: 'oih-sh-muted oih-sh-sub', text: t('changes', h.points.length) }));
      }
      position(anchor);
    });
  }

  /** Step chart of the price with the regular price, the low line and a date:price tooltip. */
  function chart(points, price, low, cur) {
    const W = 440;
    const H = 150;
    const pad = { l: 8, r: 8, t: 10, b: 18 };
    const pts = points.slice().sort((a, b) => a.t - b.t);
    const t0 = pts[0].t;
    const t1 = Math.max(Date.now(), pts[pts.length - 1].t + 1);
    const maxP = Math.max(...pts.map((p) => Math.max(p.p, p.r || 0)), price || 0, 1) * 1.08;
    const x = (ts) => pad.l + ((ts - t0) / (t1 - t0)) * (W - pad.l - pad.r);
    const y = (v) => pad.t + (1 - v / maxP) * (H - pad.t - pad.b);
    const step = (key) => {
      let d = '';
      pts.forEach((p, i) => {
        const v = p[key] || p.p;
        d += i === 0 ? `M${x(p.t)},${y(v)}` : `H${x(p.t)}V${y(v)}`;
      });
      return d + `H${x(t1)}`;
    };
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'oih-sh-chart', role: 'img' });
    root.append(
      svg('path', { d: step('p') + `V${y(0)}H${x(t0)}Z`, class: 'oih-sh-area' }),
      svg('path', { d: step('r'), class: 'oih-sh-regular' }),
      svg('path', { d: step('p'), class: 'oih-sh-pline' }));
    if (low && low.p != null) root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(low.p), y2: y(low.p), class: 'oih-sh-lowline' }));
    if (price) root.append(svg('circle', { cx: x(t1), cy: y(price), r: 3.5, class: 'oih-sh-dot' }));
    const lbl = (tx, ts, anchor) => {
      const n = svg('text', { x: tx, y: H - 4, 'text-anchor': anchor, class: 'oih-sh-axis' });
      n.textContent = date(ts);
      return n;
    };
    root.append(lbl(pad.l, t0, 'start'), lbl(W - pad.r, t1, 'end'));
    const guide = svg('line', { y1: pad.t, y2: H - pad.b, class: 'oih-sh-guide', visibility: 'hidden' });
    const tip = el('div', { class: 'oih-sh-tip' });
    root.append(guide);
    root.addEventListener('mousemove', (e) => {
      const box = root.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * W;
      const ts = t0 + ((px - pad.l) / (W - pad.l - pad.r)) * (t1 - t0);
      let p = pts[0];
      for (const q of pts) if (q.t <= ts) p = q;
      guide.setAttribute('x1', px);
      guide.setAttribute('x2', px);
      guide.setAttribute('visibility', 'visible');
      tip.textContent = `${date(Math.min(Math.max(ts, t0), t1))}: ${fmt(p.p, cur)}${p.c ? ` (−${p.c}%)` : ''}`;
      tip.style.display = 'block';
      tip.style.left = `${Math.min(Math.max((px / W) * 100, 12), 78)}%`;
    });
    root.addEventListener('mouseleave', () => {
      guide.setAttribute('visibility', 'hidden');
      tip.style.display = 'none';
    });
    return el('div', { class: 'oih-sh-chartwrap' }, root, tip);
  }

  /* ---------------- run ---------------- */

  async function run() {
    const targets = collectTargets();
    if (!targets.length) return;
    if (!pageStyle) pageStyle = learnStyle(targets.map((x) => x.priceText));
    let data = {};
    try {
      data = await send('store.prices', { country, ids: targets.map((x) => x.id).join(',') });
    } catch (e) {
      return;
    }
    for (const target of targets) annotate(target, await normalize(target, data[target.id]));
  }

  await run();
  // DLC lists and purchase blocks may render late.
  setTimeout(run, 2500);
})();
