import { getSiblingDirectory, parseDirectoryListing } from './folder-listing.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'reader:list-siblings') return false;
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: '无法读取此页面的文件夹。' });
    return false;
  }
  (async () => {
    const directory = getSiblingDirectory(sender);
    if (!await chrome.extension.isAllowedFileSchemeAccess()) {
      throw new Error('请在扩展详情中开启「允许访问文件网址」。');
    }
    const response = await fetch(directory, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    // Chrome file:// directory responses may have status 0 even with a valid
    // readable index. The parser below still rejects an invalid/empty response.
    if (!response.ok && response.status !== 0) throw new Error('无法读取当前文件夹，请确认文件夹仍然存在。');
    const files = parseDirectoryListing(await response.text(), directory);
    return { ok: true, files, directory };
  })().then(sendResponse, error => {
    const message = error?.name === 'TimeoutError'
      ? '读取文件夹超时，请重试。'
      : error instanceof TypeError
        ? '无法读取当前文件夹，请确认已开启「允许访问文件网址」。'
        : error?.message || '读取文件夹失败，请重试。';
    sendResponse({ ok: false, error: message });
  });
  return true;
});
