import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
// Después de index.css: los tokens y el tema Tally ganan los empates de especificidad
import './styles/tally.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
