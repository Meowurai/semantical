// Prefixes first, then substrings, abbreviations and small spelling mistakes.
export function fuzzyOptions(values: string[], query: string): string[] {
  const q = query.trim().toLocaleLowerCase();
  const distance = (a: string, b: string) => {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row = next;
    }
    return row[b.length];
  };
  return [...new Set(values.filter(Boolean))].map(value => {
    const text = value.toLocaleLowerCase();
    let score = Infinity;
    if (!q || text.startsWith(q)) score = text === q ? -1 : 0;
    else if (text.includes(q)) score = 10 + text.indexOf(q);
    else {
      let matched = 0;
      for (const char of text) if (char === q[matched]) matched++;
      if (matched === q.length) score = 30 + text.length - q.length;
      else if (q.length >= 3) {
        const edits = distance(q, text);
        if (edits <= (q.length >= 5 ? 2 : 1)) score = 60 + edits;
      }
    }
    return { value, score };
  }).filter(item => Number.isFinite(item.score)).sort((a, b) => a.score - b.score || a.value.localeCompare(b.value)).map(item => item.value);
}

export function autocomplete(input: HTMLInputElement, values: () => string[], update: (value: string) => void) {
  const list = document.createElement('div');
  list.id = `${input.id}-suggestions`;
  list.className = 'suggestions';
  list.role = 'listbox';
  list.setAttribute('aria-label', `${input.name} suggestions`);
  list.hidden = true;
  input.parentElement!.append(list);
  input.role = 'combobox';
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');
  let candidates: string[] = [], matches: string[] = [], active = -1;
  const close = () => {
    list.hidden = true; active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const choose = (value: string) => { input.value = value; update(value); close(); };
  const highlight = () => {
    Array.from(list.children).forEach((item, index) => item.setAttribute('aria-selected', String(index === active)));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
      list.children[active]?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const show = () => {
    matches = fuzzyOptions(candidates, input.value); active = -1;
    list.replaceChildren();
    matches.forEach((value, index) => {
      const option = document.createElement('div');
      option.role = 'option'; option.id = `${list.id}-${index}`; option.textContent = value;
      option.setAttribute('aria-selected', 'false');
      option.addEventListener('pointerdown', event => event.preventDefault());
      option.addEventListener('click', () => choose(value));
      list.append(option);
    });
    list.hidden = !matches.length;
    input.setAttribute('aria-expanded', String(matches.length > 0));
    input.removeAttribute('aria-activedescendant');
  };
  input.addEventListener('focus', () => { candidates = values(); show(); });
  input.addEventListener('input', () => { update(input.value.trim()); show(); });
  input.addEventListener('blur', () => { input.value = input.value.trim(); close(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !list.hidden) { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) show();
      if (!matches.length) return;
      active = active < 0 ? (event.key === 'ArrowDown' ? 0 : matches.length - 1) : (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      highlight();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!list.hidden && active >= 0) choose(matches[active]);
      else { input.value = input.value.trim(); close(); }
    }
  });
  return { close };
}
