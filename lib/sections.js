// Section catalogue. This file is the single source of truth: the admin builds its forms from it
// (sent as JSON via /api/schema) and the renderer (lib/render.js) draws each type.
//
// Field types: text | textarea | markdown | url | select | toggle | image | video | strings | list
// Any field may carry `showIf: { otherKey: value | [values] }` to appear conditionally.

const PALETTE = {
  primary: { name: 'Bright Fern', hex: '#55AA31' },
  accents: [
    { name: 'Vintage Grape', hex: '#654F6F' },
    { name: 'Dusty Grape', hex: '#5C5D8D' },
    { name: 'Cool Steel', hex: '#99A1A6' },
    { name: 'Honeydew', hex: '#F0FFF1' },
  ],
  tint: '#F0FFF1',
  ink: '#14200f',
};

const t = (key, label, o = {}) => ({ key, label, type: 'text', ...o });
const ta = (key, label, o = {}) => ({ key, label, type: 'textarea', rows: 3, ...o });
const md = (key, label, o = {}) => ({ key, label, type: 'markdown', rows: 6, ...o });
const url = (key, label, o = {}) => ({ key, label, type: 'url', ...o });
const sel = (key, label, options, o = {}) => ({ key, label, type: 'select', options, ...o });
const tog = (key, label, o = {}) => ({ key, label, type: 'toggle', ...o });
const img = (key, label, o = {}) => ({ key, label, type: 'image', ...o });
const vid = (key, label, o = {}) => ({ key, label, type: 'video', ...o });
const strs = (key, label, o = {}) => ({ key, label, type: 'strings', ...o });
const list = (key, label, fields, o = {}) => ({ key, label, type: 'list', fields, ...o });

const heading = [
  t('eyebrow', 'Eyebrow (small label above the heading)'),
  t('heading', 'Heading'),
  ta('lead', 'Intro text'),
];

// A reusable "pick image / uploaded video / embedded video" trio. Prefix keeps keys unique.
const mediaFields = (allow = ['image', 'video', 'embed'], kindKey = 'mediaType') => {
  const labels = { image: 'Image', video: 'Uploaded video', embed: 'Embedded video (YouTube, Vimeo, Stream…)', none: 'None' };
  return [
    sel(kindKey, 'Media', allow.map(v => ({ value: v, label: labels[v] }))),
    img('image', 'Image', { showIf: { [kindKey]: 'image' } }),
    vid('video', 'Video file', { showIf: { [kindKey]: 'video' } }),
    img('poster', 'Video poster image (optional)', { showIf: { [kindKey]: 'video' } }),
    url('embedUrl', 'Video link', { showIf: { [kindKey]: 'embed' }, hint: 'Paste a YouTube, Vimeo, Loom, Stream or SharePoint link.' }),
  ];
};

const SECTION_TYPES = {
  hero: {
    label: 'Hero', group: 'Essentials', icon: '★',
    description: 'Headline, key stats and the demo video. Usually the first section.',
    summary: p => p.headline,
    fields: [
      t('eyebrow', 'Eyebrow'),
      ta('headline', 'Headline', { rows: 2 }),
      ta('subhead', 'Sub-headline'),
      list('stats', 'Headline stats', [t('value', 'Value'), t('label', 'Label')], { itemLabel: 'value', max: 4 }),
      t('primaryLabel', 'Primary button label'), url('primaryUrl', 'Primary button link'),
      t('secondaryLabel', 'Secondary button label'), url('secondaryUrl', 'Secondary button link'),
      ...mediaFields(['video', 'embed', 'image', 'none']),
      tog('autoplay', 'Autoplay muted on a loop', { showIf: { mediaType: 'video' }, hint: 'Plays silently on a loop. Viewers can still pause it, and it stays paused for people who prefer reduced motion.' }),
      t('videoCaption', 'Caption over the video (e.g. "Product walkthrough · 2:04")'),
      t('chipValue', 'Floating highlight: value'), t('chipLabel', 'Floating highlight: label'),
      t('audienceLabel', 'Audience strip label'), strs('audience', 'Audience tags'),
    ],
    defaults: {
      eyebrow: 'Product spotlight', headline: 'A clear one-line promise of what this product does for you.',
      subhead: 'Two sentences on what the product is, who it is for, and why it matters to the firm.',
      stats: [{ value: '1,000+', label: 'active users' }, { value: '10', label: 'teams onboarded' }, { value: '3×', label: 'faster' }],
      primaryLabel: 'Get access', primaryUrl: '#get-started', secondaryLabel: 'Read the quick start', secondaryUrl: '#get-started',
      mediaType: 'video', autoplay: true, videoCaption: 'Product walkthrough', chipValue: '', chipLabel: '',
      audienceLabel: 'Built for', audience: ['Team one', 'Team two'],
    },
    settings: { bg: 'tint', navLabel: 'Overview' },
  },

  problem: {
    label: 'Why we built it', group: 'Story', icon: '⇋',
    description: 'A before / after comparison that makes the case for the product.',
    summary: p => p.heading,
    fields: [...heading,
      t('beforeTitle', 'Left column title'), strs('beforeItems', 'Left column points'),
      t('afterTitle', 'Right column title'), strs('afterItems', 'Right column points')],
    defaults: {
      eyebrow: 'Why we built it', heading: 'What was painful, and what changed.',
      lead: 'Describe the problem people lived with before this product existed.',
      beforeTitle: 'Before', beforeItems: ['The old way, point one', 'The old way, point two', 'The old way, point three'],
      afterTitle: 'With this product', afterItems: ['The new way, point one', 'The new way, point two', 'The new way, point three'],
    },
    settings: { bg: 'white' },
  },

  features: {
    label: 'Capabilities', group: 'Story', icon: '▦',
    description: 'A grid of feature cards with a small icon, title and description.',
    summary: p => p.heading,
    fields: [...heading, sel('columns', 'Columns', [{ value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }]),
      list('items', 'Capabilities', [
        sel('icon', 'Icon', ['↻', '⇄', '↗', '▤', '✓', '✦', '☰', '⚑', '⚙', '◎', '✉', '★', '⌘', '⌕', '♥', '⏱'].map(v => ({ value: v, label: v }))),
        t('title', 'Title'), ta('text', 'Description')], { itemLabel: 'title' })],
    defaults: {
      eyebrow: 'Capabilities', heading: 'What you can do with it.', lead: 'Group the product into a handful of capabilities people care about.', columns: '3',
      items: [
        { icon: '↻', title: 'Capability one', text: 'One or two sentences describing what it does and why it helps.' },
        { icon: '⇄', title: 'Capability two', text: 'One or two sentences describing what it does and why it helps.' },
        { icon: '↗', title: 'Capability three', text: 'One or two sentences describing what it does and why it helps.' },
      ],
    },
    settings: { bg: 'tint', navLabel: 'Capabilities' },
  },

  steps: {
    label: 'How it works', group: 'Story', icon: '①',
    description: 'A numbered process, shown as a horizontal timeline.',
    summary: p => p.heading,
    fields: [...heading, list('steps', 'Steps', [t('title', 'Title'), ta('text', 'Description')], { itemLabel: 'title', max: 6 })],
    defaults: {
      eyebrow: 'How it works', heading: 'From start to finish in a few steps.', lead: '',
      steps: [{ title: 'Step one', text: 'What happens first.' }, { title: 'Step two', text: 'What happens next.' }, { title: 'Step three', text: 'What the outcome is.' }],
    },
    settings: { bg: 'white', navLabel: 'How it works' },
  },

  showcase: {
    label: 'See it in action', group: 'Media', icon: '▶',
    description: 'Tabbed workflows, each with its own screenshot or video.',
    summary: p => p.heading,
    fields: [...heading, list('items', 'Workflows', [t('title', 'Tab title'), ta('text', 'Short description'), ...mediaFields()], { itemLabel: 'title' })],
    defaults: {
      eyebrow: 'See it in action', heading: 'Real workflows from real teams.', lead: '',
      items: [
        { title: 'Workflow one', text: 'What the user is doing here.', mediaType: 'image' },
        { title: 'Workflow two', text: 'What the user is doing here.', mediaType: 'image' },
      ],
    },
    settings: { bg: 'tint', navLabel: 'In action' },
  },

  gallery: {
    label: 'Screenshot gallery', group: 'Media', icon: '▣',
    description: 'A swipeable carousel of screenshots or short clips with captions.',
    summary: p => p.heading,
    fields: [...heading, list('items', 'Slides', [t('caption', 'Caption'), ...mediaFields(['image', 'video', 'embed'])], { itemLabel: 'caption' })],
    defaults: { eyebrow: 'Gallery', heading: 'A closer look.', lead: '', items: [{ caption: 'Caption', mediaType: 'image' }] },
    settings: { bg: 'white' },
  },

  richtext: {
    label: 'Text + media', group: 'Media', icon: '¶',
    description: 'Free-form text with an optional image or video, in several layouts. Use it for anything else.',
    summary: p => p.heading,
    fields: [t('eyebrow', 'Eyebrow'), t('heading', 'Heading'), md('body', 'Body text', { hint: 'Supports **bold**, *italic*, [links](https://…) and "- " bullet lists.' }),
      sel('layout', 'Layout', [{ value: 'media-right', label: 'Media on the right' }, { value: 'media-left', label: 'Media on the left' }, { value: 'media-below', label: 'Media below, full width' }, { value: 'text-only', label: 'Text only' }]),
      ...mediaFields(['none', 'image', 'video', 'embed'])],
    defaults: { eyebrow: '', heading: 'A heading', body: 'Write a few paragraphs here.\n\n- Bullets work too', layout: 'media-right', mediaType: 'none' },
    settings: { bg: 'white' },
  },

  results: {
    label: 'Results & quotes', group: 'Proof', icon: '❝',
    description: 'Headline metrics plus short quotes from colleagues. Shown on a dark band by default.',
    summary: p => p.heading,
    fields: [...heading,
      list('metrics', 'Metrics', [t('value', 'Value'), t('label', 'Label')], { itemLabel: 'value', max: 6 }),
      list('quotes', 'Quotes', [ta('text', 'Quote'), t('name', 'Name'), t('role', 'Role / team'), img('photo', 'Photo (optional)')], { itemLabel: 'name' })],
    defaults: {
      eyebrow: 'Results', heading: 'What changed for the teams using it.', lead: '',
      metrics: [{ value: '3×', label: 'faster' }, { value: '90%', label: 'satisfaction' }, { value: '10 hrs', label: 'saved per month' }],
      quotes: [{ text: 'A short, specific quote about the difference it made.', name: 'First L.', role: 'Role, team' }],
    },
    settings: { bg: 'dark', navLabel: 'Results' },
  },

  adoption: {
    label: 'Adoption by team', group: 'Proof', icon: '▥',
    description: 'Progress bars showing adoption by region or team, to encourage the laggards.',
    summary: p => p.heading,
    fields: [...heading, t('ctaLabel', 'Button label'), url('ctaUrl', 'Button link'),
      list('bars', 'Bars', [t('label', 'Label'), { key: 'value', label: 'Percent (0–100)', type: 'number', min: 0, max: 100 }], { itemLabel: 'label' })],
    defaults: {
      eyebrow: 'Adoption', heading: 'Is your team already on board?', lead: 'See where your group stands and who to talk to.',
      ctaLabel: 'Find your team’s champion', ctaUrl: '',
      bars: [{ label: 'Team A', value: 80 }, { label: 'Team B', value: 55 }, { label: 'Team C', value: 30 }],
    },
    settings: { bg: 'tint', navLabel: 'Adoption' },
  },

  whatsnew: {
    label: 'What’s new', group: 'Proof', icon: '✺',
    description: 'A dated feed of product updates, newest first. Keeps the page worth revisiting.',
    summary: p => p.heading,
    fields: [...heading, list('entries', 'Updates', [t('date', 'Date (e.g. 2026-10-01)'), t('tag', 'Tag (e.g. New, Improved)'), t('title', 'Title'), ta('text', 'Details')], { itemLabel: 'title' })],
    defaults: {
      eyebrow: 'What’s new', heading: 'Recent updates.', lead: '',
      entries: [{ date: '2026-10-01', tag: 'New', title: 'A new feature shipped', text: 'One or two lines on what it does.' }],
    },
    settings: { bg: 'white', navLabel: 'What’s new' },
  },

  roadmap: {
    label: 'Roadmap', group: 'Proof', icon: '➜',
    description: 'Now / Next / Later columns showing what is coming.',
    summary: p => p.heading,
    fields: [...heading,
      t('nowTitle', 'Column 1 title'), list('now', 'Column 1 items', [t('title', 'Title'), ta('text', 'Details')], { itemLabel: 'title' }),
      t('nextTitle', 'Column 2 title'), list('next', 'Column 2 items', [t('title', 'Title'), ta('text', 'Details')], { itemLabel: 'title' }),
      t('laterTitle', 'Column 3 title'), list('later', 'Column 3 items', [t('title', 'Title'), ta('text', 'Details')], { itemLabel: 'title' })],
    defaults: {
      eyebrow: 'Roadmap', heading: 'Where it’s heading.', lead: 'Dates are targets, not promises.',
      nowTitle: 'Now', now: [{ title: 'In progress', text: 'What the team is building.' }],
      nextTitle: 'Next', next: [{ title: 'Up next', text: 'What is planned.' }],
      laterTitle: 'Later', later: [{ title: 'Under consideration', text: 'What we are exploring.' }],
    },
    settings: { bg: 'tint', navLabel: 'Roadmap' },
  },

  getStarted: {
    label: 'Get started', group: 'Action', icon: '⚑',
    description: 'Numbered steps to get access and training, plus quick links to resources.',
    summary: p => p.heading,
    fields: [...heading,
      list('steps', 'Steps', [t('label', 'Small label (e.g. STEP 1)'), t('title', 'Title'), ta('text', 'Description'), t('linkLabel', 'Link text'), url('linkUrl', 'Link')], { itemLabel: 'title', max: 4 }),
      list('resources', 'Resource links', [t('title', 'Title'), t('text', 'Description'), url('url', 'Link')], { itemLabel: 'title', max: 8 })],
    defaults: {
      eyebrow: 'Get started', heading: 'You can be up and running this week.', lead: 'Access is free for every employee.',
      steps: [
        { label: 'STEP 1', title: 'Request access', text: 'How to get an account.', linkLabel: 'Open access form →', linkUrl: '' },
        { label: 'STEP 2', title: 'Take the intro', text: 'A short course to learn the basics.', linkLabel: 'Start the course →', linkUrl: '' },
        { label: 'STEP 3', title: 'Join the community', text: 'Ask questions and share tips.', linkLabel: 'Join the channel →', linkUrl: '' },
      ],
      resources: [{ title: 'Quick-start guide', text: 'Printable, five pages', url: '' }, { title: 'Office hours', text: 'Weekly drop-in', url: '' }],
    },
    settings: { bg: 'white', navLabel: 'Get started' },
  },

  faq: {
    label: 'FAQ', group: 'Action', icon: '?',
    description: 'Common questions in an expandable list.',
    summary: p => p.heading,
    fields: [...heading, list('items', 'Questions', [t('q', 'Question'), md('a', 'Answer', { rows: 4 })], { itemLabel: 'q' })],
    defaults: { eyebrow: 'FAQ', heading: 'Common questions.', lead: '', items: [{ q: 'Who can use it?', a: 'Every employee.' }] },
    settings: { bg: 'tint', navLabel: 'FAQ' },
  },

  contact: {
    label: 'Contact the team', group: 'Action', icon: '✉',
    description: 'A bold call-out with the people behind the product.',
    summary: p => p.heading,
    fields: [t('heading', 'Heading'), ta('text', 'Text'), t('buttonLabel', 'Button label (optional)'), url('buttonUrl', 'Button link'),
      list('people', 'People', [t('name', 'Name'), t('role', 'Role'), t('email', 'Email'), img('photo', 'Photo (optional)')], { itemLabel: 'name', max: 4 })],
    defaults: {
      heading: 'Questions? Talk to the product team.', text: 'We run live walkthroughs for teams.',
      buttonLabel: '', buttonUrl: '', people: [{ name: 'Name', role: 'Product owner', email: '' }],
    },
    settings: { bg: 'white' },
  },
};

const GROUP_ORDER = ['Essentials', 'Story', 'Media', 'Proof', 'Action'];

const THEME_DEFAULTS = {
  brandName: 'Product name',
  badge: 'Internal spotlight',
  primary: PALETTE.primary.hex,
  accent: PALETTE.accents[0].hex,
  pageBackground: 'tint',   // tint | white
  showNav: true,
  navCtaLabel: 'Get access',
  navCtaUrl: '#get-started',
  logo: '',
  footerLeft: 'Internal use only',
  footerRight: '',
};

const META_DEFAULTS = { title: '', description: '' };

module.exports = { PALETTE, SECTION_TYPES, GROUP_ORDER, THEME_DEFAULTS, META_DEFAULTS };
