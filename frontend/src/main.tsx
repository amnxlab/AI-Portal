import { StrictMode, Component, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// ── Global async/uncaught error capture ───────────────────────────────────────
// ErrorBoundary only catches synchronous render errors. This catches:
//   - Failed dynamic imports (module load errors → blank page)
//   - Unhandled promise rejections from useEffect fetches
//   - Any other uncaught runtime exceptions
const globalErrors: string[] = [];

window.addEventListener('error', (e) => {
  const msg = `${e.message}\n  at ${e.filename}:${e.lineno}:${e.colno}`;
  globalErrors.push(msg);
  console.error('[GlobalError]', e.error ?? e.message);
});

window.addEventListener('unhandledrejection', (e) => {
  const msg = `Unhandled rejection: ${e.reason?.message ?? String(e.reason)}`;
  globalErrors.push(msg);
  console.error('[UnhandledRejection]', e.reason);
});

// ── ErrorBoundary ──────────────────────────────────────────────────────────────
function PanicScreen({ title, message, stack }: { title: string; message: string; stack?: string }) {
  return (
    <div style={{ padding: 40, fontFamily: 'monospace', background: '#0d1117', color: '#f85149', minHeight: '100vh' }}>
      <h2 style={{ color: '#f85149', marginTop: 0 }}>⚠ {title}</h2>
      <pre style={{ whiteSpace: 'pre-wrap', color: '#e6edf3', background: '#161b22', padding: 16, borderRadius: 6 }}>{message}</pre>
      {stack && <pre style={{ whiteSpace: 'pre-wrap', color: '#8b949e', fontSize: 11 }}>{stack}</pre>}
      {globalErrors.length > 0 && (
        <>
          <h3 style={{ color: '#d29922' }}>Additional global errors:</h3>
          {globalErrors.map((err, i) => <pre key={i} style={{ color: '#d29922', fontSize: 11 }}>{err}</pre>)}
        </>
      )}
      <div style={{ marginTop: 32, display: 'flex', gap: 12 }}>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: '8px 16px', background: '#21262d', color: '#e6edf3', border: '1px solid #30363d', borderRadius: 6, cursor: 'pointer' }}
        >
          Reload page
        </button>
        <button
          onClick={() => { localStorage.clear(); sessionStorage.clear(); window.location.reload(); }}
          style={{ padding: '8px 16px', background: '#f85149', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >
          Clear storage & reload
        </button>
      </div>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Render crash:', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      const e = this.state.error as Error;
      return <PanicScreen title="Render Error" message={e.message} stack={e.stack} />;
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

