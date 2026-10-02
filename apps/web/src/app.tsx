import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { demoAskResponseSchema, healthResponseSchema, type DemoAskResponse, type HealthResponse } from '@portfolio-pilot/contracts';
import { MarketNews, MarketSettings, MarketStatus } from './market';
import { PortfolioPage, WatchlistPage, usePortfolios } from './portfolio';
import { apiRequest } from './lib/api-client';
import { AuthenticationGate } from './auth';

export function App() { return <AuthenticationGate><Workspace /></AuthenticationGate>; }

const nav = [
  { path: '/', label: 'Dashboard', glyph: '▦' }, { path: '/portfolios', label: 'Portfolios', glyph: '▣' },
  { path: '/news', label: 'News', glyph: '▤' }, { path: '/assistant', label: 'Assistant', glyph: '✧' },
  { path: '/watchlist', label: 'Watchlist', glyph: '☆' }, { path: '/settings', label: 'Settings', glyph: '⚙' },
] as const;

export function DataState({ kind, title, children, retry }: { kind: 'empty' | 'loading' | 'error' | 'stale'; title: string; children?: React.ReactNode; retry?: () => void }) {
  return <div className={`data-state ${kind}`} role={kind === 'error' ? 'alert' : 'status'}><span className="state-mark" aria-hidden="true">{kind === 'error' ? '!' : kind === 'loading' ? '◌' : 'i'}</span><div><strong>{title}</strong>{children && <p>{children}</p>}</div>{retry && <button type="button" className="text-button" onClick={retry}>Try again</button>}</div>;
}
function Heading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return <div className="section-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>{action}</div>;
}
function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-title"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>;
}
function ChatPanel({ id, interactive = false }: { id: string; interactive?: boolean }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<DemoAskResponse | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || pending) return;
    setPending(true); setAnswer(null); setError('');
    try {
      const result = await apiRequest('/api/demo/ask', demoAskResponseSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: question.trim() }), timeoutMs: 25_000
      });
      setAnswer(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The assistant could not answer.'); }
    finally { setPending(false); }
  }
  return <div className="chat-panel"><span className="chat-symbol" aria-hidden="true">✧</span><h3>Your research companion</h3><p>{interactive ? 'Ask a general question. Portfolio context, current prices, and news sources are not connected yet.' : 'Open the Assistant screen to ask a question.'}</p><div className="prompt-samples"><span>What can this assistant help with?</span><span>Explain weighted average cost</span></div>{interactive ? <><form onSubmit={ask}><label htmlFor={id}>Ask the assistant</label><div className="chat-input"><input id={id} value={question} onChange={event => setQuestion(event.target.value)} placeholder="Type a question..." maxLength={500} required aria-describedby={`${id}-note`} /><button type="submit" disabled={pending || !question.trim()} aria-label="Send message">→</button></div></form><small id={`${id}-note`}>Up to 500 characters. One completed answer; no conversation history.</small>{pending && <DataState kind="loading" title="Answering">Please wait.</DataState>}{error && <DataState kind="error" title="Assistant unavailable">{error}</DataState>}{answer && <div className="chat-answer" role="status"><strong>{answer.mode === 'mock' ? 'Mock answer' : 'Claude answer'}</strong><p>{answer.answer}</p></div>}</> : <Link to="/assistant" className="section-link">Open Assistant →</Link>}</div>;
}
function Assistant() { return <><PageTitle eyebrow="RESEARCH" title="Assistant" description="Ask a general question in this local development demo. Portfolio-aware research is coming later." /><section className="card assistant-page"><ChatPanel id="chat-page" interactive /></section></>; }
function Settings() { return <><PageTitle eyebrow="PREFERENCES" title="Settings" description="Provider mode and freshness come from the server." /><section className="card settings"><Heading title="Environment" /><MarketSettings /><div><span>Display currency</span><strong>USD</strong></div><div><span>Time display</span><strong>UTC</strong></div></section></>; }

function Workspace() {
  const [selected, setSelected] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const portfolios = usePortfolios();
  useEffect(() => { if (portfolios.data && !portfolios.data.portfolios.some(p => p.id === selected)) setSelected(portfolios.data.portfolios[0]?.id ?? ''); }, [portfolios.data, selected]);
  const health = useQuery<HealthResponse>({ queryKey: ['health'], queryFn: ({ signal }) => apiRequest<HealthResponse>('/api/health/live', healthResponseSchema, { signal, timeoutMs: 5000 }) });
  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    document.getElementById('mobile-close')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); document.getElementById('mobile-open')?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  return <div className="app-shell"><a href="#main-content" className="skip-link">Skip to main content</a><aside className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Primary navigation"><div className="brand"><span className="brand-icon">P<span>↗</span></span><span>Portfolio<span className="brand-light">Pilot</span><small>INVEST WITH CLARITY</small></span><button className="mobile-close" id="mobile-close" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)}>×</button></div><div className="nav-caption">WORKSPACE</div><nav aria-label="Main navigation">{nav.map(item => <NavLink key={item.path} end to={item.path} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><span className="nav-glyph" aria-hidden="true">{item.glyph}</span>{item.label}</NavLink>)}</nav><div className="sidebar-bottom"><div className="demo-sidebar"><span className="demo-light"/><strong>Market providers</strong><p><MarketStatus /></p></div><div className="profile"><span className="avatar">AC</span><span><strong>Authenticated account</strong><small>Server session</small></span><span aria-hidden="true">⌄</span></div></div></aside>{menuOpen && <button type="button" className="backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}<div className="main-shell"><header className="topbar"><button className="menu-button" id="mobile-open" type="button" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>☰</button><div className="breadcrumb">Workspace <span>/</span> <strong>{nav.find(item => item.path === location.pathname)?.label ?? 'Dashboard'}</strong></div><div className="top-actions"><label htmlFor="portfolio-selector">Portfolio</label><select id="portfolio-selector" value={selected} onChange={e => setSelected(e.target.value)}>{!portfolios.data?.portfolios.length && <option value="">No portfolios</option>}{portfolios.data?.portfolios.map(p => <option key={p.id} value={p.id}>{p.name}{p.archivedAt ? ' (Archived)' : ''}</option>)}</select><span className="top-avatar" aria-label="Server session: Authenticated account">AC</span></div></header><main id="main-content" tabIndex={-1}><div className="notice"><span className="demo-badge"><MarketStatus /></span><span>Persisted portfolios · Quotes labeled per holding</span><span className="api-status" role="status">{health.isPending ? 'Checking API…' : health.isError ? 'API unavailable' : 'API connected'}</span></div>{health.isError && <DataState kind="error" title="API connection unavailable" retry={() => void health.refetch()}>Check the API connection and try again.</DataState>}<Routes><Route path="/" element={<PortfolioPage selected={selected} select={setSelected} overview />} /><Route path="/portfolios" element={<PortfolioPage selected={selected} select={setSelected} />} /><Route path="/news" element={<MarketNews />} /><Route path="/assistant" element={<Assistant />} /><Route path="/watchlist" element={<WatchlistPage />} /><Route path="/settings" element={<Settings />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes><footer className="footer">PortfolioPilot · USD stocks · Not investment advice.</footer></main></div></div>;
}


