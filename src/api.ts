export const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin);
  url.searchParams.set('timezone', timezone);
  let response: Response;
  try {
    response = await fetch(url, {
      method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Couldn’t connect. Your draft is safe on this device; try again in a moment.');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(typeof error?.detail === 'string' ? error.detail : 'Couldn’t save that. Check the values and try again.');
  }
  return response.status === 204 ? undefined as T : response.json();
}

export function localDate(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
export function dateObject(value: string) { return new Date(`${value}T12:00:00`); }
export function duration(seconds: number, includeSeconds = true) {
  const total = Math.floor(Math.max(0, seconds));
  const minutes = Math.floor(total / 60);
  const hoursAndMinutes = `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  if (!includeSeconds) return hoursAndMinutes;
  if (total < 60) return `${total}s`;
  return `${minutes < 60 ? `${minutes}m` : hoursAndMinutes} ${String(total % 60).padStart(2, '0')}s`;
}
export function timerDuration(seconds: number) {
  const total = Math.floor(Math.max(0, seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  return [hours, minutes, total % 60].map(value => String(value).padStart(2, '0')).join(':');
}
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }

let recovery: Promise<boolean> | null = null;
/** Recover pending drafts whose composer disappeared at midnight or while the page was closed. */
export function recoverEarlierDrafts(today: string): Promise<boolean> {
  if (recovery) return recovery;
  recovery = (async () => {
    let changed = false;
    for (const key of Object.keys(localStorage)) {
      if (!/^still-draft-\d{4}-\d{2}-\d{2}$/.test(key) || key === `still-draft-${today}`) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const draft = JSON.parse(raw) as { id: number | null; content: string; saved: string; tags?: string[]; savedTags?: string[]; clientId?: string; parentId?: number | null; afterId?: number | null };
      if (draft.content !== draft.saved || JSON.stringify(draft.tags ?? []) !== JSON.stringify(draft.savedTags ?? [])) {
        if (draft.content.trim() || draft.tags?.length) {
          // Persist the retry key before making a request, including for older draft formats.
          if (!draft.clientId) {
            draft.clientId = crypto.randomUUID(); localStorage.setItem(key, JSON.stringify(draft));
          }
          await api(draft.id ? `/notes/${draft.id}` : '/notes', draft.id ? 'PATCH' : 'POST', {
            content: draft.content, tags: draft.tags, date: key.slice('still-draft-'.length), client_id: draft.clientId,
            parent_id: draft.parentId ?? null, after_id: draft.afterId ?? null,
          });
        } else if (draft.id) await api(`/notes/${draft.id}`, 'DELETE');
        changed = true;
      }
      // An unmounting composer can still be finishing a save. Do not erase newer recovery data.
      const latest = localStorage.getItem(key);
      if (latest === raw || latest === JSON.stringify(draft)) localStorage.removeItem(key);
    }
    return changed;
  })().finally(() => { recovery = null; });
  return recovery;
}
