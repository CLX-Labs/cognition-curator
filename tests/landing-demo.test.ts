import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../apps/landing/demo.js', import.meta.url), 'utf8');
const catalog = JSON.parse(
  readFileSync(new URL('../packages/db/catalog/recollect-ai-v1.json', import.meta.url), 'utf8'),
) as {
  decks: Array<{ slug: string; title: string; cards: Array<{ front: string; back: string }> }>;
};
type DemoEvent = {
  detail: number;
  button: number;
  isPrimary: boolean;
  pointerId: number;
  clientX: number;
  clientY: number;
  preventDefault: ReturnType<typeof vi.fn>;
};

class Target {
  private listeners = new Map<string, Array<(event: DemoEvent) => void>>();
  addEventListener(type: string, listener: (event: DemoEvent) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type: string, values: Partial<DemoEvent> = {}) {
    const event = {
      detail: 1,
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      preventDefault: vi.fn(),
      ...values,
    };
    this.listeners.get(type)?.forEach((listener) => listener(event));
    return event;
  }
}

class Element extends Target {
  textContent = '';
  hidden = false;
  disabled = true;
  href = '#get-recollect';
  attributes = new Map<string, string>();
  properties = new Map<string, string>();
  classes = new Set<string>();
  captured = new Set<number>();
  focus = vi.fn();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    toggle: (name: string, value: boolean) =>
      value ? this.classes.add(name) : this.classes.delete(name),
  };
  style = {
    width: '',
    touchAction: '',
    setProperty: (name: string, value: string) => this.properties.set(name, value),
    removeProperty: (name: string) => this.properties.delete(name),
  };
  setPointerCapture = vi.fn((id: number) => this.captured.add(id));
  hasPointerCapture = (id: number) => this.captured.has(id);
  releasePointerCapture = vi.fn((id: number) => this.captured.delete(id));
  setAttribute = (name: string, value: string) => this.attributes.set(name, value);
  constructor(public dataset: Record<string, string> = {}) {
    super();
  }
}

function setup(
  options: { reducedMotion?: boolean; downloadUrl?: unknown; withoutDemo?: boolean } = {},
) {
  vi.useFakeTimers();
  const ids = [
    'demo-card',
    'demo-deck',
    'demo-counter',
    'demo-front',
    'demo-prompt',
    'demo-answer',
    'demo-back',
    'demo-announcement',
    'demo-flip-label',
    'demo-progress',
    'demo-feedback',
    'download-faq',
    'availability-description',
    'year',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  const el = (id: string) => elements[id]!;
  const card = el('demo-card');
  const deckButtons = ['italian', 'science', 'ideas'].map((deck) => new Element({ deck }));
  const tiles = ['italian', 'science', 'ideas', 'art', 'japanese', 'music', 'geography'].map(
    (demoDeck) => new Element({ demoDeck }),
  );
  const controls = ['unsure', 'known'].map((confidence) => new Element({ confidence }));
  const downloadLinks = [new Element(), new Element()];
  const availability = [new Element()];
  const downloadNote = new Element();
  availability[0]!.textContent = 'Existing availability label.';
  downloadNote.textContent = 'Existing download note.';
  el('download-faq').textContent = 'Existing FAQ copy.';
  el('availability-description').textContent = 'Existing availability description.';
  const selectors: Record<string, Element[]> = {
    '[data-deck]': deckButtons,
    '[data-demo-deck]': tiles,
    '[data-confidence]': controls,
    '.demo-stage button, [data-deck]': [card, ...controls, ...deckButtons],
    '[data-download-link]': downloadLinks,
    '[data-availability]': availability,
    '[data-download-note]': [downloadNote],
  };
  const document = Object.assign(new Target(), {
    hidden: false,
    getElementById: (id: string) =>
      options.withoutDemo && id.startsWith('demo-') ? null : elements[id],
    querySelectorAll: (selector: string) => selectors[selector] ?? [],
    querySelector: (selector: string) => selectors[selector]?.[0] ?? null,
  });
  const media = Object.assign(new Target(), { matches: options.reducedMotion ?? false });
  const window = Object.assign(new Target(), {
    matchMedia: vi.fn(() => media),
    RECOLLECT_SITE: { downloadUrl: options.downloadUrl },
  });
  // Omit storage, fetch, analytics, navigator and device APIs: the preview must be self-contained.
  runInNewContext(source, { document, window, URL, Date, setTimeout, clearTimeout });
  const swipe = (x: number, y = 0) => {
    card.dispatch('pointerdown');
    const move = card.dispatch('pointermove', { clientX: 100 + x, clientY: 100 + y });
    card.dispatch('pointerup', { clientX: 100 + x, clientY: 100 + y });
    return move;
  };
  return {
    el,
    card,
    deckButtons,
    tiles,
    controls,
    downloadLinks,
    availability,
    downloadNote,
    document,
    window,
    media,
    swipe,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('landing flashcard preview', () => {
  it('enables the preview with a hidden answer and an accessible initial state', () => {
    const page = setup();
    expect(
      [page.card, ...page.controls, ...page.deckButtons].every((button) => !button.disabled),
    ).toBe(true);
    expect(page.el('demo-front').textContent).toBe('Buongiorno');
    expect(page.el('demo-counter').textContent).toBe('01 / 03');
    expect(page.el('demo-answer').hidden).toBe(true);
    expect(page.el('demo-prompt').hidden).toBe(false);
    expect(page.card.attributes.get('aria-pressed')).toBe('false');
    expect(page.el('demo-progress').attributes.get('aria-valuenow')).toBe('1');
    expect(parseFloat(page.el('demo-progress').style.width)).toBeCloseTo(100 / 3);
    expect(page.el('year').textContent).toBe(String(new Date().getFullYear()));
  });

  it('toggles the answer for pointer and native keyboard/assistive-technology clicks', () => {
    const page = setup();
    page.card.dispatch('click');
    expect(page.el('demo-answer').hidden).toBe(false);
    expect(page.el('demo-prompt').hidden).toBe(true);
    expect(page.card.classes.has('is-revealed')).toBe(true);
    expect(page.card.attributes.get('aria-pressed')).toBe('true');
    expect(page.card.attributes.get('aria-label')).toContain('Good morning; hello during the day.');
    expect(page.card.attributes.get('aria-label')).toContain('Hide answer.');
    expect(page.el('demo-flip-label').textContent).toBe('Hide answer');
    expect(page.el('demo-announcement').textContent).toBe('Good morning; hello during the day.');
    page.card.dispatch('click', { detail: 0 });
    expect(page.el('demo-answer').hidden).toBe(true);
    expect(page.card.classes.has('is-revealed')).toBe(false);
    expect(page.el('demo-flip-label').textContent).toBe('Show answer');
  });

  it.each([
    { distance: 95, feedback: 'Remembered.' },
    { distance: -95, feedback: 'Not sure yet.' },
  ])(
    'advances after a $distance px swipe without flipping the next card',
    ({ distance, feedback }) => {
      const page = setup();
      page.card.dispatch('click');
      const movement = page.swipe(distance);
      expect(movement.preventDefault).toHaveBeenCalledOnce();
      expect(page.el('demo-front').textContent).toBe('Buonasera');
      expect(page.el('demo-answer').hidden).toBe(true);
      expect(page.el('demo-progress').attributes.get('aria-valuenow')).toBe('2');
      expect(page.el('demo-feedback').textContent).toContain(feedback);
      expect(page.el('demo-announcement').textContent).toContain('card 2 of 3: Buonasera');
      expect(page.card.captured.size).toBe(0);
      expect(page.card.properties.size).toBe(0);
      page.card.dispatch('click');
      expect(page.el('demo-answer').hidden).toBe(true);
      vi.advanceTimersByTime(1800);
      expect(page.el('demo-feedback').textContent).toBe('');
      // A fresh tap must not inherit click suppression from the swipe.
      page.card.dispatch('pointerdown');
      page.card.dispatch('pointerup');
      page.card.dispatch('click');
      expect(page.el('demo-answer').hidden).toBe(false);
    },
  );

  it('keeps vertical gestures available for page scrolling and ignores the following click', () => {
    const page = setup();
    expect(page.card.style.touchAction).toBe('pan-y');
    const movement = page.swipe(20, 110);
    expect(movement.preventDefault).not.toHaveBeenCalled();
    expect(page.card.setPointerCapture).not.toHaveBeenCalled();
    expect(page.el('demo-counter').textContent).toBe('01 / 03');
    page.card.dispatch('click');
    expect(page.el('demo-answer').hidden).toBe(true);
  });

  it('snaps back a short drag and accepts keyboard activation immediately afterward', () => {
    const page = setup();
    page.swipe(35);
    expect(page.el('demo-counter').textContent).toBe('01 / 03');
    expect(page.card.properties.size).toBe(0);
    expect(page.card.classes.has('is-dragging')).toBe(false);
    page.card.dispatch('click', { detail: 0 });
    expect(page.el('demo-answer').hidden).toBe(false);
  });

  it('forgets a pointer released outside after leaving before drag intent', () => {
    const page = setup();
    page.card.dispatch('pointerdown', { clientX: 1 });
    page.card.dispatch('pointerleave', { clientX: -2 });
    page.window.dispatch('pointerup', { clientX: -2 });

    // A new tap must use its own origin, rather than completing the abandoned gesture.
    page.card.dispatch('pointerdown', { clientX: 200 });
    page.card.dispatch('pointerup', { clientX: 200 });
    page.card.dispatch('click');
    expect(page.el('demo-counter').textContent).toBe('01 / 03');
    expect(page.el('demo-answer').hidden).toBe(false);
    expect(page.el('demo-feedback').textContent).toBe('');
  });

  it('keeps a captured swipe active when the pointer leaves the card', () => {
    const page = setup();
    page.card.dispatch('pointerdown', { clientX: 1 });
    page.card.dispatch('pointermove', { clientX: 100 });
    expect(page.card.hasPointerCapture(1)).toBe(true);
    page.card.dispatch('pointerleave', { clientX: 120 });
    page.card.dispatch('pointerup', { clientX: 120 });
    page.card.dispatch('click');
    expect(page.el('demo-counter').textContent).toBe('02 / 03');
    expect(page.el('demo-answer').hidden).toBe(true);
    expect(page.el('demo-feedback').textContent).toContain('Remembered.');
    expect(page.card.captured.size).toBe(0);
  });

  it.each(['pointercancel', 'lostpointercapture', 'blur', 'visibilitychange', 'motion-change'])(
    'cancels safely on %s',
    (type) => {
      const page = setup();
      page.card.dispatch('pointerdown');
      page.card.dispatch('pointermove', { clientX: 200 });
      expect(page.card.classes.has('is-dragging')).toBe(true);
      if (type === 'blur') page.window.dispatch('blur');
      else if (type === 'visibilitychange') {
        page.document.hidden = true;
        page.document.dispatch('visibilitychange');
      } else if (type === 'motion-change') {
        page.media.matches = true;
        page.media.dispatch('change');
      } else page.card.dispatch(type);
      page.card.dispatch('pointerup', { clientX: 200 });
      page.card.dispatch('click');
      expect(page.el('demo-counter').textContent).toBe('01 / 03');
      expect(page.el('demo-answer').hidden).toBe(true);
      expect(page.card.properties.size).toBe(0);
      expect(page.card.captured.size).toBe(0);
      expect(page.card.classes.has('is-dragging')).toBe(false);
    },
  );

  it('honors reduced motion while preserving swipe and button alternatives', () => {
    const page = setup({ reducedMotion: true });
    page.card.dispatch('pointerdown');
    page.card.dispatch('pointermove', { clientX: 200 });
    expect(page.card.properties.size).toBe(0);
    expect(page.card.classes.has('is-dragging')).toBe(false);
    page.card.dispatch('pointerup', { clientX: 200 });
    expect(page.el('demo-front').textContent).toBe('Buonasera');
    page.controls[0]!.dispatch('click');
    expect(page.el('demo-front').textContent).toBe('Arrivederci');
    expect(page.el('demo-feedback').textContent).toContain('Not sure yet.');
    page.controls[1]!.dispatch('click');
    expect(page.el('demo-front').textContent).toBe('Buongiorno');
    expect(page.el('demo-feedback').textContent).toContain('Remembered.');
  });

  it('ignores secondary pointers and mouse buttons', () => {
    const page = setup();
    page.card.dispatch('pointerdown', { isPrimary: false });
    page.card.dispatch('pointermove', { clientX: 200 });
    page.card.dispatch('pointerup', { clientX: 200 });
    page.card.dispatch('pointerdown', { button: 2 });
    page.card.dispatch('pointermove', { clientX: 200 });
    page.card.dispatch('pointerup', { clientX: 200 });
    page.card.dispatch('pointerdown');
    page.card.dispatch('pointermove', { pointerId: 2, clientX: 200 });
    page.card.dispatch('pointerup', { pointerId: 2, clientX: 200 });
    page.card.dispatch('pointerup');
    expect(page.el('demo-counter').textContent).toBe('01 / 03');
    expect(page.card.setPointerCapture).not.toHaveBeenCalled();
  });

  it('resets a switched deck and keeps every collection sample in sync with the real catalog', () => {
    const page = setup();
    const slugs: Record<string, string> = {
      italian: 'italian-for-travel',
      science: 'everyday-physics',
      ideas: 'logical-fallacies',
      art: 'art-movements',
      japanese: 'japanese-greetings-and-essentials',
      music: 'music-fundamentals',
      geography: 'world-geography',
    };
    for (const tile of page.tiles) {
      tile.dispatch('click');
      const key = tile.dataset.demoDeck!;
      const deck = catalog.decks.find((deck) => deck.slug === slugs[key])!;
      expect(page.el('demo-deck').textContent).toBe(deck.title);
      for (const example of deck.cards.slice(0, 3)) {
        expect(page.el('demo-front').textContent).toBe(example.front);
        expect(page.el('demo-back').textContent).toBe(example.back);
        expect(page.el('demo-answer').hidden).toBe(true);
        page.controls[1]!.dispatch('click');
      }
      expect(page.el('demo-counter').textContent).toBe('01 / 03');
      expect(page.card.focus).toHaveBeenLastCalledWith({ preventScroll: true });
      expect(page.deckButtons.map((button) => button.attributes.get('aria-pressed'))).toEqual(
        page.deckButtons.map((button) => String(button.dataset.deck === key)),
      );
    }
    page.card.dispatch('click');
    page.deckButtons[1]!.dispatch('click');
    expect(page.el('demo-front').textContent).toBe('Inertia');
    expect(page.el('demo-answer').hidden).toBe(true);
    expect(page.el('demo-feedback').textContent).toBe('');
  });
});

describe('landing public download configuration', () => {
  it.each([
    {
      url: 'https://testflight.apple.com/join/Example1',
      label: 'Join the iPhone beta ↗',
      note: 'Available in TestFlight for iPhone.',
      availability: 'In beta for iPhone',
      faq: 'Recollect is available to test on iPhone through TestFlight. Use “Join the iPhone beta” to check whether places are available.',
      description:
        'Try Recollect on iPhone through TestFlight, or join the waitlist for availability updates.',
    },
    {
      url: 'https://apps.apple.com/us/app/recollect/id123456',
      label: 'Get Recollect for iPhone ↗',
      note: 'Available on the App Store for iPhone.',
      availability: 'Made for iPhone',
      faq: 'Recollect is available on the App Store for iPhone. Choose “Get Recollect for iPhone” to download it.',
      description: 'Get Recollect for iPhone, or join the waitlist for availability updates.',
    },
  ])(
    'uses an official public Apple link: $url',
    ({ url, label, note, availability, faq, description }) => {
      const page = setup({ downloadUrl: url });
      expect(
        page.downloadLinks.every((link) => link.href === url && link.textContent === label),
      ).toBe(true);
      expect(page.downloadNote.textContent).toBe(note);
      expect(page.availability[0]!.textContent).toBe(availability);
      expect(page.el('download-faq').textContent).toBe(faq);
      expect(page.el('availability-description').textContent).toBe(description);
    },
  );

  it.each([
    undefined,
    null,
    '',
    false,
    'not a url',
    'http://apps.apple.com/us/app/recollect/id123',
    'https://apps.apple.com.evil.example/app',
    'https://evil.example/?next=https://apps.apple.com',
    'https://apps.apple.com@evil.example/app',
    'https://someone:secret@apps.apple.com/app',
    'https://testflight.apple.com:444/join/Example',
    'javascript:alert(1)',
  ])('keeps the preview link for unsafe or missing configuration: %s', (downloadUrl) => {
    const page = setup({ downloadUrl });
    expect(page.downloadLinks.every((link) => link.href === '#get-recollect')).toBe(true);
    expect(page.downloadNote.textContent).toBe('Existing download note.');
    expect(page.availability[0]!.textContent).toBe('Existing availability label.');
    expect(page.el('download-faq').textContent).toBe('Existing FAQ copy.');
    expect(page.el('availability-description').textContent).toBe(
      'Existing availability description.',
    );
    expect(page.el('demo-answer').hidden).toBe(true);
  });

  it('still configures downloads and the year when the interactive demo is absent', () => {
    const page = setup({
      withoutDemo: true,
      downloadUrl: 'https://testflight.apple.com/join/Example1',
    });
    expect(page.downloadLinks[0]!.href).toBe('https://testflight.apple.com/join/Example1');
    expect(page.el('download-faq').textContent).toContain(
      'available to test on iPhone through TestFlight',
    );
    expect(page.el('availability-description').textContent).toBe(
      'Try Recollect on iPhone through TestFlight, or join the waitlist for availability updates.',
    );
    expect(page.el('year').textContent).toBe(String(new Date().getFullYear()));
  });
});
