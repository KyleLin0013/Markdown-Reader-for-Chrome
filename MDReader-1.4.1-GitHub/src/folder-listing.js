const markdownExtension = /\.(?:md|markdown|mdown)$/i;

/** The content script can list only the parent of its own top-level local file. */
export function getSiblingDirectory(sender) {
  if (!sender || sender.frameId !== 0 || !sender.tab || typeof sender.url !== 'string') {
    throw new Error('只能从当前本地 Markdown 文档读取同文件夹列表。');
  }
  let current;
  try { current = new URL(sender.url); }
  catch { throw new Error('无法识别当前文档地址。'); }
  if (current.protocol !== 'file:' || !markdownExtension.test(current.pathname)) {
    throw new Error('文件列表仅支持本地 Markdown 文档。');
  }
  return new URL('.', current).href;
}

/** Parse Chromium's directory listing data as JSON strings, never executable JS.
 * Its addRow(name, encodedName, isDirectory, ...) format is not a public API;
 * reject unknown HTML rather than silently displaying an incomplete empty list.
 */
export function parseDirectoryListing(html, directoryURL) {
  let directory;
  try { directory = new URL(directoryURL); }
  catch { throw new Error('无法识别文件夹地址。'); }
  if (directory.protocol !== 'file:' || !directory.pathname.endsWith('/') || directory.search || directory.hash) {
    throw new Error('只能读取本地文件夹。');
  }
  if (typeof html !== 'string') throw new Error('文件夹返回了无法识别的内容。');

  // Chromium emits a function definition even when a directory contains no rows.
  // An actual data row also recognizes listings with a different script wrapper.
  const rowPattern = /\baddRow\s*\(\s*("(?:\\.|[^"\\])*")\s*,\s*("(?:\\.|[^"\\])*")\s*,\s*(0|1|true|false)\s*(?=,|\))/g;
  const rows = [...html.matchAll(rowPattern)];
  const recognizable = rows.length > 0 || /\bfunction\s+addRow\s*\(/.test(html);
  if (!recognizable) throw new Error('无法识别 Chrome 的文件夹列表，请刷新重试。');

  const files = new Map();
  for (const row of rows) {
    if (row[3] !== '0' && row[3] !== 'false') continue;
    let name, encodedName, decodedName, url;
    try {
      name = JSON.parse(row[1]);
      encodedName = JSON.parse(row[2]);
      decodedName = decodeURIComponent(encodedName);
      url = new URL(encodedName, directory);
    } catch { continue; }
    // The decoded URL must describe the displayed leaf name, with no traversal,
    // schemes, fragments or query strings smuggled through the encoded field.
    if (!name || !markdownExtension.test(name) || /[\/\\\u0000-\u001f]/u.test(name)) continue;
    if (decodedName !== name || /[\/\\]/.test(decodedName)) continue;
    if (url.protocol !== 'file:' || url.host !== directory.host || url.hash || url.search) continue;
    if (new URL('.', url).href !== directory.href) continue;
    // Confirm URL parsing did not normalize a special filename into another one.
    try { if (decodeURIComponent(url.pathname.slice(directory.pathname.length)) !== name) continue; }
    catch { continue; }
    files.set(url.href, { name, url: url.href });
  }
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  return [...files.values()].sort((a, b) => collator.compare(a.name, b.name) || a.name.localeCompare(b.name));
}
