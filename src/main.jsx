import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './style.css';

// Recover from stale Vite lazy-loaded chunks after a deployment. The failed import
// still rejects to its caller; this reload simply gives the browser the new HTML
// and matching hashed asset. A session guard prevents reload loops.
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', event => {
    event.preventDefault();
    const key = 'pc_vite_preload_retry_at';
    let shouldReload = false;
    try {
      const previous = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - previous > 30000) {
        sessionStorage.setItem(key, String(Date.now()));
        shouldReload = true;
      }
    } catch {}
    if (shouldReload) window.location.reload();
    else console.error('Piano Coach could not reload a missing module chunk. The import error will be shown in the app.', event);
  });
}

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Piano Coach render failure:', error, info); }
  render() {
    if (this.state.error) return <main style={{fontFamily:'system-ui',maxWidth:760,margin:'8vh auto',padding:24,color:'#1d2921'}}>
      <h1>Piano Coach could not load</h1>
      <p>The application caught an error instead of leaving a blank screen. Copy this diagnostic when reporting the problem:</p>
      <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',padding:16,background:'#f3f4f2',borderRadius:10}}>{String(this.state.error?.stack||this.state.error?.message||this.state.error)}</pre>
      <button onClick={()=>location.reload()} style={{padding:'10px 16px',cursor:'pointer'}}>Reload Piano Coach</button>
    </main>;
    return this.props.children;
  }
}
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Piano Coach root element #root was not found.');
createRoot(rootElement).render(<AppErrorBoundary><App /></AppErrorBoundary>);
