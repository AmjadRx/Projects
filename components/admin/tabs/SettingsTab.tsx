'use client';

/**
 * Settings (ARCHITECTURE.md 7; docs/V3_PLAN.md 5.7: `seo`, `background`, and `heroModel` live
 * here): the default theme, the site-wide background, the hero mode with its model and media, the
 * availability badge, search and sharing, the site's media library with the folders of renamed
 * and deleted projects (ARCHITECTURE.md 13A, D-27), the warning list for every file, and the
 * connection status panel.
 */
import { useMemo, useState } from 'react';
import { Images } from 'lucide-react';
import { hasMedia } from '@/lib/media';
import type { MediaRef, Site } from '@/lib/types';
import { MediaField, MediaLibraryPanel, OtherMediaFolders } from '../media/index';
import { formatRoute, StatusPanel, WarningsPanel } from '../shell';
import { Button, Notice, Section, Select, TextArea, TextField, Toggle, useSiteBinding } from '../ui';
import { SiteMediaField, TabFrame } from './common';
import { heroModelValue, SITE_MEDIA_FOLDER } from './model';

type Settings = Site['settings'];

const THEMES = [
  { value: 'dark', label: 'Blueprint (dark)' },
  { value: 'light', label: 'Whiteprint (light)' },
] as const satisfies readonly { value: Settings['themeDefault']; label: string }[];

const BACKGROUNDS = [
  { value: 'sky', label: 'Sky: the star map (the default)' },
  { value: 'grid', label: 'Grid: the flat drawing grid' },
  { value: 'off', label: 'Off: the plain sheet' },
] as const satisfies readonly { value: Settings['background']; label: string }[];

const HERO_MODES = [
  { value: 'drawing', label: 'Drawing: the illustration of Raven' },
  { value: 'model', label: 'Model: your 3D model' },
  { value: 'media', label: 'Media: a photo or video' },
] as const satisfies readonly { value: Settings['heroMode']; label: string }[];

export function SettingsTab() {
  return (
    <TabFrame
      tab="settings"
      description="The default theme, the background, the hero, the availability badge, how the site appears in search results and link previews, and the site's media library. The warning list and the connection status are at the end."
    >
      <Appearance />
      <Hero />
      <Badge />
      <SearchAndSharing />
      <Media />
      <WarningsPanel />
      <StatusPanel />
    </TabFrame>
  );
}

function Appearance() {
  const [theme, setTheme] = useSiteBinding<Settings['themeDefault']>('settings.themeDefault');
  const [background, setBackground] = useSiteBinding<Settings['background']>('settings.background');
  return (
    <Section title="Theme and background">
      <Select
        path="settings.themeDefault"
        label="Default theme"
        hint="What a first-time visitor sees. A visitor who switched themes keeps their own choice."
        value={theme}
        options={THEMES}
        onChange={setTheme}
      />
      <Select
        path="settings.background"
        label="Background"
        hint="Behind every public page."
        value={background}
        options={BACKGROUNDS}
        onChange={setBackground}
      />
    </Section>
  );
}

function Hero() {
  const [mode, setMode] = useSiteBinding<Settings['heroMode']>('settings.heroMode');
  const [heroModel, setHeroModel] = useSiteBinding<MediaRef | undefined>('settings.heroModel');
  const [heroMedia] = useSiteBinding<MediaRef | undefined>('settings.heroMedia');
  // The seed's hero model has no `kind`; the field shows it as a model without changing the file.
  const modelShown = useMemo(() => heroModelValue(heroModel), [heroModel]);
  const hasModel = hasMedia(heroModel);

  return (
    <Section title="Hero" description="The visual beside the headline on the home page.">
      <Select path="settings.heroMode" label="Hero mode" value={mode} options={HERO_MODES} onChange={setMode} />
      {mode === 'model' && !hasModel ? (
        <Notice tone="warning" title="No hero model yet">
          Model mode shows your own 3D model, and none is added. Add one below, or choose Drawing.
        </Notice>
      ) : null}
      {mode === 'drawing' && hasModel ? (
        <Notice
          tone="info"
          actions={
            <Button size="sm" onClick={() => setMode('model')}>
              Use the model
            </Button>
          }
        >
          A hero model is added. The hero shows it once the mode is Model.
        </Notice>
      ) : null}
      {mode === 'media' && !hasMedia(heroMedia) ? (
        <Notice tone="warning" title="No hero media yet">
          Media mode shows the photo or video below, and none is set.
        </Notice>
      ) : null}
      <MediaField
        path="settings.heroModel"
        label="Hero model"
        accept={['model']}
        folder={SITE_MEDIA_FOLDER}
        clearable
        value={modelShown}
        onChange={(next, edit) => setHeroModel(next, edit)}
      />
      <SiteMediaField path="settings.heroMedia" label="Hero media" accept={['image', 'video']} focal clearable />
    </Section>
  );
}

function Badge() {
  const [show, setShow] = useSiteBinding<boolean>('settings.showAvailabilityBadge');
  const [availability] = useSiteBinding<string>('personal.availability');
  const line = (availability ?? '').trim();
  return (
    <Section title="Availability badge">
      <Toggle path="settings.showAvailabilityBadge" label="Show the availability badge" checked={show} onChange={setShow} />
      <p className="adm-muted">
        {line !== '' ? (
          <>
            The badge shows the availability line from{' '}
            <a className="adm-link" href={formatRoute('personal')}>
              Personal
            </a>
            : <span className="adm-mono">{line}</span>
          </>
        ) : (
          <>
            The availability line in{' '}
            <a className="adm-link" href={formatRoute('personal')}>
              Personal
            </a>{' '}
            is empty, so no badge shows.
          </>
        )}
      </p>
    </Section>
  );
}

function SearchAndSharing() {
  const [title, setTitle] = useSiteBinding<string>('seo.title');
  const [description, setDescription] = useSiteBinding<string>('seo.description');
  return (
    <Section title="Search and sharing">
      <TextField path="seo.title" label="Site title" hint="The title in search results, browser tabs, and link previews." value={title} onChange={setTitle} />
      <TextArea
        path="seo.description"
        label="Site description"
        hint="The summary in search results and link previews."
        rows={3}
        value={description}
        onChange={setDescription}
      />
      <SiteMediaField path="seo.ogImage" label="Link preview image" accept={['image']} clearable />
      <p className="adm-muted">Without a link preview image, the site's generated image is used.</p>
    </Section>
  );
}

/**
 * The site's media library (ARCHITECTURE.md 13A: "one library per project plus a site library"):
 * the files of the site folder, which every site tab's media field uses, and the folders of
 * renamed or deleted projects. Files there can be renamed, replaced, and deleted, and "Not used
 * anywhere" finds Blob files left after a discard (D-27). Shown on request, like a project's.
 */
function Media() {
  const [shown, setShown] = useState(false);
  return (
    <Section
      title="Media"
      description="The site's own files (the photo, headshot, logos, hero model and media, and the link preview image), and the folders of renamed or deleted projects. Rename, replace, or delete files here, and find the ones not used anywhere."
      actions={
        <Button size="sm" icon={<Images size={16} />} aria-expanded={shown} onClick={() => setShown(!shown)}>
          {shown ? 'Hide the media library' : 'Show the media library'}
        </Button>
      }
    >
      {shown ? (
        <>
          <MediaLibraryPanel folder={SITE_MEDIA_FOLDER} title="Site media" level={3} />
          <OtherMediaFolders level={3} />
        </>
      ) : null}
    </Section>
  );
}
