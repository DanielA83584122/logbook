import { useCallback, useEffect, useRef, useState } from 'react';
import styled, { css } from 'styled-components';
import { ChartNoAxesColumn, Github, Moon, Sun } from 'lucide-react';
import { api, errorMessage, localDate, recoverEarlierDrafts, timerDuration } from './api';
import { FocusSound } from './audio';
import type { Day, JournalData, Session } from './types';
import { Button, Muted, TextButton, press } from './styles';
import { Journal, Todos } from './components/Journal';
import { SessionsModal } from './components/SessionsModal';
import { StatsModal } from './components/StatsModal';
import { TagTabs } from './components/TagTabs';
import { JournalContext, flushDrafts } from './JournalContext';
import { Modal } from './components/Modal';
import { SearchModal, type SearchHit } from './components/SearchModal';
import { documentUndo, recordCompletion } from './documentHistory';
import { compactViewport, timerOnlyViewport } from './layout';

const JOURNAL_PAGE_SIZE = 14;
const REPOSITORY_URL = import.meta.env.VITE_REPOSITORY_URL || 'https://github.com/divyavenn/still';

const Page = styled.div`
  --document-width: min(680px, calc(100vw - 64px));
  --left-margin: calc((100vw - var(--document-width)) * .54);
  --right-margin: calc(100vw - var(--document-width) - var(--left-margin));
  --page-top: 48px;
  --todo-heading-height: 44px;
  @media(pointer: coarse) { --todo-heading-height: 48px; }
  height: 100dvh; overflow-x: hidden; overflow-y: auto; display: flex; flex-direction: column;
  @media ${compactViewport} {
    --document-width: min(680px, calc(100vw - 48px)); --page-top: 24px;
    --left-margin: calc((100vw - var(--document-width)) / 2); --right-margin: var(--left-margin);
  }
`;
const TopArea = styled.div`
  display: grid; grid-template-columns: minmax(0, 1fr) 88px; gap: 24px; align-items: start;
  flex-shrink: 0; padding-right: 12px; margin-bottom: 8px; min-height: calc(var(--todo-heading-height) + 88px);
  @media ${compactViewport} { display: flex; justify-content: center; padding: 0; min-height: 88px; margin-bottom: 20px; }
`;
const Toolbar = styled.div`
  display: flex; flex-direction: column; align-items: center; gap: 4px; width: 88px;
  position: sticky; top: calc(var(--page-top) + var(--todo-heading-height)); margin-top: var(--todo-heading-height); z-index: 5;
  @media ${compactViewport} { position: static; margin-top: 0; }
`;
const TimerButton = styled.button`
  ${press}; height: 72px; width: 72px; flex-shrink: 0; border: 0; border-radius: 50%; background: var(--timer); color: var(--timer-ink);
  display: flex; justify-content: center; align-items: center; padding: 0; position: relative; margin: 8px;
  &::before { content: ''; position: absolute; inset: -8px; border: 1px solid var(--timer-ring); border-radius: 50%; pointer-events: none; transition: border-color 160ms ease-out; }
  &:hover { background: var(--timer-hover); }
  &[aria-pressed='true'] { background: var(--timer-running); }
  &[aria-pressed='true']:hover { background: var(--timer-running-hover); }
  &[aria-pressed='true']::before { border-color: var(--timer-running-ring); }
  font-size: 13px; font-variant-numeric: tabular-nums;
`;
const PageControls = styled.div`
  position: fixed; top: 20px; right: 24px; z-index: 6;
  display: flex; align-items: center; gap: 0;
  @media ${compactViewport} { display: none; }
`;
const pageControl = css`
  ${press}; position: relative; display: grid; place-items: center;
  width: 32px; height: 40px; padding: 0; border: 0; border-radius: 50%;
  background: transparent; color: var(--muted); text-decoration: none;
  svg { transition: transform 140ms ease-out; }
  &:hover { color: var(--ink); }
  &:hover svg { transform: translateY(-1px) scale(1.06); }
  @media(pointer: coarse) { width: 44px; height: 44px; }
`;
const ThemeToggle = styled.button`${pageControl}`;
const RepositoryLink = styled.a`${pageControl}`;
const ThemeGlyph = styled.span<{ $shown: boolean }>`
  position: absolute; display: grid; place-items: center; pointer-events: none;
  opacity: ${({ $shown }) => $shown ? 1 : 0}; scale: ${({ $shown }) => $shown ? 1 : .25};
  filter: blur(${({ $shown }) => $shown ? 0 : 4}px);
  transition: opacity 150ms cubic-bezier(.2,0,0,1), scale 150ms cubic-bezier(.2,0,0,1), filter 150ms cubic-bezier(.2,0,0,1);
`;
const StatsToggle = styled.button`${pageControl}`;
const SoundMenu = styled.div`display: grid; gap: 8px; padding: 4px; button { justify-content: center; } input { width: 100%; min-height: 40px; accent-color: var(--link); }`;
const Main = styled.main`
  width: var(--document-width); margin: var(--page-top) var(--right-margin) 0 var(--left-margin);
  flex: 1; display: flex; flex-direction: column; min-height: 0;
`;
const LogViewport = styled.div`
  flex: 1; min-height: min(240px, max(64px, calc(100dvh - 160px))); overflow-y: auto; overflow-x: hidden; overscroll-behavior-y: contain;
  padding: 4px 12px 24px 8px; scrollbar-width: thin; scrollbar-color: var(--scrollbar) transparent;
  @media ${compactViewport} { min-height: 0; }
  @media ${timerOnlyViewport} { display: none; }
`;
const Toast = styled.div`position: fixed; bottom: 25px; left: 50%; transform: translateX(-50%); z-index: 30; max-width: min(540px, calc(100% - 32px)); display: flex; align-items: center; gap: 12px; padding: 7px 8px 7px 19px; background: var(--surface); border-radius: 12px; box-shadow: 0 0 0 1px #00000007, 0 4px 24px #31392b19; font-size: 12px;`;
const ConnectionState = styled.div`padding: 50px 0; display: grid; gap: 16px; justify-items: start; @media ${compactViewport} { display: none; }`;

export default function App() {
  const [data, setData] = useState<JournalData | null>(null);
  const [night, setNight] = useState(() => localStorage.getItem('still-theme') === 'night');
  useEffect(() => {
    document.documentElement.dataset.theme = night ? 'night' : 'day';
    localStorage.setItem('still-theme', night ? 'night' : 'day');
  }, [night]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const tagRef = useRef<string | null>(null);
  const [completed, setCompleted] = useState(new Set<number>());
  const [undoTask, setUndoTask] = useState<{ id: number; completedAt: string } | null>(null);
  const [target, setTarget] = useState<{ kind: 'notes' | 'tasks'; id: number } | null>(null);
  const completionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onComplete = (ids: number[], taskId?: number, completedAt?: string) => {
    if (completionTimeout.current) clearTimeout(completionTimeout.current);
    setCompleted(new Set(ids));
    if (taskId && completedAt) { recordCompletion(taskId, completedAt); setUndoTask({ id: taskId, completedAt }); }
    completionTimeout.current = setTimeout(() => setCompleted(new Set()), 1000);
  };
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  const [statsOpen, setStatsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [sessionsDate, setSessionsDate] = useState<string | null>(null);
  const [timerBusy, setTimerBusy] = useState(false);
  const [audible, setAudible] = useState(false);
  const [volume, setVolume] = useState(() => Math.max(0, Math.min(1, Number(localStorage.getItem('still-volume') ?? '0.22') || 0)));
  const sound = useRef(new FocusSound());
  const timerLock = useRef(false);
  const clockOffset = useRef(0);
  const generation = useRef(0);
  const loadedThrough = useRef<string | null>(null);
  const logViewport = useRef<HTMLDivElement>(null);
  const notify = useCallback((text: string) => setMessage(text), []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey) {
        if (['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); void documentUndo(event.shiftKey || event.key.toLowerCase() === 'y').catch(e => notify(errorMessage(e))); }
        if (event.key.toLowerCase() === 'f') { event.preventDefault(); setSearchOpen(true); }
        if (event.shiftKey && event.key.toLowerCase() === 's') { event.preventDefault(); setStatsOpen(true); }
        if (event.shiftKey && event.key.toLowerCase() === 'm') { event.preventDefault(); setSoundOpen(true); }
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const refresh = useCallback(async (includeHistory = true) => {
    const sequence = ++generation.current;
    const tagQuery = tagRef.current ? '&tag=' + encodeURIComponent(tagRef.current) : '';
    let response = await api<JournalData>(`/journal?limit=${JOURNAL_PAGE_SIZE}${tagQuery}`);
    try {
      if (await recoverEarlierDrafts(response.today)) response = await api<JournalData>(`/journal?limit=${JOURNAL_PAGE_SIZE}${tagQuery}`);
    } catch { notify('Could not save an earlier draft. Retrying automatically.'); }
    while (includeHistory && loadedThrough.current && response.next_cursor && response.next_cursor > loadedThrough.current) {
      const more = await api<JournalData>(`/journal?before=${response.next_cursor}&limit=${JOURNAL_PAGE_SIZE}${tagQuery}`);
      response.days.push(...more.days);
      response.next_cursor = more.next_cursor;
    }
    if (sequence !== generation.current) return;
    if (tagRef.current && !response.tags?.some(tag => tag.name === tagRef.current)) {
      tagRef.current = null; loadedThrough.current = null; setActiveTag(null); return;
    }
    clockOffset.current = new Date(response.server_time).getTime() - Date.now();
    setData(previous => {
      if (includeHistory || !previous) return response;
      const oldest = response.days.at(-1)?.date ?? response.today;
      const cachedDays = previous.days.filter(day => day.date < oldest);
      return { ...response, days: [...response.days, ...cachedDays], next_cursor: cachedDays.length ? previous.next_cursor : response.next_cursor };
    });
    setError('');
  }, [notify]);
  useEffect(() => {
    const applied = () => { void refresh().catch(e => notify(errorMessage(e))); };
    const failed = (event: Event) => notify((event as CustomEvent<string>).detail);
    const edited = () => setUndoTask(null);
    window.addEventListener('still-history-applied', applied);
    window.addEventListener('still-history-error', failed);
    window.addEventListener('still-history-available', edited);
    return () => { window.removeEventListener('still-history-applied', applied); window.removeEventListener('still-history-error', failed); window.removeEventListener('still-history-available', edited); };
  }, [refresh, notify]);

  useEffect(() => {
    void refresh(false).catch(e => setError(errorMessage(e)));
    const interval = setInterval(() => { void refresh(false).catch(e => setError(errorMessage(e))); }, 15000);
    const focus = () => { void refresh(false).catch(e => setError(errorMessage(e))); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(interval); window.removeEventListener('focus', focus); };
  }, [refresh, activeTag]);
  useEffect(() => {
    let day = localDate();
    const interval = setInterval(() => {
      setNow(Date.now());
      const next = localDate();
      if (next !== day) { day = next; void refresh(false).catch(e => setError(errorMessage(e))); }
    }, 1000);
    return () => clearInterval(interval);
  }, [refresh]);
  useEffect(() => { if (!message) return; const id = setTimeout(() => setMessage(''), 6500); return () => clearTimeout(id); }, [message]);
  useEffect(() => {
    if (!data?.active_session) { sound.current.stop(); setAudible(false); }
  }, [data?.active_session?.id]);
  useEffect(() => { const currentSound = sound.current; return () => currentSound.dispose(); }, []);

  const active = data?.active_session;
  const adjustedNow = now + clockOffset.current;
  const elapsed = active ? Math.max(0, (adjustedNow - new Date(active.started_at).getTime()) / 1000) : 0;
  const toggleTimer = async () => {
    if (timerLock.current) return;
    timerLock.current = true; setTimerBusy(true);
    try {
      if (active) {
        await api<Session>('/timer/stop', 'POST', { session_id: active.id });
        sound.current.stop(); setAudible(false);
        setData(current => current ? { ...current, active_session: null } : current);
      } else {
        if (localStorage.getItem('still-muted') !== 'true') void sound.current.start(volume).then(() => setAudible(true)).catch(() => notify('Audio paused. Open the timer’s sound menu to resume.'));
        const started = await api<Session>('/timer/start', 'POST');
        setData(current => current ? { ...current, active_session: started } : current);
      }
      await refresh();
    } catch (e) { if (!active) { sound.current.stop(); setAudible(false); } notify(errorMessage(e)); }
    finally { timerLock.current = false; setTimerBusy(false); }
  };
  const toggleSound = async () => {
    if (audible) { sound.current.stop(); setAudible(false); localStorage.setItem('still-muted', 'true'); }
    else { try { await sound.current.start(volume); setAudible(true); localStorage.setItem('still-muted', 'false'); } catch { notify('Your browser couldn’t start audio. The timer is still tracking your focus.'); } }
  };
  const secondsForDay = (day: Day) => {
    if (!active || !data || day.date !== data.today) return day.focused_seconds;
    return day.focused_seconds + Math.max(0, (adjustedNow - new Date(data.server_time).getTime()) / 1000);
  };

  const selectTag = async (tag: string | null) => {
    try {
      await flushDrafts();
      tagRef.current = tag; loadedThrough.current = null; generation.current++;
      setActiveTag(tag);
      if (logViewport.current) logViewport.current.scrollTop = 0;
    } catch (error) { notify(errorMessage(error)); }
  };

  const jumpTo = async (hit: SearchHit) => {
    try {
      await flushDrafts();
      tagRef.current = null; loadedThrough.current = null; setActiveTag(null); setTarget(null);
      await refresh();
      if (hit.date) {
        const result = await api<JournalData>(`/journal?on=${hit.date}`);
        setData(current => current ? { ...current, days: [...current.days.filter(day => day.date !== hit.date), ...result.days].sort((a, b) => b.date.localeCompare(a.date)) } : current);
      }
      setSearchOpen(false);
      setTimeout(() => setTarget({ kind: hit.kind, id: hit.id }), 180);
    } catch (e) { notify(errorMessage(e)); }
  };

  return <JournalContext.Provider value={{ tags: data?.tags ?? [], activeTag: data?.tag ?? null, completed, onComplete, target }}><Page>
    <PageControls role="group" aria-label="Page controls">
    {REPOSITORY_URL && <RepositoryLink href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer" aria-label="GitHub repository" title="GitHub"><Github size={17} aria-hidden="true" /></RepositoryLink>}
    <StatsToggle aria-label="Open focus statistics" title="Statistics · ⌘⇧S" onClick={() => setStatsOpen(true)}><ChartNoAxesColumn size={17} aria-hidden="true" /></StatsToggle>
    <ThemeToggle role="switch" aria-label="Night mode" aria-checked={night}
      title={night ? 'Use day mode' : 'Use night mode'} onClick={() => setNight(value => !value)}>
      <ThemeGlyph $shown={!night} data-icon="sun" aria-hidden="true"><Sun size={17} /></ThemeGlyph>
      <ThemeGlyph $shown={night} data-icon="moon" aria-hidden="true"><Moon size={17} /></ThemeGlyph>
    </ThemeToggle>
    </PageControls>
    <TagTabs tags={data?.tags ?? []} active={activeTag} onSelect={tag => { void selectTag(tag); }} />
    <Main>
      <TopArea>
        {!data ? <ConnectionState><Muted>{error || 'Loading…'}</Muted>{error && <Button onClick={() => { setError(''); void refresh().catch(e => setError(errorMessage(e))); }}>Retry</Button>}</ConnectionState> :
          <Todos key={data.tag ?? "all"} tasks={data.tasks} refresh={refresh} notify={notify} />}
    <Toolbar><TimerButton disabled={timerBusy || !data} aria-label={active ? 'Stop focus timer' : 'Start focus timer'} aria-pressed={!!active} title="Click to start/stop · right-click for sound" onContextMenu={e => { e.preventDefault(); setSoundOpen(true); }} onKeyDown={e => { if (e.key === 'ContextMenu' || e.shiftKey && e.key === 'F10') { e.preventDefault(); setSoundOpen(true); } }} onClick={() => void toggleTimer()}>{timerDuration(elapsed)}</TimerButton></Toolbar>
      </TopArea>
      {data &&
        <LogViewport ref={logViewport} data-testid="log-scroll">
        <Journal key={data.tag ?? "all"} scrollRoot={logViewport} days={data.days} today={data.today} refresh={refresh} notify={notify} openSessions={setSessionsDate} secondsForDay={secondsForDay} hasMore={!!data.next_cursor} loadMore={async () => {
          if (!data.next_cursor) return;
          const filter = tagRef.current;
          const more = await api<JournalData>(`/journal?before=${data.next_cursor}&limit=${JOURNAL_PAGE_SIZE}${filter ? '&tag=' + encodeURIComponent(filter) : ''}`);
          if (filter !== tagRef.current) return;
          loadedThrough.current = more.days.at(-1)?.date ?? loadedThrough.current;
          setData(current => current ? { ...current, days: [...current.days, ...more.days.filter(d => !current.days.some(existing => existing.date === d.date))], next_cursor: more.next_cursor } : current);
        }} />
        {error && <TextButton onClick={() => void refresh().catch(e => notify(errorMessage(e)))}>Connection lost · retry</TextButton>}
        </LogViewport>
      }
    </Main>
    <SessionsModal date={sessionsDate} onClose={() => setSessionsDate(null)} onChange={refresh} />
    <StatsModal open={statsOpen} onClose={() => setStatsOpen(false)} />
    <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={jumpTo} />
    <Modal open={soundOpen} onClose={() => setSoundOpen(false)} title="Focus sound" compact><SoundMenu>
      <TextButton aria-label={audible ? 'Mute focus sound' : 'Play focus sound'} onClick={() => void toggleSound()}>{audible ? 'Mute' : 'Play sound'}</TextButton>
      <input aria-label="Focus sound volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={e => { const value = Number(e.target.value); setVolume(value); localStorage.setItem('still-volume', String(value)); sound.current.setVolume(value); }} />
    </SoundMenu></Modal>
    {undoTask && !message && <Toast><TextButton aria-label="Undo task completion" onClick={async () => {
      try { await documentUndo(); setUndoTask(null); }
      catch (e) { notify(errorMessage(e)); }
    }}>Undo</TextButton><TextButton aria-label="Dismiss undo" onClick={() => setUndoTask(null)}>×</TextButton></Toast>}
    {message && <Toast role="status">{message}<TextButton aria-label="Dismiss notification" onClick={() => setMessage('')}>Dismiss</TextButton></Toast>}
  </Page></JournalContext.Provider>;
}
