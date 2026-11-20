/** The background derives the directory from the sending local document URL. */
export async function createFileBrowser({ sidebar, outlinePanel, filePanel, currentURL }) {
  if (new URL(currentURL).protocol !== 'file:') return;
  const tabs = document.createElement('div');
  tabs.className = 'reader-sidebar-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '侧栏内容');
  tabs.innerHTML = `<button type="button" id="reader-files-tab" role="tab" aria-controls="reader-files-panel">文件</button><button type="button" id="reader-outline-tab" role="tab" aria-controls="reader-outline-panel">目录</button>`;
  const [filesTab, outlineTab] = tabs.children;
  sidebar.prepend(tabs);
  filePanel.setAttribute('role', 'tabpanel');
  filePanel.setAttribute('aria-labelledby', filesTab.id);
  outlinePanel.setAttribute('role', 'tabpanel');
  outlinePanel.setAttribute('aria-labelledby', outlineTab.id);
  filePanel.innerHTML = `<div class="reader-sidebar-header"><div class="reader-folder-label"><span class="reader-folder-icon" aria-hidden="true"></span><h2 class="reader-folder-name"></h2></div><button type="button" class="reader-button reader-icon-button reader-refresh-files" aria-label="刷新文件列表" title="刷新文件列表">↻</button></div>
    <label class="reader-search"><input type="search" class="reader-filter reader-file-filter" aria-label="筛选 Markdown 文件" placeholder="筛选文件"></label>
    <div class="reader-file-count"></div>
    <nav class="reader-file-list" aria-label="同文件夹 Markdown 文档"></nav>
    <p class="reader-files-status" role="status"></p>`;
  const folderName = filePanel.querySelector('.reader-folder-name');
  const refresh = filePanel.querySelector('.reader-refresh-files');
  const filter = filePanel.querySelector('.reader-file-filter');
  const count = filePanel.querySelector('.reader-file-count');
  const list = filePanel.querySelector('.reader-file-list');
  const status = filePanel.querySelector('.reader-files-status');
  const directory = new URL('.', currentURL);
  let decodedPath;
  try { decodedPath = decodeURIComponent(directory.pathname); } catch { decodedPath = directory.pathname; }
  folderName.textContent = decodedPath.split('/').filter(Boolean).pop() || '/';
  folderName.title = decodedPath;
  let entries = [];
  let ready = false;
  let unavailable = false;
  const current = new URL(currentURL); current.hash = ''; current.search = '';

  function render() {
    const query = filter.value.trim().toLocaleLowerCase();
    const visible = entries.filter(file => file.name.toLocaleLowerCase().includes(query));
    list.replaceChildren();
    for (const file of visible) {
      const link = document.createElement('a');
      link.className = 'reader-file-link';
      link.href = file.url;
      link.title = file.name;
      const icon = document.createElement('span');
      icon.className = 'reader-doc-icon'; icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.textContent = file.name;
      link.append(icon, label);
      if (new URL(file.url).href === current.href) { link.classList.add('active'); link.setAttribute('aria-current', 'page'); }
      list.append(link);
    }
    count.textContent = query ? `${visible.length} / ${entries.length} 份文档` : `${entries.length} 份文档`;
    if (!unavailable && ready) {
      status.textContent = visible.length ? '' : entries.length ? '没有匹配的文件。' : '这个文件夹没有 Markdown 文档。';
      status.hidden = !!visible.length;
    }
  }

  async function load() {
    refresh.disabled = true;
    filePanel.setAttribute('aria-busy', 'true');
    status.hidden = false; status.textContent = '正在读取同文件夹文档…';
    unavailable = false;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'reader:list-siblings' });
      if (!result?.ok) throw new Error(result?.error || '无法读取文件夹，请刷新扩展后重试。');
      // Validate returned links again before exposing navigation in the content page.
      entries = result.files.filter(file => {
        try {
          const url = new URL(file.url);
          return typeof file.name === 'string' && url.protocol === 'file:' && !url.hash && !url.search &&
            new URL('.', url).href === directory.href && /\.(md|markdown|mdown)$/i.test(url.pathname);
        } catch { return false; }
      });
      ready = true; render();
    } catch (error) {
      unavailable = true;
      status.textContent = error.message || '读取失败，请重试。';
      status.hidden = false;
      // Keep a previously loaded list usable when a refresh fails.
      if (!ready) count.textContent = '';
    } finally {
      refresh.disabled = false;
      filePanel.removeAttribute('aria-busy');
    }
  }
  function select(view, persist = true) {
    const files = view === 'files';
    filePanel.hidden = !files;
    outlinePanel.hidden = files;
    filesTab.setAttribute('aria-selected', String(files));
    outlineTab.setAttribute('aria-selected', String(!files));
    filesTab.tabIndex = files ? 0 : -1;
    outlineTab.tabIndex = files ? -1 : 0;
    if (persist) chrome.storage.local.set({ readerSidebarView:view }).catch(() => {});
  }
  filesTab.addEventListener('click', () => select('files'));
  outlineTab.addEventListener('click', () => select('outline'));
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const files = event.key === 'Home' || (event.key !== 'End' && filesTab.getAttribute('aria-selected') !== 'true');
    select(files ? 'files' : 'outline'); (files ? filesTab : outlineTab).focus();
  });
  refresh.addEventListener('click', load);
  filter.addEventListener('input', render);
  select('files', false);
  try {
    const { readerSidebarView } = await chrome.storage.local.get('readerSidebarView');
    if (readerSidebarView === 'outline') select('outline', false);
  } catch {}
  await load();
}
