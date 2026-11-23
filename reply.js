// "Write in your language, publish in theirs": extra buttons in Reddit's reply box (next to Cancel / Comment).
(() => {
  'use strict';

  const EDITOR_SEL = [
    '[contenteditable="true"][role="textbox"]',
    '[data-lexical-editor="true"]',
    'shreddit-composer textarea',
    'comment-composer-host textarea',
    '.usertext-edit textarea',
  ].join(',');
  const SUBMIT_SEL = 'button[slot="submit-button"], button[type="submit"], .usertext-buttons button.save';
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();

  const settings = { replyTranslate: true, replyLang: 'en' };
  const SEND_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  const originals = new WeakMap(); // editor -> draft before translation (for undo)
  const uiByRoot = new WeakMap();
  let floating = null; // fallback panel when Reddit's button row can't be found

  // ---------- Reading the page ----------
  function visibleText(el) {
    const own = [...el.querySelectorAll('.rt-ui')];
    own.forEach((n) => { n.style.display = 'none'; });
    const text = (el.innerText || el.textContent || '').trim();
    own.forEach((n) => { n.style.display = ''; });
    return text;
  }

  /** Text of the comment/post being answered — used only in "auto" language mode. */
  function parentText(ed) {
    const commentBody = ed.closest('shreddit-comment')?.querySelector(':scope > div[slot="comment"]');
    if (commentBody && !commentBody.contains(ed)) return visibleText(commentBody);
    const oldComment = ed.closest('.thing.comment')?.querySelector(':scope > .entry .usertext-body .md');
    if (oldComment && !oldComment.contains(ed)) return visibleText(oldComment);
    const post = document.querySelector('shreddit-post');
    if (post) {
      const body = post.querySelector('[slot="text-body"]');
      return `${post.getAttribute('post-title') || ''}\n${body ? visibleText(body) : ''}`.trim();
    }
    const oldPost = document.querySelector('.thing.link');
    return oldPost ? visibleText(oldPost.querySelector('.entry') || oldPost) : '';
  }

  async function resolveTarget(ed) {
    if (settings.replyLang !== 'auto') return settings.replyLang;
    const text = parentText(ed);
    return text ? RT.detect(text) : '';
  }

  // ---------- Writing into Reddit's editor ----------
  const readDraft = (ed) => (ed.tagName === 'TEXTAREA' ? ed.value : ed.innerText || '');

  /** Select the whole draft and give the editor a moment to sync its own selection model. */
  async function selectAll(ed) {
    ed.focus();
    document.execCommand('selectAll');
    const range = document.createRange();
    range.selectNodeContents(ed);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    await delay(40); // rich editors (Lexical) read the selection on the async selectionchange event
  }

  /** Replace the whole draft as if the user typed it; returns true when the editor holds exactly `text`. */
  async function writeDraft(ed, text) {
    if (ed.tagName === 'TEXTAREA') {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ed, text);
      ed.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    await selectAll(ed);
    const data = new DataTransfer();
    data.setData('text/plain', text);
    ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    await delay(80);
    if (normalize(readDraft(ed)) === normalize(text)) return true;
    await selectAll(ed); // paste was ignored or landed at the caret — replace everything via the editing pipeline
    document.execCommand('insertText', false, text);
    await delay(80);
    return normalize(readDraft(ed)) === normalize(text);
  }

  /** Chat's send button: searched from the input outward through the surrounding components. */
  function findChatSend(ed) {
    // CSS `i` only folds ASCII case, so Cyrillic labels are listed in both cases.
    const sel = ['button[type="submit"]', 'button[aria-label*="send" i]', 'button[aria-label*="Надіслати"]',
      'button[aria-label*="надіслати"]', 'button[aria-label*="Отправить"]', 'button[aria-label*="отправить"]'].join(',');
    let root = ed.getRootNode();
    for (let depth = 0; root && depth < 4; depth += 1) {
      // never pick one of our own buttons (their labels also say "надіслати")
      const btn = [...(root.querySelectorAll?.(sel) || [])].find((b) => !b.closest('.rt-ui'));
      if (btn) return btn;
      root = root.host ? root.host.getRootNode() : null;
    }
    return null;
  }

  /** Chat sends on Enter; synthetic key events still reach the chat's own key handlers. */
  async function sendByEnter(ed) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
    for (const type of ['keydown', 'keypress', 'keyup']) ed.dispatchEvent(new KeyboardEvent(type, opts));
    await delay(300);
    return !normalize(readDraft(ed));
  }

  async function sendInChat(ed) {
    const btn = findChatSend(ed);
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    return sendByEnter(ed);
  }

  function findSubmit(ed) {
    const scopes = ['shreddit-composer', 'comment-composer-host', 'faceplate-form', 'form', '.usertext-edit']
      .map((sel) => ed.closest(sel)).filter(Boolean);
    for (const scope of scopes) {
      for (const root of [scope, scope.shadowRoot].filter(Boolean)) {
        const btn = root.querySelector(SUBMIT_SEL);
        if (btn) return btn;
      }
    }
    return null;
  }

  // ---------- Buttons (inline styles: they may live inside Reddit's shadow DOM where our CSS doesn't reach) ----------
  const css = {
    root: 'display:inline-flex;align-items:center;gap:4px;margin-right:8px;vertical-align:middle;font:600 14px/1 system-ui,sans-serif;',
    icon: 'display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border:none;border-radius:50%;background:transparent;color:inherit;cursor:pointer;',
    send: 'display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 14px;border:none;border-radius:999px;background:#0a66c2;color:#fff;cursor:pointer;white-space:nowrap;',
    badge: 'font:700 13px/1 system-ui,sans-serif;letter-spacing:.02em;',
    status: 'max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 12px/1.2 system-ui,sans-serif;opacity:.75;',
  };

  function iconButton(icon, label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = css.icon;
    btn.innerHTML = icon;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    RT.onActivate(btn, () => onClick());
    return btn;
  }

  function buildActions() {
    const u = { editor: null };
    u.root = document.createElement('span');
    u.root.className = 'rt-ui rt-reply-actions';
    u.root.style.cssText = css.root;
    u.status = document.createElement('span');
    u.status.setAttribute('role', 'status');
    u.status.style.cssText = css.status;
    u.translateBtn = iconButton(RT.ICON, RTI.t('reply.translateOnly'), () => translateDraft(u));
    u.undoBtn = iconButton(RT.UNDO_ICON, RTI.t('reply.undo'), () => undo(u));
    showUndo(u, false);
    u.sendBtn = document.createElement('button');
    u.sendBtn.type = 'button';
    u.sendBtn.style.cssText = css.send;
    // Pill: [translate icon] EN [send icon] — reads as "translate to EN, then send".
    u.sendBtn.setAttribute('aria-label', RTI.t('reply.send'));
    u.badge = document.createElement('span');
    u.badge.style.cssText = css.badge;
    u.badge.setAttribute('aria-hidden', 'true');
    u.sendBtn.insertAdjacentHTML('afterbegin', RT.ICON);
    u.sendBtn.append(u.badge);
    u.sendBtn.insertAdjacentHTML('beforeend', SEND_ICON);
    RT.onActivate(u.sendBtn, () => translateAndSend(u));
    u.root.append(u.status, u.translateBtn, u.undoBtn, u.sendBtn);
    uiByRoot.set(u.root, u);
    return u;
  }

  /** Put our buttons right after Reddit's submit button, in the same slot so they render to its right. */
  function injectNextTo(submit) {
    const parent = submit.parentNode;
    const existing = parent.querySelector(':scope > .rt-reply-actions');
    if (existing) return uiByRoot.get(existing);
    const u = buildActions();
    u.root.style.marginRight = '0';
    u.root.style.marginLeft = '8px';
    if (submit.getAttribute('slot')) u.root.setAttribute('slot', submit.getAttribute('slot'));
    parent.insertBefore(u.root, submit.nextSibling);
    return u;
  }

  function getFloating() {
    if (floating) return floating;
    floating = buildActions();
    floating.root.style.cssText += 'position:fixed;z-index:2147483645;padding:3px 6px;border-radius:999px;background:#fff;color:#1a1a1b;box-shadow:0 2px 10px rgba(0,0,0,.2);';
    floating.root.hidden = true;
    document.documentElement.append(floating.root);
    return floating;
  }

  function positionFloating() {
    const u = floating;
    if (!u || u.root.hidden || !u.editor) return;
    if (!u.editor.isConnected) { u.root.hidden = true; return; }
    const rect = u.editor.getBoundingClientRect();
    const h = u.root.offsetHeight || 44;
    u.root.style.top = `${Math.round(rect.top - h - 6 >= 0 ? rect.top - h - 6 : rect.bottom + 6)}px`;
    u.root.style.left = `${Math.round(Math.max(8, Math.min(rect.right - u.root.offsetWidth, innerWidth - u.root.offsetWidth - 8)))}px`;
    requestAnimationFrame(positionFloating);
  }

  // ---------- State helpers ----------
  // Inline display beats the [hidden] attribute, so toggle display directly.
  function showUndo(u, visible) {
    u.undoBtn.style.display = visible ? 'inline-flex' : 'none';
  }

  function setStatus(u, text, isError = false) {
    u.status.textContent = text;
    u.status.style.color = isError ? '#d93a00' : '';
    u.status.style.opacity = isError ? '1' : '.75';
  }

  function setBusy(u, busy) {
    u.sendBtn.disabled = busy;
    u.sendBtn.style.opacity = busy ? '.6' : '';
    u.translateBtn.style.opacity = busy ? '.4' : '';
    if (busy) setStatus(u, RTI.t('card.translating'));
  }

  async function refreshBadge(u) {
    const ed = u.editor;
    for (const [btn, key] of [[u.translateBtn, 'reply.translateOnly'], [u.undoBtn, 'reply.undo']]) {
      btn.title = RTI.t(key);
      btn.setAttribute('aria-label', btn.title);
    }
    u.badge.textContent = settings.replyLang === 'auto' ? '…' : settings.replyLang.toUpperCase();
    const target = await resolveTarget(ed);
    if (u.editor !== ed) return;
    u.badge.textContent = target ? target.toUpperCase() : '?';
    u.sendBtn.title = target
      ? RTI.t('reply.sendToShortcut', { lang: RT.langName(target) })
      : RTI.t('reply.noPartnerLang');
    u.sendBtn.setAttribute('aria-label', target ? RTI.t('reply.sendTo', { lang: RT.langName(target) }) : RTI.t('reply.send'));
  }

  // ---------- Actions ----------
  /** Returns 'translated' | 'same' | null (failed). */
  async function translateDraft(u) {
    const ed = u.editor;
    const text = ed ? readDraft(ed).trim() : '';
    if (!text) { setStatus(u, RTI.t('reply.writeFirst')); return null; }
    setBusy(u, true);
    const target = await resolveTarget(ed);
    if (!target) { setBusy(u, false); setStatus(u, RTI.t('reply.noLang'), true); return null; }
    const res = await RT.translate(text, target);
    if (!res.ok) { setBusy(u, false); setStatus(u, RTI.t('reply.failed', { error: res.error }), true); return null; }
    if (!res.translated) { setBusy(u, false); setStatus(u, RTI.t('reply.already', { lang: RT.langName(target) })); return 'same'; }
    const written = await writeDraft(ed, res.translated);
    setBusy(u, false);
    if (!written) { setStatus(u, RTI.t('reply.checkField'), true); return null; }
    originals.set(ed, text);
    showUndo(u, true);
    setStatus(u, `→ ${RT.langName(target)}`);
    return 'translated';
  }

  async function translateAndSend(u) {
    if (u.sending) return; // ignore repeated presses while one send is in progress
    u.sending = true;
    try {
      await translateAndSendOnce(u);
    } finally {
      u.sending = false;
    }
  }

  async function translateAndSendOnce(u) {
    const ed = u.editor;
    if (!(await translateDraft(u))) return;
    await delay(250); // let Reddit enable its submit button after the text change
    if (RT.isChatElement(ed)) {
      if (!(await sendInChat(ed))) { setStatus(u, RTI.t('reply.pressEnter')); return; }
    } else {
      const submit = findSubmit(ed);
      if (!submit || submit.disabled) { setStatus(u, RTI.t('reply.pressReddit')); return; }
      submit.click();
    }
    originals.delete(ed);
    showUndo(u, false);
    setStatus(u, '');
  }

  async function undo(u) {
    const ed = u.editor;
    if (!ed || !originals.has(ed)) return;
    await writeDraft(ed, originals.get(ed));
    originals.delete(ed);
    showUndo(u, false);
    setStatus(u, '');
  }

  // ---------- Wiring ----------
  function uiFor(ed) {
    const submit = RT.isChatElement(ed) ? null : findSubmit(ed); // chat input has no button row — use the floating panel
    const u = submit ? injectNextTo(submit) : getFloating();
    if (u.editor !== ed) {
      u.editor = ed;
      showUndo(u, originals.has(ed));
      setStatus(u, '');
    }
    refreshBadge(u);
    if (u === floating) { u.root.hidden = false; positionFloating(); }
    return u;
  }

  const CHAT_INPUT_SEL = 'textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]';
  function editorFromEvent(e) {
    const path = e.composedPath();
    const inChat = RT.isChatPath(path);
    return path.find((n) => n instanceof Element && (n.matches(EDITOR_SEL) || (inChat && n.matches(CHAT_INPUT_SEL))));
  }

  document.addEventListener('focusin', (e) => {
    const ed = settings.replyTranslate && editorFromEvent(e);
    if (ed) uiFor(ed);
  }, true);

  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!floating || floating.root.hidden) return;
      const active = document.activeElement;
      if (floating.root.contains(active) || floating.editor?.contains(active)) return;
      floating.root.hidden = true;
    }, 200);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!settings.replyTranslate || e.key !== 'Enter' || !e.shiftKey || !(e.ctrlKey || e.metaKey)) return;
    const ed = editorFromEvent(e);
    if (!ed) return;
    e.preventDefault();
    e.stopPropagation();
    translateAndSend(uiFor(ed));
  }, true);

  function applySettings(next) {
    Object.assign(settings, next);
    if (!settings.replyTranslate) {
      document.querySelectorAll('.rt-reply-actions').forEach((n) => n !== floating?.root && n.remove());
      if (floating) floating.root.hidden = true;
    }
  }

  chrome.storage.sync.get(settings, applySettings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const next = {};
    for (const key of Object.keys(settings)) if (changes[key]) next[key] = changes[key].newValue;
    applySettings(next);
  });
})();
