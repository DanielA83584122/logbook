import { useEffect, useRef, useState, type FormEvent } from 'react';
import styled from 'styled-components';

const Gate = styled.dialog`
  width: min(360px, calc(100vw - 40px)); padding: 25px 27px 23px; border: 0; border-radius: 14px;
  color: var(--ink); background: var(--surface); box-shadow: 0 0 0 1px #00000008, 0 18px 70px #202a2530;
  &::backdrop { background: color-mix(in srgb, var(--backdrop) 70%, transparent); backdrop-filter: blur(7px); }
`;
const Form = styled.form`display: grid; gap: 7px;`;
const PasswordLine = styled.label`
  display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: baseline; gap: 10px;
  color: var(--muted); font-size: 13px;
`;
const Password = styled.input`
  width: 100%; min-width: 0; padding: 7px 2px 6px; border: 0; border-bottom: 1px solid var(--line);
  border-radius: 0; outline: 0; background: transparent; color: var(--ink); font-size: 16px; letter-spacing: .08em;
  transition: border-color 120ms ease-out, box-shadow 120ms ease-out;
  &:focus { border-color: var(--link); box-shadow: 0 1px 0 var(--link); }
  &:disabled { opacity: .55; }
`;
const Error = styled.p`min-height: 16px; color: var(--danger); font-size: 11px; text-align: right;`;

export function PasswordGate({ authenticate }: { authenticate: (password: string) => Promise<boolean> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const node = dialog.current!;
    if (!node.open) node.showModal();
    input.current?.focus();
    return () => { if (node.open) node.close(); };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true); setError('');
    try {
      if (!await authenticate(password)) {
        setError('wrong password'); setPassword('');
        requestAnimationFrame(() => input.current?.focus());
      }
    } catch {
      setError('couldn’t connect');
    } finally {
      setBusy(false);
    }
  };

  return <Gate ref={dialog} aria-label="Password required" onCancel={event => event.preventDefault()}>
    <Form onSubmit={submit}>
      <PasswordLine><span>password:</span><Password ref={input} aria-label="Password" type="password" autoComplete="current-password"
        enterKeyHint="go" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></PasswordLine>
      <Error role="alert" aria-live="polite">{error}</Error>
    </Form>
  </Gate>;
}
