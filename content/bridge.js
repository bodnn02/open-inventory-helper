/*
 * Bridge between page scripts (world: MAIN) and the extension. MAIN-world scripts
 * see Steam globals (g_sessionID, g_ActiveInventory, ...) but not chrome.*; the bridge
 * forwards a short list of safe methods to the service worker.
 */
(() => {
  'use strict';
  if (window.__oihBridge) return;
  window.__oihBridge = true;

  // Read-only methods: any page script can dispatch these events.
  const ALLOWED = new Set([
    'settings.get', 'price.overview', 'price.histogram', 'price.bulk', 'item.classinfo', 'rates.get',
    'wallet.remember', 'wallet.get', 'queue.size'
  ]);

  // Open while the page lives: when it closes, the service worker drops this page's queued requests.
  let port = null;
  function keepPort() {
    if (port) return;
    port = chrome.runtime.connect({ name: 'oih-page' });
    port.onDisconnect.addListener(() => { port = null; });
  }

  function reply(id, payload) {
    document.dispatchEvent(new CustomEvent('oih:res', { detail: JSON.stringify(Object.assign({ id }, payload)) }));
  }

  document.addEventListener('oih:req', (e) => {
    let msg;
    try {
      msg = JSON.parse(e.detail);
    } catch (err) {
      return;
    }
    if (!msg || typeof msg.id !== 'number' || !ALLOWED.has(msg.method)) return;
    try {
      keepPort();
      chrome.runtime.sendMessage({ method: msg.method, params: msg.params || {} })
        .then((res) => reply(msg.id, res || { error: 'empty response' }))
        .catch((err) => reply(msg.id, { error: String(err?.message || err) }));
    } catch (err) {
      reply(msg.id, { error: 'Extension was reloaded — refresh the page' });
    }
  });

  // A same-site request carries the session even when the background one is rejected,
  // so pages report the incoming offers count (at most once a minute).
  async function reportTrades() {
    try {
      const { tradeReport } = await chrome.storage.local.get('tradeReport');
      if (tradeReport && Date.now() - tradeReport.at < 60000) return;
      const res = await fetch(location.origin + '/actions/GetNotificationCounts', { credentials: 'include' });
      let report = null;
      if (res.ok) {
        const data = await res.json();
        const n = Number(data && data.notifications && data.notifications['1']);
        if (Number.isFinite(n)) report = { loggedIn: true, count: n };
      } else if (res.status === 401 && document.querySelector('#global_action_menu a[href*="/login"]')) {
        report = { loggedIn: false };
      }
      if (report) chrome.runtime.sendMessage({ method: 'trades.report', params: report });
    } catch (e) { /* offline or extension reloaded */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reportTrades, { once: true });
  else reportTrades();

  // Sync area only: local changes carry whole marketplace price lists.
  chrome.storage.sync.onChanged.addListener((changes) => {
    if (changes.settings) {
      document.dispatchEvent(new CustomEvent('oih:settings', {
        detail: JSON.stringify(changes.settings.newValue || {})
      }));
    }
  });
})();
