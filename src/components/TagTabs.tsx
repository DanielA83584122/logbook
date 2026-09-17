import { useRef, useState } from 'react';
import styled from 'styled-components';
import type { Tag } from '../JournalContext';
import { compactViewport } from '../layout';

const Backdrop = styled.div<{ $open: boolean }>`
  position: fixed; inset: 0; z-index: 40;
  background: var(--backdrop); backdrop-filter: blur(4px);
  opacity: ${({ $open }) => $open ? 1 : 0};
  visibility: ${({ $open }) => $open ? 'visible' : 'hidden'};
  pointer-events: none;
  transition: opacity 140ms ease-out, visibility 140ms;
  body:has(dialog[open]) & { display: none; }
  @media ${compactViewport} { display: none; }
`;
const Rail = styled.nav<{ $open: boolean }>`
  --sidebar-width: max(var(--left-margin), min(280px, calc(100vw - 48px)));
  position: fixed; inset: 0 auto 0 0; z-index: 41;
  width: ${({ $open }) => $open ? 'var(--sidebar-width)' : 'calc(var(--left-margin) / 2)'};
  outline: none;
  body:has(dialog[open]) & { display: none; }
  @media ${compactViewport} { display: none; }
`;
const Panel = styled.div<{ $open: boolean }>`
  position: absolute; inset: 0 auto 0 0; width: var(--sidebar-width);
  padding: 48px clamp(24px, calc(var(--sidebar-width) * .12), 48px) 32px;
  overflow-y: auto; background: var(--paper);
  opacity: ${({ $open }) => $open ? 1 : 0};
  visibility: ${({ $open }) => $open ? 'visible' : 'hidden'};
  pointer-events: ${({ $open }) => $open ? 'auto' : 'none'};
  transition: opacity 140ms ease-out, visibility 140ms;
`;
const Heading = styled.h2`margin: 0 0 18px; font-size: 22px; font-weight: 400; letter-spacing: -.02em;`;
const Home = styled.button`
  min-height: 40px; padding: 0; border: 0; background: transparent; color: var(--ink);
  font: inherit; letter-spacing: inherit; text-align: left;
  @media(pointer: coarse) { min-height: 44px; }
`;
const Collection = styled.div`display: flex; flex-wrap: wrap; align-content: start; gap: 8px;`;
const TagPill = styled.button`
  position: relative; max-width: 100%; min-height: 36px; padding: 6px 12px;
  border: 0; border-radius: 999px; background: var(--tag-bg); color: var(--tag-ink);
  font-size: 14px; line-height: 20px; overflow-wrap: anywhere;
  &::before { content: ''; position: absolute; inset: -2px; }
  @media(pointer: coarse) { min-height: 44px; &::before { inset: 0; } }
`;

export function TagTabs({ tags, active, onSelect }: { tags: Tag[]; active: string | null; onSelect: (tag: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const rail = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const show = () => {
    if (document.querySelector('dialog[open]')) return;
    if (!rail.current?.contains(document.activeElement)) previousFocus.current = document.activeElement as HTMLElement;
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    if (rail.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement)?.blur();
      if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    }
  };
  const select = (tag: string | null) => { close(); onSelect(tag); };

  return <>
    <Backdrop $open={open} aria-hidden="true" data-testid="tag-backdrop" />
    <Rail ref={rail} $open={open} aria-label="Tags" tabIndex={0} data-open={open}
      onPointerEnter={show}
      onPointerLeave={() => {
        if (!rail.current?.matches(':focus-visible') && !rail.current?.querySelector(':focus-visible')) close();
      }}
      onFocusCapture={event => {
        if (event.relatedTarget instanceof HTMLElement && !event.currentTarget.contains(event.relatedTarget)) previousFocus.current = event.relatedTarget;
        show();
      }}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <Panel $open={open} aria-hidden={!open} inert={!open}>
        <Heading><Home type="button" onClick={() => select(null)}>logbook</Home></Heading>
        <Collection>{tags.map(tag => <TagPill key={tag.name} type="button"
          aria-pressed={tag.name === active} onClick={() => select(tag.name)}>#{tag.name}</TagPill>)}</Collection>
      </Panel>
    </Rail>
  </>;
}
