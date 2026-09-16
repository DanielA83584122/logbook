export type OutlineItem = { id: number; content: string; parent_id: number | null; position: number; client_id?: string | null; source_task_id?: number | null; tags?: string[]; completed_at?: string | null; child_count?: number; completed_child_count?: number };
export type Note = OutlineItem & { date: string; source_task_id: number | null };
export type Task = OutlineItem;
export type Session = { id: number; started_at: string; ended_at: string | null; duration_seconds: number; seconds_on_day?: number };
export type Day = {
  date: string; notes: Note[]; focused_seconds: number;
  longest_session_seconds: number; session_count: number;
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
