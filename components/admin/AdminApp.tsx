'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, LogOut } from 'lucide-react';
import type { Project, Site } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  AboutTab, ContactTab, ExperienceTab, HonorsEduTab, NavTab,
  PersonalTab, SettingsTab, SkillsTab, SocialsTab, StatsTab, ThesisTab,
} from './SiteTabs';
import ProjectsTab, { type DraftProject } from './ProjectsTab';

type TabId =
  | 'settings' | 'personal' | 'socials' | 'nav' | 'stats' | 'thesis'
  | 'about' | 'projects' | 'skills' | 'experience' | 'honorsEdu' | 'contact';

const TABS: { id: TabId; label: string }[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'personal', label: 'Personal' },
  { id: 'socials', label: 'Social links' },
  { id: 'nav', label: 'Navigation' },
  { id: 'stats', label: 'Stats' },
  { id: 'thesis', label: 'Thesis' },
  { id: 'about', label: 'About' },
  { id: 'projects', label: 'Projects' },
  { id: 'skills', label: 'Skills' },
  { id: 'experience', label: 'Experience' },
  { id: 'honorsEdu', label: 'Honors / Education' },
  { id: 'contact', label: 'Contact' },
];

function Login({ onAuthed }: { onAuthed: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? (res.status === 401 ? 'Incorrect password.' : `Error ${res.status}`));
        return;
      }
      onAuthed();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 md:p-8">
        <p className="kicker">Admin</p>
        <h1 className="mt-2 text-xl font-semibold text-ink">Sign in</h1>
        <label className="label mt-6">Password</label>
        <input
          type="password"
          autoFocus
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="mt-3 font-mono text-xs text-red-400">{error}</p>}
        <button type="submit" disabled={busy || !password} className="btn-primary mt-5 w-full disabled:opacity-40">
          {busy ? 'Checking…' : 'Unlock'}
        </button>
        <a href="/" className="mt-5 block text-center font-mono text-[11px] uppercase tracking-widest text-ink-mute hover:text-accent">
          ← Back to site
        </a>
      </form>
    </div>
  );
}

export default function AdminApp() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [projects, setProjects] = useState<DraftProject[]>([]);
  const [baseline, setBaseline] = useState<string>('');
  const [deletes, setDeletes] = useState<string[]>([]);
  const [tab, setTab] = useState<TabId>('settings');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMode, setSavedMode] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth').then((res) => setAuthed(res.ok)).catch(() => setAuthed(false));
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/content');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const drafts: DraftProject[] = (data.projects as Project[]).map((p) => ({
        ...p,
        _originalSlug: p.slug,
      }));
      setSite(data.site as Site);
      setProjects(drafts);
      setDeletes([]);
      setBaseline(JSON.stringify({ site: data.site, projects: drafts }));
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (authed) load();
  }, [authed, load]);

  const dirty = useMemo(
    () => deletes.length > 0 || JSON.stringify({ site, projects }) !== baseline,
    [site, projects, deletes, baseline],
  );

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const save = async () => {
    if (!site) return;
    setSaving(true);
    setSaveError(null);
    setSavedMode(null);
    try {
      const files: { path: string; data: unknown }[] = [{ path: 'content/site.json', data: site }];
      const removals = new Set(deletes.map((slug) => `content/projects/${slug}.json`));
      for (const project of projects) {
        const { _originalSlug, ...clean } = project;
        if (_originalSlug && _originalSlug !== project.slug) {
          removals.add(`content/projects/${_originalSlug}.json`);
        }
        removals.delete(`content/projects/${project.slug}.json`);
        files.push({ path: `content/projects/${project.slug}.json`, data: clean });
      }
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ files, deletes: [...removals] }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (res.status === 401) {
          setAuthed(false);
          return;
        }
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSavedMode(data.mode);
      const cleaned = projects.map((p) => ({ ...p, _originalSlug: p.slug }));
      setProjects(cleaned);
      setDeletes([]);
      setBaseline(JSON.stringify({ site, projects: cleaned }));
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    await fetch('/api/auth', { method: 'DELETE' });
    setAuthed(false);
  };

  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="font-mono text-sm text-ink-mute">Loading…</span>
      </div>
    );
  }
  if (!authed) return <Login onAuthed={() => setAuthed(true)} />;

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="card max-w-md p-6 text-center">
          <h2 className="text-lg font-semibold text-ink">Could not load content</h2>
          <p className="mt-2 font-mono text-xs text-ink-dim">{loadError}</p>
          <button onClick={load} className="btn-primary mt-5">Retry</button>
        </div>
      </div>
    );
  }
  if (!site) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="font-mono text-sm text-ink-mute">Loading content…</span>
      </div>
    );
  }

  const patch = (fn: (s: Site) => Site) => setSite((s) => (s ? fn(s) : s));

  return (
    <div className="min-h-screen pb-28">
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col bg-surface md:flex"
        style={{ borderRight: '1px solid var(--line)' }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <div>
            <p className="kicker">Admin</p>
            <p className="text-sm font-semibold text-ink">amjadrehawi.com</p>
          </div>
          <button onClick={logout} aria-label="Sign out" className="text-ink-mute hover:text-accent">
            <LogOut size={15} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'block w-full rounded-sm px-3 py-2 text-left text-sm transition-colors',
                tab === t.id ? 'bg-accent/10 font-medium text-accent' : 'text-ink-dim hover:bg-surface-2 hover:text-ink',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="p-4" style={{ borderTop: '1px solid var(--line)' }}>
          <a href="/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-ink-mute hover:text-accent">
            <ExternalLink size={12} /> View site
          </a>
        </div>
      </aside>

      {/* mobile tab strip */}
      <div className="sticky top-0 z-40 overflow-x-auto bg-surface md:hidden" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="flex gap-1 p-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'whitespace-nowrap rounded-sm px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider',
                tab === t.id ? 'bg-accent/10 text-accent' : 'text-ink-mute',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <main className="md:ml-60">
        <div className="mx-auto w-full max-w-3xl px-5 py-8 md:px-10 md:py-12">
          {tab === 'settings' && <SettingsTab site={site} patch={patch} />}
          {tab === 'personal' && <PersonalTab site={site} patch={patch} />}
          {tab === 'socials' && <SocialsTab site={site} patch={patch} />}
          {tab === 'nav' && <NavTab site={site} patch={patch} />}
          {tab === 'stats' && <StatsTab site={site} patch={patch} />}
          {tab === 'thesis' && <ThesisTab site={site} patch={patch} />}
          {tab === 'about' && <AboutTab site={site} patch={patch} />}
          {tab === 'projects' && (
            <ProjectsTab
              projects={projects}
              onChange={setProjects}
              onDelete={(slug) => {
                const target = projects.find((p) => p.slug === slug);
                if (target?._originalSlug) {
                  setDeletes((d) => [...new Set([...d, target._originalSlug!])]);
                }
                setProjects((ps) => ps.filter((p) => p.slug !== slug).map((p, i) => ({ ...p, order: i + 1 })));
              }}
            />
          )}
          {tab === 'skills' && <SkillsTab site={site} patch={patch} />}
          {tab === 'experience' && <ExperienceTab site={site} patch={patch} />}
          {tab === 'honorsEdu' && <HonorsEduTab site={site} patch={patch} />}
          {tab === 'contact' && <ContactTab site={site} patch={patch} />}
        </div>
      </main>

      <div
        className="fixed inset-x-0 bottom-0 z-40 bg-surface/90 backdrop-blur md:left-60"
        style={{ borderTop: '1px solid var(--line)' }}
      >
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 py-3 md:px-10">
          <div className="min-w-0">
            {saveError ? (
              <span className="font-mono text-xs text-red-400">⚠ {saveError}</span>
            ) : saving ? (
              <span className="font-mono text-xs text-ink-dim">Committing…</span>
            ) : dirty ? (
              <span className="font-mono text-xs text-accent-2">● Unsaved changes</span>
            ) : savedMode === 'github' ? (
              <span className="font-mono text-xs text-accent">
                ✓ Saved and committed. Site rebuilds in ~1–2 min.
              </span>
            ) : savedMode === 'fs' ? (
              <span className="font-mono text-xs text-accent">✓ Saved to local files.</span>
            ) : (
              <span className="font-mono text-xs text-ink-mute">All changes saved</span>
            )}
          </div>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="btn-primary !min-h-0 shrink-0 !px-5 !py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
