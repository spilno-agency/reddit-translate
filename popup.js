const LANGS = ['uk', 'en', 'pl', 'de', 'fr', 'es', 'it', 'pt', 'cs', 'ro', 'tr', 'nl', 'sv', 'ja', 'ko', 'zh-CN', 'ar', 'hi', 'ru'];
const DEFAULTS = { targetLang: 'uk', showButtons: true, selectionTranslate: true, replyTranslate: true, replyLang: 'en', chatTranslate: true, autoTranslate: false, uiLang: 'auto' };
const SWITCHES = ['autoTranslate', 'showButtons', 'selectionTranslate', 'chatTranslate', 'replyTranslate'];
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const $ = (id) => document.getElementById(id);
const { t } = RTI;

const targetLang = $('targetLang');
const replyLang = $('replyLang');
const state = { ...DEFAULTS };

/** Language lists are rebuilt on each interface-language change so names read in that language. */
function fillLanguageLists() {
  targetLang.replaceChildren(...LANGS.map((code) => new Option(capitalize(RTI.langName(code)), code)));
  replyLang.replaceChildren(
    new Option(t('popup.replyLangEn'), 'en'),
    new Option(t('popup.replyLangAuto'), 'auto'),
    ...LANGS.filter((c) => c !== 'en').map((code) => new Option(capitalize(RTI.langName(code)), code)),
  );
  targetLang.value = state.targetLang;
  replyLang.value = state.replyLang;
}

/** Apply the current interface language to every marked element of the popup. */
function renderTexts() {
  document.documentElement.lang = RTI.lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  $('version').textContent = t('popup.subtitle', { v: chrome.runtime.getManifest().version });
  // On-device engine (Chrome Translator API) is free and private; otherwise the extension falls back to Google.
  $('engine-text').textContent = t('Translator' in self ? 'popup.engineLocal' : 'popup.engineGoogle');
  for (const btn of $('uiLang').querySelectorAll('button')) btn.setAttribute('aria-pressed', String(btn.dataset.lang === RTI.lang));
  fillLanguageLists();
}

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

const save = (patch) => {
  Object.assign(state, patch);
  chrome.storage.sync.set(patch, () => toast(t('popup.saved')));
};

chrome.storage.sync.get(DEFAULTS, (s) => {
  Object.assign(state, s);
  for (const id of SWITCHES) $(id).checked = s[id];
  renderTexts();
});
RTI.onChange(renderTexts);

targetLang.addEventListener('change', () => save({ targetLang: targetLang.value }));
replyLang.addEventListener('change', () => save({ replyLang: replyLang.value }));
for (const id of SWITCHES) $(id).addEventListener('change', (e) => save({ [id]: e.target.checked }));
for (const btn of $('uiLang').querySelectorAll('button')) {
  btn.addEventListener('click', () => save({ uiLang: btn.dataset.lang })); // storage change re-renders via RTI.onChange
}

// Diagnostics: ask the content script on the active Reddit tab for a page skeleton and copy it.
$('diag').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'rt-diagnose' }, { frameId: 0 }, async (res) => {
    if (chrome.runtime.lastError || !res?.ok) {
      toast(t('popup.openReddit'));
      return;
    }
    await navigator.clipboard.writeText(res.text);
    toast(t('popup.diagCopied'));
  });
});
