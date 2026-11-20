import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve('.');
const results = [];
const checks = (name, assertion) => { assert.ok(assertion, name); results.push(name); console.log(`✓ ${name}`); };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/unsafe.md') {
    res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8'});
    res.end('# Safety\n<script>window.pwned = true</script>\n<img src="x" onerror="window.pwned = true">\n[bad](javascript:alert(1))\n<style>body{display:none}</style>\n<input autofocus onfocus="window.pwned=true">\n');
    return;
  }
  if (pathname === '/delayed.md') {
    res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8'});
    res.end('# Delayed image\n![slow](/slow.svg)\n\n## Target\n\n' + 'Following text.\n\n'.repeat(100));
    return;
  }
  if (pathname === '/collisions.md') {
    res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8'});
    res.end('# UI collision test\n\n## md-reader-source\n\nA real heading.\n\n<div class="reader-toast">Document content</div>\n\n<details><summary>Collapsed</summary><h2 id="inside">Inside details</h2><p>Visible target</p></details>\n\n'+'Following text.\n\n'.repeat(100));
    return;
  }
  if (pathname === '/existing.md') {
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    res.end('<!doctype html><html><body><article class="markdown-body"><h1>Existing website</h1><p>Unchanged</p></article></body></html>');
    return;
  }
  if (pathname === '/slow.svg') {
    setTimeout(() => { res.writeHead(200, {'Content-Type':'image/svg+xml'}); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#c7d9c4"/></svg>'); }, 650);
    return;
  }
  try {
    const path = resolve(root, '.' + pathname);
    if (!path.startsWith(root + '/')) throw Error('Outside test directory');
    const data = await readFile(path);
    res.writeHead(200, {'Content-Type': pathname.endsWith('.md') ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8'});
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'mdreader-browser-'));
const fixture = await mkdtemp(join(tmpdir(), 'mdreader-folder-'));
const siblingNames = ['01 开始.md', '02 中文 #100%.md', '03 引号"括号(逗号,).md', '10 参考.MD', '11 后缀.markdown', '12 补充.mdown', '13 混合.Md'];
await Promise.all(siblingNames.map(name=>writeFile(join(fixture,name),`# ${name}\n\n`+'Opening text.\n\n'.repeat(35)+'## 目标章节\n\n'+'Following text.\n\n'.repeat(50))));
await writeFile(join(fixture,'not-markdown.txt'),'ignore me');
await mkdir(join(fixture,'子文件夹'));
await writeFile(join(fixture,'子文件夹','不应递归.md'),'# Nested');
let context;
try {
  const extension = join(root, 'extension');
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.CHROMIUM_PATH ? { executablePath:process.env.CHROMIUM_PATH } : {channel:'chromium'}),
    headless:true, viewport:{width:1440,height:1000}, colorScheme:'light',
    args:[`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--allow-file-access-from-files'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const initial = `${base}/examples/${encodeURIComponent('开始阅读')}.md`;
  const target = `${base}/examples/${encodeURIComponent('章节')}/${encodeURIComponent('使用指南')}.md`;
  async function ready() { await page.locator('body.md-reader .markdown-body h1').waitFor(); }
  async function aligned(id) {
    await page.waitForFunction(id => {
      const node = [...document.querySelectorAll('article [id],article a[name]')].find(n=>n.id===id||n.getAttribute('name')===id);
      if (!node) return false;
      const top = node.getBoundingClientRect().top;
      return top >= 55 && top < 180;
    }, id);
  }
  await page.goto(initial); await ready();
  checks('在线文档不读取本地文件夹',await page.getByRole('tab',{name:'文件',exact:true}).count()===0);
  checks('真实扩展自动渲染 HTTP Markdown', await page.locator('.reader-toc a').count() > 3);
  checks('全新安装默认使用纸感绿',await page.evaluate(()=>document.body.dataset.palette==='paper' && getComputedStyle(document.body).getPropertyValue('--reader-accent').trim()==='#37664f'));
  await mkdir('test-results', {recursive:true});
  await page.screenshot({path:'test-results/reader-light.png',fullPage:false,animations:'disabled'});
  const outline = page.getByRole('navigation',{name:'文档章节'});
  const chapterSearch = page.getByRole('searchbox',{name:'筛选章节'});
  const chapterToggle = outline.getByRole('button',{name:/排版，为内容让路 的下级章节/});
  const subchapter = outline.locator('.toc-link').filter({hasText:'有条理的清单'});
  checks('下级章节默认折叠在父标题下',await subchapter.isHidden() && await chapterToggle.getAttribute('aria-expanded')==='false');
  await chapterToggle.press('Space');
  checks('键盘可展开下级章节且不跳转正文',await subchapter.isVisible() && page.url()===initial);
  await page.locator('.reader-document-name').click();
  await page.screenshot({path:'test-results/reader-outline.png',animations:'disabled'});
  await chapterToggle.click();
  await chapterSearch.fill('有条理');
  checks('目录筛选显示位于折叠分支中的匹配和父标题',await subchapter.isVisible() && await outline.locator('.toc-link:visible').count()===3);
  await chapterSearch.fill('没有匹配的章节标题');
  checks('目录筛选无匹配时显示提示',await outline.getByText('没有匹配的章节。',{exact:true}).isVisible());
  await chapterSearch.clear();
  checks('清空目录筛选后恢复折叠状态',await subchapter.isHidden());
  const settingsButton = page.getByRole('button',{name:'阅读设置',exact:true});
  const settingsPanel = page.getByRole('region',{name:'阅读设置',exact:true});
  await settingsButton.click();
  await page.screenshot({path:'test-results/reader-settings.png',animations:'disabled'});
  const article = page.locator('article');
  const standardWidth = (await article.boundingBox()).width;
  await settingsPanel.getByRole('button',{name:'宽版',exact:true}).click();
  checks('设置面板可扩大版心', (await article.boundingBox()).width > standardWidth);
  await settingsPanel.getByRole('button',{name:'标准',exact:true}).click();
  const originalSize = await article.evaluate(node=>getComputedStyle(node).fontSize);
  await settingsPanel.getByRole('button',{name:'放大字号',exact:true}).click();
  checks('设置面板可放大字号',parseFloat(await article.evaluate(node=>getComputedStyle(node).fontSize)) > parseFloat(originalSize));
  await settingsPanel.getByRole('button',{name:'缩小字号',exact:true}).click();
  await settingsPanel.getByRole('button',{name:'标准蓝',exact:true}).click();
  checks('可选标准蓝配色',await page.locator('body').getAttribute('data-palette')==='blue');
  await settingsPanel.getByRole('button',{name:'纸感绿',exact:true}).click();
  checks('可切回原纸感绿配色',await page.locator('body').getAttribute('data-palette')==='paper');
  await page.getByLabel('自定义主题色',{exact:true}).evaluate(node=>{node.value='#d497aa';node.dispatchEvent(new Event('input',{bubbles:true}));});
  checks('可应用自定义主题色',await page.evaluate(()=>document.body.dataset.palette==='custom'&&document.body.style.getPropertyValue('--reader-seed')==='#d497aa'));
  await page.reload(); await ready();
  checks('自定义配色跨刷新保存',await page.locator('body').getAttribute('data-palette')==='custom');
  const second = await context.newPage();
  await second.goto(initial); await second.locator('body.md-reader').waitFor();
  await settingsButton.click();
  await settingsPanel.getByRole('button',{name:'纸感绿',exact:true}).click();
  await second.waitForFunction(()=>document.body.dataset.palette==='paper');
  checks('阅读器配色在已打开的文档间同步',true);
  await second.close();
  await page.keyboard.press('Escape');
  checks('阅读设置可用 Escape 关闭并恢复焦点',await settingsPanel.isHidden() && await settingsButton.evaluate(node=>node === document.activeElement));
  await page.getByRole('link', {name:'直接前往使用指南的「中文锚点」章节'}).click();
  await ready(); await aligned('中文锚点');
  checks('跨文档中文锚点定位', page.url().includes(encodeURIComponent('使用指南')) && page.url().includes('#'));
  await page.reload(); await ready(); await aligned('中文锚点');
  checks('刷新后重新定位中文目标', true);
  await page.getByRole('link', {name:'跳到第二个重复标题',exact:true}).click();
  await aligned('重复标题-1'); checks('重复标题 -1 独立定位',true);
  await page.evaluate(()=>scrollTo(0,scrollY+200));
  await page.locator('.reader-toc a').filter({hasText:'重复标题'}).nth(1).click();
  await aligned('重复标题-1'); checks('相同锚点重复点击再次定位',true);
  await page.goBack(); await aligned('中文锚点'); checks('同文档浏览器后退',true);
  await page.goForward(); await aligned('重复标题-1'); checks('同文档浏览器前进',true);
  await page.goto(`${target}#${encodeURIComponent('阅读节奏')}`); await ready(); await aligned('阅读节奏');
  const deepSection = outline.getByRole('link',{name:'阅读节奏',exact:true});
  checks('打开深层锚点会展开所在目录分支',await deepSection.isVisible());
  await outline.getByRole('button',{name:'收起 关于 MD Reader 的下级章节',exact:true}).click();
  checks('折叠当前章节分支时高亮其可见父标题',await outline.locator('.toc-link.active').textContent()==='关于 MD Reader');
  await outline.getByRole('link',{name:'关于 MD Reader',exact:true}).click();
  await aligned('关于-md-reader');
  checks('折叠时仍可点击父标题跳转',decodeURIComponent(new URL(page.url()).hash)==='#关于-md-reader');
  for (const id of ['custom-bookmark','my-section','hello-world']) {
    await page.goto(`${target}#${id}`); await ready(); await aligned(id);
    checks(`直接加载锚点 ${id}`,true);
  }
  await page.goto(`${target}#Hello%20World`); await ready(); await aligned('hello-world');
  checks('原始标题文字兼容',true);
  await page.goto(`${target}#not-found`); await ready();
  await page.getByRole('status').filter({hasText:'没有找到章节'}).waitFor();
  checks('不存在的锚点明确提示',true);
  await page.goto(initial); await ready();
  await settingsButton.click();
  await settingsPanel.getByRole('button',{name:'深色',exact:true}).click();
  await page.keyboard.press('Escape');
  checks('切换深色主题', await page.locator('body').getAttribute('data-theme')==='dark');
  await page.screenshot({path:'test-results/reader-dark.png',animations:'disabled'});
  await page.emulateMedia({media:'print'});
  checks('深色配色打印保持白底',await page.evaluate(()=>getComputedStyle(document.body).backgroundColor==='rgb(255, 255, 255)'));
  await page.emulateMedia({media:'screen'});
  await page.reload(); await ready();
  checks('主题设置跨刷新保存', await page.locator('body').getAttribute('data-theme')==='dark');
  await page.getByRole('button',{name:'显示 Markdown 源文'}).click();
  checks('源文视图保留原文', (await page.locator('#md-reader-source').textContent()).startsWith('# 留一点空间'));
  await page.getByRole('button',{name:'显示 Markdown 源文'}).click();
  await page.getByRole('searchbox',{name:'筛选章节'}).fill('保持');
  checks('目录筛选仅保留匹配章节及其父标题', await page.locator('.reader-toc a:visible').count()===2);
  await page.getByRole('searchbox',{name:'筛选章节'}).fill('');
  await page.setViewportSize({width:390,height:844});
  checks('窄屏没有横向溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const sidebarButton = page.getByRole('button',{name:'显示或隐藏文档导航'});
  await sidebarButton.click();
  checks('窄屏目录可展开',await page.locator('body').evaluate(n=>n.classList.contains('reader-toc-open')));
  await page.screenshot({path:'test-results/reader-mobile-nav.png',animations:'disabled'});
  await page.keyboard.press('Escape');
  checks('窄屏侧栏关闭后将焦点还给按钮',await sidebarButton.evaluate(node=>node.getAttribute('aria-expanded')==='false' && node===document.activeElement));
  await page.screenshot({path:'test-results/reader-mobile.png',animations:'disabled'});
  await page.setViewportSize({width:320,height:640});
  await settingsButton.click();
  checks('320px 窄屏设置完整位于视口内',await settingsPanel.evaluate(node=>{
    const {left,right,bottom} = node.getBoundingClientRect();
    return left >= 0 && right <= innerWidth && bottom <= innerHeight && document.documentElement.scrollWidth === innerWidth;
  }));
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(`${base}/unsafe.md`); await ready();
  checks('不执行文档中的脚本和事件',await page.evaluate(()=>!window.pwned));
  checks('移除脚本、样式与危险链接',await page.locator('article script,article style,article [onerror],article a[href^="javascript:"]').count()===0);
  await page.goto(`${base}/collisions.md#inside`); await ready(); await aligned('inside');
  checks('自动展开目标所在的折叠段落',await page.locator('article details').evaluate(n=>n.open));
  checks('正文同名 ID 不会覆盖源文界面',await page.locator('article h2').first().textContent()==='md-reader-source');
  await page.getByRole('button',{name:'显示 Markdown 源文'}).click();
  checks('同名锚点不会破坏源文切换',await page.locator('main > pre').isVisible());
  await page.goto(`${base}/existing.md`);
  checks('跳过已有 HTML 页面并不污染其样式', await page.evaluate(()=>!document.body.classList.contains('md-reader') && getComputedStyle(document.querySelector('h1')).fontSize==='32px'));
  await page.goto(`${base}/delayed.md#target`); await ready(); await aligned('target');
  await page.waitForFunction(()=>document.querySelector('article img')?.complete);
  await aligned('target'); checks('图片延迟加载后校正目标位置',true);
  const local = pathToFileURL(join(root,'examples/开始阅读.md')).href;
  await page.goto(local); await ready();
  await page.getByRole('link',{name:'直接前往使用指南的「中文锚点」章节'}).click();
  await ready(); await aligned('中文锚点');
  checks('本地 file:// 中文路径跨文件锚点',page.url().startsWith('file://'));
  await page.goBack(); await ready();
  checks('跨文件浏览器后退',page.url()===local);
  await page.goForward(); await ready(); await aligned('中文锚点');
  checks('跨文件浏览器前进恢复锚点',true);
  await page.goto(pathToFileURL(join(fixture,siblingNames[0])).href); await ready();
  await page.locator('.reader-file-link').nth(siblingNames.length-1).waitFor();
  checks('自动列出同目录全部 Markdown 文档',await page.locator('.reader-file-link').count()===siblingNames.length);
  checks('仅当前目录 Markdown，不含其他格式或子目录',!(await page.locator('.reader-file-list').textContent()).includes('not-markdown') && !(await page.locator('.reader-file-list').textContent()).includes('不应递归'));
  checks('文件按名称自然排序',JSON.stringify(await page.locator('.reader-file-link > span:last-child').allTextContents())===JSON.stringify(siblingNames));
  checks('当前文件高亮',await page.locator('.reader-file-link[aria-current="page"]').getAttribute('title')===siblingNames[0]);
  await page.getByRole('searchbox',{name:'筛选 Markdown 文件'}).fill('中文');
  checks('文件名称筛选',await page.locator('.reader-file-link').count()===1);
  await page.locator('.reader-file-link').click(); await ready();
  checks('含中文空格井号百分号的文件切换',page.url()===pathToFileURL(join(fixture,siblingNames[1])).href);
  await page.locator('.reader-file-link').nth(siblingNames.length-1).waitFor();
  await page.getByRole('link',{name:siblingNames[2],exact:false}).click(); await ready();
  checks('引号括号逗号文件名切换',page.url()===pathToFileURL(join(fixture,siblingNames[2])).href);
  await page.getByRole('tab',{name:'目录',exact:true}).click();
  await page.locator('.reader-toc a').filter({hasText:'目标章节'}).click(); await aligned('目标章节');
  checks('文件侧栏与章节目录切换仍可定位',true);
  await page.reload(); await ready();
  checks('记住侧栏标签选择',await page.getByRole('tab',{name:'目录',exact:true}).getAttribute('aria-selected')==='true');
  await page.getByRole('tab',{name:'文件',exact:true}).click();
  await writeFile(join(fixture,'20 新增.md'),'# 新增文档');
  await page.getByRole('button',{name:'刷新文件列表',exact:true}).click();
  await page.getByRole('link',{name:'20 新增.md',exact:true}).waitFor();
  checks('刷新发现新文件',await page.locator('.reader-file-link').count()===siblingNames.length+1);
  await rm(join(fixture,'20 新增.md'));
  await page.getByRole('button',{name:'刷新文件列表',exact:true}).click();
  await page.waitForFunction(count=>document.querySelectorAll('.reader-file-link').length===count,siblingNames.length);
  checks('刷新移除已删除文件',true);
  await page.getByRole('searchbox',{name:'筛选 Markdown 文件'}).fill('不存在');
  await page.getByText('没有匹配的文件。',{exact:true}).waitFor();
  checks('筛选无结果有明确提示',true);
  await page.getByRole('searchbox',{name:'筛选 Markdown 文件'}).fill('');
  await page.evaluate(()=>scrollTo(0,0));
  const newTab = context.waitForEvent('page');
  await page.getByRole('link',{name:siblingNames[0],exact:false}).click({button:'middle'});
  const opened = await newTab;
  await opened.locator('body.md-reader').waitFor();
  checks('文件可在新标签页打开',opened.url()===pathToFileURL(join(fixture,siblingNames[0])).href);
  await opened.close();
  await page.getByRole('link',{name:'13 混合.Md',exact:true}).click(); await ready();
  checks('混合大小写 Markdown 后缀可正常切换渲染',page.url()===pathToFileURL(join(fixture,'13 混合.Md')).href);
  await page.goto(local); await ready();
  await page.locator('.reader-file-link').nth(2).waitFor();
  await page.screenshot({path:'test-results/reader-files.png',animations:'disabled'});
  await settingsButton.click();
  await settingsPanel.getByRole('button',{name:'浅色',exact:true}).click();
  await page.locator('.reader-main').click({position:{x:12,y:16}});
  checks('点击正文可关闭阅读设置',await settingsPanel.isHidden());
  await page.screenshot({path:'test-results/reader-desktop.png',animations:'disabled'});
  checks('无浏览器运行异常',errors.length===0);
  console.log(`\n${results.length} browser checks passed.`);
} catch (error) {
  const active = context?.pages().at(-1);
  if (active) {
    console.error('Folder panel:',await active.locator('.reader-files-panel').textContent().catch(()=>''));
    await active.screenshot({path:'test-results/failure.png'}).catch(()=>{});
  }
  const worker = context?.serviceWorkers()[0];
  if (worker) {
    const listing = await worker.evaluate(async url => (await fetch(url)).text(),pathToFileURL(fixture + '/').href).catch(error=>error.message);
    await writeFile('test-results/directory-listing.html',listing);
  }
  throw error;
} finally {
  await context?.close();
  server.close();
  await rm(profile,{recursive:true,force:true});
  await rm(fixture,{recursive:true,force:true});
}
