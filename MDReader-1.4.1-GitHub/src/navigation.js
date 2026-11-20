import GithubSlugger, { slug } from 'github-slugger';

const headingSelector = 'h1, h2, h3, h4, h5, h6';
const headingIndexes = new WeakMap();

// Remove a trailing {#custom-id} without flattening emphasis/code inside a heading.
function removeTextSuffix(element, length) {
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (let i = nodes.length - 1; i >= 0 && length; i--) {
    const value = nodes[i].nodeValue || '';
    const count = Math.min(length, value.length);
    nodes[i].nodeValue = value.slice(0, value.length - count);
    length -= count;
  }
}

/** Assign stable GitHub-style IDs after sanitizing HTML, before adding UI links.
 * Explicit HTML IDs, named anchors, and heading {#custom-id} markers take priority.
 * Returns [{ element, id, text, level }], also used for the outline.
 */
export function prepareHeadings(article) {
  const headings = Array.from(article.querySelectorAll(headingSelector));
  const reserved = new Set();
  for (const element of article.querySelectorAll('[id], a[name]')) {
    if (element.id) reserved.add(element.id);
    const name = element.getAttribute('name');
    if (name) reserved.add(name);
  }

  // Reserve explicit suffixes up front, including those later in the document.
  for (const heading of headings) {
    const marker = /\s*\{#([^\s{}]+)\}\s*$/u.exec(heading.textContent);
    if (marker) {
      if (!heading.id) heading.id = marker[1];
      reserved.add(heading.id);
      removeTextSuffix(heading, marker[0].length);
    }
  }

  // Duplicate explicit heading IDs are invalid HTML. Keep the first target at
  // its original address, and make later headings individually addressable.
  const firstIdOwner = new Map();
  for (const element of article.querySelectorAll('[id], a[name]')) {
    if (element.id && !firstIdOwner.has(element.id)) firstIdOwner.set(element.id, element);
  }
  for (const heading of headings) {
    if (heading.id && firstIdOwner.get(heading.id) !== heading) {
      const original = heading.id;
      let suffix = 1;
      while (reserved.has(`${original}-${suffix}`)) suffix++;
      heading.id = `${original}-${suffix}`;
      reserved.add(heading.id);
    }
  }

  const slugger = new GithubSlugger();
  const index = headings.map(element => {
    const text = element.textContent.trim();
    if (!element.id) {
      // Symbols-only headings need a nonempty addressable ID.
      const title = slug(text) ? text : 'section';
      let id = slugger.slug(title);
      while (reserved.has(id)) id = slugger.slug(title);
      element.id = id;
      reserved.add(id);
    }
    return { element, id: element.id, text, level: Number(element.tagName.slice(1)) };
  });
  headingIndexes.set(article, index);
  return index;
}

/** Decode once: %25 is a literal percent, not an invitation to decode twice. */
export function decodeFragment(hash) {
  const value = String(hash || '').replace(/^#/, '');
  try { return decodeURIComponent(value); }
  catch {
    // A literal '%' in a hand-written link must not prevent adjacent encoded
    // Chinese text from decoding. Leave malformed byte runs untouched.
    return value.replace(/(?:%[\da-f]{2})+/gi, encoded => {
      try { return decodeURIComponent(encoded); }
      catch { return encoded; }
    });
  }
}

/** Resolve exact IDs/named anchors first, then an unambiguous visible heading.
 * No selector is constructed from the fragment, so punctuation is safe.
 */
export function resolveAnchor(article, hash) {
  const fragment = decodeFragment(hash);
  if (!fragment) return null;
  const anchors = Array.from(article.querySelectorAll('[id], a[name]'));
  const exactId = anchors.find(element => element.id === fragment);
  if (exactId) return exactId;
  const named = anchors.find(element => element.tagName === 'A' && element.getAttribute('name') === fragment);
  if (named) return named;

  const index = headingIndexes.get(article) || Array.from(article.querySelectorAll(headingSelector))
    .map(element => ({ element, text: element.textContent.trim(), id: element.id }));
  const matchingText = index.filter(heading => heading.text === fragment);
  if (matchingText.length === 1) return matchingText[0].element;
  if (matchingText.length > 1) return null;
  const normalized = slug(fragment);
  if (!normalized) return null;
  const matchingSlug = index.filter(heading => slug(heading.text) === normalized);
  return matchingSlug.length === 1 ? matchingSlug[0].element : null;
}

/** Call navigate() after rendering. Hash changes are handled automatically.
 * Repeated clicks on the current hash should explicitly call navigate(hash).
 * Delayed images/fonts can move the target: correct for at most 1.8 seconds,
 * stopping immediately when the user starts scrolling or interacting.
 * onFound(element, hash) and onMissing(hash) are each called once per navigation.
 */
export function createNavigator({ article, onMissing = () => {}, onFound = () => {} }) {
  const win = article.ownerDocument.defaultView;
  let active = null;
  let highlighted = null;
  let destroyed = false;

  function stopCorrection() {
    if (!active) return;
    win.clearTimeout(active.timeout);
    if (active.frame) win.cancelAnimationFrame(active.frame);
    active.observer?.disconnect();
    article.removeEventListener('load', active.schedule, true);
    active = null;
  }

  function navigate(hash = win.location.hash) {
    if (destroyed) return null;
    stopCorrection();
    highlighted?.classList.remove('anchor-target');
    highlighted = null;
    if (!hash || hash === '#') return null;
    const target = resolveAnchor(article, hash);
    if (!target) {
      onMissing(hash);
      return null;
    }
    // Initial fragment navigation ran before Markdown existed. Reveal collapsed
    // ancestors ourselves, so scrolling to a generated heading has a layout box.
    for (let ancestor = target.parentElement; ancestor && ancestor !== article; ancestor = ancestor.parentElement) {
      if (ancestor.tagName === 'DETAILS') ancestor.open = true;
    }
    highlighted = target;
    target.classList.add('anchor-target');
    const session = { frame: 0, timeout: 0, observer: null, schedule: null };
    active = session;
    const position = () => {
      session.frame = 0;
      if (active === session && target.isConnected) {
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
    };
    session.schedule = () => {
      if (active === session && !session.frame) session.frame = win.requestAnimationFrame(position);
    };
    position();
    session.schedule();
    if (win.ResizeObserver) {
      session.observer = new win.ResizeObserver(session.schedule);
      session.observer.observe(article);
    }
    article.addEventListener('load', session.schedule, true);
    article.ownerDocument.fonts?.ready.then(session.schedule);
    session.timeout = win.setTimeout(() => {
      if (active === session) stopCorrection();
    }, 1800);
    onFound(target, hash);
    return target;
  }

  const hashChanged = () => navigate();
  const keyPressed = event => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stopCorrection();
  };
  win.addEventListener('hashchange', hashChanged);
  win.addEventListener('wheel', stopCorrection, { passive: true });
  win.addEventListener('touchstart', stopCorrection, { passive: true });
  win.addEventListener('pointerdown', stopCorrection, { passive: true });
  win.addEventListener('keydown', keyPressed);

  return {
    navigate,
    destroy() {
      destroyed = true;
      stopCorrection();
      highlighted?.classList.remove('anchor-target');
      win.removeEventListener('hashchange', hashChanged);
      win.removeEventListener('wheel', stopCorrection);
      win.removeEventListener('touchstart', stopCorrection);
      win.removeEventListener('pointerdown', stopCorrection);
      win.removeEventListener('keydown', keyPressed);
    },
  };
}
