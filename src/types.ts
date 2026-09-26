export type EntryKind = 'notes' | 'tasks';
/** '' is a plain bullet; 'wait' is something its parent to-do waits on. */
export type Role = '' | 'wait';
export type OutlineItem = { id: number; kind?: EntryKind | 'note' | 'task'; content: string; parent_id: number | null; position: number; revision: number; created_at?: string; client_id?: string | null; tags?: string[]; inherited_tags?: string[]; role?: Role; completed_at?: string | null; child_count?: number; completed_child_count?: number };
export type Note = OutlineItem & { date: string };
export type Task = OutlineItem;
export type Session = { id: number; started_at: string; ended_at: string | null; duration_seconds: number; seconds_on_day?: number };
export type CalendarEvent = { id: string; title: string; start: string; end: string; all_day: boolean; cancelled: boolean; url: string | null };
export type Day = {
  date: string; notes: Note[]; focused_seconds: number;
  longest_session_seconds: number; session_count: number;
  tasks?: Task[];
  entries?: OutlineItem[];
  events?: CalendarEvent[];
};
export type JournalData = {
  tag?: string | null; tags?: import('./JournalContext').Tag[];
  today: string; days: Day[]; tasks: Task[]; active_session: Session | null;
  server_time: string; next_cursor: string | null;
};
export type DailyStat = Day & { completed_task_count: number; note_count: number };
export type Stats = {
  start: string; end: string; day_count: number; active_days: number;
  total_focused_seconds: number; session_count: number;
  average_daily_focused_seconds: number; average_daily_longest_session_seconds: number;
  daily: DailyStat[];
};
