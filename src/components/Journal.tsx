import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import styled from 'styled-components';
import { dateObject, duration, errorMessage } from '../api';
import type { Day, Task } from '../types';
import { TextButton } from '../styles';
import { Outline } from './Outline';
import { useJournalContext } from '../JournalContext';

const SectionTitle = styled.button`font-size: 20px; line-height: 1.4; margin-bottom: 4px; font-weight: 500; border: 0; padding: 0; min-height: 40px; background: transparent; text-align: left;`;
const TodoSection = styled.section`
  flex-shrink: 0; min-width: 0; padding: 0 12px 4px 8px; margin-bottom: 16px;
  @media (max-width: 640px), (max-height: 230px) { display: none; }
`;
const DayBlock = styled.section<{ $today: boolean }>`margin-bottom: 20px; @media(max-width: 640px) { display: ${({ $today }) => $today ? 'block' : 'none'}; }`;
const DateHead = styled.button`
  display: flex; align-items: center; gap: 10px; min-height: 40px; margin-bottom: 3px;
  padding: 0; border: 0; background: transparent; text-align: left; white-space: nowrap;
  &:hover > span { text-decoration: underline; }
  @media(pointer: coarse) { min-height: 44px; }
`;
const DateLabel = styled.time`display: inline-block; font-size: 15px; line-height: 24px; padding: 0 6px; margin-left: -6px; border-radius: 9px; background: var(--date-bg);`;
const FocusTotal = styled.span`font-size: 12px; line-height: 24px; color: var(--muted); font-variant-numeric: tabular-nums;`;
const Body = styled.div`min-width: 0; padding-left: 20px;`;
const HistoryEnd = styled.div`display: flex; justify-content: center; padding: 20px 0; color: var(--sage); @media(max-width: 640px) { display: none; }`;
type Actions = { refresh: () => Promise<void>; notify: (message: string) => void };

export function Todos({ tasks, refresh, notify }: { tasks: Task[] } & Actions) {
  const [folded, setFolded] = useState(false);
  const { target } = useJournalContext();
  useEffect(() => { if (target?.kind === 'tasks') setFolded(false); }, [target]);
  return <TodoSection aria-labelledby="todo-title"><SectionTitle id="todo-title" aria-expanded={!folded} title={folded ? 'Expand to-dos' : 'Fold to-dos'} onClick={() => setFolded(value => !value)}>to do</SectionTitle>
    {!folded && <Body><Outline kind="tasks" items={tasks} composer refresh={refresh} notify={notify} /></Body>}
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
      if (entries.some(entry => entry.isIntersecting) && window.matchMedia('(min-width: 641px)').matches) void loadEarlier();
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
      return <DayBlock key={day.date} $today={isToday || target?.kind === 'notes' && day.notes.some(note => note.id === target.id)} aria-label={`${title}, ${day.date}`}>
        <DateHead type="button" aria-label={`Focus sessions for ${day.date}`} onClick={() => openSessions(day.date)} title="View and edit focus sessions">
          <DateLabel dateTime={day.date}>{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</DateLabel>
          {seconds >= 1 && <FocusTotal>{duration(seconds, true)}</FocusTotal>}
        </DateHead>
        <Body><Outline kind="notes" items={day.notes} day={day.date} composer={isToday} refresh={refresh} notify={notify} /></Body>
      </DayBlock>;
    })}
    <HistoryEnd ref={historyEnd}>{hasMore && <TextButton disabled={loadingMore} onClick={() => void loadEarlier()}>{historyError ? 'Retry' : 'Earlier days'}</TextButton>}</HistoryEnd>
  </section>;
}
