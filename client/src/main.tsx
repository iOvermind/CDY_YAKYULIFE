import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root 掛載點');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
