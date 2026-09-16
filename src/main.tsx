import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { GlobalStyle } from './styles';

document.documentElement.dataset.theme = localStorage.getItem('still-theme') === 'night' ? 'night' : 'day';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><GlobalStyle /><App /></React.StrictMode>,
);
