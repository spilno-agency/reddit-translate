// Shared translation engine for the content scripts (they share one isolated world, so RT is visible to all).
(() => {
  'use strict';

  const translatorCache = new Map();
  let detectorPromise = null;

  const langName = (code) => RTI.langName(code);
  const sameLang = (a, b) => Boolean(a && b) && a.split('-')[0].toLowerCase() === b.split('-')[0].toLowerCase();

  function askBackground(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: RTI.t('err.reload') });
          else resolve(res || { ok: false, error: RTI.t('err.noAnswer') });
        });
      } catch {
        resolve({ ok: false, error: RTI.t('err.reload') });
      }
    });
  }

  // ---------- Engine 1: Chrome built-in on-device translator (free, private, no limits) ----------
  async function detectOnDevice(text) {
    if (!('LanguageDetector' in self)) return '';
    detectorPromise ||= LanguageDetector.create();
    const [top] = await (await detectorPromise).detect(text.slice(0, 2000));
    return top && top.confidence > 0.4 && top.detectedLanguage !== 'und' ? top.detectedLanguage : '';
  }

  async function translateOnDevice(text, target, sourceHint) {
    if (!('Translator' in self)) return null;
    const detected = sourceHint || await detectOnDevice(text);
    if (!detected) return null;
    if (sameLang(detected, target)) return { ok: true, detected, translated: '' };
    const key = `${detected}>${target}`;
    if (!translatorCache.has(key)) {
      const pair = { sourceLanguage: detected, targetLanguage: target };
      if ((await Translator.availability(pair)) === 'unavailable') return null;
      translatorCache.set(key, Translator.create(pair));
    }
    try {
      const translator = await translatorCache.get(key);
      return { ok: true, detected, translated: await translator.translate(text) };
    } catch (e) {
      translatorCache.delete(key);
      throw e;
    }
  }

  /** Translate text into `target`; result: {ok, detected, translated} or {ok:false, error}.
   *  `sourceHint` skips detection — useful for short texts (a post title) whose language is known from the body. */
  async function translate(text, target, sourceHint = '') {
    try {
      const local = await translateOnDevice(text, target, sourceHint);
      if (local) return local;
    } catch {
      // on-device model failed (e.g. still downloading) — fall back to the online engine
    }
    return askBackground({ type: 'rt-translate', text, target });
  }

  /** Language code of `text`, or '' if it can't be determined. */
  async function detect(text) {
    try {
      const local = await detectOnDevice(text);
      if (local) return local;
    } catch {
      // fall through to the online detector
    }
    const res = await askBackground({ type: 'rt-detect', text: text.slice(0, 500) });
    return res.ok ? res.detected : '';
  }

  // ---------- Click guard ----------
  // In the feed a whole post card is clickable, so events from our buttons must never reach Reddit.
  // We stop them at the very first (window capture) stage and run the button's action ourselves.
  const isEl = (n) => n instanceof Element;
  const GUARDED_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick', 'dblclick'];
  for (const type of GUARDED_EVENTS) {
    window.addEventListener(type, (e) => {
      const path = e.composedPath();
      if (!path.some((n) => isEl(n) && n.classList.contains('rt-ui'))) return;
      e.stopPropagation();
      const onButton = path.some((n) => isEl(n) && n.tagName === 'BUTTON');
      if (type === 'mousedown' && onButton) e.preventDefault(); // keep focus and text selection where they are
      if (type !== 'click') return;
      const actor = path.find((n) => isEl(n) && typeof n.rtAction === 'function');
      if (!actor) return;
      e.preventDefault();
      actor.rtAction(e);
    }, true);
  }

  /** Register what a button of ours does (instead of addEventListener('click')), see the click guard above. */
  const onActivate = (el, fn) => { el.rtAction = fn; };
  const inChat = () => location.hostname === 'chat.reddit.com' || location.pathname.startsWith('/chat');
  // The chat also pops up over any Reddit page; it's made of components named like rs-* or *chat*.
  const isChatNode = (n) => n instanceof Element && (/^rs-|chat/i.test(n.tagName) || /chat/i.test(n.id));
  /** True when an event/element path lies inside Reddit Chat (full page or the popup window). */
  const isChatPath = (path) => inChat() || path.some(isChatNode);
  /** Same as isChatPath, but walking up from an element (through shadow roots). */
  function isChatElement(el) {
    if (inChat()) return true;
    for (let n = el; n; n = n.parentElement || n.getRootNode().host) if (isChatNode(n)) return true;
    return false;
  }

  /** Shared look of the translation card (inline: it may live inside Reddit's shadow DOM). */
  const CARD_CSS = [
    'margin:8px 0 4px', 'padding:10px 14px 12px', 'border-radius:12px',
    'border:1px solid rgba(37,99,235,.18)', 'border-left:3px solid #2563eb',
    'background:linear-gradient(135deg,rgba(37,99,235,.07),rgba(124,58,237,.05))',
    'font-size:14px', 'font-weight:400', 'line-height:1.55', 'color:inherit', 'text-align:left',
  ].join(';');
  const META_CSS = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:11.5px;font-weight:600;letter-spacing:.02em;color:#2563eb;opacity:.9;';
  const TEXT_CSS = 'white-space:pre-wrap;overflow-wrap:anywhere;';
  const TITLE_CSS = 'margin-bottom:4px;font-size:15.5px;font-weight:700;line-height:1.4;overflow-wrap:anywhere;';
  const META_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="currentColor"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>';

  /** Fill a card: small "文A english → ukrainian" header, optional bold title, then text
   *  (textContent only — never markup from the page). */
  function fillCard(card, metaText, bodyText, isError = false, titleText = '') {
    card.style.cssText = CARD_CSS + (isError ? ';border-color:rgba(217,58,0,.25);border-left-color:#d93a00;background:rgba(217,58,0,.06)' : '');
    const meta = document.createElement('div');
    meta.style.cssText = META_CSS + (isError ? 'color:#d93a00;' : '');
    meta.innerHTML = META_ICON;
    meta.append(document.createTextNode(metaText));
    const body = document.createElement('div');
    body.style.cssText = TEXT_CSS;
    body.textContent = bodyText;
    const title = document.createElement('div');
    title.style.cssText = TITLE_CSS;
    title.textContent = titleText;
    card.replaceChildren(...(metaText ? [meta] : []), ...(titleText ? [title] : []), ...(bodyText ? [body] : []));
  }

  globalThis.RT = {
    fillCard,
    translate,
    detect,
    langName,
    sameLang,
    onActivate,
    inChat,
    isChatPath,
    isChatElement,
    ICON: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>',
    UNDO_ICON: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>',
  };
})();
