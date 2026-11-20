import test from 'node:test';
import assert from 'node:assert/strict';
import { getSiblingDirectory, parseDirectoryListing } from '../src/folder-listing.js';

const directory = 'file:///Users/test/%E4%B8%AD%E6%96%87%20docs/';
const row = (name, isDirectory = 0, encodedName = encodeURIComponent(name)) =>
  'addRow(' + JSON.stringify(name) + ',' + JSON.stringify(encodedName) + ',' + isDirectory + ',128,"128 B",0,"today");';
const listing = (...rows) => '<html><script>function addRow(name,url,isDirectory) {}</script>\n' + rows.join('\n');

test('lists only sibling Markdown files and naturally orders numbered filenames', () => {
  const files = parseDirectoryListing(listing(
    row('chapter10.md'), row('chapter2.md'), row('chapter1.md'),
    row('guide.Markdown'), row('notes.MdOwN'), row('plain.txt'), row('folder.md', 1),
  ), directory);
  assert.deepEqual(files.map(file => file.name), ['chapter1.md', 'chapter2.md', 'chapter10.md', 'guide.Markdown', 'notes.MdOwN']);
  assert.ok(files.every(file => file.url.startsWith(directory)));
});

test('preserves Chinese, spaces, hashes, percents, quotes and delimiter-like text', () => {
  const names = ['中文 文档.md', '#锚点 & 100%.md', 'quote"comma,).md', '");alert(1);//.md', '%20literal.md'];
  const files = parseDirectoryListing(listing(...names.map(name => row(name))), directory);
  // A slash cannot be a leaf filename; the harmless punctuation in the other names is retained.
  assert.equal(files.length, 4);
  for (const file of files) assert.equal(file.url, directory + encodeURIComponent(file.name));
  assert.ok(files.some(file => file.name === '%20literal.md' && file.url.endsWith('%2520literal.md')));
});

test('rejects path traversal, external schemes, queries and mismatched displayed names', () => {
  const files = parseDirectoryListing(listing(
    row('ok.md'), row('escape.md', 0, '../escape.md'),
    row('escape.md', 0, '%2e%2e%2fescape.md'), row('remote.md', 0, 'https://example.com/remote.md'),
    row('file.md', 0, 'file.md?read=other'), row('file.md', 0, 'file.md#hidden'),
    row('disguised.md', 0, 'different.md'), row('dir\\file.md'),
  ), directory);
  assert.deepEqual(files, [{ name:'ok.md', url:directory + 'ok.md' }]);
});

test('deduplicates listings and supports boolean directory flags', () => {
  const files = parseDirectoryListing(listing(row('ok.md'), row('ok.md'), row('also.md', false), row('folder.md', true)), directory);
  assert.deepEqual(files.map(file => file.name), ['also.md', 'ok.md']);
});

test('distinguishes an empty Chrome listing from an unsupported response', () => {
  assert.deepEqual(parseDirectoryListing(listing(), directory), []);
  assert.deepEqual(parseDirectoryListing(listing(row('notes.txt')), directory), []);
  assert.throws(() => parseDirectoryListing('<html>Access denied</html>', directory), /无法识别/);
  assert.throws(() => parseDirectoryListing(listing(), 'https://example.com/'), /本地文件夹/);
  assert.throws(() => parseDirectoryListing(listing(), 'file:///docs/file.md'), /本地文件夹/);
});

test('directory scope derives only from the main-frame local Markdown sender', () => {
  const sender = { frameId:0, tab:{id:1}, url:directory + 'chapter.md#%E4%B8%AD%E6%96%87' };
  assert.equal(getSiblingDirectory(sender), directory);
  assert.throws(() => getSiblingDirectory({ ...sender, frameId:1 }), /本地 Markdown/);
  assert.throws(() => getSiblingDirectory({ ...sender, url:'https://example.com/readme.md' }), /本地 Markdown/);
  assert.throws(() => getSiblingDirectory({ ...sender, url:'file:///docs/index.html' }), /本地 Markdown/);
  assert.throws(() => getSiblingDirectory({ ...sender, tab:null }), /本地 Markdown/);
  assert.throws(() => getSiblingDirectory({ ...sender, url:'not a URL' }), /无法识别/);
});
