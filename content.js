(() => {
  'use strict';

  // Text blocks that get a translate button: new Reddit (shreddit) and old.reddit.com.
  // Order matters: for each post/comment only the first match gets a button.
  const BODY_SELECTORS = [
    'shreddit-comment [slot="comment"]',
    '[id$="-comment-rtjson-content"]',
    'shreddit-post [slot="text-body"]',
    'shreddit-post-text-body',
    '[id$="-post-rtjson-content"]',
    '.thing .entry .usertext-body > .md',
  ];
  // Posts with no text (link, image, video) are translated by their title instead.
  const TITLE_SELECTORS = ['shreddit-post [slot="title"]', '.thing.link .entry p.title'];
  const POST_TEXT_SEL = '[slot="text-body"], shreddit-post-text-body, [id$="-post-rtjson-content"], .usertext-body';
  // Inline styles too: the button/panel may end up inside Reddit's shadow DOM where content.css doesn't apply.
  const INLINE = {
    btn: 'display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:none;border-radius:50%;background:transparent;color:inherit;cursor:pointer;vertical-align:middle;',
    panel: 'margin-top:4px;padding:8px 12px;border-left:3px solid #0a66c2;border-radius:6px;background:rgba(10,102,194,.08);font-size:14px;line-height:1.5;',
    meta: 'font-size:12px;opacity:.7;margin-bottom:4px;',
    text: 'white-space:pre-wrap;overflow-wrap:anywhere;',
  };
  const DONE_ATTR = 'data-rt-done';
  const { ICON, langName, sameLang } = RT;
  const CLOSE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

  const settings = { targetLang: 'uk', showButtons: true, selectionTranslate: true, autoTranslate: false };
  const MAX_PARALLEL = 3;
  const originalText = new WeakMap();
  const requestTranslation = (text) => RT.translate(text, settings.targetLang);

  /** Build the translation block; textContent only, never innerHTML, so page text can't inject markup. */
  function renderResult(panel, res) {
    if (!res.ok) RT.fillCard(panel, RTI.t('card.failed'), res.error, true);
    else if (sameLang(res.detected, settings.targetLang)) RT.fillCard(panel, RTI.t('card.already', { lang: langName(res.detected) }), '');
    else RT.fillCard(panel, `${langName(res.detected || 'und')} → ${langName(settings.targetLang)}`, res.translated);
  }

  /** A part (title or text) worth showing: translated and not already in the reading language. */
  const isUseful = (res) => Boolean(res?.ok && res.translated && !sameLang(res.detected, settings.targetLang));

  /** Card for a post/comment: translated title in bold (if any), then the text. Untranslated parts keep the original. */
  function renderPost(panel, parts, results) {
    const done = results.filter(Boolean);
    const failed = done.find((r) => !r.ok);
    if (failed && !done.some(isUseful)) { RT.fillCard(panel, RTI.t('card.failed'), failed.error, true); return; }
    const detected = done.find((r) => r.ok && r.detected)?.detected || 'und';
    if (!done.some(isUseful)) { RT.fillCard(panel, RTI.t('card.already', { lang: langName(detected) }), ''); return; }
    const [titleRes, textRes] = results;
    const pick = (res, original) => (isUseful(res) ? res.translated : original);
    RT.fillCard(panel, `${langName(detected)} → ${langName(settings.targetLang)}`,
      parts.text ? pick(textRes, parts.text) : '', false, parts.title ? pick(titleRes, parts.title) : '');
  }

  /** Title and text translated separately (so the title can be shown as a title); the language is detected
   *  once from both, because a short title alone is easy to misdetect. */
  async function translateParts(parts) {
    const target = settings.targetLang;
    const hint = parts.title ? await RT.detect(`${parts.title}\n${parts.text}`) : '';
    return Promise.all([
      parts.title ? RT.translate(parts.title, target, hint) : null,
      parts.text ? RT.translate(parts.text, target, hint) : null,
    ]);
  }

  function setButtonState(btn, state) {
    btn.classList.toggle('rt-loading', state === 'loading');
    btn.classList.toggle('rt-active', state === 'shown');
    const label = RTI.t(state === 'shown' ? 'btn.hide' : state === 'loading' ? 'card.translating' : 'btn.translate');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(state === 'shown'));
  }

  async function onTranslateClick(event, bodyEl, bar, btn) {
    event.preventDefault();
    event.stopPropagation();
    const existing = bar.querySelector('.rt-panel');
    if (existing && existing.dataset.lang === settings.targetLang) {
      const hidden = existing.hidden = !existing.hidden;
      setButtonState(btn, hidden ? 'idle' : 'shown');
      return;
    }
    existing?.remove();
    await translateBody(bodyEl, bar, btn, false);
  }

  /** Translate one post/comment into the panel under it. In auto mode same-language texts stay silent. */
  async function translateBody(bodyEl, bar, btn, auto) {
    if (!originalText.has(bodyEl)) originalText.set(bodyEl, partsOf(bodyEl));
    setButtonState(btn, 'loading');
    const parts = originalText.get(bodyEl);
    const results = await translateParts(parts);
    if (auto && !results.some(isUseful)) {
      bodyEl.dataset.rtAutoLang = settings.targetLang; // nothing to show; don't retry for this language
      setButtonState(btn, 'idle');
      return;
    }
    bar.querySelector('.rt-panel')?.remove();
    const panel = document.createElement('div');
    panel.className = 'rt-panel';
    panel.style.cssText = INLINE.panel;
    panel.dataset.lang = settings.targetLang;
    renderPost(panel, parts, results);
    bar.append(panel);
    setButtonState(btn, 'shown');
  }

  // ---------- "Translate everything": only what scrolls into view, a few at a time ----------
  const autoItems = new Map(); // bodyEl -> { bar, btn }
  const autoQueue = [];
  let autoRunning = 0;

  function pumpAutoQueue() {
    while (autoRunning < MAX_PARALLEL && autoQueue.length) {
      const bodyEl = autoQueue.shift();
      const item = autoItems.get(bodyEl);
      if (!item || !bodyEl.isConnected || !needsAutoTranslation(bodyEl, item)) continue;
      autoRunning += 1;
      translateBody(bodyEl, item.bar, item.btn, true).finally(() => { autoRunning -= 1; pumpAutoQueue(); });
    }
  }

  const needsAutoTranslation = (bodyEl, item) => settings.autoTranslate
    && bodyEl.dataset.rtAutoLang !== settings.targetLang
    && !item.bar.querySelector(`.rt-panel[data-lang="${settings.targetLang}"]`);

  const watchedTarget = new Map(); // element being watched -> bodyEl it stands for
  const visibilityObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      visibilityObserver.unobserve(entry.target);
      const bodyEl = watchedTarget.get(entry.target);
      watchedTarget.delete(entry.target);
      if (bodyEl) autoQueue.push(bodyEl);
    }
    pumpAutoQueue();
  }, { rootMargin: '400px 0px' });

  /** Element to watch for visibility: a text block without its own box (display: contents) never
   *  "intersects", so fall back to the whole post/comment card. */
  function visibilityTarget(bodyEl) {
    if (bodyEl.getClientRects().length) return bodyEl;
    const child = [...bodyEl.children].find((c) => c.getClientRects().length);
    if (child) return child;
    const owner = ownerOf(bodyEl);
    return owner.getClientRects().length ? owner : bodyEl;
  }

  function observeForAuto(bodyEl) {
    const target = visibilityTarget(bodyEl);
    watchedTarget.set(target, bodyEl);
    visibilityObserver.observe(target);
  }

  function watchForAuto(bodyEl, bar, btn) {
    autoItems.set(bodyEl, { bar, btn });
    if (settings.autoTranslate) observeForAuto(bodyEl);
  }

  function restartAuto() {
    for (const [bodyEl] of autoItems) {
      if (!bodyEl.isConnected) { autoItems.delete(bodyEl); continue; }
      for (const [target, body] of watchedTarget) {
        if (body === bodyEl) { visibilityObserver.unobserve(target); watchedTarget.delete(target); }
      }
      if (settings.autoTranslate) observeForAuto(bodyEl);
    }
  }

  /** True when the element's text is laid out on the page (works for display: contents too). */
  function isRendered(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rect = range.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /** Title of a post (empty for comments). */
  function postTitle(owner) {
    if (owner.matches('shreddit-post')) return (owner.getAttribute('post-title') || '').trim();
    if (owner.matches('.thing.link')) return (owner.querySelector('.entry a.title')?.textContent || '').trim();
    return '';
  }

  /** What to translate: {title, text}. A title-only post has text ''. */
  function partsOf(bodyEl) {
    if (TITLE_SELECTORS.some((sel) => bodyEl.matches(sel))) {
      return { title: postTitle(ownerOf(bodyEl)) || extractText(bodyEl), text: '' };
    }
    const title = postTitle(ownerOf(bodyEl));
    let text = extractText(bodyEl);
    if (title && text.startsWith(title)) text = text.slice(title.length).trim();
    return { title, text };
  }

  /** Visible text of a post/comment without our own UI. */
  function extractText(el) {
    const ui = el.querySelector(':scope > .rt-ui');
    if (ui) ui.style.display = 'none';
    const text = (el.innerText || el.textContent || '').trim();
    if (ui) ui.style.display = '';
    return text;
  }

  /** closest() that also climbs out of shadow roots. */
  function closestDeep(el, sel) {
    for (let node = el; node; node = node.parentElement || node.getRootNode().host) {
      if (node.matches?.(sel)) return node;
    }
    return null;
  }

  /** The post/comment a text block belongs to — one translate button per owner. */
  const ownerOf = (bodyEl) => closestDeep(bodyEl, 'shreddit-comment, shreddit-post, .thing') || bodyEl;
  let doneOwners = new WeakSet();

  /** Reddit's own button row for this post/comment, and the element to insert before (share/award). */
  function actionRowSlot(bodyEl) {
    const owner = ownerOf(bodyEl);
    let row = null;
    if (owner.matches('shreddit-comment')) {
      const rows = [owner, owner.shadowRoot].filter(Boolean).flatMap((r) => [...r.querySelectorAll('shreddit-comment-action-row')]);
      row = rows.find((r) => closestDeep(r, 'shreddit-comment') === owner) || null;
    } else if (owner.matches('shreddit-post')) {
      row = owner;
    }
    if (!row) return null;
    const slotted = [...row.children].filter((el) => el.getAttribute('slot') && !el.classList.contains('rt-ui'));
    const isShare = (el) => /share/i.test(el.getAttribute('slot')) || /share/i.test(el.tagName);
    const anchor = slotted.find(isShare) || slotted.find((el) => /award/i.test(el.getAttribute('slot')));
    return anchor ? { row, anchor } : null;
  }

  /** Where the translation appears. Post text blocks can be clipped (line-clamp, "read more"), so for posts
   *  the panel goes right after the block — in the same slot, so it still renders under the text. */
  function placeBar(bar, bodyEl, owner) {
    if (!owner.matches('shreddit-post')) { bodyEl.append(bar); return; }
    if (bodyEl.getAttribute('slot')) bar.setAttribute('slot', bodyEl.getAttribute('slot'));
    bodyEl.after(bar);
  }

  /** Place the button right after "Share"; falls back to a line under the text if the row isn't found. */
  function placeButton(btn, bodyEl, bar) {
    const slot = actionRowSlot(bodyEl);
    if (slot) {
      btn.setAttribute('slot', slot.anchor.getAttribute('slot'));
      btn.classList.add('rt-ui', 'rt-row-btn');
      slot.row.insertBefore(btn, slot.anchor.nextSibling); // same slot, so it renders to the right of Share
      return;
    }
    const oldRow = bodyEl.closest('.entry')?.querySelector(':scope > ul.flat-list.buttons');
    if (oldRow) {
      const li = document.createElement('li');
      li.className = 'rt-ui rt-row-btn';
      li.append(btn);
      oldRow.append(li);
      return;
    }
    bar.append(btn);
  }

  function attach(bodyEl) {
    if (bodyEl.classList.contains('rt-ui') || bodyEl.closest('.rt-ui')) return; // our own panel shares the post's slot
    if (bodyEl.hasAttribute(DONE_ATTR) || !(bodyEl.textContent || '').trim()) return;
    // Reddit keeps hidden copies of post text (e.g. collapsed previews). Only a block whose text is
    // actually rendered may claim the post's single button — otherwise the translation lands out of sight.
    if (!isRendered(bodyEl)) return;
    const owner = ownerOf(bodyEl);
    if (doneOwners.has(owner)) return;
    // A title claims the post only when the post has no text block at all (link/image/video posts).
    if (TITLE_SELECTORS.some((sel) => bodyEl.matches(sel)) && owner.querySelector(POST_TEXT_SEL)) return;
    doneOwners.add(owner);
    bodyEl.setAttribute(DONE_ATTR, '1');
    const bar = document.createElement('div'); // the translation appears here, right under the text
    bar.className = 'rt-ui rt-bar';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rt-btn';
    btn.dataset.rtRead = '1';
    btn.style.cssText = INLINE.btn;
    btn.innerHTML = ICON;
    setButtonState(btn, 'idle');
    RT.onActivate(btn, (e) => onTranslateClick(e, bodyEl, bar, btn));
    bar.addEventListener('click', (e) => e.stopPropagation());
    placeBar(bar, bodyEl, owner);
    placeButton(btn, bodyEl, bar);
    watchForAuto(bodyEl, bar, btn);
  }

  const observer = new MutationObserver(() => scheduleScan());
  const watchedRoots = new WeakSet();

  /** The document plus every open shadow root (Reddit renders parts of comments inside web components). */
  function allRoots() {
    const roots = [document];
    for (let i = 0; i < roots.length; i += 1) {
      const start = roots[i] === document ? document.documentElement : roots[i];
      const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.shadowRoot) roots.push(n.shadowRoot);
    }
    return roots;
  }

  function scan() {
    if (!settings.showButtons) return;
    for (const root of allRoots()) {
      if (!watchedRoots.has(root)) {
        watchedRoots.add(root);
        observer.observe(root === document ? document.documentElement : root, { childList: true, subtree: true });
      }
      for (const sel of [...BODY_SELECTORS, ...TITLE_SELECTORS]) root.querySelectorAll(sel).forEach(attach);
    }
  }

  function removeAllButtons() {
    document.querySelectorAll('.rt-bar, .rt-row-btn').forEach((el) => el.remove());
    document.querySelectorAll(`[${DONE_ATTR}]`).forEach((el) => el.removeAttribute(DONE_ATTR));
    doneOwners = new WeakSet();
    autoItems.clear();
  }

  let scanTimer = 0;
  const scheduleScan = () => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 400);
  };

  // ---------- Selection translation: select any text → small floating button ----------
  let floatBtn = null;
  let popover = null;

  function hideFloating() {
    floatBtn?.remove();
    floatBtn = null;
  }

  function hidePopover() {
    popover?.remove();
    popover = null;
  }

  function showPopover(x, y, text) {
    hidePopover();
    popover = document.createElement('div');
    popover.className = 'rt-ui rt-popover';
    popover.style.left = `${x}px`;
    popover.style.top = `${y}px`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'rt-btn rt-close';
    close.title = RTI.t('btn.close');
    close.setAttribute('aria-label', close.title);
    close.innerHTML = CLOSE_ICON;
    RT.onActivate(close, hidePopover);
    const panel = document.createElement('div');
    panel.className = 'rt-panel';
    panel.textContent = RTI.t('card.translating');
    popover.append(close, panel);
    document.body.append(popover);
    requestTranslation(text).then((res) => popover && renderResult(panel, res));
  }

  function onMouseUp(event) {
    if (!settings.selectionTranslate || event.target.closest?.('.rt-ui')) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 2 || !sel.rangeCount) return hideFloating();
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      // Text selected inside shadow DOM (Reddit chat) gives an empty rect at 0,0 — fall back to the pointer.
      const hasRect = rect.width > 0 || rect.height > 0;
      const anchorX = hasRect ? rect.right : event.clientX + 4;
      const anchorY = hasRect ? rect.bottom : event.clientY + 4;
      hideFloating();
      floatBtn = document.createElement('button');
      floatBtn.type = 'button';
      floatBtn.className = 'rt-ui rt-btn rt-float';
      floatBtn.innerHTML = ICON;
      floatBtn.title = RTI.t('btn.translateSelection');
      floatBtn.setAttribute('aria-label', floatBtn.title);
      const x = Math.min(anchorX + 4, window.innerWidth - 40) + window.scrollX;
      const y = anchorY + window.scrollY + 4;
      floatBtn.style.left = `${x}px`;
      floatBtn.style.top = `${y}px`;
      RT.onActivate(floatBtn, (e) => {
        e.stopPropagation();
        hideFloating();
        showPopover(Math.max(8, Math.min(x, window.scrollX + window.innerWidth - 420)), y, text);
      });
      document.body.append(floatBtn);
    }, 0);
  }

  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest?.('.rt-ui')) {
      hideFloating();
      hidePopover();
    }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideFloating(); hidePopover(); }
  });

  // ---------- Settings ----------
  function applySettings(next) {
    const langChanged = next.targetLang && next.targetLang !== settings.targetLang;
    Object.assign(settings, next);
    if (langChanged) document.querySelectorAll('.rt-bar .rt-panel').forEach((p) => p.remove());
    if (!settings.showButtons) removeAllButtons();
    else scan();
    if (!settings.selectionTranslate) { hideFloating(); hidePopover(); }
    for (const { bar, btn } of autoItems.values()) setButtonState(btn, bar.querySelector('.rt-panel:not([hidden])') ? 'shown' : 'idle');
    if ('autoTranslate' in next || langChanged) restartAuto();
  }

  chrome.storage.sync.get(settings, applySettings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const next = {};
    for (const [k, v] of Object.entries(changes)) next[k] = v.newValue;
    applySettings(next);
  });

  // Hidden post text can become visible without DOM changes (e.g. "read more"), so rescan on scroll too.
  addEventListener('scroll', scheduleScan, { passive: true, capture: true });
  scan();
})();
