// "Copy diagnostics" (from the settings popup): a skeleton of how Reddit built the post / chat on this page,
// so layout problems can be fixed without guessing. Only tag names, slots, sizes and text LENGTHS — never text.
(() => {
  'use strict';

  const MAX_OUT = 9000;

  function brief(el) {
    if (!(el instanceof Element)) return el instanceof ShadowRoot ? '#shadow-root' : String(el?.nodeName);
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const cls = el.classList.length ? `.${[...el.classList].slice(0, 3).join('.')}` : '';
    const slot = el.getAttribute('slot') ? `[slot=${el.getAttribute('slot')}]` : '';
    const id = el.id ? `#${el.id.replace(/^t[13]_\w+/, 'tX')}` : '';
    const extra = [cs.display, cs.overflow !== 'visible' ? `ov:${cs.overflow}` : '', cs.flexDirection !== 'row' && cs.display.includes('flex') ? cs.flexDirection : '']
      .filter(Boolean).join(' ');
    return `${el.tagName.toLowerCase()}${id}${slot}${cls} {${extra}} ${Math.round(r.width)}x${Math.round(r.height)} txt:${(el.textContent || '').trim().length}${el.shadowRoot ? ' +shadow' : ''}${el.classList.contains('rt-ui') ? ' <RT>' : ''}${el.hasAttribute('data-rt-done') ? ' <RT-done>' : ''}`;
  }

  function tree(node, depth, indent = '') {
    if (depth < 0) return [];
    const lines = [];
    const kids = [...(node.children || [])];
    if (node.shadowRoot) kids.unshift(node.shadowRoot);
    for (const kid of kids.slice(0, 12)) {
      lines.push(indent + brief(kid));
      lines.push(...tree(kid, depth - 1, `${indent}  `));
    }
    if (kids.length > 12) lines.push(`${indent}… +${kids.length - 12}`);
    return lines;
  }

  function pathUp(el, levels) {
    const out = [];
    for (let n = el, i = 0; n && i < levels; i += 1) {
      out.push(brief(n));
      n = n.parentElement || n.getRootNode().host;
    }
    return out;
  }

  function allRoots() {
    const roots = [document];
    for (let i = 0; i < roots.length; i += 1) {
      const start = roots[i] === document ? document.documentElement : roots[i];
      const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.shadowRoot) roots.push(n.shadowRoot);
    }
    return roots;
  }

  const queryAll = (sel) => allRoots().flatMap((r) => [...r.querySelectorAll(sel)]);

  function diagnose() {
    const lines = [`Reddit Translate ${chrome.runtime.getManifest().version} | ${location.hostname}/${location.pathname.split('/')[1] || ''} | ${innerWidth}x${innerHeight}`];
    const posts = queryAll('shreddit-post');
    lines.push(`posts:${posts.length} comments:${queryAll('shreddit-comment').length} readButtons:${queryAll('[data-rt-read]').length} panels:${queryAll('.rt-panel').length}`);
    posts.slice(0, 2).forEach((post, i) => {
      lines.push(`--- post ${i + 1}: ${brief(post)}`, ...tree(post, 4, '  '));
    });
    const postBodies = queryAll('[id$="-post-rtjson-content"], [slot="text-body"], shreddit-post-text-body');
    lines.push(`--- post text candidates: ${postBodies.length}`);
    postBodies.slice(0, 4).forEach((b) => lines.push('  path:', ...pathUp(b, 6).map((l) => `    ${l}`)));
    const chatPanels = queryAll('.rt-ui').filter((p) => !p.closest('shreddit-post, shreddit-comment') && p.tagName === 'DIV');
    lines.push(`--- chat panels: ${chatPanels.length}`);
    chatPanels.slice(0, 6).forEach((p) => {
      lines.push(`  panel ${brief(p)} after:`, ...pathUp(p.previousElementSibling || p, 5).map((l) => `    ${l}`));
    });
    return lines.join('\n').slice(0, MAX_OUT);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'rt-diagnose' || window !== window.top) return false;
    try {
      sendResponse({ ok: true, text: diagnose() });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
    return false;
  });
})();
