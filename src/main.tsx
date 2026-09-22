import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import styled from 'styled-components';
import App from './App';
import { GlobalStyle } from './styles';
import { PasswordGate } from './components/PasswordGate';

document.documentElement.dataset.theme = localStorage.getItem('still-theme') === 'night' ? 'night' : 'day';

const AppSurface = styled.div<{ $locked: boolean }>`
  min-height: 100dvh; filter: blur(${({ $locked }) => $locked ? '7px' : '0'});
  opacity: ${({ $locked }) => $locked ? .72 : 1}; pointer-events: ${({ $locked }) => $locked ? 'none' : 'auto'};
  user-select: ${({ $locked }) => $locked ? 'none' : 'auto'};
  transition: filter 180ms ease-out, opacity 180ms ease-out;
`;

function Root() {
  const [state, setState] = useState<'checking' | 'locked' | 'ready'>('checking');
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/status').then(async response => {
      if (!response.ok) throw new Error();
      const status = await response.json() as { enabled: boolean; authenticated: boolean };
      if (!cancelled) setState(status.enabled && !status.authenticated ? 'locked' : 'ready');
    }).catch(() => { if (!cancelled) setState('locked'); });
    const lock = () => setState('locked');
    window.addEventListener('still-auth-required', lock);
    return () => { cancelled = true; window.removeEventListener('still-auth-required', lock); };
  }, []);
  const authenticate = useCallback(async (password: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
    });
    if (response.status === 401) return false;
    if (!response.ok) throw new Error();
    setState('ready'); return true;
  }, []);
  const locked = state !== 'ready';
  return <><AppSurface data-testid="auth-surface" $locked={locked} aria-hidden={locked || undefined}><App locked={locked} /></AppSurface>
    {state === 'locked' && <PasswordGate authenticate={authenticate} />}</>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><GlobalStyle /><Root /></React.StrictMode>,
);
