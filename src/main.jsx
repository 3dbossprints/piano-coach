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
    let previous = 0;
    try { previous = Number(sessionStorage.getItem(key) || 0); } catch {}
    if (Date.now() - previous > 30000) {
      try { sessionStorage.setItem(key, String(Date.now())); } catch {}
      window.location.reload();
    } else {
      console.error('Music Coach could not reload a missing module chunk. The import error will be shown in the app.', event);
    }
  });
}

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Music Coach render failure:', error, info); }
  render() {
    if (this.state.error) return <main style={{fontFamily:'system-ui',maxWidth:760,margin:'8vh auto',padding:24,color:'#1d2921'}}>
      <h1>Music Coach could not load</h1>
      <p>The application caught an error instead of leaving a blank screen. Copy this diagnostic when reporting the problem:</p>
      <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',padding:16,background:'#f3f4f2',borderRadius:10}}>{String(this.state.error?.stack||this.state.error?.message||this.state.error)}</pre>
      <button onClick={()=>location.reload()} style={{padding:'10px 16px',cursor:'pointer'}}>Reload Music Coach</button>
    </main>;
    return this.props.children;
  }
}
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Music Coach root element #root was not found.');
createRoot(rootElement).render(<AppErrorBoundary><App /></AppErrorBoundary>);
