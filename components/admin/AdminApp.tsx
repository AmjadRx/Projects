'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Content } from '@/lib/types';
import PasswordGate from './PasswordGate';
import Sidebar from './Sidebar';
import SaveBar from './SaveBar';
import PersonalTab from './tabs/PersonalTab';
import BrandThesisTab from './tabs/BrandThesisTab';
import AboutTab from './tabs/AboutTab';
import StatsTab from './tabs/StatsTab';
import ProjectsTab from './tabs/ProjectsTab';
import SkillsTab from './tabs/SkillsTab';
import ExperienceTab from './tabs/ExperienceTab';
import HonorsTab from './tabs/HonorsTab';
import EducationTab from './tabs/EducationTab';
import ContactTab from './tabs/ContactTab';

export type TabId =
  | 'personal'
  | 'brandThesis'
  | 'about'
  | 'stats'
  | 'projects'
  | 'skills'
  | 'experience'
  | 'honors'
  | 'education'
  | 'contact';

const PASSWORD_KEY = 'amjad_admin_password_v1';

export default function AdminApp() {
  const [password, setPassword] = useState<string | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [baseline, setBaseline] = useState<Content | null>(null);
  const [tab, setTab] = useState<TabId>('personal');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const dirty = useMemo(() => {
    if (!content || !baseline) return false;
    return JSON.stringify(content) !== JSON.stringify(baseline);
  }, [content, baseline]);

  useEffect(() => {
    try {
      const p = sessionStorage.getItem(PASSWORD_KEY);
      if (p) setPassword(p);
    } catch {
      // ignore
    }
  }, []);

  const fetchContent = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/content', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Content;
      setContent(data);
      setBaseline(JSON.parse(JSON.stringify(data)));
    } catch (err) {
      setLoadError((err as Error)?.message ?? 'Failed to load content');
    }
  }, []);

  useEffect(() => {
    if (!password) return;
    fetchContent();
  }, [password, fetchContent]);

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

  const handleUnlock = (p: string) => {
    setPassword(p);
    try {
      sessionStorage.setItem(PASSWORD_KEY, p);
    } catch {
      // ignore
    }
  };

  const handleLogout = () => {
    setPassword(null);
    setContent(null);
    setBaseline(null);
    try {
      sessionStorage.removeItem(PASSWORD_KEY);
    } catch {
      // ignore
    }
  };

  const handleSave = async () => {
    if (!content || !password) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify(content),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (res.status === 401) {
          setSaveError('Unauthorized. Re-enter the admin password.');
          handleLogout();
        } else {
          setSaveError(data.error ?? `HTTP ${res.status}`);
        }
        return;
      }
      setSavedAt(data.savedAt as string);
      setBaseline(JSON.parse(JSON.stringify(content)));
    } catch (err) {
      setSaveError((err as Error)?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!password) {
    return <PasswordGate onUnlock={handleUnlock} />;
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="card max-w-md p-6 text-center">
          <h2 className="text-lg font-semibold text-ink">Couldn't load content</h2>
          <p className="mt-2 text-sm text-ink-dim">{loadError}</p>
          <button onClick={fetchContent} className="btn-primary mt-4">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="font-mono text-sm text-ink-mute">Loading admin…</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-32">
      <Sidebar tab={tab} setTab={setTab} onLogout={handleLogout} />
      <main className="md:ml-64">
        <div className="mx-auto w-full max-w-4xl px-6 py-10 md:px-10 md:py-12">
          {tab === 'personal' && (
            <PersonalTab
              value={content.personal}
              onChange={(p) => setContent({ ...content, personal: p })}
            />
          )}
          {tab === 'brandThesis' && (
            <BrandThesisTab
              value={content.brandThesis}
              onChange={(b) => setContent({ ...content, brandThesis: b })}
            />
          )}
          {tab === 'about' && (
            <AboutTab
              value={content.about}
              onChange={(a) => setContent({ ...content, about: a })}
            />
          )}
          {tab === 'stats' && (
            <StatsTab
              value={content.stats}
              onChange={(s) => setContent({ ...content, stats: s })}
            />
          )}
          {tab === 'projects' && (
            <ProjectsTab
              value={content.projects}
              onChange={(p) => setContent({ ...content, projects: p })}
            />
          )}
          {tab === 'skills' && (
            <SkillsTab
              value={content.skills}
              onChange={(s) => setContent({ ...content, skills: s })}
            />
          )}
          {tab === 'experience' && (
            <ExperienceTab
              value={content.experience}
              onChange={(e) => setContent({ ...content, experience: e })}
            />
          )}
          {tab === 'honors' && (
            <HonorsTab
              value={content.honors}
              onChange={(h) => setContent({ ...content, honors: h })}
            />
          )}
          {tab === 'education' && (
            <EducationTab
              value={content.education}
              onChange={(e) => setContent({ ...content, education: e })}
            />
          )}
          {tab === 'contact' && (
            <ContactTab
              value={content.contact}
              onChange={(c) => setContent({ ...content, contact: c })}
            />
          )}
        </div>
      </main>
      <SaveBar
        dirty={dirty}
        saving={saving}
        savedAt={savedAt}
        error={saveError}
        onSave={handleSave}
      />
    </div>
  );
}
