import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { LanguageProvider } from './contexts/LanguageContext';
import { ErrorPanel } from '@hk01/pi-ai-extra-image-kit/react';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <App />
      {/* Image errors with provider/model, outside App so the login screen shows them too */}
      <ErrorPanel />
    </LanguageProvider>
  </StrictMode>,
);
