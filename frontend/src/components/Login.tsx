import { useState, useEffect } from 'react';
import { getGoogleAuthUrl } from '../services/api';

function LogoSignil() {
  return (
    <div className="login-logo-prompt">
      <span>shine:~</span>
      <span className="login-sigil">$</span>
      <span>login</span>
      <span className="login-caret" />
    </div>
  );
}

function WordMark() {
  return (
    <div className="login-wordmark">
      shine<span className="login-dot" />
    </div>
  );
}

function ColorStripe() {
  return (
    <div className="login-color-stripe">
      <span className="s1" /><span className="s2" /><span className="s3" /><span className="s4" />
    </div>
  );
}

const GOOGLE_SVG = (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.87-3.04.87a5.27 5.27 0 0 1-4.95-3.64H.96v2.33A9 9 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M4.05 10.79a5.41 5.41 0 0 1 0-3.58V4.88H.96a9 9 0 0 0 0 8.24l3.1-2.33z"/>
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.88l3.1 2.33A5.36 5.36 0 0 1 9 3.58z"/>
  </svg>
);

export function Login() {
  const [loading, setLoading] = useState(false);

  const signIn = () => {
    if (loading) return;
    setLoading(true);
    window.location.href = getGoogleAuthUrl();
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); signIn(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  return (
    <div className="chrome">
      <div className="chrome-bar">
        <div className="chrome-lights">
          <span className="light l-red" />
          <span className="light l-yellow" />
          <span className="light l-green" />
        </div>
        <div className="chrome-title">shine</div>
        <div className="chrome-right">sign in</div>
      </div>

      <div className="login-body">
        <div className="login-backdrop" />
        <div className="login-panel">
          <div className="login-logo-wrap">
            <LogoSignil />
            <WordMark />
            <ColorStripe />
            <p className="login-tagline">control your entire google workspace with natural language commands.</p>
          </div>

          <button
            className={'login-g-btn' + (loading ? ' loading' : '')}
            type="button"
            disabled={loading}
            onClick={signIn}
          >
            <span className="login-g-btn-icon">{GOOGLE_SVG}</span>
            <span className="login-loader" />
            <span className="login-g-btn-text">{loading ? 'signing in...' : 'continue with google'}</span>
          </button>

          <div className="login-term-hint">
            or hit <code>↵</code> to run <code>login --google</code>
          </div>

          <div className="login-footer">
            by continuing you agree to the <a href="#">terms</a> and <a href="#">privacy policy</a>.<br />
            shine is not affiliated with google.
          </div>
        </div>
      </div>
    </div>
  );
}
