export function createOutline({ nav, filter, headings }) {
  const document = nav.ownerDocument;
  const entries = new Map();
  const roots = [];
  const ancestors = [];

  for (const heading of headings) {
    while (ancestors.length && ancestors.at(-1).heading.level >= heading.level) ancestors.pop();
    const parent = ancestors.at(-1);
    const entry = { heading, parent, children: [], expanded: !parent };
    (parent ? parent.children : roots).push(entry);
    ancestors.push(entry);
    entries.set(heading.element, entry);
  }

  let query = '';
  let current;
  let highlighted;

  function updateIndicator() {
    let visible = current;
    for (let entry = current; entry; entry = entry.parent) {
      if (entry.item.hidden || entry.parent?.group.hidden) visible = entry.parent;
    }
    if (visible === highlighted) return;
    highlighted?.link.classList.remove('active');
    visible?.link.classList.add('active');
    highlighted = visible;
  }

  function setExpanded(entry, expanded) {
    entry.group.hidden = !expanded;
    entry.button.setAttribute('aria-expanded', String(expanded));
    const action = expanded ? '收起' : '展开';
    entry.button.setAttribute('aria-label', `${action} ${entry.link.textContent} 的下级章节`);
    entry.button.title = `${action}下级章节`;
  }

  function renderList(nodes) {
    const list = document.createElement('ul');
    list.className = 'toc-list';
    for (const entry of nodes) {
      const item = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'toc-row';
      const link = document.createElement('a');
      link.className = 'toc-link';
      link.href = `#${encodeURIComponent(entry.heading.id)}`;
      link.textContent = entry.heading.text || '未命名章节';
      entry.item = item;
      entry.link = link;
      item.append(row);
      list.append(item);

      if (entry.children.length) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'toc-disclosure';
        entry.button = button;
        entry.group = renderList(entry.children);
        row.append(button);
        item.append(entry.group);
        setExpanded(entry, entry.expanded);
        button.addEventListener('click', () => {
          const expanded = entry.group.hidden;
          if (!query) entry.expanded = expanded;
          setExpanded(entry, expanded);
          updateIndicator();
        });
      }
      row.append(link);
    }
    return list;
  }

  if (roots.length) nav.append(renderList(roots));
  const empty = document.createElement('p');
  empty.className = 'reader-files-status';
  empty.setAttribute('role', 'status');
  empty.textContent = roots.length ? '没有匹配的章节。' : '这份文档没有标题。';
  empty.hidden = Boolean(roots.length);
  nav.append(empty);
  filter.disabled = !roots.length;

  const ordered = Array.from(entries.values());
  filter.addEventListener('input', () => {
    query = filter.value.trim().toLocaleLowerCase();
    // Visit children first so matching sections can keep their parent path visible.
    for (let i = ordered.length - 1; i >= 0; i--) {
      const entry = ordered[i];
      const hasVisibleChildren = entry.children.some(child => !child.item.hidden);
      entry.item.hidden = Boolean(query && !hasVisibleChildren && !entry.link.textContent.toLocaleLowerCase().includes(query));
      if (entry.group) {
        entry.button.hidden = Boolean(query && !hasVisibleChildren);
        setExpanded(entry, query ? hasVisibleChildren : entry.expanded);
      }
    }
    empty.hidden = roots.some(root => !root.item.hidden);
    updateIndicator();
  });

  return {
    setCurrent(element) {
      const entry = entries.get(element);
      if (entry === current) return;
      current?.link.removeAttribute('aria-current');
      entry?.link.setAttribute('aria-current', 'location');
      current = entry;
      updateIndicator();
    },
    reveal(element) {
      for (let parent = entries.get(element)?.parent; parent; parent = parent.parent) {
        parent.expanded = true;
        if (!parent.button.hidden) setExpanded(parent, true);
      }
      updateIndicator();
    },
  };
}
