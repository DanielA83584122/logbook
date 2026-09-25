import type { OutlineItem } from './types';

/** A section row is a root journal bullet whose Markdown starts as a level-1 heading (`# title #tag`). */
export const isSectionContent = (content: string) => /^#(?:\s|$)/.test(content);
export const isSectionRow = (item: Pick<OutlineItem, 'kind' | 'parent_id' | 'content'>) =>
  item.parent_id === null && (item.kind === 'notes' || item.kind === 'note' || item.kind === undefined) && isSectionContent(item.content);
/** Blank text, or a heading marker with nothing after it: an untitled section row without tags is not worth saving. */
export const blankContent = (content: string) => !content.trim() || /^#{1,6}$/.test(content.trim());

/** Tags a new bullet would carry without holding them: the section above a root row, or its parent's own and inherited tags. */
export function inheritedTagsAt(items: OutlineItem[], parentId: number | null, afterId: number | null): Set<string> {
  if (parentId !== null) {
    const parent = items.find(item => item.id === parentId);
    return new Set([...(parent?.inherited_tags ?? []), ...(parent?.tags ?? [])]);
  }
  if (afterId !== null) {
    const previous = items.find(item => item.id === afterId);
    if (!previous) return new Set();
    return new Set(isSectionRow(previous) ? previous.tags ?? [] : previous.inherited_tags ?? []);
  }
  return new Set();
}
