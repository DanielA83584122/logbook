import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { api, dateObject, duration, errorMessage, localDate } from '../api';
import type { Stats } from '../types';
import { InlineError, Muted, press } from '../styles';
import { Modal } from './Modal';

const Top = styled.div`display: flex; justify-content: flex-end; margin-bottom: 20px;`;
const Scope = styled.div`display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; color: var(--muted); font-size: 12px; select { min-height: 40px; background: transparent; border: 0; color: inherit; }`;
const Segment = styled.div`display: flex; padding: 3px; background: var(--soft); border-radius: 10px;`;
const Range = styled.button<{ $selected: boolean }>`
  ${press}; border: 0; min-height: 40px; padding: 7px 13px; font-size: 12px; border-radius: 7px;
  background: ${({ $selected }) => $selected ? 'var(--field)' : 'transparent'}; color: ${({ $selected }) => $selected ? 'var(--ink)' : 'var(--muted)'};
  box-shadow: ${({ $selected }) => $selected ? '0 1px 3px #00000009' : 'none'};
`;
const Metrics = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 32px; @media(max-width: 440px) { gap: 10px; }`;
const Metric = styled.div`padding: 8px 0;`;
const MetricValue = styled.p`font-size: 28px; color: var(--ink); font-variant-numeric: tabular-nums; margin: 7px 0;`;
const MetricLabel = styled.p`font-size: 12px; color: var(--muted);`;
const ChartHeading = styled.div`display: flex; justify-content: flex-end; margin-bottom: 12px;`;
const Graph = styled.div<{ $count: number }>`display: grid; grid-template-columns: repeat(${({ $count }) => $count}, minmax(0, 1fr)); gap: ${({ $count }) => $count > 7 ? '5px' : '19px'}; height: 153px; align-items: end; border-bottom: 1px solid var(--line); padding: 0 8px;`;
const Bar = styled.div<{ $height: number; $today: boolean }>`
  height: ${({ $height }) => $height}%; background: ${({ $today }) => $today ? 'var(--chart-today)' : 'var(--chart)'};
  max-width: 48px; width: 100%; margin: 0 auto; border-radius: 4px 4px 0 0;
  transition: background-color 120ms ease-out; &:hover { background: var(--chart-hover); }
`;
const Axis = styled.div<{ $count: number }>`display: grid; grid-template-columns: repeat(${({ $count }) => $count}, minmax(0, 1fr)); gap: ${({ $count }) => $count > 7 ? '5px' : '19px'}; padding: 10px 8px; color: var(--muted); font-size: 10px; text-align: center;`;
const Summary = styled.div`display: flex; justify-content: space-between; gap: 12px; padding: 21px 0; margin-top: 13px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);`;
const SummaryValue = styled.p`font-size: 18px; font-variant-numeric: tabular-nums;`;
const Small = styled.p`font-size: 10px; color: var(--muted); margin-top: 3px;`;
const Quiet = styled.div`display: grid; place-items: center; gap: 13px; padding: 48px 0; color: var(--sage);`;
const Details = styled.details`margin-top: 16px; font-size: 12px; summary { color: var(--sage); min-height: 44px; display: flex; align-items: center; gap: 8px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 7px 4px; border-bottom: 1px solid var(--line); } th { font-weight: 400; color: var(--muted); }`;

export function StatsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [range, setRange] = useState(7);
  const [activeOnly, setActiveOnly] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setError('');
    const end = new Date(); const start = new Date(); start.setDate(end.getDate() - range + 1);
    api<Stats>(`/stats?start=${localDate(start)}&end=${localDate(end)}`).then(data => { if (!cancelled) setStats(data); })
      .catch(e => { if (!cancelled) setError(errorMessage(e)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, range]);
  const max = Math.max(1, ...(stats?.daily.map(d => d.focused_seconds) ?? []));
  const denominator = activeOnly ? stats?.active_days : stats?.day_count;
  const averageFocus = stats && denominator ? stats.total_focused_seconds / denominator : 0;
  const averageLongest = stats && denominator ? stats.daily.reduce((sum, day) => sum + day.longest_session_seconds, 0) / denominator : 0;
  return <Modal open={open} onClose={onClose} title="Statistics" wide>
    <Top><Segment aria-label="Statistics period">{[7, 30].map(days => <Range key={days} $selected={range === days} aria-pressed={range === days} onClick={() => setRange(days)}>{days} days</Range>)}</Segment></Top>
    {error ? <InlineError role="alert">{error}</InlineError> : loading || !stats ? <Quiet><Muted>Loading…</Muted></Quiet> : <>
      <Scope><span>Completed sessions · averages to the second</span><select aria-label="Average over" value={activeOnly ? 'active' : 'all'} onChange={e => setActiveOnly(e.target.value === 'active')}><option value="all">All {stats.day_count} calendar days</option><option value="active">{stats.active_days} days with focus</option></select></Scope>
      <Metrics><Metric><MetricValue>{duration(averageFocus)}</MetricValue><MetricLabel>Average daily focus</MetricLabel></Metric>
        <Metric><MetricValue>{duration(averageLongest)}</MetricValue><MetricLabel>Average daily longest session</MetricLabel></Metric></Metrics>
      <ChartHeading><Small>{duration(max)}</Small></ChartHeading>
      <Graph $count={stats.daily.length} role="img" aria-label={`Daily focus over ${range} days. Exact values are available in the daily breakdown below.`}>
        {stats.daily.map(day => <Bar key={day.date} $height={day.focused_seconds / max * 100} $today={day.date === stats.end} title={`${day.date}: ${duration(day.focused_seconds)}`} />)}
      </Graph>
      <Axis $count={stats.daily.length}>{stats.daily.map((day, i) => <span key={day.date}>{range === 7 ? dateObject(day.date).toLocaleDateString('en-US', { weekday: 'short' }) : i % 7 === 0 || i === 29 ? dateObject(day.date).getDate() : ''}</span>)}</Axis>
      <Summary><div><SummaryValue>{duration(stats.total_focused_seconds)}</SummaryValue><Small>total focus</Small></div><div><SummaryValue>{stats.active_days} <Small as="span">/ {stats.day_count}</Small></SummaryValue><Small>days with focus</Small></div><div><SummaryValue>{stats.session_count}</SummaryValue><Small>focus sessions</Small></div></Summary>
      <Details><summary>Daily breakdown</summary><table><thead><tr><th>Date</th><th>Total focus</th><th>Longest session</th><th>To-dos done</th></tr></thead><tbody>{stats.daily.map(day => <tr key={day.date}><td>{day.date}</td><td>{duration(day.focused_seconds)}</td><td>{duration(day.longest_session_seconds)}</td><td>{day.completed_task_count}</td></tr>)}</tbody></table></Details>
    </>}
  </Modal>;
}
