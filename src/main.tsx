import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { exposeComputeBridge } from './gpu/expose';
import './ui/app.css';

// The §19 verification surface: e2e/webgpu.spec.ts drives the limb fixtures
// through the real GPU via window.scaleAtlasCompute. Diagnostics, not API.
exposeComputeBridge();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
