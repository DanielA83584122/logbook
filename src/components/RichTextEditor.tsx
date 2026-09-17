import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Markdown } from '@tiptap/markdown';
import type { Mark, Node as DocumentNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import styled from 'styled-components';
import { formattingExtensions, documentWithTags, serializeBullet, richTextStyles, safeHref } from '../markdown';
import { Field } from '../styles';
import { Modal } from './Modal';
import { createPortal } from 'react-dom';
import { useJournalContext } from '../JournalContext';
import { normalizeTag } from '../tagSyntax';
import { TagDecorations, commitTypedTags } from '../tagEditor';
import { documentUndo } from '../documentHistory';
import { errorMessage } from '../api';

const Surface = styled.div`
  flex: 1; min-width: 0;
  .tiptap { ${richTextStyles}; min-height: var(--bullet-row-height, 40px); padding: var(--bullet-padding, 7px 0); outline: none; caret-color: var(--ink); }
  .tiptap:focus-visible { outline: none; }

  @media(pointer: coarse) { .tiptap { min-height: 44px; padding: 10px 0; } }
`;
const LinkForm = styled.form`display: grid; gap: 8px; margin: 0;`;
const LinkField = styled(Field)<{ $url?: boolean }>`
  color: ${({ $url }) => $url ? "var(--url)" : "var(--link)"};
  border: 0; outline: none; box-shadow: none; background: transparent;
  &:focus-visible { outline: none; background: var(--field); }
`;

const TagMenu = styled.div<{ $left: number; $top: number }>`
  position: fixed; left: ${({ $left }) => $left}px; top: ${({ $top }) => $top}px; z-index: 40;
  width: min(230px, calc(100vw - 24px)); max-height: 200px; overflow-y: auto;
  padding: 5px; border-radius: 8px; background: var(--surface); box-shadow: 0 6px 24px #25282a18;
`;
const TagOption = styled.button<{ $selected: boolean }>`
  display: block; width: 100%; border: 0; border-radius: 5px; text-align: left; padding: 7px 10px;
  background: ${({ $selected }) => $selected ? 'var(--tag-bg)' : 'transparent'}; color: var(--ink); font-size: 14px;
  &:hover { background: var(--tag-bg); }
`;
type TagSuggestion = { from: number; to: number; query: string; names: string[]; index: number; left: number; top: number };

function linkUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw || /[\s\u0000-\u001f\u007f]/.test(raw)) return null;
  if (/^(\/(?!\/)|#)/.test(raw)) return raw;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  if (!safeHref(candidate)) return null;
  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname && !parsed.pathname) return null;
    return parsed.href;
  } catch { return null; }
}

function clipboardUrl(value: string): string | null {
  const raw = value.trim();
  // A sentence or arbitrary copied word should leave the field alone.
  if (!/^(https?:\/\/|mailto:|tel:)/i.test(raw) &&
      !/^(?:[a-z\d-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(raw)) return null;
  return linkUrl(raw);
}
function sharedMarks(doc: DocumentNode, from: number, to: number): Mark[] {
  let marks: Mark[] = [];
  let first = true;
  doc.nodesBetween(from, to, node => {
    if (!node.isText) return;
    marks = first ? [...node.marks] : marks.filter(mark => mark.isInSet(node.marks));
    first = false;
  });
  return marks;
}

type LinkMode = 'shortcut' | 'context';
export type TextOffsets = { anchor: number; head: number };
export type RichTextHandle = { focus: (options?: FocusOptions, selection?: TextOffsets) => void; editLink: () => void };
type Props = {
  ref?: Ref<RichTextHandle>; value: string; tags: string[]; label: string; readOnly: boolean;
  onChange: (markdown: string, tags: string[]) => void; onBlur: (event?: FocusEvent) => void; onKeyDown: (event: KeyboardEvent) => void;
  onBoundary?: (direction: 'up' | 'down' | 'backspace' | 'delete') => void;
  onSelectDocument?: () => void;
};

export function RichTextEditor({ ref, value, tags: bulletTags, label, readOnly, onChange, onBlur, onKeyDown, onBoundary, onSelectDocument }: Props) {
  const { tags } = useJournalContext();
  const [suggestion, setSuggestion] = useState<TagSuggestion | null>(null);
  const suggestionRef = useRef<TagSuggestion | null>(null);
  const suggest = (next: TagSuggestion | null) => { suggestionRef.current = next; setSuggestion(next); };
  const callbacks = useRef({ onChange, onBlur, onKeyDown, onBoundary, onSelectDocument });
  callbacks.current = { onChange, onBlur, onKeyDown, onBoundary, onSelectDocument };
  const lastSnapshot = useRef(JSON.stringify([value, bulletTags]));
  const linkOpen = useRef(false);
  const [link, setLink] = useState<{ from: number; to: number; mode: LinkMode } | null>(null);
  const [url, setUrl] = useState('');
  const [linkMode, setLinkMode] = useState<LinkMode>('shortcut');
  const [linkText, setLinkText] = useState('');
  const clipboardRequest = useRef(0);
  const urlEdited = useRef(false);
  const urlField = useRef<HTMLInputElement>(null);
  const previousSelectAll = useRef(false);
  const linkPrefix = useRef<{ from: number; to: number; mark: Mark; doc: DocumentNode } | null>(null);
  const linkReplacement = useRef<{ to: number; mark: Mark; doc: DocumentNode } | null>(null);
  const editor: Editor | null = useEditor({
    extensions: [...formattingExtensions(), Markdown, TagDecorations],
    content: documentWithTags(value, bulletTags), injectCSS: false, immediatelyRender: true,
    // Literal punctuation stays literal; formatting comes from shortcuts or rich paste.
    enableInputRules: false, enablePasteRules: false,
    editable: !readOnly,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': label, 'aria-multiline': 'true', spellcheck: 'true' },
      handleDOMEvents: {
        contextmenu(view, event) {
          const anchor = (event.target as HTMLElement).closest('a');
          if (!anchor || !view.dom.contains(anchor) || !view.editable) return false;
          event.preventDefault();
          editor?.commands.setTextSelection({
            from: view.posAtDOM(anchor, 0), to: view.posAtDOM(anchor, anchor.childNodes.length),
          });
          openLink('context');
          return true;
        },
      },
      handleTextInput(view, from, to, text) {
        if (view.composing) return false;
        if (from === to) {
          const { state } = view;
          const replacement = linkReplacement.current;
          linkReplacement.current = null;
          // Replacing a selected linked label is one edit, including spaces.
          // Keep its URL until the user moves the caret or leaves the editor.
          if (replacement?.doc === state.doc && replacement.to === from) {
            const tr = state.tr.insertText(text, from, to).addMark(from, from + text.length, replacement.mark);
            tr.setSelection(TextSelection.create(tr.doc, from + text.length));
            linkReplacement.current = { ...replacement, to: from + text.length, doc: tr.doc };
            view.dispatch(tr.scrollIntoView());
            return true;
          }
          const at = state.doc.resolve(from);
          const before = at.nodeBefore, after = at.nodeAfter;
          const left = before?.isText ? before.marks.find(mark => mark.type.name === 'link') : undefined;
          const right = after?.isText ? after.marks.find(mark => mark.type.name === 'link') : undefined;
          const marks = state.storedMarks ?? at.marks();
          const previous = linkPrefix.current;
          linkPrefix.current = null;
          const prefix = previous?.doc === state.doc && previous.to === from && right?.eq(previous.mark) ? previous : null;
          if (marks.some(mark => mark.type.name === 'code') || left && right && left.eq(right) && !prefix) return false;
          if (!left && !right && !marks.some(mark => mark.type.name === 'link')) return false;

          // Link marks are inclusive in Tiptap. At an edge, only the attached
          // word should inherit the URL; a separating space stays plain.
          const tr = state.tr.insertText(text, from, to);
          tr.removeMark(from, from + text.length, state.schema.marks.link);
          if (prefix || right && !/^\s/u.test(after?.text ?? '')) {
            const mark = prefix?.mark ?? right!;
            const spaces = [...text.matchAll(/\s/gu)];
            const split = spaces.length ? from + spaces.at(-1)!.index! + 1 : from;
            const start = prefix?.from ?? from;
            // A prefix initially belongs to the same word. If a space is
            // subsequently typed, detach that prefix from the original link.
            if (spaces.length) tr.removeMark(start, split, state.schema.marks.link);
            if (split < from + text.length) {
              tr.addMark(split, from + text.length, mark);
              linkPrefix.current = { from: spaces.length ? split : start, to: from + text.length, mark, doc: tr.doc };
            }
          } else if (left && !/\s$/u.test(before?.text ?? '')) {
            const space = text.search(/\s/u);
            const end = from + (space < 0 ? text.length : space);
            if (end > from) tr.addMark(from, end, left);
          }
          tr.setSelection(TextSelection.create(tr.doc, from + text.length)).setStoredMarks(null);
          view.dispatch(tr.scrollIntoView());
          return true;
        }
        linkPrefix.current = null;
        linkReplacement.current = null;
        // Replacing a whole linked label (including Select All) keeps its URL
        // and shared formatting, just like editing characters inside the link.
        const commonMarks = sharedMarks(view.state.doc, from, to);
        const link = commonMarks.find(mark => mark.type.name === 'link');
        if (!link) return false;
        const tr = view.state.tr.deleteSelection().ensureMarks(commonMarks).insertText(text);
        // Select All can include the paragraph itself, so use the mapped caret.
        linkReplacement.current = { to: tr.selection.from, mark: link, doc: tr.doc };
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      handleKeyDown(view, event) {
        if (view.composing || event.isComposing || !view.editable) return false;
        const pending = suggestionRef.current;
        if (pending && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault();
          const index = (pending.index + (event.key === 'ArrowDown' ? 1 : -1) + pending.names.length) % pending.names.length;
          suggest({ ...pending, index }); return true;
        }
        if (pending && (event.key === 'Enter' || event.key === 'Tab')) {
          event.preventDefault(); chooseTag(pending.names[pending.index]); return true;
        }
        if (pending && event.key === 'Escape') { event.preventDefault(); suggest(null); return true; }
        const mod = event.metaKey || event.ctrlKey;
        if (mod && ['z', 'y'].includes(event.key.toLowerCase())) {
          event.preventDefault();
          const forward = event.shiftKey || event.key.toLowerCase() === 'y';
          const handled = forward ? editor?.commands.redo() : editor?.commands.undo();
          if (!handled) void documentUndo(forward).catch(error => window.dispatchEvent(new CustomEvent('still-history-error', { detail: errorMessage(error) })));
          return true;
        }
        if (mod && event.key.toLowerCase() === 'a') {
          if (previousSelectAll.current) { previousSelectAll.current = false; event.preventDefault(); callbacks.current.onSelectDocument?.(); return true; }
          previousSelectAll.current = true;
        } else if (!['Meta', 'Control', 'Shift', 'Alt'].includes(event.key)) previousSelectAll.current = false;
        if (!mod && !event.shiftKey && view.state.selection.empty) {
          const { from, $from } = view.state.selection;
          const first = $from.depth > 0 && $from.before(1) === 0;
          const last = $from.depth > 0 && $from.after(1) === view.state.doc.content.size;
          const direction = event.key === 'ArrowUp' && first && view.endOfTextblock('up') ? 'up'
            : event.key === 'ArrowDown' && last && view.endOfTextblock('down') ? 'down'
            : event.key === 'Backspace' && from === 1 ? 'backspace'
            : event.key === 'Delete' && from === view.state.doc.content.size - 1 ? 'delete' : null;
          if (direction && callbacks.current.onBoundary) { event.preventDefault(); callbacks.current.onBoundary(direction); return true; }
        }
        if (mod && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'c') {
          event.preventDefault(); editor?.commands.toggleCode(); return true;
        }
        if (mod && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          openLink('shortcut');
          return true;
        }
        if (mod && event.shiftKey && event.key.toLowerCase() === 'x') {
          event.preventDefault(); editor?.commands.toggleStrike(); return true;
        }
        if (mod && event.key === '\\') {
          event.preventDefault(); editor?.chain().unsetAllMarks().clearNodes().run(); return true;
        }
        if (event.key === 'Enter' && !mod && editor?.isActive('codeBlock')) return false;
        if (event.key === 'Enter' && editor) commitTypedTags(editor, true);
        callbacks.current.onKeyDown(event);
        return event.defaultPrevented;
      },
    },
    onUpdate({ editor }) {
      const bullet = serializeBullet(editor.getJSON());
      lastSnapshot.current = JSON.stringify([bullet.content, bullet.tags]);
      callbacks.current.onChange(bullet.content, bullet.tags);
      updateSuggestion(editor);
      commitTypedTags(editor);
    },
    onSelectionUpdate({ editor }) {
      if (!editor.state.selection.empty || editor.state.selection.from !== linkPrefix.current?.to) linkPrefix.current = null;
      if (!editor.state.selection.empty || editor.state.selection.from !== linkReplacement.current?.to) linkReplacement.current = null;
      updateSuggestion(editor);
    },
    onBlur({ event }) { linkPrefix.current = null; linkReplacement.current = null; previousSelectAll.current = false; suggest(null); if (!linkOpen.current) { if (editor) commitTypedTags(editor, true); callbacks.current.onBlur(event); } },
  });

  const updateSuggestion = (current: Editor) => {
    const { $from, empty, from } = current.state.selection;
    if (!empty || $from.parent.type.name === 'codeBlock' || $from.marks().some(mark => mark.type.name === 'code' || mark.type.name === 'link')) { suggest(null); return; }
    const before = $from.parent.textBetween(0, $from.parentOffset, '', '\ufffc');
    const match = /(?:^|[^\p{L}\p{N}_/#&])#([\p{L}\p{N}_-]{0,64})$/u.exec(before);
    if (!match) { suggest(null); return; }
    const query = normalizeTag(match[1]);
    const names = tags.map(tag => tag.name).filter(name => name.startsWith(query));
    if (!names.length) { suggest(null); return; }
    const rect = current.view.coordsAtPos(from);
    suggest({ from: from - match[1].length - 1, to: from, query, names, index: 0,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 242)),
      top: rect.bottom + 206 < window.innerHeight ? rect.bottom + 6 : Math.max(12, rect.top - 206) });
  };
  const chooseTag = (name: string) => {
    const pending = suggestionRef.current;
    if (!editor || !pending) return;
    suggest(null);
    editor.chain().insertContentAt({ from: pending.from, to: pending.to }, [{ type: 'journalTag', attrs: { name } }, { type: 'text', text: ' ' }]).run();
    editor.view.dom.focus();
  };
  useEffect(() => {
    const dismiss = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('#tag-suggestions')) return;
      if (!suggestionRef.current) return;
      if (editor?.isFocused) {
        const caret = editor.view.coordsAtPos(editor.state.selection.from);
        const viewport = editor.view.dom.closest('[data-testid="log-scroll"]')?.getBoundingClientRect();
        if (caret.bottom >= Math.max(0, viewport?.top ?? 0) && caret.top <= Math.min(window.innerHeight, viewport?.bottom ?? window.innerHeight)) {
          updateSuggestion(editor);
          return;
        }
      }
      suggest(null);
    };
    window.addEventListener('scroll', dismiss, true);
    return () => window.removeEventListener('scroll', dismiss, true);
  }, [editor, tags]);
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute('aria-autocomplete', 'list');
    if (suggestion) {
      editor.view.dom.setAttribute('aria-controls', 'tag-suggestions');
      editor.view.dom.setAttribute('aria-activedescendant', `tag-option-${suggestion.index}`);
    } else {
      editor.view.dom.removeAttribute('aria-controls'); editor.view.dom.removeAttribute('aria-activedescendant');
    }
  }, [editor, suggestion]);

  useEffect(() => {
    if (suggestion) document.getElementById(`tag-option-${suggestion.index}`)?.scrollIntoView({ block: 'nearest' });
  }, [suggestion?.index, suggestion?.query]);

  const openLink = (mode: LinkMode) => {
    if (!editor || editor.isDestroyed || editor.state.selection.empty) return;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, '\n');
    if (!selected.trim()) return;
    const existing = editor.isActive('link');
    setLinkText(selected);
    setUrl(existing ? String(editor.getAttributes('link').href ?? '') : '');
    urlEdited.current = false;
    urlField.current?.setCustomValidity('');
    linkOpen.current = true; setLinkMode(mode); setLink({ from, to, mode });
    const request = ++clipboardRequest.current;
    if (mode === 'shortcut') {
      // Read only for this user gesture. Denial leaves manual URL entry usable.
      void navigator.clipboard?.readText().then(value => {
        if (request !== clipboardRequest.current || !linkOpen.current || urlEdited.current) return;
        const href = clipboardUrl(value);
        if (href) setUrl(href);
      }).catch(() => {});
    }
  };

  useImperativeHandle(ref, () => ({
    focus(options, selection) {
      if (!editor || editor.isDestroyed) return;
      if (selection) {
        // Saved HTML and ProseMirror use different offsets. Count visible text
        // in both so a mouse selection survives entering the editor.
        const positionAt = (offset: number) => {
          let remaining = offset;
          let position = 1;
          let found = false;
          editor.state.doc.descendants((node, pos) => {
            if (found) return false;
            if (node.isText) {
              position = pos + Math.min(remaining, node.nodeSize);
              if (remaining <= node.nodeSize) found = true;
              else remaining -= node.nodeSize;
            }
            return !found;
          });
          return position;
        };
        editor.commands.setTextSelection({ from: positionAt(selection.anchor), to: positionAt(selection.head) });
      }
      editor.view.dom.focus(options);
    },
    editLink() { openLink('context'); },
  }), [editor]);
  useEffect(() => {
    const snapshot = JSON.stringify([value, bulletTags]);
    if (editor && snapshot !== lastSnapshot.current) {
      editor.commands.setContent(documentWithTags(value, bulletTags), { emitUpdate: false });
      lastSnapshot.current = snapshot;
    }
  }, [editor, value, bulletTags]);
  useEffect(() => { editor?.setEditable(!readOnly, false); }, [editor, readOnly]);
  useEffect(() => { editor?.view.dom.setAttribute('aria-label', label); }, [editor, label]);

  const close = (range = link) => {
    linkOpen.current = false; clipboardRequest.current++; setLink(null);
    // Native dialog closes after its exit transition; restore the original text selection.
    setTimeout(() => {
      if (editor && !editor.isDestroyed) {
        if (range) editor.commands.setTextSelection({ from: range.from, to: range.to });
        editor.view.dom.focus();
      }
    }, 170);
  };

  return <Surface><EditorContent editor={editor} />
    {suggestion && createPortal(<TagMenu id="tag-suggestions" role="listbox" aria-label="Tags" $left={suggestion.left} $top={suggestion.top}>
      {suggestion.names.map((name, index) => <TagOption key={name} id={`tag-option-${index}`} role="option" aria-selected={index === suggestion.index}
        $selected={index === suggestion.index} onMouseDown={event => event.preventDefault()} onClick={() => chooseTag(name)}>#{name}</TagOption>)}
    </TagMenu>, document.body)}
    <Modal open={link !== null} onClose={() => close()} title="Link" compact>
      <LinkForm onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault(); event.currentTarget.requestSubmit();
        }
      }} onSubmit={event => {
        event.preventDefault(); if (!editor || !link) return;
        const raw = url.trim();
        const href = raw ? linkUrl(raw) : null;
        if (raw && !href) {
          urlField.current?.setCustomValidity('Enter a valid URL.');
          urlField.current?.reportValidity();
          return;
        }
        const chain = editor.chain().setTextSelection({ from: link.from, to: link.to });
        const selected = editor.state.doc.textBetween(link.from, link.to, '\n');
        if (link.mode === 'context' && linkText !== selected) {
          const marks = sharedMarks(editor.state.doc, link.from, link.to)
            .filter(mark => mark.type.name !== 'link').map(mark => mark.toJSON());
          if (href) marks.push({ type: 'link', attrs: { href } });
          if (linkText) chain.insertContent({ type: 'text', text: linkText, marks });
          else chain.deleteSelection();
        } else if (href) chain.setLink({ href });
        else chain.unsetLink();
        chain.run(); callbacks.current.onBlur();
        close({ ...link, from: editor.state.selection.from, to: editor.state.selection.to });
      }}>
        {linkMode === 'context' && <LinkField aria-label="Link text" autoFocus value={linkText}
          onChange={event => setLinkText(event.target.value)} />}
        <LinkField $url ref={urlField} aria-label="Link URL" placeholder="URL" autoFocus={linkMode !== 'context'} inputMode="url"
          autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="done" value={url}
          onChange={event => {
            urlEdited.current = true;
            event.target.setCustomValidity('');
            setUrl(event.target.value);
          }} />
      </LinkForm>
    </Modal>
  </Surface>;
}
