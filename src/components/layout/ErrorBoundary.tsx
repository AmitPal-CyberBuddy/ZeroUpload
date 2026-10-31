import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';

interface State {
  error: Error | null;
}

/**
 * Catches render failures — typically a failed dynamic import after a redeploy —
 * and offers a reload instead of a blank page. Your files are unaffected: they
 * were never uploaded.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Local-only logging; nothing is reported to a server.
    console.error('ZeroUpload crashed while rendering:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="page">
        <div className="fourohfour">
          <Icon name="alert" size={40} style={{ color: 'var(--warn)' }} />
          <span className="eyebrow">Something broke</span>
          <h1>This screen could not be rendered.</h1>
          <p>
            A part of the page failed to load, which can happen just after an update. Reloading usually
            fixes it. Your files were never uploaded, so nothing was lost.
          </p>
          <div className="row row--wrap" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
              <Icon name="refresh" size={14} /> Reload the page
            </button>
            <a className="btn btn--secondary" href="#/tools" onClick={() => window.location.reload()}>
              Back to the catalogue
            </a>
          </div>
          <details className="error-detail">
            <summary>Technical details</summary>
            <pre className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: '60ch', whiteSpace: 'pre-wrap' }}>
              {this.state.error.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
