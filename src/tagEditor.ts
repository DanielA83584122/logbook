import { Extension, Node, type Editor } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { tagMatches, normalizeTag } from './tagSyntax';

export const TagDecorations = Extension.create({
  name: 'journalTags',
  addProseMirrorPlugins() {
    return [new Plugin({ props: { decorations(state) {
      const decorations: Decoration[] = [];
      state.doc.descendants((node, position) => {
        if (node.type.name === 'codeBlock') return false;
        if (!node.isText || node.marks.some(mark => mark.type.name === 'code' || mark.type.name === 'link')) return;
        for (const tag of tagMatches(node.text ?? '')) {
          decorations.push(Decoration.inline(position + tag.from, position + tag.to, { class: 'journal-tag', 'data-tag': tag.name }));
        }
      });
      return DecorationSet.create(state.doc, decorations);
    } } })];
  },
});


export const JournalTag = Node.create({
  name: 'journalTag', inline: true, group: 'inline', atom: true, selectable: true,
  addAttributes() { return { name: { default: '', rendered: false } }; },
  parseHTML() { return [{ tag: 'span[data-tag]', getAttrs: element => {
    const name = (element as HTMLElement).getAttribute('data-tag') ?? '';
    return tagMatches('#' + name).some(tag => tag.text === '#' + name) ? { name: normalizeTag(name) } : false;
  } }]; },
  renderHTML({ node }) { return ['span', { 'data-tag': node.attrs.name, class: 'journal-tag', contenteditable: 'false' }, '#' + node.attrs.name]; },
  renderText({ node }) { return '#' + node.attrs.name; },
  renderMarkdown() { return ''; },
  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { empty, $from, from } = this.editor.state.selection;
        if (!empty || $from.nodeBefore?.type.name !== this.name) return false;
        return this.editor.commands.deleteRange({ from: from - $from.nodeBefore.nodeSize, to: from });
      },
      Delete: () => {
        const { empty, $from, from } = this.editor.state.selection;
        if (!empty || $from.nodeAfter?.type.name !== this.name) return false;
        return this.editor.commands.deleteRange({ from, to: from + $from.nodeAfter.nodeSize });
      },
    };
  },
});

export function commitTypedTags(editor: Editor, includeCurrent = false) {
  const { from: caret } = editor.state.selection;
  const matches: { from: number; to: number; name: string }[] = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === 'codeBlock') return false;
    if (!node.isText || node.marks.some(mark => mark.type.name === 'code' || mark.type.name === 'link')) return;
    for (const match of tagMatches(node.text ?? '')) {
      const from = position + match.from, to = position + match.to;
      if (includeCurrent || caret < from || caret > to) matches.push({ from, to, name: match.name });
    }
  });
  const tr = editor.state.tr;
  for (const match of matches.reverse()) tr.replaceWith(match.from, match.to, editor.schema.nodes.journalTag.create({ name: match.name }));
  const atoms: { pos: number; name: string; size: number }[] = [];
  let lastText = 0;
  tr.doc.descendants((node, pos) => {
    if (node.type.name === 'journalTag') atoms.push({ pos, name: node.attrs.name, size: node.nodeSize });
    else if (node.isText && node.text?.trim()) lastText = pos + node.nodeSize;
  });
  if (atoms.length && (atoms[0].pos < lastText || tr.doc.lastChild?.type.name !== 'paragraph')) {
    const names = [...new Set(atoms.map(atom => atom.name))];
    for (const atom of [...atoms].reverse()) {
      tr.delete(atom.pos, atom.pos + atom.size);
      // Browsers may insert a non-breaking space beside an inline-block chip.
      if (atom.pos > 0 && /^[ \t\u00a0]{2}$/.test(tr.doc.textBetween(atom.pos - 1, atom.pos + 1))) tr.insertText(' ', atom.pos - 1, atom.pos + 1);
    }
    if (tr.doc.lastChild?.type.name !== 'paragraph') tr.insert(tr.doc.content.size, editor.schema.nodes.paragraph.create());
    const at = tr.doc.content.size - 1;
    const nodes = names.flatMap((name, index) => [
      ...(index || tr.doc.lastChild?.textContent && !/\s$/.test(tr.doc.lastChild.textContent) ? [editor.schema.text(' ')] : []),
      editor.schema.nodes.journalTag.create({ name }),
    ]);
    tr.insert(at, nodes);
    tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(caret, -1))));
  }
  if (tr.docChanged) editor.view.dispatch(tr);
}
