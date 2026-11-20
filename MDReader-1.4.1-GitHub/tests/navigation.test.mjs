import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigator, decodeFragment, prepareHeadings, resolveAnchor } from '../src/navigation.js';

// A small document fixture keeps the pure indexing/resolution tests independent
// of browser installation. The end-to-end suite verifies actual DOM and scrolling.
function documentFixture(specs) {
  const elements = specs.map(({ tag = 'H2', text = '', id = '', name = null }) => {
    const textNode = { nodeValue: text };
    return {
      tagName: tag, id, textNode,
      get textContent() { return textNode.nodeValue; },
      getAttribute(attribute) { return attribute === 'name' ? name : null; },
      ownerDocument: {
        createTreeWalker() {
          let read = false;
          return { currentNode: null, nextNode() {
            if (read) return false;
            read = true; this.currentNode = textNode; return true;
          } };
        },
      },
    };
  });
  return {
    elements,
    querySelectorAll(selector) {
      return selector.startsWith('h1')
        ? elements.filter(element => /^H[1-6]$/.test(element.tagName))
        : elements.filter(element => element.id || element.getAttribute('name'));
    },
  };
}

test('GitHub-compatible Chinese, punctuation, and duplicate heading IDs', () => {
  const article = documentFixture([
    { text: '安装与配置' }, { text: 'Hello, World!' },
    { text: '重复标题' }, { text: '重复标题' }, { text: '重复标题' },
    { text: 'Hello, World!-1' }, { text: 'Hello, World!' },
  ]);
  assert.deepEqual(prepareHeadings(article).map(heading => heading.id), [
    '安装与配置', 'hello-world', '重复标题', '重复标题-1', '重复标题-2',
    'hello-world-1', 'hello-world-2',
  ]);
});

test('reserves explicit IDs and names before assigning heading slugs', () => {
  const article = documentFixture([
    { text: 'Custom' }, { tag: 'A', id: 'custom' },
    { text: 'Named' }, { tag: 'A', name: 'named' },
    { text: '中文标题 {#custom-id}' },
    { text: 'Already named {#ignored-marker}', id: 'existing-id' },
  ]);
  const headings = prepareHeadings(article);
  assert.deepEqual(headings.map(heading => heading.id), ['custom-1', 'named-1', 'custom-id', 'existing-id']);
  assert.equal(headings[2].text, '中文标题');
  assert.equal(headings[3].text, 'Already named');
  assert.equal(resolveAnchor(article, '#custom'), article.elements[1]);
  assert.equal(resolveAnchor(article, '#named'), article.elements[3]);
});

test('decodes Chinese fragments once and safely handles malformed escapes', () => {
  const article = documentFixture([
    { text: '安装与配置' },
    { tag: 'A', id: '%E4%B8%AD' },
    { tag: 'A', id: '100% complete' },
    { tag: 'A', id: 'a:b[1].c' },
    { tag: 'A', id: '安装100%' },
  ]);
  prepareHeadings(article);
  assert.equal(resolveAnchor(article, '#%E5%AE%89%E8%A3%85%E4%B8%8E%E9%85%8D%E7%BD%AE'), article.elements[0]);
  assert.equal(resolveAnchor(article, '#%25E4%25B8%25AD'), article.elements[1]);
  assert.equal(resolveAnchor(article, '#100% complete'), article.elements[2]);
  assert.equal(resolveAnchor(article, '#a%3Ab%5B1%5D.c'), article.elements[3]);
  assert.equal(resolveAnchor(article, '#%E5%AE%89%E8%A3%85100%'), article.elements[4]);
  assert.equal(decodeFragment('#C++'), 'C++');
});

test('exact ID wins; title fallback is allowed only when unambiguous', () => {
  const article = documentFixture([
    { text: 'Quick Start' }, { text: 'Repeated title' }, { text: 'Repeated title' },
    { text: '中文 标题' }, { tag: 'A', id: 'Quick Start' },
  ]);
  prepareHeadings(article);
  assert.equal(resolveAnchor(article, '#Quick%20Start'), article.elements[4]);
  assert.equal(resolveAnchor(article, '#QUICK%20START'), article.elements[0]);
  assert.equal(resolveAnchor(article, '#中文%20标题'), article.elements[3]);
  assert.equal(resolveAnchor(article, '#Repeated%20title'), null);
  assert.equal(resolveAnchor(article, '#repeated-title-1'), article.elements[2]);
  assert.equal(resolveAnchor(article, '#missing-section'), null);
  assert.equal(resolveAnchor(article, '#'), null);
});

test('custom markers are reserved even when appearing after natural heading', () => {
  const article = documentFixture([{ text: 'Target' }, { text: 'Later {#target}' }]);
  assert.deepEqual(prepareHeadings(article).map(heading => heading.id), ['target-1', 'target']);
  assert.equal(resolveAnchor(article, '#target'), article.elements[1]);
});

test('duplicate explicit heading IDs keep the first address and disambiguate later headings', () => {
  const article = documentFixture([
    { text: 'First {#target}' }, { text: 'Second {#target}' },
    { text: 'Third', id: 'target' }, { tag: 'A', id: 'target-1' },
    { tag: 'A', id: 'existing' }, { text: 'Fourth', id: 'existing' },
  ]);
  assert.deepEqual(prepareHeadings(article).map(heading => heading.id), ['target', 'target-2', 'target-3', 'existing-1']);
  assert.equal(resolveAnchor(article, '#target'), article.elements[0]);
  assert.equal(resolveAnchor(article, '#target-2'), article.elements[1]);
  assert.equal(resolveAnchor(article, '#existing'), article.elements[4]);
});

test('symbol-only headings get addressable unique IDs', () => {
  const article = documentFixture([{ text: '!!!' }, { text: '???' }]);
  assert.deepEqual(prepareHeadings(article).map(heading => heading.id), ['section', 'section-1']);
});

test('navigation opens all collapsed details ancestors before scrolling to the target', () => {
  const article = documentFixture([{ text: 'Nested target', id: 'target' }]);
  const outer = { tagName: 'DETAILS', open: false, parentElement: article };
  const wrapper = { tagName: 'DIV', parentElement: outer };
  const inner = { tagName: 'DETAILS', open: false, parentElement: wrapper };
  const unrelated = { tagName: 'DETAILS', open: false, parentElement: article };
  const target = article.elements[0];
  let scrolled = false;
  target.parentElement = inner;
  target.isConnected = true;
  target.classList = { add() {}, remove() {} };
  target.scrollIntoView = () => {
    assert.equal(outer.open, true, 'outer details is visible before scrolling');
    assert.equal(inner.open, true, 'inner details is visible before scrolling');
    scrolled = true;
  };
  article.addEventListener = () => {};
  article.removeEventListener = () => {};
  article.ownerDocument = { defaultView: {
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    setTimeout() { return 1; }, clearTimeout() {},
  } };
  const navigator = createNavigator({ article });
  assert.equal(navigator.navigate('#target'), target);
  assert.equal(scrolled, true);
  assert.equal(unrelated.open, false, 'unrelated collapsible content stays closed');
  navigator.destroy();
});
