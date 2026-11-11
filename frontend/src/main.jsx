import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import App from './App.jsx';
import { SesionProvider } from './sesion.jsx';
import { AvisosProvider } from './componentes/ui.jsx';
import './styles.css';
import './paginas/operacion.css';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <SesionProvider>
      <AvisosProvider>
        <App />
      </AvisosProvider>
    </SesionProvider>
  </BrowserRouter>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
