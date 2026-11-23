// Interface language (Ukrainian / English), shared by the popup, content scripts and the background worker.
// The choice lives in chrome.storage.sync as `uiLang`: 'uk' | 'en' | 'auto' (= browser language).
(() => {
  'use strict';

  const DICT = {
    uk: {
      // popup
      'popup.subtitle': 'Версія {v}',
      'popup.uiLang': 'Мова інтерфейсу',
      'popup.autoTitle': 'Перекладати все',
      'popup.autoHint': "Пости, коментарі й чат перекладаються самі, щойно з'являються на екрані",
      'popup.reading': 'Читання',
      'popup.targetLang': 'Перекладати на',
      'popup.targetLangHint': 'мова читання',
      'popup.showButtons': 'Іконка 文A під постами',
      'popup.showButtonsHint': 'поруч із «Поширити»',
      'popup.selection': 'Переклад виділеного тексту',
      'popup.selectionHint': 'виділіть — і натисніть синю іконку',
      'popup.chat': 'Переклад у чаті',
      'popup.chatHint': 'іконка при наведенні на повідомлення',
      'popup.replies': 'Мої відповіді',
      'popup.replyButton': 'Кнопка',
      'popup.replyButtonHint': 'біля «Коментар» і в чаті',
      'popup.replyLang': 'Надсилати мовою',
      'popup.replyLangHint': 'пишете своєю, йде цією',
      'popup.replyLangEn': 'Англійська',
      'popup.replyLangAuto': 'Як у співрозмовника',
      'popup.shortcut': '— перекласти й надіслати',
      'popup.engineLocal': 'Переклад на пристрої · приватно',
      'popup.engineGoogle': 'Переклад через Google Translate',
      'popup.diag': 'Скопіювати діагностику',
      'popup.diagTitle': "Скопіювати діагностику (будова сторінки без тексту) — якщо переклад з'являється не там",
      'popup.saved': 'Збережено ✓',
      'popup.openReddit': 'Відкрийте вкладку Reddit і оновіть її',
      'popup.diagCopied': 'Діагностику скопійовано — вставте в чат',
      // translation cards
      'card.translating': 'Перекладаю…',
      'card.failed': 'Не вдалося перекласти',
      'card.already': 'Текст уже мовою: {lang}',
      // post / comment buttons
      'btn.translate': 'Перекласти',
      'btn.hide': 'Сховати переклад',
      'btn.close': 'Закрити',
      'btn.translateSelection': 'Перекласти виділене',
      'btn.translateMessage': 'Перекласти повідомлення',
      // reply
      'reply.translateOnly': 'Перекласти мою відповідь (без надсилання)',
      'reply.undo': 'Повернути мій текст',
      'reply.send': 'Перекласти й надіслати',
      'reply.sendTo': 'Перекласти ({lang}) й надіслати',
      'reply.sendToShortcut': 'Перекласти ({lang}) й надіслати — Ctrl/⌘ + Shift + Enter',
      'reply.noPartnerLang': 'Не вдалося визначити мову співрозмовника',
      'reply.writeFirst': 'Спершу напишіть відповідь',
      'reply.noLang': 'Не вдалося визначити мову',
      'reply.failed': 'Не вдалося перекласти: {error}',
      'reply.already': 'Уже {lang}',
      'reply.checkField': 'Перевірте текст у полі перед надсиланням',
      'reply.pressEnter': 'Перекладено — натисніть Enter',
      'reply.pressReddit': 'Перекладено — натисніть кнопку Reddit',
      // errors
      'err.reload': 'Розширення оновлено — перезавантажте сторінку',
      'err.noAnswer': 'Немає відповіді',
      'err.googleLimit': 'Google тимчасово обмежив переклад, спробуйте пізніше',
      'err.empty': 'Порожній текст',
      'err.badLang': 'Невірна мова перекладу',
    },
    en: {
      'popup.subtitle': 'Version {v}',
      'popup.uiLang': 'Interface language',
      'popup.autoTitle': 'Translate everything',
      'popup.autoHint': 'Posts, comments and chat are translated as soon as they appear on screen',
      'popup.reading': 'Reading',
      'popup.targetLang': 'Translate to',
      'popup.targetLangHint': 'your reading language',
      'popup.showButtons': '文A icon under posts',
      'popup.showButtonsHint': 'next to “Share”',
      'popup.selection': 'Translate selected text',
      'popup.selectionHint': 'select text, then click the blue icon',
      'popup.chat': 'Translate in chat',
      'popup.chatHint': 'icon appears when you hover a message',
      'popup.replies': 'My replies',
      'popup.replyButton': 'Button',
      'popup.replyButtonHint': 'next to “Comment” and in chat',
      'popup.replyLang': 'Send in',
      'popup.replyLangHint': 'your replies go out in it',
      'popup.replyLangEn': 'English',
      'popup.replyLangAuto': 'Same as the other person',
      'popup.shortcut': '— translate and send',
      'popup.engineLocal': 'On-device translation · private',
      'popup.engineGoogle': 'Translated by Google Translate',
      'popup.diag': 'Copy diagnostics',
      'popup.diagTitle': 'Copy diagnostics (page structure, no text) — if a translation shows up in the wrong place',
      'popup.saved': 'Saved ✓',
      'popup.openReddit': 'Open a Reddit tab and reload it',
      'popup.diagCopied': 'Diagnostics copied — paste them into the chat',
      'card.translating': 'Translating…',
      'card.failed': 'Translation failed',
      'card.already': 'Already in {lang}',
      'btn.translate': 'Translate',
      'btn.hide': 'Hide translation',
      'btn.close': 'Close',
      'btn.translateSelection': 'Translate selection',
      'btn.translateMessage': 'Translate message',
      'reply.translateOnly': 'Translate my reply (without sending)',
      'reply.undo': 'Restore my text',
      'reply.send': 'Translate and send',
      'reply.sendTo': 'Translate ({lang}) and send',
      'reply.sendToShortcut': 'Translate ({lang}) and send — Ctrl/⌘ + Shift + Enter',
      'reply.noPartnerLang': "Couldn't detect the other person's language",
      'reply.writeFirst': 'Write your reply first',
      'reply.noLang': "Couldn't detect the language",
      'reply.failed': 'Translation failed: {error}',
      'reply.already': 'Already in {lang}',
      'reply.checkField': 'Check the text in the box before sending',
      'reply.pressEnter': 'Translated — press Enter',
      'reply.pressReddit': 'Translated — press the Reddit button',
      'err.reload': 'The extension was updated — reload the page',
      'err.noAnswer': 'No response',
      'err.googleLimit': 'Google is temporarily limiting translations, try again later',
      'err.empty': 'Empty text',
      'err.badLang': 'Invalid target language',
    },
  };

  const SUPPORTED = Object.keys(DICT);
  const browserLang = () => ((globalThis.navigator?.language || '').toLowerCase().startsWith('uk') ? 'uk' : 'en');
  /** 'uk' | 'en' for a stored choice ('auto' or anything unknown follows the browser). */
  const resolve = (choice) => (SUPPORTED.includes(choice) ? choice : browserLang());

  let lang = browserLang();
  const listeners = new Set();

  function setLang(choice) {
    const next = resolve(choice);
    if (next === lang) return;
    lang = next;
    for (const fn of listeners) fn(lang);
  }

  /** Text for `key` in the current interface language; {name} placeholders are filled from `vars`. */
  function t(key, vars = {}) {
    const text = DICT[lang][key] ?? DICT.uk[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
  }

  /** Language name ("English" / "англійська") in the interface language. */
  function langName(code) {
    try { return new Intl.DisplayNames([lang], { type: 'language' }).of(code) || code; } catch { return code; }
  }

  try {
    chrome.storage.sync.get({ uiLang: 'auto' }, (s) => setLang(s.uiLang));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.uiLang) setLang(changes.uiLang.newValue);
    });
  } catch {
    // storage unavailable (extension context gone) — keep the browser language
  }

  globalThis.RTI = {
    t,
    langName,
    resolve,
    get lang() { return lang; },
    onChange: (fn) => listeners.add(fn),
  };
})();
