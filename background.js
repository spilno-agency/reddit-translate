importScripts('i18n.js');

// Translation requests run here (not in the page) so Reddit's CSP and CORS don't block them.
const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MAX_CHUNK = 4000;
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/** Split long text on line breaks so each request stays under the endpoint's size limit. */
function splitIntoChunks(text) {
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    const pieces = line.length > MAX_CHUNK ? line.match(new RegExp(`[\\s\\S]{1,${MAX_CHUNK}}`, 'g')) : [line];
    for (const piece of pieces) {
      if (current && current.length + piece.length + 1 > MAX_CHUNK) {
        chunks.push(current);
        current = piece;
      } else {
        current = current ? `${current}\n${piece}` : piece;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function translateChunk(text, target) {
  const url = `${ENDPOINT}?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: `q=${encodeURIComponent(text)}`,
  });
  const isJson = (res.headers.get('content-type') || '').includes('json');
  if (!res.ok || !isJson) throw new Error(RTI.t('err.googleLimit'));
  const data = await res.json();
  const translated = (data?.[0] || []).map((part) => part?.[0] || '').join('');
  return { translated, detected: data?.[2] || '' };
}

async function translateText(text, target) {
  if (typeof text !== 'string' || !text.trim()) throw new Error(RTI.t('err.empty'));
  if (!LANG_RE.test(target)) throw new Error(RTI.t('err.badLang'));
  const results = [];
  for (const chunk of splitIntoChunks(text)) results.push(await translateChunk(chunk, target));
  return {
    translated: results.map((r) => r.translated).join('\n'),
    detected: results.find((r) => r.detected)?.detected || '',
  };
}

async function detectLanguage(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error(RTI.t('err.empty'));
  const { detected } = await translateChunk(text.slice(0, 500), 'en');
  return { detected };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    'rt-translate': () => translateText(msg.text, msg.target),
    'rt-detect': () => detectLanguage(msg.text),
  };
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler()
    .then((r) => sendResponse({ ok: true, ...r }))
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true; // keep the channel open for the async response
});
