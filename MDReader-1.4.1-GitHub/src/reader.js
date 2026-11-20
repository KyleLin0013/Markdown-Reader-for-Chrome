import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { prepareHeadings, createNavigator } from './navigation.js';
import { applyPalette, createReadingSettings, fontSize } from './appearance.js';
import { createFileBrowser } from './file-browser.js';
import { createOutline } from './outline.js';

// Keep the original URL: relative paths, new tabs and browser history stay native.
const isMarkdownPath = /\.(?:md|markdown|mdown)$/i.test(location.pathname);
const isText = /^(?:text\/(?:plain|markdown|x-markdown)|application\/(?:markdown|x-markdown))(?:;|$)/i.test(document.contentType);
if (isMarkdownPath && isText && !document.body.classList.contains('md-reader')) start().catch(console.error);

async function start() {
  const original = document.querySelector('body > pre')?.textContent ?? document.body.textContent ?? '';
  const source = original.replace(/^\uFEFF/, '');
  const displaySource = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  let settings = { theme: 'system', size: 17, wide: false, palette: 'paper' };
  try { settings = { ...settings, ...(await chrome.storage.local.get('readerSettings')).readerSettings }; } catch {}
  const file = safeDecode(location.pathname.split('/').pop() || 'Markdown');
  const shell = document.createElement('div');
  shell.className = 'reader-shell';
  shell.innerHTML = `<header class="reader-toolbar">
      <div class="reader-identity">
        <button type="button" class="reader-button reader-icon-button reader-toc-toggle" aria-label="显示或隐藏文档导航" aria-controls="md-reader-sidebar" aria-expanded="false"><span class="reader-sidebar-icon" aria-hidden="true"></span></button>
        <span class="reader-brand" translate="no">MD Reader</span>
        <div class="reader-document-name"><span class="reader-doc-icon" aria-hidden="true"></span><span class="reader-file"></span></div>
      </div>
      <div class="reader-actions">
        <button type="button" class="reader-button" data-action="source" aria-label="显示 Markdown 源文" title="源文 / 阅读" aria-pressed="false">源文</button>
        <button type="button" class="reader-button" data-action="print" aria-label="打印或导出 PDF" title="打印 / PDF">打印</button>
        <button type="button" class="reader-button reader-settings-trigger" data-action="appearance" aria-label="阅读设置"><span class="reader-settings-symbol" aria-hidden="true">Aa</span><span class="reader-settings-text">阅读设置</span></button>
      </div>
      <div class="reader-progress" aria-hidden="true"></div>
    </header>
    <div class="reader-layout">
      <aside class="reader-sidebar" id="md-reader-sidebar" aria-label="文档导航" tabindex="-1">
        <div class="reader-files-panel" id="reader-files-panel" hidden></div>
        <div class="reader-outline-panel" id="reader-outline-panel">
          <div class="reader-sidebar-header"><h2>本页目录</h2><span class="reader-heading-count"></span></div>
          <label class="reader-search"><input class="reader-filter" type="search" placeholder="筛选章节" aria-label="筛选章节"></label>
          <nav class="reader-toc" aria-label="文档章节"></nav>
        </div>
        <footer class="reader-footer"><span class="reader-estimate"></span><span class="reader-percent">已读 0%</span></footer>
      </aside>
      <div class="reader-sidebar-overlay" aria-hidden="true"></div>
      <main class="reader-main">
        <article class="markdown-body" id="md-reader-article"></article>
        <pre id="md-reader-source" hidden></pre>
      </main>
    </div>
    <div class="reader-toast" role="status" aria-live="polite" hidden></div>`;
  // Cache trusted UI nodes before inserting document HTML; headings may share their IDs.
  const selectors = ['article', '.reader-main', '.reader-sidebar', '.reader-sidebar-overlay', '.reader-toc-toggle', '.reader-files-panel',
    '.reader-outline-panel', '.reader-file', '#md-reader-source', '.reader-heading-count', '.reader-estimate', '.reader-toc',
    '[data-action="appearance"]', '.reader-toast', '[data-action="source"]', '[data-action="print"]', '.reader-filter',
    '.reader-progress', '.reader-percent'];
  const controls = new Map(selectors.map(selector => [selector, shell.querySelector(selector)]));
  const ui = selector => controls.get(selector);
  const article = ui('article');
  // No executable HTML, document styles, forms, embedded frames or base URL changes.
  article.innerHTML = DOMPurify.sanitize(marked.parse(displaySource, { gfm: true, breaks: false }), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'link', 'meta', 'base', 'form', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'audio', 'video'],
    FORBID_ATTR: ['style', 'srcset', 'autofocus', 'contenteditable'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|file):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i
  });
  article.querySelectorAll('input').forEach(input => {
    if (input.type !== 'checkbox') input.remove();
    else input.disabled = true;
  });
  article.querySelectorAll('a').forEach(link => {
    link.removeAttribute('target');
    link.setAttribute('rel', 'noopener noreferrer');
  });
  article.querySelectorAll('img').forEach(img => { img.decoding = 'async'; });
  article.querySelectorAll('pre > code').forEach(code => {
    code.parentElement.dataset.language = (code.className.match(/language-([\w+-]+)/) || [,'TEXT'])[1];
  });
  article.querySelectorAll('table').forEach(table => {
    const container = document.createElement('div');
    container.className = 'reader-table-scroll';
    table.replaceWith(container);
    container.append(table);
  });
  const headings = prepareHeadings(article);
  const title = headings.find(h => h.level === 1)?.text || file.replace(/\.[^.]+$/, '');
  document.title = `${title} · MD Reader`;
  ui('.reader-file').textContent = file;
  ui('.reader-file').title = safeDecode(location.pathname);
  ui('#md-reader-source').textContent = source;
  ui('.reader-heading-count').textContent = `${headings.length} 节`;
  const characters = article.textContent.replace(/\s/g, '').length;
  ui('.reader-estimate').textContent = `${characters.toLocaleString()} 字符 · 约 ${Math.max(1, Math.ceil(characters / 500))} 分钟`;
  const outline = createOutline({ nav: ui('.reader-toc'), filter: ui('.reader-filter'), headings });
  document.body.replaceChildren(shell);
  document.body.className = 'md-reader';
  document.documentElement.lang = 'zh-CN';
  const media = matchMedia('(prefers-color-scheme: dark)');
  const applySettings = () => {
    document.body.dataset.theme = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme;
    applyPalette(settings);
    document.documentElement.style.setProperty('--reader-font-size', `${fontSize(settings.size)}px`);
    document.documentElement.classList.toggle('reader-wide', !!settings.wide);
  };
  applySettings();
  createFileBrowser({ sidebar:ui('.reader-sidebar'), outlinePanel:ui('.reader-outline-panel'), filePanel:ui('.reader-files-panel'), currentURL:location.href }).catch(console.error);
  media.addEventListener('change', applySettings);
  const appearanceButton = ui('[data-action="appearance"]');
  const readingSettings = createReadingSettings({
    button: appearanceButton, getSettings: () => settings,
    onChange: change => {
      settings = { ...settings, ...change };
      applySettings();
      chrome.storage.local.set({ readerSettings: settings }).catch(() => {});
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.readerSettings?.newValue) return;
    settings = { ...settings, ...changes.readerSettings.newValue };
    applySettings(); readingSettings.sync();
  });
  const narrow = matchMedia('(max-width: 900px)');
  const sidebar = ui('.reader-sidebar');
  const sidebarToggle = ui('.reader-toc-toggle');
  function setSidebar(open, restoreFocus = false) {
    const expanded = narrow.matches && open;
    document.body.classList.toggle('reader-toc-open', expanded);
    sidebarToggle.setAttribute('aria-expanded', String(expanded));
    sidebar.inert = narrow.matches && !expanded;
    ui('.reader-main').inert = expanded;
    if (restoreFocus) sidebarToggle.focus({ preventScroll: true });
  }
  setSidebar(false);
  narrow.addEventListener('change', () => setSidebar(false));
  sidebarToggle.addEventListener('click', () => {
    readingSettings.close();
    const open = sidebar.inert;
    setSidebar(open);
    if (open) (sidebar.querySelector('[role="tab"][aria-selected="true"]') || sidebar).focus({ preventScroll: true });
  });
  appearanceButton.addEventListener('click', () => setSidebar(false));
  ui('.reader-sidebar-overlay').addEventListener('click', () => setSidebar(false, true));
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && sidebarToggle.getAttribute('aria-expanded') === 'true') {
      event.preventDefault();
      setSidebar(false, true);
    }
  });
  let toastTimer;
  function toast(message) {
    const node = ui('.reader-toast');
    node.textContent = message; node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 4800);
  }
  const navigator = createNavigator({ article,
    onMissing: hash => toast(`没有找到章节「${safeDecode(hash.slice(1))}」，可从左侧目录查找。`),
    onFound: target => {
      ui('.reader-toast').hidden = true;
      outline.reveal(target);
    }
  });
  let raw = false;
  let readingPosition = 0;
  const showSource = value => {
    raw = value;
    if (raw) readingPosition = scrollY;
    article.hidden = raw;
    ui('#md-reader-source').hidden = !raw;
    ui('[data-action="source"]').setAttribute('aria-pressed', String(raw));
    window.scrollTo(0, raw ? 0 : readingPosition);
    updateProgress();
  };
  ui('[data-action="source"]').addEventListener('click', () => showSource(!raw));
  ui('[data-action="print"]').addEventListener('click', () => window.print());
  shell.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const url = new URL(link.href, location.href);
    if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search && url.hash) {
      if (raw) showSource(false);
      if (sidebarToggle.getAttribute('aria-expanded') === 'true') setSidebar(false, true);
      // Leave changed hashes to native navigation/history; re-run when clicking the same hash.
      if (url.hash === location.hash) { event.preventDefault(); navigator.navigate(url.hash); }
    }
  });
  let queued = false;
  function updateProgress() {
    queued = false;
    const total = document.documentElement.scrollHeight - innerHeight;
    const percent = total <= 0 ? 100 : Math.min(100, Math.round(scrollY / total * 100));
    ui('.reader-progress').style.width = `${percent}%`;
    ui('.reader-percent').textContent = `已读 ${percent}%`;
    if (raw) return;
    let active = headings[0]?.element;
    for (const { element } of headings) {
      const { top, height } = element.getBoundingClientRect();
      if (height && top <= 160) active = element;
    }
    outline.setCurrent(active);
  }
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(updateProgress); } }, { passive: true });
  addEventListener('resize', updateProgress);
  addEventListener('hashchange', () => { if (!location.hash) scrollTo(0, 0); });
  requestAnimationFrame(() => { if (location.hash) navigator.navigate(); updateProgress(); });
}

function safeDecode(value) { try { return decodeURIComponent(value); } catch { return value; } }
