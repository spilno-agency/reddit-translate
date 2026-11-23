// Reddit Chat: hover a message → translate icon → translation appears right under that message.
// Chat is built from closed shadow-DOM components we can't target by class, so messages are found by
// shape: the biggest element under the pointer that still holds the same, reasonably short text.
(() => {
  'use strict';

  const MAX_LEN = 3000;
  const SKIP = 'input, textarea, select, button, [contenteditable="true"], [role="textbox"]';
  const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const settings = { chatTranslate: true, targetLang: 'uk', autoTranslate: false };
  const panels = new WeakMap(); // message element -> translation panel

  let current = null; // message element the icon belongs to
  let hideTimer = 0;
  const icon = buildIcon();

  function buildIcon() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rt-ui';
    btn.innerHTML = RT.ICON;
    btn.title = RTI.t('btn.translateMessage');
    btn.setAttribute('aria-label', btn.title);
    btn.style.cssText = 'position:fixed;z-index:2147483646;display:none;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:50%;background:#0a66c2;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.25);cursor:pointer;';
    RT.onActivate(btn, () => current && toggleTranslation(current));
    btn.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    document.documentElement.append(btn);
    RTI.onChange(() => { btn.title = RTI.t('btn.translateMessage'); btn.setAttribute('aria-label', btn.title); });
    return btn;
  }

  /** The message block under the pointer, or null. */
  function messageFrom(path) {
    if (path.some((n) => n instanceof Element && (n.classList.contains('rt-ui') || n.matches(SKIP)))) return null;
    let el = path.find((n) => n instanceof HTMLElement && normalize(n.innerText));
    if (!el) return null;
    const text = normalize(el.innerText);
    while (el.parentElement && normalize(el.parentElement.innerText) === text) el = el.parentElement;
    const rect = el.getBoundingClientRect();
    if (text.length > MAX_LEN || rect.height > innerHeight * 0.6 || rect.width < 20) return null;
    return el;
  }

  function showIcon(el) {
    clearTimeout(hideTimer);
    current = el;
    const rect = el.getBoundingClientRect();
    icon.style.top = `${Math.round(Math.max(4, rect.top + rect.height / 2 - 14))}px`;
    icon.style.left = `${Math.round(Math.min(rect.right + 6, innerWidth - 34))}px`;
    icon.style.display = 'inline-flex';
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { icon.style.display = 'none'; current = null; }, 600);
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.className = 'rt-ui';
    RT.fillCard(panel, RTI.t('card.translating'), '');
    return panel;
  }

  /** True when the panel really sits under the message — not beside it as a stretched column. */
  function isBelow(panel, el) {
    const p = panel.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    return p.height > 0 && p.top >= e.bottom - 4 && p.left < e.right && p.right > e.left;
  }

  /** Insert the panel after the message; if the layout puts it anywhere but below, try one level up, else give up. */
  function placePanel(panel, el) {
    el.after(panel);
    if (isBelow(panel, el)) return true;
    const parent = el.parentElement;
    if (parent) {
      parent.after(panel);
      if (isBelow(panel, parent)) return true;
    }
    panel.remove();
    return false;
  }

  /** Translation goes right after the message, inside the same component (textContent only — no markup). */
  async function toggleTranslation(el) {
    const existing = panels.get(el);
    if (existing?.isConnected) {
      existing.style.display = existing.style.display === 'none' ? '' : 'none';
      return;
    }
    const text = el.innerText.trim();
    const panel = buildPanel();
    if (!placePanel(panel, el)) return;
    panels.set(el, panel);
    const res = await RT.translate(text, settings.targetLang);
    if (!res.ok) RT.fillCard(panel, RTI.t('card.failed'), res.error, true);
    else if (!res.translated) RT.fillCard(panel, RTI.t('card.already', { lang: RT.langName(res.detected) }), '');
    else RT.fillCard(panel, `${RT.langName(res.detected || 'und')} → ${RT.langName(settings.targetLang)}`, res.translated);
  }

  // ---------- "Translate everything" in chat: visible messages get translated on their own ----------
  const AUTO_MIN_LEN = 12;
  const AUTO_PARALLEL = 2;
  const SCAN_EVERY_MS = 1500;
  const autoDone = new WeakSet();
  const cache = new Map(); // "lang|text" -> translated text ('' = nothing to show)
  const queue = [];
  let running = 0;

  /** Open shadow roots that belong to the chat (the popup or the full chat page). */
  function chatRoots() {
    const all = [document];
    for (let i = 0; i < all.length; i += 1) {
      const start = all[i] === document ? document.documentElement : all[i];
      const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.shadowRoot) all.push(n.shadowRoot);
    }
    return RT.inChat() ? all : all.filter((r) => r !== document && RT.isChatElement(r.host));
  }

  /** Skip room-list previews ("Yes o…"), links, buttons and anything truncated to one line. */
  function isMessageLike(el, text) {
    if (text.length < AUTO_MIN_LEN || !/\s/.test(text)) return false;
    if (el.closest('a[href], button, [role="link"], [role="option"], .rt-ui') || el.closest(SKIP)) return false;
    if (el.closest('shreddit-post, shreddit-comment, [data-rt-done], .thing')) return false; // posts/comments have their own translator
    // Room titles and headers are not messages.
    if (el.closest('h1, h2, h3, h4, h5, h6, header, [role="heading"], [role="banner"], [role="tab"]')) return false;
    // In a row-flex container the translation would become a stretched side column — skip such spots.
    const parentStyle = el.parentElement && getComputedStyle(el.parentElement);
    if (parentStyle && parentStyle.display.includes('flex') && !parentStyle.flexDirection.startsWith('column')) return false;
    for (const node of [el, el.parentElement].filter(Boolean)) {
      const style = getComputedStyle(node);
      if (style.textOverflow === 'ellipsis' || style.whiteSpace === 'nowrap') return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.height > 0 && rect.bottom > -300 && rect.top < innerHeight + 300;
  }

  function findChatMessages() {
    const found = new Set();
    for (const root of chatRoots()) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const parent = t.parentElement;
        if (!parent || !normalize(t.data) || autoDone.has(parent)) continue;
        let el = parent;
        const text = normalize(el.innerText);
        while (el.parentElement && normalize(el.parentElement.innerText) === text) el = el.parentElement;
        if (!autoDone.has(el) && isMessageLike(el, text)) found.add(el);
      }
    }
    return found;
  }

  async function autoTranslate(el) {
    const text = el.innerText.trim();
    const key = `${settings.targetLang}|${text}`;
    if (!cache.has(key)) {
      const res = await RT.translate(text, settings.targetLang);
      const useful = res.ok && res.translated && normalize(res.translated) !== normalize(text);
      cache.set(key, useful ? res.translated : '');
    }
    const translated = cache.get(key);
    if (!translated || !el.isConnected || panels.get(el)?.isConnected) return;
    const panel = buildPanel();
    RT.fillCard(panel, `→ ${RT.langName(settings.targetLang)}`, translated);
    if (placePanel(panel, el)) panels.set(el, panel);
  }

  function pump() {
    while (running < AUTO_PARALLEL && queue.length) {
      const el = queue.shift();
      running += 1;
      autoTranslate(el).catch(() => {}).finally(() => { running -= 1; pump(); });
    }
  }

  function scanChatForAuto() {
    if (!settings.autoTranslate || !settings.chatTranslate) return;
    for (const el of findChatMessages()) {
      autoDone.add(el);
      queue.push(el);
    }
    pump();
  }

  setInterval(scanChatForAuto, SCAN_EVERY_MS);

  document.addEventListener('pointerover', (e) => {
    if (!settings.chatTranslate) return;
    const path = e.composedPath();
    if (path.includes(icon)) return;
    if (!RT.isChatPath(path)) { if (current) scheduleHide(); return; }
    const el = messageFrom(path);
    if (el) showIcon(el);
    else scheduleHide();
  }, true);

  addEventListener('scroll', () => { icon.style.display = 'none'; }, true);

  chrome.storage.sync.get(settings, (s) => Object.assign(settings, s));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const key of Object.keys(settings)) if (changes[key]) settings[key] = changes[key].newValue;
    if (!settings.chatTranslate) icon.style.display = 'none';
  });
})();
