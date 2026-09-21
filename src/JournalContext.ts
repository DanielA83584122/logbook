import { createContext, useContext } from 'react';
export type Tag = { name: string; note_count: number; task_count: number };
export const JournalContext = createContext({
  tags: [] as Tag[], activeTag: null as string | null,
  completed: new Set<number>(), onComplete: (_ids: number[], _taskId?: number, _completedAt?: string) => {},
  reopened: new Set<number>(), onReopen: (_ids: number[]) => {},
  target: null as { kind: 'notes' | 'tasks'; id: number } | null,
});
export const useJournalContext = () => useContext(JournalContext);

const flushers = new Set<() => Promise<unknown>>();
export function registerDraftFlush(flush: () => Promise<unknown>) {
  flushers.add(flush);
  return () => { flushers.delete(flush); };
}
export async function flushDrafts() { await Promise.all([...flushers].map(flush => flush())); }
