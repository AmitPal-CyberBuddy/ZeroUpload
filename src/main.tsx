import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/layout.css';
import './styles/brand.css';
import './styles/workspace.css';
import './styles/pages.css';
import './styles/tools.css';
import { App } from './App';
import { ToastProvider } from './hooks/useToast';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

createRoot(container).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
