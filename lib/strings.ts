/**
 * Interface labels: every word on the site that does not come from content/ (docs/V3_PLAN.md
 * D-56). These words state no fact about the owner; facts live only in the content files. The
 * content check scans this file with the same rules as content/.
 *
 * Four strings are fixed by the handoff and must not change: the placeholder line, the 404
 * heading, the hero caption, and the thermal caption.
 */
export const UI = {
  site: {
    skipToContent: 'Skip to content',
    home: 'Home',
    primaryNav: 'Main',
    footerNav: 'Footer',
    /** The phone menu: its button, its dialog's name, and the button that closes it. */
    menu: 'Menu',
    close: 'Close',
    /** The theme toggle: the group's name, the two options, and their names in the compact toggle. */
    theme: 'Theme',
    blueprint: 'Blueprint',
    whiteprint: 'Whiteprint',
    blueprintTheme: 'Blueprint theme',
    whiteprintTheme: 'Whiteprint theme',
    lastUpdated: 'Last updated',
    copyright: (year: number, name: string) => `© ${year} ${name}`,
    /** The zone marks of the sheet frame: 1 to 8 across the top, A to F down the side. */
    zoneColumns: ['1', '2', '3', '4', '5', '6', '7', '8'],
    zoneRows: ['A', 'B', 'C', 'D', 'E', 'F'],
  },
  /** The sky behind every page (Phase 5): the footer's pause control and its credit line. */
  sky: {
    /**
     * The pause-motion control in the footer's meta row (D-67): a plain button whose words say
     * what pressing it will do, "Pause motion" while the sky moves and "Play motion" while it is
     * paused. (A toggle with aria-pressed must keep one label, so the words carry the state.)
     */
    pauseMotion: 'Pause motion',
    playMotion: 'Play motion',
    /**
     * The credit line for the sky's sources (the bundle's Footer README, word for word), shown
     * when settings.background is "sky". As the bundle has it, only "CC BY" is a link, to the
     * licence deed (rel="license"); the full source notes stay in public/sky/CREDITS.md.
     */
    credits: 'Stars: Yale Bright Star Catalogue (Hoffleit and Warren). Milky Way: ESO/S. Brunier, CC BY.',
    creditLinks: [{ text: 'CC BY', href: 'https://creativecommons.org/licenses/by/4.0/', licence: true }],
  },
  hero: {
    seeTheWork: 'See the work',
    openProject: (title: string) => `Open ${title}`,
    graduation: 'Graduation',
    playVideo: 'Play video',
    pauseVideo: 'Pause video',
    /**
     * The hero drawing's text alternative (ARCHITECTURE.md 10), the canvas's own words for what it
     * draws. The lens and the thermal view are decorative, so it does not describe them.
     */
    drawing: 'Plan view of Raven, a tri-tiltrotor eVTOL: two tilting wing rotors, one tail rotor and a V-tail.',
  },
  home: {
    readouts: 'In numbers',
    /** Read after a readout's value and label: the project its link opens. */
    readoutProof: (title: string) => `, proof: ${title}`,
    now: 'Now',
    selectedWork: 'Selected work',
    allProjects: 'All projects',
    moreAbout: 'More about me',
    tools: 'Tools',
    /**
     * The phone's strip of featured cards (components/home/FeaturedStrip.tsx): its name, what
     * assistive technology calls it once it is a carousel (aria-roledescription), and its buttons.
     */
    featuredStrip: { region: 'Featured projects', kind: 'carousel', previous: 'Previous project', next: 'Next project' },
    /** The column heads of the index of the projects that are not featured (shown from 1024 px). */
    index: { sheet: 'Sheet', project: 'Project', domain: 'Domain', status: 'Status', maturity: 'Maturity' },
  },
  projects: {
    intro: 'Filter by domain, or open any project.',
    filterLabel: 'Filter by domain',
    filterAll: 'All',
    showing: (shown: number, total: number) => `Showing ${shown} of ${total} projects`,
    backToProjects: 'All projects',
    previous: 'Previous',
    next: 'Next',
    /** The pitch and highlights, as one region. */
    summary: 'Summary',
    progress: 'Progress',
    /** The progress strip's name. */
    progressOf: (title: string) => `${title} progress`,
    callouts: 'Key figures',
    moreProjects: 'More projects',
    /** The previous and next project links at the foot of a project page, and their sheet line. */
    pager: 'Previous and next project',
    sheetOf: (n: number, total: number) => `Sheet ${n} of ${total}`,
    /** The label over a log block on a project page. */
    buildLog: 'Build log',
  },
  /**
   * The project card: the cue on a featured card, the tag on a cover that is a video or a model, and
   * the line on such a cover while it runs (motion sheet 5; the Cover-Video and Cover-Model boards).
   */
  card: { open: 'Open project', video: 'Video', model: '3D model', playing: 'Playing, muted', turning: 'Turning' },
  maturity: {
    label: 'Maturity',
    step: (step: number, total: number) => `Step ${step} of ${total}`,
  },
  progressState: { done: 'Done', current: 'In progress', todo: 'Planned' },
  roadmap: { label: 'Roadmap', labelFor: (title: string) => `${title} roadmap`, stage: (n: number) => `Stage ${n}` },
  roadmapStatus: { done: 'Done', 'in-progress': 'In progress', next: 'Planned, next', future: 'Planned' },
  titleBlock: {
    caption: 'Title block',
    project: 'Project',
    sheet: 'Sheet',
    of: 'of',
    role: 'Role',
    dates: 'Dates',
    status: 'Status',
    rev: 'Rev',
    links: 'Links',
  },
  revisions: {
    rev: 'Rev',
    date: 'Date',
    description: 'Description',
    project: 'Project',
    caption: 'Revisions, newest first',
    photos: 'Photos',
  },
  /** The /log page: the line under its title, and what it says when no project has an entry yet. */
  log: {
    intro: 'Every entry from every project, newest first.',
    empty: 'No entries yet.',
    seeProjects: 'See the projects',
  },
  about: {
    facts: 'Facts',
    skills: 'Skills',
    item: 'Item',
    skill: 'Skill',
    proof: 'Proof',
    tiers: { deep: 'Deep', strong: 'Strong', familiar: 'Familiar' },
    /** The bill of materials, for screen readers: the table's name, and an item with no project page. */
    bomTable: 'Skills, as a bill of materials, with the project that proves each one',
    noProof: 'No project page',
    education: 'Education',
    honors: 'Honors',
  },
  contact: {
    emailMe: 'Email me',
    copyAddress: 'Copy address',
    copied: 'Address copied',
    copyFailed: 'Copy did not work. Select the address instead.',
    elsewhere: 'Elsewhere',
    location: 'Location',
  },
  callout: { note: 'Note', status: 'Status' },
  /** A media well with nothing to show: no file yet, a file on its way, or a file that did not load. */
  placeholder: {
    photoToCome: 'Photo to come',
    loading: 'Loading photo',
    didNotLoad: 'Photo did not load',
    tryAgain: 'Try again',
  },
  notFound: {
    heading: 'Sheet not found',
    body: 'Nothing is drawn at this address.',
    home: 'Go home',
    projects: 'See all projects',
    /** The line in the empty drawing well above the heading. */
    well: 'No sheet at this address',
  },
  /**
   * The command palette (ARCHITECTURE.md 5, "Also new"; the bundle's Nav and CommandPalette, and the
   * Palette boards): the nav's button that opens it, the dialog and its field, the result groups and
   * the line beside each result, the keys under the list, the empty state, and the count that screen
   * readers hear. The nav's words reach the button from the server; the palette reads the rest.
   */
  palette: {
    /** The nav button: its name (the bundle's words), its word from 1280 px, and the shortcut it shows. */
    open: 'Search pages and projects',
    search: 'Search',
    shortcut: 'Ctrl K',
    /** The dialog's name, which is also the field's name and its placeholder. */
    label: 'Search pages, projects and sections',
    /** The list of results, for assistive technology. */
    results: 'Results',
    close: 'Close',
    groups: { pages: 'Pages', projects: 'Projects', sections: 'Sections' },
    /** The line beside a result: a page, a section of a project page (a project shows its sheet). */
    page: 'Page',
    section: 'Section',
    /** A section's name: its project's title, then its heading ("Raven: Roadmap"). */
    sectionOf: (project: string, heading: string) => `${project}: ${heading}`,
    /** The keys under the list (hidden from assistive technology, which hears the combobox). */
    keys: { up: '↑', down: '↓', move: 'to move', enter: 'Enter', go: 'to open', esc: 'Esc', close: 'to close' },
    /**
     * Nothing matches: what to try instead, with the nav's page names when there are any. Shown in
     * place of the list, and said politely in place of the count.
     */
    noMatch: (query: string, pages: readonly string[]) =>
      pages.length > 0
        ? `No match for "${query}". Try a project name or a page: ${pages.join(', ')}.`
        : `No match for "${query}". Try a project name.`,
    /** Said politely after the results change, when there are any. */
    count: (n: number) => (n === 1 ? '1 result' : `${n} results`),
  },
  heroCaption: 'Raven, tri-tiltrotor eVTOL. Illustration, not measured data.',
  /**
   * The generated Open Graph images (lib/og/): the label of the home image's title block cell,
   * which holds the owner's name. The project images use the title block's own labels above.
   */
  seo: { name: 'Name' },
  viewers: {
    loadViewer: 'Load viewer',
    tapToLoad: 'Tap to load',
    loading: 'Loading',
    failed: 'This viewer could not load. The file is still available below.',
    /** The same, for a file that is not offered for download (docs/V3_PLAN.md R-16). */
    failedNoDownload: 'This viewer could not load.',
    fullscreen: 'Full screen',
    exitFullscreen: 'Exit full screen',
    close: 'Close',
    download: 'Download',
    previous: 'Previous',
    next: 'Next',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    resetView: 'Reset view',
    /** The text button that returns a zoomed photo or drawing to the whole picture, and its tooltip. */
    fit: 'Fit',
    fitToFrame: 'Fit to frame',
    itemOf: (n: number, total: number) => `${n} of ${total}`,
    /** The kind that leads a viewer's caption line (bundle MediaFrame), and the gallery's tags. */
    kind: {
      photo: 'Photo',
      video: 'Video',
      document: 'Document',
      model: '3D model',
      audio: 'Audio',
      code: 'Code',
      compare: 'Before and after',
      drawing: 'Drawing',
    },
    image: {
      open: 'Open image',
      lightbox: 'Image viewer',
      keysOne: 'Use plus and minus to zoom, 0 to reset, and the arrow keys to move around while zoomed in.',
      keysMany:
        'Use the left and right arrow keys to move between items, plus and minus to zoom, 0 to reset, and the arrow keys to move around while zoomed in.',
    },
    gallery: {
      label: 'Gallery',
      /** What a screen reader calls the strip (aria-roledescription). */
      roleDescription: 'gallery',
      openItem: (n: number, total: number) => `Open item ${n} of ${total}`,
      videoDidNotLoad: 'Video did not load',
      modelDidNotLoad: '3D model did not load',
    },
    video: {
      play: 'Play',
      pause: 'Pause',
      mute: 'Mute',
      unmute: 'Unmute',
      captionsOn: 'Show captions',
      captionsOff: 'Hide captions',
      seek: 'Seek',
      scrubHint: 'Scroll to move through this video.',
      loadEmbed: (provider: string) => `Load the ${provider} player`,
      embedNotice: (provider: string) => `Playing this video loads the ${provider} player.`,
      videoFallback: 'Video',
      /** The name of the captions track, shown in a phone's own full-screen player. */
      captionsTrack: 'English',
      watchOn: (provider: string) => `Watch on ${provider}`,
      embedTitle: (provider: string) => `${provider} video`,
    },
    /** Time in words for seek controls ("1 minute 5 seconds of 3 minutes"). */
    time: {
      hours: (n: number) => (n === 1 ? '1 hour' : `${n} hours`),
      minutes: (n: number) => (n === 1 ? '1 minute' : `${n} minutes`),
      seconds: (n: number) => (n === 1 ? '1 second' : `${n} seconds`),
      timeOf: (current: string, total: string) => `${current} of ${total}`,
    },
    audio: { play: 'Play', pause: 'Pause', mute: 'Mute', unmute: 'Unmute', seek: 'Seek', audioFallback: 'Audio' },
    document: {
      open: 'Open document',
      page: 'Page',
      pageOf: (n: number, total: number) => `Page ${n} of ${total}`,
      previousPage: 'Previous page',
      nextPage: 'Next page',
      search: 'Search in document',
      searchPrevious: 'Previous match',
      searchNext: 'Next match',
      matches: (n: number, total: number) => `Match ${n} of ${total}`,
      noMatches: 'No matches',
      fitWidth: 'Fit width',
      wordNotice: 'Word documents open in an isolated frame.',
      documentFallback: 'Document',
    },
    model: {
      load: 'Load 3D model',
      views: 'View',
      realistic: 'Realistic',
      blueprint: 'Blueprint',
      thermal: 'Thermal',
      thermalCaption: 'Illustration, not measured data.',
      hint: 'Drag to orbit',
      explode: 'Exploded view',
      parts: 'Parts',
      rotateLeft: 'Rotate left',
      rotateRight: 'Rotate right',
      rotateUp: 'Rotate up',
      rotateDown: 'Rotate down',
      paused: 'Paused to save memory. Select to resume.',
      resume: 'Resume',
      /** Models carry no download link by default (docs/V3_PLAN.md Q-24), so these point to none. */
      noWebgl: 'This browser cannot show 3D models.',
      failed: 'This 3D model could not load.',
      keys: 'Use the arrow keys to rotate the model, and plus or minus to zoom.',
      /** The hero's model has no zoom, so its key hint names only the arrow keys. */
      keysRotate: 'Use the arrow keys to rotate the model.',
      modelFallback: '3D model',
    },
    panzoom: {
      label: 'Pan and zoom',
      minimap: 'Overview',
      keys: 'Use plus and minus to zoom, the arrow keys to move around while zoomed in, and 0 to reset.',
      hint: 'Drag to pan',
    },
    compare: {
      label: 'Before and after',
      before: 'Before',
      after: 'After',
      divider: 'Divider position',
      /** Spoken value of the divider: how much of the before photo shows, from the left. */
      position: (percent: number) => `${percent} percent`,
      downloadBefore: 'Download the before photo',
      downloadAfter: 'Download the after photo',
    },
    code: {
      copy: 'Copy code',
      copied: 'Copied',
      copyFailed: 'Copy failed',
      copyFailedHint: 'Copy did not work. The code is selected, so you can copy it yourself.',
      repository: 'View the repository',
    },
    repo: { repository: 'Repository', updated: 'Updated', language: 'Language', open: 'Open on GitHub' },
    file: { download: 'Download' },
  },
} as const;
