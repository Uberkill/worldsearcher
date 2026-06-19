import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    const errorStr = error ? error.message : '';
    const stackStr = error ? error.stack : '';
    localStorage.setItem(
      'LAST_CRASH',
      JSON.stringify({ error: errorStr, stack: stackStr, info: errorInfo })
    );
    console.error(
      '[ErrorBoundary] Game engine crashed:',
      errorStr,
      stackStr,
      errorInfo
    );
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.toString() || 'Unknown error';
      const stack = this.state.errorInfo?.componentStack || '';

      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'linear-gradient(160deg, #0a0008 0%, #180010 100%)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
            color: '#fca5a5',
            padding: 32,
          }}
        >
          {/* Glitch accent bar */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: 'linear-gradient(90deg, #dc2626, #ef4444, #dc2626)',
            }}
          />

          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠</div>

          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: 'uppercase',
              margin: '0 0 8px',
              color: '#fca5a5',
            }}
          >
            Engine Crash
          </h1>
          <p
            style={{
              fontSize: 14,
              color: '#94a3b8',
              margin: '0 0 32px',
              textAlign: 'center',
            }}
          >
            The 3D engine encountered a fatal error and could not recover.
          </p>

          {/* Error message */}
          <div
            style={{
              background: 'rgba(220,38,38,0.08)',
              border: '1px solid rgba(220,38,38,0.25)',
              borderRadius: 8,
              padding: '12px 20px',
              maxWidth: 640,
              width: '100%',
              fontFamily: 'monospace',
              fontSize: 13,
              color: '#fca5a5',
              marginBottom: 24,
              wordBreak: 'break-all',
            }}
          >
            {msg}
          </div>

          {/* Stack trace (collapsible) */}
          {stack && (
            <details style={{ maxWidth: 640, width: '100%', marginBottom: 24 }}>
              <summary
                style={{
                  cursor: 'pointer',
                  fontSize: 12,
                  color: '#64748b',
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  marginBottom: 8,
                }}
              >
                Component Stack
              </summary>
              <pre
                style={{
                  fontSize: 11,
                  color: '#475569',
                  background: 'rgba(0,0,0,0.4)',
                  borderRadius: 6,
                  padding: 12,
                  overflow: 'auto',
                  maxHeight: 200,
                  border: '1px solid rgba(255,255,255,0.05)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {stack}
              </pre>
            </details>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '12px 28px',
                borderRadius: 9999,
                background: 'rgba(220,38,38,0.15)',
                border: '1px solid rgba(220,38,38,0.4)',
                color: '#fca5a5',
                fontSize: 14,
                cursor: 'pointer',
                letterSpacing: 1,
                textTransform: 'uppercase',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) =>
                (e.target.style.background = 'rgba(220,38,38,0.3)')
              }
              onMouseLeave={(e) =>
                (e.target.style.background = 'rgba(220,38,38,0.15)')
              }
            >
              Reload Game
            </button>
            <button
              onClick={() =>
                this.setState({ hasError: false, error: null, errorInfo: null })
              }
              style={{
                padding: '12px 28px',
                borderRadius: 9999,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#94a3b8',
                fontSize: 14,
                cursor: 'pointer',
                letterSpacing: 1,
                textTransform: 'uppercase',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) =>
                (e.target.style.background = 'rgba(255,255,255,0.08)')
              }
              onMouseLeave={(e) =>
                (e.target.style.background = 'rgba(255,255,255,0.04)')
              }
            >
              Try to Recover
            </button>
          </div>

          <p style={{ marginTop: 24, fontSize: 11, color: '#334155' }}>
            Check the browser console for more details.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
