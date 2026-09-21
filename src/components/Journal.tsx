import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import styled from 'styled-components';
import { measureLineStats, prepareWithSegments } from '@chenglou/pretext';
import { dateObject, duration, errorMessage } from '../api';
import type { Day, Task } from '../types';
import { TextButton } from '../styles';
import { Outline } from './Outline';
import { useJournalContext } from '../JournalContext';
import { compactViewport, fullViewport } from '../layout';

const SectionTitle = styled.button`font-size: 20px; line-height: 1.4; margin-bottom: 4px; font-weight: 500; border: 0; padding: 0; height: calc(var(--todo-heading-height) - 4px); background: transparent; text-align: left;`;
const TodoSection = styled.section`
  align-self: stretch; display: flex; flex-direction: column; flex-shrink: 0; min-width: 180px; width: 100%; padding: 0 12px 4px 8px; margin-bottom: 16px;
  @media ${compactViewport} { display: none; }
`;
const DayBlock = styled.section<{ $today: boolean }>`
  margin-bottom: 20px;
  @media(pointer: coarse) { margin-bottom: 44px; }
  @media ${compactViewport} { display: ${({ $today }) => $today ? 'block' : 'none'}; }
`;
const DateHead = styled.button`
  display: flex; align-items: center; gap: 10px; min-height: 40px; margin-bottom: 3px;
  padding: 0; border: 0; background: transparent; text-align: left; white-space: nowrap;
  &:hover > span { text-decoration: underline; }
  @media(pointer: coarse) { min-height: 44px; }
`;
const DateLabel = styled.time`display: inline-block; font-size: 15px; line-height: 24px; padding: 0 6px; margin-left: -6px; border-radius: 9px; background: var(--date-bg); transform: translateY(1px);`;
const FocusTotal = styled.span`font-size: 12px; line-height: 24px; color: var(--muted); font-variant-numeric: tabular-nums;`;
const Body = styled.div`
  min-width: 0; padding-left: 20px; flex: 1; display: flex; flex-direction: column;
  > [data-outline-kind='tasks'] { flex: 1; display: flex; flex-direction: column; }
  > [data-outline-kind='tasks'] > [data-task-creation-area] { flex: 1; }
`;
const HistoryEnd = styled.div`display: flex; justify-content: center; padding: 20px 0; color: var(--sage); @media ${compactViewport} { display: none; }`;
type Actions = { refresh: () => Promise<void>; notify: (message: string) => void };

export function Todos({ tasks, refresh, notify }: { tasks: Task[] } & Actions) {
  const [folded, setFolded] = useState(false);
  const { target } = useJournalContext();
  const section = useRef<HTMLElement>(null);
  useEffect(() => { if (target?.kind === 'tasks') setFolded(false); }, [target]);
  useLayoutEffect(() => {
    const element = section.current;
    const top = element?.parentElement;
    if (!element || !top) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const topBox = top.getBoundingClientRect();
        const maximumColumn = topBox.width - 150;
        const restingWidth = element.getBoundingClientRect().width;
        top.style.transition = 'none';
        top.style.setProperty('--todo-column', `${maximumColumn}px`);
        void top.offsetWidth;
        const sectionBox = element.getBoundingClientRect();
        const toolbarBox = top.lastElementChild?.getBoundingClientRect();
        let paintedRight = sectionBox.left + 168;
        for (const row of element.querySelectorAll<HTMLElement>('[role="group"], [role="textbox"], [data-empty-todo]')) {
          if (row.offsetParent === null || row.closest('[aria-hidden="true"]')) continue;
          const text = row.innerText.trim();
          if (!text) continue;
          const rowBox = row.getBoundingClientRect();
          const style = getComputedStyle(row);
          const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const prepared = prepareWithSegments(text, font, { whiteSpace: 'pre-wrap', letterSpacing: Number.parseFloat(style.letterSpacing) || 0 });
          const { maxLineWidth } = measureLineStats(prepared, rowBox.width);
          // Pretext handles the fast common path. Reconcile against painted
          // fragments for rich marks and the browser's long-word fallback.
          let paintedTextRight = rowBox.left;
          const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            if (!node.textContent?.trim()) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            for (const rect of range.getClientRects()) paintedTextRight = Math.max(paintedTextRight, rect.right);
          }
          paintedRight = Math.max(paintedRight, paintedTextRight > rowBox.left ? paintedTextRight : rowBox.left + maxLineWidth);
        }
        // Short lists may pull the timer inward, but never past the visual
        // anchor at the center of the viewport. The maximum remains the
        // existing outer column limit used for long-task wrapping.
        const outerTimerCenter = toolbarBox ? toolbarBox.left + toolbarBox.width / 2 : window.innerWidth / 2;
        const centeredColumn = Math.ceil(maximumColumn - (outerTimerCenter - window.innerWidth / 2) + 24);
        let desired = Math.min(maximumColumn, Math.max(180, centeredColumn, Math.ceil(paintedRight - sectionBox.left + 12)));
        // Measure the actual button after the provisional placement. Responsive
        // grid rounding is not perfectly represented by the column geometry.
        top.style.setProperty('--todo-column', `${desired}px`);
        void top.offsetWidth;
        const timerBox = top.querySelector<HTMLElement>('[aria-label$="focus timer"]')?.getBoundingClientRect();
        if (timerBox) {
          const correction = window.innerWidth / 2 - (timerBox.left + timerBox.width / 2);
          if (correction > 0) desired = Math.min(maximumColumn, Math.ceil(desired + correction));
        }
        top.style.setProperty('--todo-column', `${restingWidth}px`);
        void top.offsetWidth;
        top.style.removeProperty('transition');
        top.style.setProperty('--todo-column', `${desired}px`);
      });
    };
    measure();
    const mutation = new MutationObserver(measure);
    mutation.observe(element, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-hidden'] });
    const resize = new ResizeObserver(measure);
    resize.observe(top);
    void document.fonts.ready.then(measure);
    return () => {
      cancelAnimationFrame(frame); mutation.disconnect(); resize.disconnect();
      top.style.removeProperty('--todo-column');
    };
  }, []);
  return <TodoSection ref={section} aria-labelledby="todo-title"><SectionTitle id="todo-title" data-focus-chrome aria-expanded={!folded} title={folded ? 'Expand to-dos' : 'Fold to-dos'} onClick={() => setFolded(value => !value)}>to do</SectionTitle>
    {!folded && <Body><Outline kind="tasks" items={tasks} composer={tasks.length > 0} refresh={refresh} notify={notify} /></Body>}
  </TodoSection>;
}

export function Journal({ days, today, refresh, notify, openSessions, secondsForDay, loadMore, hasMore, scrollRoot }: {
  days: Day[]; today: string; openSessions: (date: string) => void; secondsForDay: (day: Day) => number;
  loadMore: () => Promise<void>; hasMore: boolean; scrollRoot: RefObject<HTMLDivElement | null>;
} & Actions) {
  const [loadingMore, setLoadingMore] = useState(false);
  const { target } = useJournalContext();
  const historyEnd = useRef<HTMLDivElement>(null);
  const loadingLock = useRef(false);
  const [historyError, setHistoryError] = useState(false);
  const loadEarlier = useCallback(async () => {
    if (loadingLock.current) return;
    loadingLock.current = true; setLoadingMore(true);
    try { await loadMore(); setHistoryError(false); }
    catch (e) { setHistoryError(true); notify(errorMessage(e)); }
    finally { setLoadingMore(false); loadingLock.current = false; }
  }, [loadMore, notify]);
  useEffect(() => {
    if (!hasMore || historyError || !historyEnd.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && window.matchMedia(fullViewport).matches) void loadEarlier();
    }, { root: scrollRoot.current, rootMargin: '200px' });
    observer.observe(historyEnd.current);
    return () => observer.disconnect();
  }, [hasMore, historyError, loadEarlier, scrollRoot]);
  const yesterday = dateObject(today); yesterday.setDate(yesterday.getDate() - 1);
  return <section aria-label="Logbook">
    {days.map(day => {
      const isToday = day.date === today;
      const date = dateObject(day.date);
      const seconds = secondsForDay(day);
      const title = isToday ? 'Today' : date.toDateString() === yesterday.toDateString() ? 'Yesterday' : date.toLocaleDateString(undefined, { weekday: 'long' });
      const entries = day.entries?.length ? day.entries : [
        ...day.notes.map(note => ({ ...note, kind: 'notes' as const })),
        ...(day.tasks ?? []).map(task => ({ ...task, kind: 'tasks' as const })),
      ];
      const targeted = target && entries.some(entry => entry.kind === target.kind && entry.id === target.id);
      return <DayBlock key={day.date} $today={isToday || !!targeted} aria-label={`${title}, ${day.date}`}
        onClick={event => {
          if ((event.target as Element).closest('button, a, input, [contenteditable], [role="group"]') || window.getSelection()?.toString()) return;
          window.dispatchEvent(new CustomEvent('still-new-bullet', { detail: `still-draft-${day.date}` }));
        }}>
        <DateHead type="button" data-focus-chrome aria-label={`Focus sessions for ${day.date}`} onClick={() => openSessions(day.date)} title="View and edit focus sessions">
          <DateLabel dateTime={day.date}>{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</DateLabel>
          {seconds >= 1 && <FocusTotal>{duration(seconds, true)}</FocusTotal>}
        </DateHead>
        <Body>
          <Outline kind="mixed" items={entries} day={day.date} archived composer={isToday} refresh={refresh} notify={notify} />
        </Body>
      </DayBlock>;
    })}
    <HistoryEnd ref={historyEnd}>{hasMore && <TextButton disabled={loadingMore} onClick={() => void loadEarlier()}>{historyError ? 'Retry' : 'Earlier days'}</TextButton>}</HistoryEnd>
  </section>;
}
