import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styled, { keyframes, css } from 'styled-components';
import { useJournalContext, registerDraftFlush } from '../JournalContext';
import { api, errorMessage } from '../api';
import type { OutlineItem } from '../types';
import { TextButton, VisuallyHidden } from '../styles';
import { MarkdownContent, markdownText, richTextStyles, mergeMarkdown, formatMarkdown, pastedBullet } from '../markdown';
import { RichTextEditor, type RichTextHandle, type TextOffsets } from './RichTextEditor';
import { documentUndo, editDocument, recordEdit } from '../documentHistory';

const MAX_LEVELS = 8;
const OutlineSurface = styled.div<{ $task: boolean }>`
  position: relative; outline: none;
  --bullet-size: ${({ $task }) => $task ? '18px' : '16px'};
  --bullet-row-height: ${({ $task }) => $task ? '40px' : '32px'};
  --bullet-padding: ${({ $task }) => $task ? '7px 0' : '5px 0'};
  --bullet-line-height: 1.3;
  --bullet-paragraph-gap: .25em;
`;
const List = styled.ul`list-style: none; padding: 0; margin: 0;`;
const Children = styled(List)<{ $task: boolean }>`
  padding-left: ${({ $task }) => $task ? '28px' : '20px'};
  @media(max-width: 900px) { padding-left: ${({ $task }) => $task ? '20px' : '12px'}; }
  @media(max-width: 440px) { padding-left: ${({ $task }) => $task ? '12px' : '8px'}; }
`;
const popOut = keyframes`0% { opacity: 1; transform: scale(1); } 40% { opacity: .8; transform: scale(1.012); } 100% { opacity: 0; transform: translateY(-3px) scale(.985); }`;
const slideIn = keyframes`from { opacity: 0; transform: translateY(-7px); } to { opacity: 1; transform: translateY(0); }`;
const Item = styled.li<{ $leaving?: boolean; $arriving?: boolean }>`
  min-width: 0; transform-origin: left center;
  ${({ $leaving }) => $leaving && css`animation: ${popOut} 180ms ease-out both; pointer-events: none;`}
  ${({ $arriving }) => $arriving && css`animation: ${slideIn} 280ms cubic-bezier(.2,.7,.3,1) both;`}
`;
const Row = styled.div`position: relative; display: flex; align-items: flex-start; min-height: var(--bullet-row-height); @media(pointer: coarse) { min-height: 44px; }`;
const Branch = styled.div<{ $open: boolean }>`
  display: grid; min-height: 0;
  grid-template-rows: ${({ $open }) => $open ? '1fr' : '0fr'};
  opacity: ${({ $open }) => $open ? 1 : 0};
  transform: translateY(${({ $open }) => $open ? '0' : '-3px'});
  visibility: ${({ $open }) => $open ? 'visible' : 'hidden'};
  pointer-events: ${({ $open }) => $open ? 'auto' : 'none'};
  transition-property: grid-template-rows, opacity, transform, visibility;
  transition-duration: 320ms, 240ms, 320ms, 0s;
  transition-timing-function: cubic-bezier(.2, 0, 0, 1);
  transition-delay: ${({ $open }) => $open ? '0s' : '0s, 60ms, 0s, 320ms'};

  > ${Children} { min-height: 0; overflow: hidden; }
  > ${Children} > ${Item} > ${Row} {
    opacity: ${({ $open }) => $open ? 1 : 0};
    transform: translateY(${({ $open }) => $open ? '0' : '-3px'});
    transition-property: opacity, transform;
    transition-duration: 220ms, 280ms;
    transition-timing-function: ease-out;
  }
  ${({ $open }) => $open && css`
    > ${Children} > ${Item}:nth-child(2) > ${Row} { transition-delay: 35ms; }
    > ${Children} > ${Item}:nth-child(3) > ${Row} { transition-delay: 70ms; }
    > ${Children} > ${Item}:nth-child(4) > ${Row} { transition-delay: 105ms; }
    > ${Children} > ${Item}:nth-child(n + 5) > ${Row} { transition-delay: 140ms; }
  `}

  @media (prefers-reduced-motion: reduce) {
    transition: none;
    > ${Children} > ${Item} > ${Row} { transition: none; }
  }
`;
const ComposerTarget = styled.button`
  display: block; width: 100%; min-height: 40px; padding: 0; border: 0; background: transparent;
  @media(pointer: coarse) { min-height: 44px; }
`;
const Marker = styled.span<{ $task: boolean }>`
  display: flex; width: 40px; min-width: 40px; height: var(--bullet-row-height); align-items: center; justify-content: center;
  &::before { content: ${({ $task }) => $task ? "''" : "'–'"}; font-size: 14px;
    ${({ $task }) => $task ? 'width: 14px; height: 14px; border: 1.5px solid var(--checkbox); border-radius: 2px;' : ''} }
  @media(pointer: coarse) { width: 44px; min-width: 44px; height: 44px; }
`;
const DraftItem = styled(Item)<{ $emptyTask: boolean }>`
  ${({ $emptyTask }) => $emptyTask && css`
    > ${Row} > ${Marker} { visibility: hidden; }
    &:focus-within > ${Row} > ${Marker} { visibility: visible; }
  `}
`;
const Checkbox = styled.button<{ $checked?: boolean }>`
  position: relative; display: flex; align-items: center; justify-content: center; width: 40px; min-width: 40px; height: 40px;
  border: 0; padding: 0; background: transparent; border-radius: 3px;
  &::before { content: ''; width: 14px; height: 14px; border: 1.5px solid var(--checkbox); border-radius: 2px; }
  &:hover::before { background: var(--soft); }
  ${({ $checked }) => $checked && css`&::after { content: ''; position: absolute; width: 7px; height: 4px; border-left: 1.5px solid var(--muted); border-bottom: 1.5px solid var(--muted); transform: rotate(-45deg); }`}
  @media(pointer: coarse) { width: 44px; min-width: 44px; height: 44px; }
`;
const Disclosure = styled.button<{ $open: boolean; $task: boolean; $progress: number }>`
  width: 40px; min-width: 40px; height: var(--bullet-row-height); padding: 0; border: 0;
  display: grid; place-items: center; background: transparent; border-radius: 4px; color: var(--muted);
  &::before { content: ''; width: 5px; height: 5px; border-right: 1.25px solid currentColor; border-bottom: 1.25px solid currentColor;
    transform: rotate(${({ $open }) => $open ? '45deg' : '-45deg'}); transition: transform 140ms ease-out; }
  ${({ $task, $progress }) => $task && css`&::before { width: 14px; height: 14px; border: 1px solid currentColor; border-radius: 50%; transform: none; background: conic-gradient(currentColor ${$progress * 360}deg, transparent 0); }`}
  @media(pointer: coarse) { width: 44px; min-width: 44px; height: 44px;
  }
`;
const Text = styled.div<{ $done?: boolean }>`
  ${richTextStyles}; cursor: text;
  flex: 1; min-width: 0; min-height: var(--bullet-row-height); padding: var(--bullet-padding); border: 0; background: transparent;
  ${({ $done }) => $done && css`color: var(--muted); text-decoration: line-through; a { color: var(--muted); }`}
  text-align: left; line-height: var(--bullet-line-height); font-size: var(--bullet-size); white-space: pre-wrap; overflow-wrap: anywhere;
  @media(pointer: coarse) { min-height: 44px; padding: 10px 0; }
`;


type Draft = {
  active: boolean; mode: 'new' | 'edit'; id: number | null; content: string; saved: string;
  clientId: ReturnType<typeof crypto.randomUUID>; parentId: number | null; afterId: number | null; hiddenTag: string | null; tags: string[]; savedTags: string[];
};
type Props = {
  kind: 'notes' | 'tasks'; items: OutlineItem[]; day?: string; composer?: boolean;
  refresh: () => Promise<void>; notify: (message: string) => void;
};
function selectedTextOffsets(element?: HTMLElement, link?: HTMLElement): TextOffsets | undefined {
  if (element && link) {
    const range = document.createRange();
    range.selectNodeContents(element); range.setEndBefore(link);
    const anchor = range.toString().length;
    return { anchor, head: anchor + (link.textContent?.length ?? 0) };
  }
  const selection = window.getSelection();
  if (!element || !selection?.anchorNode || !selection.focusNode ||
      !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  const anchor = range.toString().length;
  range.setEnd(selection.focusNode, selection.focusOffset);
  return { anchor, head: range.toString().length };
}

const sorted = (items: OutlineItem[]) => [...items].sort((a, b) => a.position - b.position || a.id - b.id);
const siblings = (items: OutlineItem[], parentId: number | null) => sorted(items.filter(item => item.parent_id === parentId));
const fresh = (items: OutlineItem[], active: boolean, parentId: number | null = null, afterId?: number | null): Draft => ({
  tags: [], savedTags: [], hiddenTag: null, active, mode: 'new', id: null, content: '', saved: '', clientId: crypto.randomUUID(), parentId,
  afterId: afterId === undefined ? siblings(items, parentId).at(-1)?.id ?? null : afterId,
});

export function Outline({ kind, items, day, composer = false, refresh, notify }: Props) {
  const { activeTag, completed, onComplete, target } = useJournalContext();
  const blank = (...args: Parameters<typeof fresh>): Draft => ({ ...fresh(...args), hiddenTag: activeTag });
  const [expanded, setExpanded] = useState(new Set<number>());
  const [previewed, setPreviewed] = useState(new Set<number>());
  const [completing, setCompleting] = useState<number | null>(null);
  const [, setSelectedAll] = useState(false);
  const selectionActive = useRef(false);
  const surface = useRef<HTMLDivElement>(null);
  const key = kind === 'notes' ? `still-draft-${day}` : 'still-outline-tasks';
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Draft> | null;
      if (stored && (stored.content !== stored.saved || JSON.stringify(stored.tags ?? []) !== JSON.stringify(stored.savedTags ?? [])) && typeof stored.content === 'string') {
        const row = items.find(item => item.id === stored.id);
        return { ...blank(items, true), ...stored, active: true, parentId: stored.parentId ?? row?.parent_id ?? null };
      }
      for (const row of items) {
        const edit = localStorage.getItem(`still-edit-${kind}-${row.id}`);
        if (edit !== null) return { ...blank(items, true), mode: 'edit', id: row.id, content: edit, saved: row.content, parentId: row.parent_id };
      }
      const oldTask = kind === 'tasks' ? localStorage.getItem('still-task-draft') : null;
      if (oldTask) return { ...blank(items, true), content: oldTask };
    } catch { /* Keep the journal usable if old local draft metadata is malformed. */ }
    return blank(items, composer);
  });
  const current = useRef(draft);
  const records = useRef(items);
  records.current = items;
  useEffect(() => {
    if (target?.kind !== kind) return;
    const item = records.current.find(row => row.id === target.id);
    if (!item) return;
    const parents: number[] = [];
    let parent = item.parent_id;
    while (parent !== null) { parents.push(parent); parent = records.current.find(row => row.id === parent)?.parent_id ?? null; }
    setExpanded(previous => new Set([...previous, ...parents]));
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-kind="${kind}"][data-item-id="${target.id}"] [role="group"]`);
      row?.scrollIntoView({ block: 'center' }); row?.focus({ preventScroll: true });
    }));
    return () => cancelAnimationFrame(frame);
  }, [target, kind]);
  const mounted = useRef(true);
  const input = useRef<RichTextHandle>(null);
  const pendingSelection = useRef<TextOffsets | undefined>(undefined);
  const pendingLinkEdit = useRef(false);
  const queue = useRef<Promise<number | null>>(Promise.resolve(null));
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const previouslyComposer = useRef(composer);
  const persist = useCallback((next: Draft) => {
    current.current = next;
    if (next.active) localStorage.setItem(key, JSON.stringify(next));
    else localStorage.removeItem(key);
    if (mounted.current) setDraft(next);
  }, [key]);
  const focus = () => requestAnimationFrame(() => {
    if (selectionActive.current) return;
    input.current?.focus({ preventScroll: false }, pendingSelection.current);
    if (pendingLinkEdit.current) input.current?.editLink();
    pendingSelection.current = undefined;
    pendingLinkEdit.current = false;
  });
  const dismissEmptyDraft = () => {
    if (lock.current) return false;
    const snapshot = current.current;
    if (snapshot.mode !== 'new' || snapshot.id !== null || snapshot.content.trim() || snapshot.tags.length) return false;
    persist(blank(records.current, false));
    return true;
  };

  const save = useCallback(() => {
    const operation = queue.current.catch(() => null).then(async () => {
      const snapshot = current.current;
      if (!snapshot.active || snapshot.content === snapshot.saved && JSON.stringify(snapshot.tags) === JSON.stringify(snapshot.savedTags)) return snapshot.id;
      setSaving(true);
      try {
        if (!snapshot.content.trim() && !snapshot.tags.length) {
          if (snapshot.id) {
            await editDocument([{ kind, id: snapshot.id, delete: true }], snapshot.clientId);
            persist({ ...current.current, id: null, saved: '', savedTags: [], clientId: crypto.randomUUID() });
            await refresh();
          }
          setFailed(false); return null;
        }
        const [result] = await editDocument([{
          kind, id: snapshot.id, content: snapshot.content, tags: snapshot.tags, date: day, client_id: snapshot.clientId, parent_id: snapshot.parentId, after_id: snapshot.afterId,
        }], snapshot.clientId);
        if (!result) throw new Error('The entry could not be saved.');
        persist({ ...current.current, id: result.id, saved: snapshot.content, savedTags: snapshot.tags });
        if (kind === 'tasks') localStorage.removeItem('still-task-draft');
        if (snapshot.id) localStorage.removeItem(`still-edit-${kind}-${snapshot.id}`);
        setFailed(false); await refresh(); return result.id;
      } catch (error) { setFailed(true); notify(errorMessage(error)); throw error; }
      finally { if (mounted.current) setSaving(false); }
    });
    queue.current = operation;
    return operation;
  }, [day, kind, notify, persist, refresh]);

  useEffect(() => registerDraftFlush(save), [save]);
  useEffect(() => {
    const applied = () => { selectionActive.current = false; setSelectedAll(false); persist(blank([], composer)); };
    window.addEventListener('still-history-applied', applied);
    return () => window.removeEventListener('still-history-applied', applied);
  }, [composer, persist]);
  useEffect(() => {
    if (kind !== 'notes' || !draft.active || draft.mode === 'edit') return;
    const timeout = setTimeout(() => { void save().catch(() => {}); }, 700);
    return () => clearTimeout(timeout);
  }, [draft.content, draft.tags, draft.active, draft.mode, kind, save]);
  useEffect(() => {
    if (previouslyComposer.current && !composer && kind === 'notes') {
      setDraft(value => ({ ...value, active: false }));
      void save().then(() => persist(blank(records.current, false))).catch(() => {
        current.current = { ...current.current, active: false };
        setDraft(current.current);
        // Keep the unsaved local copy for the earlier-day recovery worker.
      });
    }
    previouslyComposer.current = composer;
  }, [composer, kind, persist, save]);
  useEffect(() => {
    mounted.current = true;
    const onFocus = () => {
      if (kind === 'notes' && composer && !document.querySelector('dialog[open]') && document.activeElement === document.body) input.current?.focus({ preventScroll: true });
    };
    const frame = requestAnimationFrame(() => {
      if (kind === 'notes' && composer) input.current?.focus({ preventScroll: true });
    });
    const flush = () => { void save().catch(() => {}); };
    window.addEventListener('focus', onFocus); window.addEventListener('pagehide', flush);
    return () => {
      mounted.current = false; cancelAnimationFrame(frame);
      window.removeEventListener('focus', onFocus); window.removeEventListener('pagehide', flush);
      void save().catch(() => {});
    };
  }, [composer, kind, save]);

  const run = async (action: () => Promise<void>, restoreFocus = true) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { await action(); }
    catch (error) { notify(errorMessage(error)); }
    finally { lock.current = false; if (mounted.current) { setBusy(false); if (restoreFocus) focus(); } }
  };
  const select = (row: OutlineItem, element?: HTMLElement, contextLink?: HTMLElement, offsets?: TextOffsets) => {
    const selection = offsets ?? selectedTextOffsets(element, contextLink);
    void run(async () => {
      await save();
      const group = siblings(records.current, row.parent_id);
      const index = group.findIndex(item => item.id === row.id);
      const content = row.content;
      persist({ ...blank(records.current, true), mode: 'edit', id: row.id, content, saved: content,
        tags: row.tags ?? [], savedTags: row.tags ?? [], hiddenTag: activeTag && row.tags?.includes(activeTag) ? activeTag : null,
        parentId: row.parent_id, afterId: group[index - 1]?.id ?? null });
      pendingSelection.current = selection;
      pendingLinkEdit.current = Boolean(contextLink);
    });
  };
  const move = async (outdent: boolean) => {
    const snapshot = current.current;
    const parent = records.current.find(item => item.id === snapshot.parentId);
    const group = siblings(records.current, snapshot.parentId).filter(item => item.id !== snapshot.id);
    const previous = snapshot.afterId !== null ? group.find(item => item.id === snapshot.afterId) : undefined;
    if (outdent ? !parent : !previous) return;
    const parentId = outdent ? parent!.parent_id : previous!.id;
    const afterId = outdent ? parent!.id : siblings(records.current, previous!.id).at(-1)?.id ?? null;
    let level = 1, ancestor = parentId;
    while (ancestor !== null) { level++; ancestor = records.current.find(item => item.id === ancestor)?.parent_id ?? null; }
    if (level > MAX_LEVELS) throw new Error(`Bullets support up to ${MAX_LEVELS} levels.`);
    const id = await save();
    if (id) await editDocument([{ kind, id, move: true, parent_id: parentId, after_id: afterId }]);
    persist({ ...current.current, parentId, afterId });
    if (id) await refresh();
  };
  const complete = (id: number) => void run(async () => {
    await save();
    const task = records.current.find(row => row.id === id)!;
    if (task.completed_at) {
      const result = await api<{ operation_id: string | null }>(`/tasks/${id}/reopen`, 'POST', { completed_at: task.completed_at, record_history: true });
      recordEdit(result.operation_id, crypto.randomUUID());
      await refresh(); return;
    }
    let finishing = task;
    while (finishing.parent_id !== null) {
      const parent = records.current.find(row => row.id === finishing.parent_id);
      if (!parent || (parent.completed_child_count ?? 0) + 1 !== parent.child_count) break;
      finishing = parent;
    }
    if (finishing.parent_id === null) setCompleting(finishing.id);
    try {
      const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
      const [result] = await Promise.all([api<{ task_ids: number[]; completed_at: string }>(`/tasks/${id}/complete`, 'POST'), new Promise(resolve => setTimeout(resolve, delay))]);
      onComplete(result.task_ids, id, result.completed_at);
      persist(blank(records.current, composer));
      await refresh();
    } finally { setCompleting(null); }
  }, false);

  useEffect(() => {
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; id: number | null; end: boolean }>).detail;
      if (detail.key !== key) return;
      const row = records.current.find(item => item.id === detail.id);
      if (row && !row.completed_at) {
        const offset = detail.end ? markdownText(row.content).length : 0;
        select(row, undefined, undefined, { anchor: offset, head: offset });
      } else if (detail.id === null) { persist(blank(records.current, true)); focus(); }
    };
    window.addEventListener('still-navigate-bullet', navigate);
    return () => window.removeEventListener('still-navigate-bullet', navigate);
  });
  const boundary = (direction: 'up' | 'down' | 'backspace' | 'delete') => void run(async () => {
    const currentElement = surface.current?.querySelector('[contenteditable]')?.closest('li');
    const elements = [...document.querySelectorAll<HTMLElement>('li[data-outline-key][data-item-id]')].filter(el => el.offsetParent !== null && !el.closest('[aria-hidden="true"]') && el.dataset.done !== 'true');
    const index = elements.findIndex(el => el === currentElement);
    const backwards = direction === 'up' || direction === 'backspace';
    const adjacent = elements[index + (backwards ? -1 : 1)];
    if (!adjacent) return;
    const id = adjacent.dataset.itemId === 'draft' ? null : Number(adjacent.dataset.itemId);
    if (direction === 'up' || direction === 'down') {
      await save();
      // Deliver after this outline releases its mutation lock.
      setTimeout(() => window.dispatchEvent(new CustomEvent('still-navigate-bullet', { detail: { key: adjacent.dataset.outlineKey, id, end: backwards } })), 0);
      return;
    }
    if (adjacent.dataset.outlineKey !== key || id === null) return;
    const other = records.current.find(row => row.id === id);
    if (!other) return;
    const snapshot = current.current;
    const ownId = await save();
    if (!ownId) return;
    const first = backwards ? other : { ...other, id: ownId, content: snapshot.content, tags: snapshot.tags };
    const second = backwards ? { ...other, id: ownId, content: snapshot.content, tags: snapshot.tags } : other;
    const content = mergeMarkdown(first.content, second.content), tags = [...new Set([...first.tags ?? [], ...second.tags ?? []])];
    const [result] = await editDocument([{ kind, id: first.id, content, tags }, { kind, id: second.id, delete: true }]);
    if (!result) return;
    persist({ ...blank([], true), mode: 'edit', id: result.id, content, saved: content, tags, savedTags: tags, parentId: result.parent_id });
    pendingSelection.current = { anchor: markdownText(first.content).length, head: markdownText(first.content).length };
    await refresh();
  }, direction === 'backspace' || direction === 'delete');
  const selectDocument = () => {
    selectionActive.current = true; setSelectedAll(true); setExpanded(new Set(records.current.map(item => item.id)));
    if (surface.current) {
      surface.current.focus(); const selection = window.getSelection(), range = document.createRange();
      range.selectNodeContents(surface.current); selection?.removeAllRanges(); selection?.addRange(range);
    }
    void save().catch(() => {});
  };
  const replaceDocument = (text = '', html = '') => void run(async () => {
    await save();
    const bullet = pastedBullet(text, html);
    const tags = [...new Set([...bullet.tags, ...(activeTag ? [activeTag] : [])])];
    const changes: Record<string, unknown>[] = records.current.filter(item => !item.completed_at).map(item => ({ kind, id: item.id, delete: true }));
    const hasContent = !!(bullet.content.trim() || bullet.tags.length);
    if (hasContent) changes.push({ kind, content: bullet.content, tags, date: day, client_id: crypto.randomUUID() });
    const results = changes.length ? await editDocument(changes) : [];
    const created = hasContent ? results.at(-1) : null;
    selectionActive.current = false; setSelectedAll(false); window.getSelection()?.removeAllRanges();
    persist(created ? { ...blank([], true), mode: 'edit', id: created.id, content: created.content, saved: created.content, tags: created.tags ?? [], savedTags: created.tags ?? [] } : blank([], composer));
    if (created) pendingSelection.current = { anchor: markdownText(created.content).length, head: markdownText(created.content).length };
    await refresh();
  });
  const copyDocument = (clipboard: DataTransfer) => {
    const lines: string[] = [];
    const build = (parent: number | null, depth: number): HTMLUListElement => {
      const list = document.createElement('ul');
      for (const row of sorted(records.current.filter(item => (item.parent_id !== null && !records.current.some(other => other.id === item.parent_id) ? null : item.parent_id) === parent))) {
        const tags = row.tags?.filter(tag => tag !== activeTag) ?? [];
        lines.push('  '.repeat(depth) + '- ' + row.content.replace(/\n/g, '\n' + '  '.repeat(depth + 1)) + (tags.length ? ' ' + tags.map(tag => '#' + tag).join(' ') : ''));
        const li = document.createElement('li');
        const element = surface.current?.querySelector(`[data-item-id="${row.id}"]`);
        const text = element?.querySelector(':scope > div > [role="group"], :scope > div .tiptap');
        if (text) li.innerHTML = text.innerHTML;
        else li.textContent = markdownText(row.content);
        const children = build(row.id, depth + 1);
        if (children.children.length) li.append(children);
        list.append(li);
      }
      return list;
    };
    clipboard.setData('text/html', build(null, 0).outerHTML); clipboard.setData('text/plain', lines.join('\n'));
  };

  const draftInside = (id: number) => {
    let parent = current.current.active ? current.current.parentId : null;
    while (parent !== null) {
      if (parent === id) return true;
      parent = records.current.find(row => row.id === parent)?.parent_id ?? null;
    }
    return false;
  };
  const clearPreview = (id: number | null) => {
    if (id === null) return;
    setPreviewed(previous => {
      if (!previous.size) return previous;
      const next = new Set(previous);
      for (const candidate of previous) {
        let ancestor: number | null = candidate;
        while (ancestor !== null) {
          if (ancestor === id) { next.delete(candidate); break; }
          ancestor = records.current.find(row => row.id === ancestor)?.parent_id ?? null;
        }
      }
      return next.size === previous.size ? previous : next;
    });
  };
  const isExpanded = (id: number) => expanded.has(id) || previewed.has(id) || draftInside(id);
  const renderToggle = (id: number | null, content: string) => {
    const row = items.find(item => item.id === id);
    const childCount = row?.child_count ?? items.filter(item => item.parent_id === id).length;
    const doneCount = row?.completed_child_count ?? items.filter(item => item.parent_id === id && item.completed_at).length;
    if (id === null || !childCount && !(draft.active && draft.parentId === id && (draft.content.trim() || draft.tags.length))) return null;
    const open = isExpanded(id);
    const pinned = expanded.has(id) || draftInside(id);
    if (kind === 'tasks' && row?.completed_at) return <Disclosure as="span" $open={false} $task $progress={1} role="progressbar"
      aria-label={`${markdownText(content)} completion`} aria-valuemin={0} aria-valuemax={childCount} aria-valuenow={doneCount} />;
    return <Disclosure type="button" $open={open} $task={kind === 'tasks'} $progress={childCount ? doneCount / childCount : 0} disabled={busy} aria-expanded={open}
      aria-description={kind === 'tasks' ? `${doneCount} of ${childCount} children completed` : undefined}
      aria-label={`${pinned ? 'Collapse' : 'Expand'} ${markdownText(content) || 'bullet'}`}
      onPointerEnter={event => {
        if (!pinned && event.pointerType !== 'touch') setPreviewed(previous => previous.has(id) ? previous : new Set([...previous, id]));
      }} onClick={() => void run(async () => {
        if (pinned) {
          await save();
          if (draftInside(id)) persist(blank(records.current, composer));
          clearPreview(id);
        }
        setExpanded(previous => { const next = new Set(previous); if (pinned) next.delete(id); else next.add(id); return next; });
      }, false)} />;
  };

  const inputLabel = draft.mode === 'edit' ? kind === 'notes' ? 'Edit note' : 'Edit to-do' : kind === 'notes' ? 'New journal bullet' : 'New to-do';
  const renderMarker = (id: number | null, content: string) => {
    const toggle = renderToggle(id, content);
    if (kind === 'tasks' && id !== null) {
      const done = !!items.find(item => item.id === id)?.completed_at;
      return toggle ?? <Checkbox type="button" $checked={done} aria-pressed={done} disabled={busy} aria-label={`${done ? 'Reopen' : 'Complete'} ${markdownText(content)}`} onClick={() => complete(id)} />;
    }
    return toggle ?? <Marker $task={kind === 'tasks'} aria-hidden="true" />;
  };
  const renderDraft = (depth: number): ReactNode => <DraftItem key="draft" data-depth={depth}
    data-outline-key={key} data-kind={kind} data-item-id={draft.id ?? 'draft'}
    onPointerLeave={() => clearPreview(draft.id)}
    $emptyTask={kind === 'tasks' && draft.id === null && !draft.content.trim() && !draft.tags.length}
    $leaving={completing === draft.id && completing !== null}>
    <Row aria-busy={saving}>{renderMarker(draft.id, draft.content)}<RichTextEditor key={draft.clientId} ref={input} label={inputLabel} value={draft.content} tags={draft.tags.filter(tag => tag !== activeTag)} readOnly={busy}
      onBoundary={boundary} onSelectDocument={selectDocument}
      onChange={(content, tags) => persist({ ...current.current, content, tags: [...new Set([...tags, ...(current.current.hiddenTag && (content.trim() || tags.length) ? [current.current.hiddenTag] : [])])] })}
      onBlur={event => {
        if (event?.relatedTarget instanceof Node && surface.current?.contains(event.relatedTarget)) { void save().catch(() => {}); return; }
        if (!lock.current && dismissEmptyDraft()) return;
        void save().catch(() => {});
      }}
      onKeyDown={event => {
        if (event.isComposing || busy) return;
        if (event.key === 'Tab') {
          if (event.shiftKey && current.current.parentId === null) return;
          event.preventDefault(); void run(() => move(event.shiftKey));
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (!current.current.content.trim() && !current.current.tags.length && !current.current.id) {
            if (current.current.parentId !== null) void run(() => move(true));
            return;
          }
          void run(async () => {
            const snapshot = current.current;
            const id = await save();
            persist(id ? blank(records.current, true, snapshot.parentId, id) : blank(records.current, composer));
          });
        } else if (event.key === 'Backspace' && current.current.mode === 'new' && !current.current.content && !current.current.tags.length && !current.current.id) {
          event.preventDefault(); dismissEmptyDraft();
        } else if (event.key === 'Escape' && draft.mode === 'edit') {
          event.preventDefault(); persist(blank(records.current, composer)); focus();
        }
      }} /></Row>
    {failed && <TextButton onClick={() => void run(async () => { await save(); })}>Retry saving</TextButton>}
    {draft.id !== null && <Branch data-branch-for={draft.id} $open={isExpanded(draft.id)} aria-hidden={!isExpanded(draft.id)}>{renderChildren(draft.id, depth + 1)}</Branch>}
  </DraftItem>;

  const renderChildren = (parentId: number | null, depth: number): ReactNode => {
    const group: (OutlineItem | null)[] = sorted(items.filter(item =>
      (item.parent_id !== null && !items.some(parent => parent.id === item.parent_id) ? null : item.parent_id) === parentId
    )).filter(item => !draft.active || item.id !== draft.id);
    const draftParent = draft.parentId !== null && !items.some(row => row.id === draft.parentId) ? null : draft.parentId;
    if (draft.active && draftParent === parentId) {
      let index = draft.afterId !== null ? group.findIndex(item => item?.id === draft.afterId) + 1 : -1;
      if (index < 1) {
        const original = items.find(item => item.id === draft.id && item.parent_id === parentId);
        index = original ? group.filter(item => item && (item.position < original.position || item.position === original.position && item.id < original.id)).length : group.length;
      }
      group.splice(index, 0, null);
    }
    if (!group.length) return null;
    const content = group.map(item => item === null ? renderDraft(depth) : <Item key={item.id} data-outline-key={key} data-done={!!item.completed_at} data-kind={kind} data-item-id={item.id} data-depth={depth} $leaving={completing === item.id}
      onPointerLeave={() => clearPreview(item.id)}
      $arriving={kind === 'notes' && !!item.source_task_id && completed.has(item.source_task_id)}>
      <Row>{renderMarker(item.id, item.content)}<Text $done={!!item.completed_at} role="group" tabIndex={0} aria-label={markdownText(item.content) || (item.tags ?? []).filter(tag => tag !== activeTag).map(tag => '#' + tag).join(' ')}
        onClick={event => { if (!item.completed_at && !(event.target as HTMLElement).closest('a')) select(item, event.currentTarget); }}
        onContextMenu={event => {
          const link = (event.target as HTMLElement).closest('a');
          if (link && !item.completed_at) { event.preventDefault(); select(item, event.currentTarget, link); }
        }}
        onKeyDown={event => { if (!item.completed_at && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); select(item); } }}
      ><MarkdownContent content={item.content} tags={activeTag ? item.tags?.filter(tag => tag !== activeTag) : item.tags} /></Text></Row>
      <Branch data-branch-for={item.id} $open={isExpanded(item.id)} aria-hidden={!isExpanded(item.id)}>{renderChildren(item.id, depth + 1)}</Branch>
    </Item>);
    return parentId === null ? <List>{content}</List> : <Children $task={kind === 'tasks'}>{content}</Children>;
  };
  return <OutlineSurface ref={surface} $task={kind === 'tasks'} tabIndex={-1} onPointerDown={() => { selectionActive.current = false; setSelectedAll(false); }} onCopyCapture={event => {
    if (!selectionActive.current) return;
    event.preventDefault(); event.stopPropagation(); copyDocument(event.clipboardData);
  }} onCutCapture={event => { if (selectionActive.current) { event.preventDefault(); event.stopPropagation(); copyDocument(event.clipboardData); replaceDocument(); } }}
  onPasteCapture={event => { if (selectionActive.current) { event.preventDefault(); event.stopPropagation(); replaceDocument(event.clipboardData.getData('text/plain'), event.clipboardData.getData('text/html')); } }} onKeyDownCapture={event => {
    if (!selectionActive.current || event.defaultPrevented) return;
    event.stopPropagation();
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'a') { event.preventDefault(); return; }
    if (mod && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); void documentUndo(event.shiftKey || event.key.toLowerCase() === 'y').catch(e => notify(errorMessage(e))); return; }
    const format = mod ? ({ b: 'bold', i: 'italic', u: 'underline', c: event.shiftKey ? 'code' : '', x: event.shiftKey ? 'strike' : '' } as Record<string, string>)[event.key.toLowerCase()] : '';
    if (format) { event.preventDefault(); void run(async () => {
      await save();
      const changes = records.current.filter(item => !item.completed_at).map(item => ({ kind, id: item.id, content: formatMarkdown(item.content, format), tags: item.tags }));
      if (changes.length) await editDocument(changes);
      persist(blank([], composer)); selectionActive.current = false; setSelectedAll(false); window.getSelection()?.removeAllRanges(); await refresh();
    }); return; }
    if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); replaceDocument(); }
    else if (!mod && event.key.length === 1) { event.preventDefault(); replaceDocument(event.key); }
    else if (event.key === 'Escape') { event.preventDefault(); selectionActive.current = false; setSelectedAll(false); window.getSelection()?.removeAllRanges(); focus(); }
  }}>{renderChildren(null, 0)}{composer && !draft.active && <ComposerTarget type="button"
    aria-label={kind === 'tasks' ? 'Add to-do' : 'Add journal bullet'}
    onClick={() => { persist(blank(records.current, true)); focus(); }} />}
    <VisuallyHidden>Tab indents. Shift Tab outdents. Enter adds a sibling. Shift Enter adds a line break. Select all twice selects this list.</VisuallyHidden></OutlineSurface>;
}
