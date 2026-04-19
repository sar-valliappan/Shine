import { useState, useEffect, useRef, useCallback } from 'react';
import { getGoogleAuthUrl } from '../services/api';
import '../styles/landing.css';

// ── data ────────────────────────────────────────────────────────────────────

const COMMANDS = [
  'summarize my inbox',
  'schedule meeting tomorrow at 3pm with the team',
  'draft reply to last email from Sarah',
  'find Q4 budget report in Drive',
  'create slides for Monday standup',
  'show my calendar this week',
  'share budget.xlsx with finance@company.com',
  'mark all starred emails as read',
  'set out-of-office for next week',
];

const NAV_LINKS = [
  { label: 'products',      id: 'products'      },
  { label: 'features',      id: 'features'      },
  { label: 'how it works',  id: 'how-it-works'  },
  { label: 'about',         id: 'about'         },
];

const SECTION_IDS = ['hero', 'products', 'features', 'how-it-works', 'showcase', 'about'];

const FLOAT_ICONS = [
  { icon: '✉', color: '#EA4335', label: 'Gmail' },
  { icon: '◷', color: '#4285F4', label: 'Calendar' },
  { icon: '⊞', color: '#34A853', label: 'Sheets' },
  { icon: '▷', color: '#F57C00', label: 'Slides' },
  { icon: '△', color: '#FBBC05', label: 'Drive' },
  { icon: '≡', color: '#4285F4', label: 'Docs'  },
] as const;

const PRODUCTS = [
  { name: 'Gmail',     icon: '✉',  color: '#EA4335', cmd: '→ summarize inbox'   },
  { name: 'Calendar',  icon: '◷', color: '#4285F4', cmd: '→ schedule meeting'  },
  { name: 'Drive',     icon: '△',  color: '#FBBC05', cmd: '→ find files'        },
  { name: 'Docs',      icon: '≡',  color: '#4285F4', cmd: '→ draft document'    },
  { name: 'Slides',    icon: '▷',  color: '#F57C00', cmd: '→ create deck'       },
  { name: 'Sheets',    icon: '⊞', color: '#34A853', cmd: '→ analyze data'      },
  { name: 'Forms',     icon: '◻', color: '#8B2FB3', cmd: '→ create survey'     },
] as const;

const STEPS = [
  {
    num: '01',
    title: 'type a command',
    desc: 'describe what you want in plain english. no syntax to learn, no shortcuts to memorize.',
  },
  {
    num: '02',
    title: 'shine processes it',
    desc: 'our ai engine understands your intent and routes to exactly the right google api.',
  },
  {
    num: '03',
    title: 'done.',
    desc: 'your workspace action completes instantly. no new tabs. no clicking through menus.',
  },
] as const;

const STAT_DATA = [
  { display: '10×', target: 10, suffix: '×', label: 'faster workflow' },
  { display: '7',   target: 7,  suffix: '',  label: 'google apps connected' },
  { display: '0',   target: 0,  suffix: '',  label: 'tab switches needed' },
  { display: '∞',  target: -1, suffix: '',  label: 'commands possible' },
] as const;

const BENTO_CARDS = [
  { n: 'Gmail',    c: 'r',      col: '#EA4335', icon: '✉',  span: true,  desc: 'summarize inbox · draft replies · search threads · set filters', cmds: ['summarize my inbox', 'draft reply to Sarah', 'find unread from Alex'] },
  { n: 'Calendar', c: 'b',      col: '#4285F4', icon: '◷', span: false, desc: 'schedule events · find free time · rsvp · set reminders',       cmds: ['schedule meeting 3pm', 'show this week', 'find free slot friday'] },
  { n: 'Drive',    c: 'y',      col: '#FBBC05', icon: '△',  span: false, desc: 'find files · share folders · organize · bulk rename',           cmds: ['find Q4 report', 'share with team', 'list recent files'] },
  { n: 'Docs',     c: 'docs',   col: '#4285F4', icon: '≡',  span: false, desc: 'create · edit · export · comment · collaborate',               cmds: ['create project brief', 'export to PDF', 'add comment on doc'] },
  { n: 'Slides',   c: 'slides', col: '#F57C00', icon: '▷',  span: false, desc: 'create presentations · add slides · export · share',            cmds: ['create pitch deck', 'add 3 slides', 'export as PDF'] },
  { n: 'Sheets',   c: 'sheets', col: '#34A853', icon: '⊞', span: true,  desc: 'analyze data · create formulas · build charts · import CSV',   cmds: ['analyze sales data', 'create pivot table', 'import CSV'] },
  { n: 'Forms',    c: 'forms',  col: '#8B2FB3', icon: '◻', span: false, desc: 'create surveys · collect responses · analyze results',          cmds: ['create feedback form', 'share survey link', 'view responses'] },
] as const;

const SHOWCASE = [
  {
    app: 'Gmail', color: '#EA4335', icon: '✉',
    command: 'summarize my inbox',
    output: '12 unread · 3 need replies\n─ Sarah: Q4 review draft\n─ Alex: Monday standup\n─ Team: Sprint 24 recap',
  },
  {
    app: 'Calendar', color: '#4285F4', icon: '◷',
    command: 'schedule meeting tomorrow 3pm',
    output: '✓ Created "Team Sync"\nApr 19 · 3:00–3:30 PM\nInvited: team@company.com',
  },
  {
    app: 'Drive', color: '#FBBC05', icon: '△',
    command: 'find Q4 budget report',
    output: '✓ Q4_Budget_v3.xlsx\nFinance / Reports\nModified: Apr 15, 2:30 PM',
  },
] as const;

const ABOUT_STATS = [
  { value: '93%', label: 'of tasks use 3+ apps' },
  { value: '47m', label: 'lost daily to switching' },
  { value: '1',   label: 'command changes it all' },
] as const;

// ── Google SVG ───────────────────────────────────────────────────────────────

const GOOGLE_SVG = (
  <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden focusable="false">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.87-3.04.87a5.27 5.27 0 0 1-4.95-3.64H.96v2.33A9 9 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M4.05 10.79a5.41 5.41 0 0 1 0-3.58V4.88H.96a9 9 0 0 0 0 8.24l3.1-2.33z"/>
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.88l3.1 2.33A5.36 5.36 0 0 1 9 3.58z"/>
  </svg>
);

// ── typewriter hook ──────────────────────────────────────────────────────────

function useTypewriter(lines: string[], speed = 68) {
  const [display, setDisplay] = useState('');
  const lineIdx  = useRef(0);
  const charIdx  = useRef(0);
  const deleting = useRef(false);

  useEffect(() => {
    let raf: number;
    let lastTime = 0;
    let delay = speed;

    const tick = (now: number) => {
      if (now - lastTime < delay) { raf = requestAnimationFrame(tick); return; }
      lastTime = now;
      const current = lines[lineIdx.current];
      if (!deleting.current) {
        if (charIdx.current <= current.length) {
          setDisplay(current.slice(0, charIdx.current));
          charIdx.current++;
          delay = speed + (Math.random() * 28 - 14);
        } else {
          delay = 1900; deleting.current = true;
        }
      } else {
        if (charIdx.current > 0) {
          charIdx.current--;
          setDisplay(current.slice(0, charIdx.current));
          delay = speed * 0.44;
        } else {
          deleting.current = false;
          lineIdx.current = (lineIdx.current + 1) % lines.length;
          delay = 380;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return display;
}

// ── component ────────────────────────────────────────────────────────────────

export function Login() {
  const [loading, setLoading]         = useState(false);
  const [activeSection, setActiveSection] = useState('hero');

  const cursorGlowRef = useRef<HTMLDivElement>(null);
  const scrollBarRef  = useRef<HTMLDivElement>(null);
  const scrollHintRef = useRef<HTMLDivElement>(null);
  const navRef        = useRef<HTMLElement>(null);

  const typedText = useTypewriter(COMMANDS);

  // ── sign in ────────────────────────────────────────────────────────────────
  const signIn = useCallback(() => {
    if (loading) return;
    setLoading(true);
    window.location.href = getGoogleAuthUrl();
  }, [loading]);

  // ── allow page scroll ──────────────────────────────────────────────────────
  useEffect(() => {
    const prevO = document.body.style.overflow;
    const prevH = document.body.style.height;
    document.body.style.overflow = 'auto';
    document.body.style.height   = 'auto';
    document.documentElement.style.scrollBehavior = 'smooth';
    return () => {
      document.body.style.overflow = prevO;
      document.body.style.height   = prevH;
      document.documentElement.style.scrollBehavior = '';
    };
  }, []);

  // ── enter key ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); signIn(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [signIn]);

  // ── merged scroll handler ──────────────────────────────────────────────────
  useEffect(() => {
    const nav  = navRef.current;
    const bar  = scrollBarRef.current;
    const hint = scrollHintRef.current;

    const onScroll = () => {
      const y    = window.scrollY;
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      if (nav)  nav.classList.toggle('ln-nav-scrolled', y > 50);
      if (bar)  bar.style.width = maxY > 0 ? `${(y / maxY) * 100}%` : '0%';
      if (hint) hint.classList.toggle('ln-hint-hidden', y > 80);
      document.documentElement.style.setProperty('--ln-scroll', String(y));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── cursor glow ────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = cursorGlowRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      el.style.transform = `translate3d(${e.clientX - 300}px,${e.clientY - 300}px,0)`;
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // ── active section tracker ─────────────────────────────────────────────────
  useEffect(() => {
    const observers = SECTION_IDS.map(id => {
      const el = document.getElementById(id);
      if (!el) return null;
      const obs = new IntersectionObserver(
        (entries) => { const entry = entries[0]; if (entry?.isIntersecting) setActiveSection(id); },
        { threshold: 0.35 }
      );
      obs.observe(el);
      return obs;
    });
    return () => observers.forEach(o => o?.disconnect());
  }, []);

  // ── scroll reveal ──────────────────────────────────────────────────────────
  useEffect(() => {
    const els = document.querySelectorAll('.ln-reveal, .ln-reveal-h');
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          (e.target as HTMLElement).classList.add('ln-revealed');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.09 });
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  // ── HIW connector line reveal ──────────────────────────────────────────────
  useEffect(() => {
    const section = document.querySelector<HTMLElement>('.ln-hiw-section');
    if (!section) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry?.isIntersecting) { section.classList.add('ln-hiw-revealed'); obs.disconnect(); } },
      { threshold: 0.3 }
    );
    obs.observe(section);
    return () => obs.disconnect();
  }, []);

  // ── animated stat counters ─────────────────────────────────────────────────
  useEffect(() => {
    const statEls = document.querySelectorAll<HTMLElement>('.ln-stat-v[data-target]');
    let triggered = false;
    const obs = new IntersectionObserver(entries => {
      if (triggered || !entries.some(e => e.isIntersecting)) return;
      triggered = true;
      obs.disconnect();
      statEls.forEach(el => {
        const target = parseFloat(el.dataset.target ?? '0');
        if (target < 0) return; // ∞ — static
        const suffix = el.dataset.suffix ?? '';
        const dur    = 1200;
        const start  = performance.now();
        const tick   = (now: number) => {
          const t     = Math.min((now - start) / dur, 1);
          const eased = 1 - Math.pow(1 - t, 3);
          el.textContent = Math.round(eased * target) + suffix;
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.5 });
    statEls.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  // ── magnetic CTA buttons ───────────────────────────────────────────────────
  useEffect(() => {
    const wraps = document.querySelectorAll<HTMLElement>('.ln-cta-wrap');
    const offs: (() => void)[] = [];
    wraps.forEach(wrap => {
      const btn = wrap.querySelector<HTMLElement>('.ln-cta-btn');
      if (!btn) return;
      const onMove = (e: MouseEvent) => {
        const r  = wrap.getBoundingClientRect();
        const dx = (e.clientX - r.left - r.width  / 2) * 0.28;
        const dy = (e.clientY - r.top  - r.height / 2) * 0.28;
        btn.style.transform = `translate3d(${dx}px,${dy}px,0)`;
      };
      const onLeave = () => { btn.style.transform = 'translate3d(0,0,0)'; };
      wrap.addEventListener('mousemove', onMove);
      wrap.addEventListener('mouseleave', onLeave);
      offs.push(() => { wrap.removeEventListener('mousemove', onMove); wrap.removeEventListener('mouseleave', onLeave); });
    });
    return () => offs.forEach(f => f());
  }, []);

  // ── bento 3D tilt ─────────────────────────────────────────────────────────
  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>('.ln-bento-card');
    const offs: (() => void)[] = [];
    cards.forEach(el => {
      const onMove = (e: MouseEvent) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width  - 0.5;
        const y = (e.clientY - r.top)  / r.height - 0.5;
        el.style.transform = `perspective(700px) rotateX(${-y * 12}deg) rotateY(${x * 12}deg) translateZ(10px)`;
        el.style.setProperty('--sx', String(x + 0.5));
        el.style.setProperty('--sy', String(y + 0.5));
      };
      const onLeave = () => {
        el.style.transform = '';
        el.style.setProperty('--sx', '0.5');
        el.style.setProperty('--sy', '0.5');
      };
      el.addEventListener('mousemove', onMove);
      el.addEventListener('mouseleave', onLeave);
      offs.push(() => { el.removeEventListener('mousemove', onMove); el.removeEventListener('mouseleave', onLeave); });
    });
    return () => offs.forEach(f => f());
  }, []);

  // ── helpers ────────────────────────────────────────────────────────────────
  const scrollToSection = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    history.pushState(null, '', `#${id}`);
  }, []);

  const CtaBtn = ({ id }: { id: string }) => (
    <button
      key={id}
      className={'ln-cta-btn' + (loading ? ' ln-loading' : '')}
      type="button" disabled={loading} onClick={signIn}
    >
      <span className="ln-cta-glass" aria-hidden />
      <span className="ln-cta-icon"  aria-hidden>{GOOGLE_SVG}</span>
      <span className="ln-cta-spinner" aria-hidden />
      <span className="ln-cta-text">{loading ? 'signing in…' : 'continue with google'}</span>
    </button>
  );

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="ln-root">

      {/* ── Fixed chrome ────────────────────────────────────────────────── */}
      <div className="ln-scroll-bar" aria-hidden>
        <div className="ln-scroll-bar-fill" ref={scrollBarRef} />
      </div>
      <div className="ln-cursor-glow" ref={cursorGlowRef} aria-hidden />
      <div className="ln-orb-field" aria-hidden>
        <div className="ln-orb ln-orb-r" />
        <div className="ln-orb ln-orb-b" />
        <div className="ln-orb ln-orb-y" />
        <div className="ln-orb ln-orb-g" />
      </div>
      <nav className="ln-dots" aria-label="page sections">
        {SECTION_IDS.map(id => (
          <button
            key={id}
            className={'ln-dot' + (activeSection === id ? ' ln-dot-active' : '')}
            onClick={() => scrollToSection(id)}
            aria-label={`Go to ${id.replace('-', ' ')} section`}
          />
        ))}
      </nav>

      {/* ── Navbar ──────────────────────────────────────────────────────── */}
      <header className="ln-nav" ref={navRef}>
        <div className="ln-nav-logo" onClick={() => scrollToSection('hero')} role="button" tabIndex={0} aria-label="Shine home">
          shine<span className="ln-dot-cycle" aria-hidden>.</span>
        </div>
        <nav className="ln-nav-links" aria-label="page navigation">
          {NAV_LINKS.map(l => (
            <a
              key={l.id}
              href={`#${l.id}`}
              className={'ln-nav-link' + (activeSection === l.id ? ' ln-nav-link-active' : '')}
            >
              {l.label}
            </a>
          ))}
        </nav>
        <button className="ln-nav-btn" onClick={signIn} disabled={loading} aria-label="Sign in">
          {loading ? 'signing in…' : 'sign in →'}
        </button>
      </header>

      {/* ═══════════════════════════════════════════════════════════════════
          HERO
          ═══════════════════════════════════════════════════════════════════ */}
      <section id="hero" className="ln-hero" aria-labelledby="hero-heading">
        <div className="ln-hero-grid" aria-hidden />
        <div className="ln-hero-vignette" aria-hidden />

        {/* Floating product icons */}
        <div className="ln-ficons" aria-hidden>
          {FLOAT_ICONS.map((fi, i) => (
            <div key={fi.label} className={`ln-ficon ln-ficon-${i + 1}`}>
              <div className="ln-ficon-inner" style={{ color: fi.color }}>{fi.icon}</div>
            </div>
          ))}
        </div>

        <div className="ln-hero-content">
          <p className="ln-hero-eyebrow">_ natural language workspace control</p>

          <div className="ln-logo-stage" aria-hidden>
            <div className="ln-logo-3d">
              <span className="ln-logo-word">shine</span>
              <span className="ln-logo-period">.</span>
            </div>
            <div className="ln-logo-halo" />
          </div>

          <div className="ln-stripe" aria-hidden>
            <span className="ln-s-r" /><span className="ln-s-b" />
            <span className="ln-s-y" /><span className="ln-s-g" />
          </div>

          <p className="ln-hero-tag" id="hero-heading">
            control your entire google workspace<br />
            <span className="ln-hero-tag-em">
              <span className="ln-gradient-text">one command.</span> seven apps. zero friction.
            </span>
          </p>

          <div className="ln-cta-wrap">
            <CtaBtn id="hero-cta" />
          </div>

          <p className="ln-press-hint">
            press <code>↵</code> or run <code>login --google</code>
          </p>
        </div>

        <div className="ln-scroll-hint" ref={scrollHintRef} aria-hidden>
          <span className="ln-scroll-hint-label">scroll to explore</span>
          <div className="ln-scroll-hint-arrow">↓</div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          PRODUCTS MARQUEE
          ═══════════════════════════════════════════════════════════════════ */}
      <section id="products" className="ln-products-section" aria-label="Supported Google Workspace products">
        <div className="ln-products-track">
          <div className="ln-products-inner" aria-hidden>
            {[...PRODUCTS, ...PRODUCTS].map((p, i) => (
              <div key={i} className="ln-product-card">
                <span className="ln-product-icon" style={{ color: p.color }}>{p.icon}</span>
                <span className="ln-product-name">{p.name}</span>
                <span className="ln-product-cmd">{p.cmd}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          HOW IT WORKS
          ═══════════════════════════════════════════════════════════════════ */}
      <section id="how-it-works" className="ln-hiw-section" aria-labelledby="hiw-heading">
        <h2 className="ln-section-h ln-reveal-h" id="hiw-heading">how it works.</h2>
        <div className="ln-hiw-steps">
          {STEPS.map((step, i) => (
            <>
              <div key={step.num} className="ln-hiw-step ln-reveal" style={{ transitionDelay: `${i * 100}ms` }}>
                <div className="ln-hiw-step-dot" aria-hidden />
                <div className="ln-hiw-num">{step.num}</div>
                <div className="ln-hiw-title">{step.title}</div>
                <div className="ln-hiw-desc">{step.desc}</div>
              </div>
              {i < STEPS.length - 1 && (
                <div key={`connector-${i}`} className="ln-hiw-connector" aria-hidden>
                  <div className="ln-hiw-connector-fill" />
                </div>
              )}
            </>
          ))}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          TERMINAL DEMO
          ═══════════════════════════════════════════════════════════════════ */}
      <section id="features" className="ln-demo-section ln-reveal" aria-label="Live terminal demo">
        <p className="ln-section-eyebrow">_ watch it work</p>
        <div className="ln-term-3d-wrap">
          <div className="ln-term-3d" role="img" aria-label="Terminal showing shine commands">
            <div className="ln-term-chrome" aria-hidden>
              <span className="ln-tl ln-tl-r" /><span className="ln-tl ln-tl-y" /><span className="ln-tl ln-tl-g" />
              <span className="ln-term-chrome-title">shine — workspace terminal</span>
            </div>
            <div className="ln-term-body">
              <div className="ln-term-line">
                <span className="ln-term-ps1">shine:~</span>
                <span className="ln-term-dollar">$</span>
                <span className="ln-term-typed" aria-live="polite">{typedText}</span>
                <span className="ln-term-blink" aria-hidden />
              </div>
              <div className="ln-term-output">
                <span className="ln-out-check">✓</span> parsing intent with ai engine...
              </div>
              <div className="ln-term-output">
                <span className="ln-out-check">✓</span> routing to google workspace api...
              </div>
              <div className="ln-term-output ln-out-done">
                <span className="ln-out-check">✓</span> done <span className="ln-out-dim">(432ms)</span>
              </div>
            </div>
            <div className="ln-scanlines" aria-hidden />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          STATS
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="ln-stats ln-reveal" aria-label="Key statistics">
        {STAT_DATA.map(s => (
          <div className="ln-stat" key={s.label}>
            <span
              className={'ln-stat-v' + (s.target < 0 ? ' ln-stat-infinity' : '')}
              data-target={s.target >= 0 ? String(s.target) : undefined}
              data-suffix={s.suffix || undefined}
            >
              {s.display}
            </span>
            <span className="ln-stat-l">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          BENTO GRID (7 apps)
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="ln-bento-section" aria-labelledby="bento-heading">
        <h2 className="ln-section-h ln-reveal-h" id="bento-heading">everything connected.</h2>
        <div className="ln-bento-grid">
          {BENTO_CARDS.map((card, i) => (
            <div
              key={card.n}
              className={[
                'ln-bento-card',
                `ln-bento-${card.c}`,
                card.span ? 'ln-bento-span' : '',
                'ln-reveal',
              ].join(' ')}
              style={{ transitionDelay: `${i * 65}ms` }}
            >
              <div className="ln-bento-spec" aria-hidden />
              <div className="ln-bento-glow-bg" aria-hidden />
              <div className="ln-bento-top">
                <span className="ln-bento-icon" style={{ color: card.col }} aria-hidden>{card.icon}</span>
                <span className="ln-bento-name">{card.n}</span>
              </div>
              <p className="ln-bento-desc">{card.desc}</p>
              <div className="ln-bento-cmd-list" aria-hidden>
                {card.cmds.map((cmd: string) => (
                  <span key={cmd} className="ln-bento-cmd">{cmd}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          COMMAND SHOWCASE
          ═══════════════════════════════════════════════════════════════════ */}
      <section id="showcase" className="ln-showcase-section" aria-labelledby="showcase-heading">
        <h2 className="ln-section-h ln-reveal-h" id="showcase-heading">real commands. real results.</h2>
        <div className="ln-showcase-grid">
          {SHOWCASE.map((s, i) => (
            <div key={s.app} className="ln-showcase-item ln-reveal" style={{ transitionDelay: `${i * 100}ms` }}>
              <div className="ln-showcase-label">
                <div className="ln-showcase-badge" style={{ color: s.color, borderColor: `${s.color}30` }}>{s.icon}</div>
                <span className="ln-showcase-app">{s.app}</span>
              </div>
              <div className="ln-showcase-term">
                <div className="ln-showcase-chrome" aria-hidden>
                  <span className="ln-tl ln-tl-r" /><span className="ln-tl ln-tl-y" /><span className="ln-tl ln-tl-g" />
                </div>
                <div className="ln-showcase-body">
                  <div className="ln-showcase-cmd-line">
                    <span className="ln-showcase-ps">shine:~</span>
                    <span className="ln-showcase-dollar">$</span>
                    {s.command}
                  </div>
                  <div className="ln-showcase-output">{s.output}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          ABOUT / MISSION
          ═══════════════════════════════════════════════════════════════════ */}
      <section id="about" className="ln-about-section" aria-labelledby="about-heading">
        <div className="ln-about-inner ln-reveal">
          <p className="ln-about-eyebrow">_ why we built this</p>
          <p className="ln-about-quote" id="about-heading">
            "most people waste nearly an hour every day switching between google apps to complete
            a single task. we built shine so you{' '}
            <em><span className="ln-gradient-text">never have to switch again.</span></em>"
          </p>
          <div className="ln-about-stat-row">
            {ABOUT_STATS.map(s => (
              <div key={s.label} className="ln-about-stat">
                <span className="ln-about-stat-v">{s.value}</span>
                <span className="ln-about-stat-l">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          BOTTOM CTA
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="ln-bottom-cta ln-reveal" aria-label="Sign in call to action">
        <p className="ln-bottom-tag">ready to shine?</p>
        <p className="ln-bottom-sub">start controlling your workspace in under 30 seconds.</p>
        <div className="ln-cta-wrap">
          <CtaBtn id="bottom-cta" />
        </div>
        <p className="ln-press-hint">press <code>↵</code> or run <code>login --google</code></p>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          FOOTER
          ═══════════════════════════════════════════════════════════════════ */}
      <footer className="ln-footer">
        <span className="ln-footer-logo">shine<span className="ln-dot-cycle" aria-hidden>.</span></span>
        <span className="ln-footer-sep" aria-hidden>·</span>
        <a className="ln-footer-a" href="#">terms</a>
        <span className="ln-footer-sep" aria-hidden>·</span>
        <a className="ln-footer-a" href="#">privacy policy</a>
        <span className="ln-footer-sep" aria-hidden>·</span>
        <span className="ln-footer-note">not affiliated with google</span>
      </footer>

    </div>
  );
}
