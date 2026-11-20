chrome.extension.isAllowedFileSchemeAccess((allowed) => {
  document.getElementById('status').textContent = allowed ? '✓ 已开启本地文件访问，可以开始阅读' : '○ 请先开启本地文件访问';
});
document.getElementById('settings').addEventListener('click', () => {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});
