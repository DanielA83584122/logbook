import styled, { createGlobalStyle, css } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  @font-face { font-family: 'Sohne'; src: url('/fonts/sohne-variable.woff2') format('woff2'); font-weight: 100 900; font-style: normal; font-display: swap; }
  @font-face { font-family: 'Sohne'; src: url('/fonts/sohne-italic.woff2') format('woff2'); font-weight: 400; font-style: italic; font-display: swap; }
  :root {
    color-scheme: light;
    --paper: #e4e7e9; --ink: #1c1c1c; --muted: #596167; --line: #c6cbc8; --sage: #535d59; --soft: #dbe1e5;
    --surface: #eef1f3; --field: #f6f8fa; --date-bg: #d2dbe2; --tag-bg: #d7deda; --tag-ink: #4e5b55;
    --code-bg: #dce1dc; --code-ink: #52635f; --quote: #59635e; --selection: #cbd5dc; --focus: #788487;
    --link: #2169b0; --url: #6d5597; --checkbox: #777b7e; --scrollbar: #b8c0bc;
    --timer-ring: #9da8b0; --timer: #59636b; --timer-hover: #646f77; --timer-ink: #f5f5f3;
    --timer-running: #48675e; --timer-running-hover: #547469; --timer-running-ring: #6b8980;
    --primary: #303b40; --primary-hover: #45535a; --primary-ink: #ffffff;
    --danger: #934638; --backdrop: #31393033; --chart: #a1b599; --chart-today: #607b61; --chart-hover: #7e9774;
  }
  :root[data-theme='night'] {
    color-scheme: dark;
    --paper: #011627; --ink: #c0c7d1; --muted: #a3b0bf; --line: #294559; --sage: #b1c4cc; --soft: #193447;
    --surface: #0a2133; --field: #102a3f; --date-bg: #173449; --tag-bg: #26394a; --tag-ink: #c0c7d1;
    --code-bg: #183340; --code-ink: #9bc2b9; --quote: #a3b9be; --selection: #315366; --focus: #75d1c4;
    --link: #75d1c4; --url: #b7a4dd; --checkbox: #8ca0b0; --scrollbar: #35556a;
    --timer-ring: #486578; --timer: #24394a; --timer-hover: #304b60; --timer-ink: #dbe4ea;
    --timer-running: #335e62; --timer-running-hover: #3b686c; --timer-running-ring: #75a39e;
    --primary: #75d1c4; --primary-hover: #9ddece; --primary-ink: #011627;
    --danger: #efaa9c; --backdrop: #000b16aa; --chart: #355e65; --chart-today: #75d1c4; --chart-hover: #96e0d5;
  }
  * { box-sizing: border-box; }
  html { background: var(--paper); -webkit-font-smoothing: antialiased; }
  body { margin: 0; color: var(--ink); background: var(--paper); font-family: 'Sohne', 'Helvetica Neue', Arial, sans-serif; font-size: 18px; font-weight: 300; line-height: 1.4; transition: background-color 160ms ease-out, color 160ms ease-out; }
  body:has(dialog[open]) { overflow: hidden; }
  button, input, textarea, select { font: inherit; color: inherit; }
  button { -webkit-tap-highlight-color: transparent; }
  button:not(:disabled), summary { cursor: pointer; }
  button:disabled { cursor: wait; opacity: .5; }
  button, input, textarea, select, a { outline-offset: 4px; }
  :focus-visible { outline: 2px solid var(--focus); }
  ::selection { background: var(--selection); }
  h1, h2, h3, p { margin: 0; }
  h1, h2, h3 { text-wrap: balance; font-weight: 400; }
  p, li { text-wrap: pretty; }
  svg { flex-shrink: 0; stroke-width: 1.5; }
  a { color: inherit; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
  }
`;

export const press = css`
  transition: background-color 120ms ease-out, color 120ms ease-out, scale 150ms ease-out;
  &:active:not(:disabled) { scale: .96; }
`;
export const IconButton = styled.button`
  ${press}; width: 44px; height: 44px; display: inline-flex; justify-content: center; align-items: center;
  border: 0; border-radius: 50%; background: transparent; color: var(--muted); flex-shrink: 0;
  &:hover { background: var(--soft); color: var(--ink); }
`;
export const Button = styled.button<{ $primary?: boolean }>`
  ${press}; min-height: 44px; padding: 8px 17px; display: inline-flex; justify-content: center; align-items: center; gap: 8px;
  border: 0; border-radius: 8px; background: ${({ $primary }) => $primary ? 'var(--primary)' : 'var(--soft)'};
  color: ${({ $primary }) => $primary ? 'var(--primary-ink)' : 'var(--ink)'}; font-size: 13px;
  &:hover { background: ${({ $primary }) => $primary ? 'var(--primary-hover)' : 'var(--date-bg)'}; }
`;
export const TextButton = styled.button`
  ${press}; min-height: 44px; border: 0; background: transparent; color: var(--sage);
  display: inline-flex; align-items: center; gap: 7px; padding: 4px 8px; font-size: 12px; border-radius: 6px;
  &:hover { background: var(--soft); }
`;
export const Eyebrow = styled.span`
  font-size: 10px; font-weight: 600; letter-spacing: 1.8px; text-transform: uppercase; color: var(--muted);
`;
export const Muted = styled.p`font-size: 13px; color: var(--muted);`;
export const Field = styled.input`
  width: 100%; min-height: 44px; border: 1px solid var(--line); border-radius: 7px;
  padding: 8px 11px; background: var(--field); font-size: 14px; min-width: 0;
`;
export const FieldLabel = styled.label`display: grid; gap: 6px; font-size: 12px; color: var(--muted);`;
export const InlineError = styled.p`font-size: 13px; color: var(--danger); margin: 12px 0;`;
export const Row = styled.div`display: flex; align-items: center; gap: 8px;`;
export const VisuallyHidden = styled.span`
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
`;
