import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../apps/landing/friend-invite.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../apps/landing/friends/index.html', import.meta.url), 'utf8');
const invite = 'aB3_-'.repeat(6) + 'xY';

function setup({
  search = `?invite=${invite}`,
  downloadUrl = null as unknown,
  clipboard = vi.fn().mockResolvedValue(undefined) as ReturnType<typeof vi.fn> | null,
} = {}) {
  const elements: Record<string, {
    hidden: boolean;
    textContent: string;
    value: string;
    href: string;
    focus: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    setSelectionRange: ReturnType<typeof vi.fn>;
    addEventListener: (type: string, callback: () => Promise<void>) => void;
  }> = {};
  const handlers = new Map<string, () => Promise<void>>();
  for (const id of [
    'invite-ready', 'invite-introduction', 'invite-invalid', 'invite-code', 'invite-copy',
    'invite-copy-status', 'invite-open', 'invite-download', 'invite-download-note',
  ]) {
    elements[id] = {
      hidden: ['invite-ready', 'invite-invalid'].includes(id),
      textContent: id === 'invite-download' ? 'Join the waitlist ↗' : '',
      value: '',
      href: id === 'invite-download' ? '/#get-recollect' : '',
      focus: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn(),
      addEventListener: (type, callback) => { handlers.set(`${id}:${type}`, callback); },
    };
  }
  const location = Object.freeze({ search, href: `https://recollect-ai.netlify.app/friends${search}` });
  const fetch = vi.fn();
  const setTimeout = vi.fn();
  const localStorage = { setItem: vi.fn(), getItem: vi.fn() };
  const sessionStorage = { setItem: vi.fn(), getItem: vi.fn() };
  runInNewContext(source, {
    document: { getElementById: (id: string) => elements[id] },
    window: { location, RECOLLECT_SITE: { downloadUrl } },
    navigator: { clipboard: clipboard ? { writeText: clipboard } : undefined },
    URL, URLSearchParams, fetch, setTimeout, localStorage, sessionStorage,
  });
  return {
    elements, handlers, clipboard, fetch, setTimeout, localStorage, sessionStorage, location,
    copy: () => handlers.get('invite-copy:click')!(),
  };
}

describe('public friend invitation', () => {
  it('shows the code and an explicit app link without navigating, fetching, or saving the invite', () => {
    const page = setup();
    expect(page.elements['invite-ready']!.hidden).toBe(false);
    expect(page.elements['invite-code']!.value).toBe(invite);
    expect(page.elements['invite-open']!.href).toBe(`cognitioncurator://friends?invite=${invite}`);
    expect(page.elements['invite-invalid']!.hidden).toBe(true);
    expect(page.location.href).toBe(`https://recollect-ai.netlify.app/friends?invite=${invite}`);
    expect(page.clipboard).not.toHaveBeenCalled();
    expect(page.fetch).not.toHaveBeenCalled();
    expect(page.setTimeout).not.toHaveBeenCalled();
    expect(page.localStorage.setItem).not.toHaveBeenCalled();
    expect(page.sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it.each([
    '', '?invite=', '?invite=short', `?invite=${'a'.repeat(257)}`,
    '?invite=%3Cscript%3Ealert(1)%3C%2Fscript%3E', '?invite=abcdefghijklmnop%2Fqr',
    `?invite=${invite}&invite=${invite}`, `?invite=${invite}&invite=`,
  ])('leaves no app link for missing, malformed, or ambiguous input: %s', (search) => {
    const page = setup({ search });
    expect(page.elements['invite-ready']!.hidden).toBe(true);
    expect(page.elements['invite-invalid']!.hidden).toBe(false);
    expect(page.elements['invite-introduction']!.hidden).toBe(true);
    expect(page.elements['invite-code']!.value).toBe('');
    expect(page.elements['invite-open']!.href).toBe('');
    expect(page.handlers.has('invite-copy:click')).toBe(false);
  });

  it.each(['a'.repeat(16), 'Z_9-'.repeat(64)])('accepts API-compatible code lengths', (code) => {
    const page = setup({ search: `?invite=${code}` });
    expect(page.elements['invite-code']!.value).toBe(code);
    expect(page.elements['invite-ready']!.hidden).toBe(false);
  });

  it('copies only after a click and confirms only after the clipboard accepts it', async () => {
    const clipboard = vi.fn();
    let resolveCopy!: () => void;
    clipboard.mockReturnValue(new Promise<void>((resolve) => { resolveCopy = resolve; }));
    const page = setup({ clipboard });
    const pending = page.copy();
    expect(clipboard).toHaveBeenCalledExactlyOnceWith(invite);
    expect(page.elements['invite-copy-status']!.textContent).toBe('');
    resolveCopy();
    await pending;
    expect(page.elements['invite-copy-status']!.textContent).toContain('Invite code copied');
    expect(page.elements['invite-code']!.select).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'denied'])('provides manual selection when clipboard is %s', async (mode) => {
    const clipboard = mode === 'denied' ? vi.fn().mockRejectedValue(new Error('Denied')) : null;
    const page = setup({ clipboard });
    await page.copy();
    expectManualCopy(page);
  });

  it.each([
    ['https://apps.apple.com/us/app/recollect/id6749138102', 'Get Recollect for iPhone'],
    ['https://apps.apple.com/app/id6749138102', 'Get Recollect for iPhone'],
    ['https://testflight.apple.com/join/AbCd1234', 'Join the iPhone beta'],
  ])('uses only the configured official Apple download destination %s', (downloadUrl, label) => {
    const page = setup({ downloadUrl });
    expect(page.elements['invite-download']!.href).toBe(downloadUrl);
    expect(page.elements['invite-download']!.textContent).toContain(label);
    expect(page.elements['invite-download']!.href).not.toContain(invite);
    expect(page.elements['invite-download-note']!.textContent).toContain('come back');
  });

  it.each([
    null, '', 'javascript:alert(1)', 'http://apps.apple.com/app/id123',
    'https://apps.apple.com.evil.example/app/id123', 'https://evil.example/download',
    'https://testflight.apple.com/join/not-a-public-invite', 'https://apps.apple.com/login',
    'https://user:password@apps.apple.com/app/id123', 'https://apps.apple.com:8443/app/id123',
  ])('keeps the honest beta fallback for unconfigured or unsafe download URL %s', (downloadUrl) => {
    const page = setup({ downloadUrl });
    expect(page.elements['invite-download']!.href).toBe('/#get-recollect');
    expect(page.elements['invite-download']!.textContent).toContain('Join the waitlist');
  });

  it('does not use a download destination supplied through invite query parameters', () => {
    const page = setup({ search: `?invite=${invite}&downloadUrl=https://evil.example` });
    expect(page.elements['invite-download']!.href).toBe('/#get-recollect');
  });

  it('has non-personal link previews, no-referrer policy, and useful static installation instructions', () => {
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
    expect(html).toContain('href="https://recollect-ai.netlify.app/friends/"');
    expect(html).toContain('property="og:url" content="https://recollect-ai.netlify.app/friends/"');
    expect(html).toContain('id="invite-download" href="/#get-recollect" referrerpolicy="no-referrer"');
    expect(html).toContain('<noscript>');
    expect(html).toContain('Your invitation.');
    expect(html).toContain('A public download link isn’t available yet.');
    expect(html).toContain('You → Friends');
    expect(html).not.toMatch(/<script[^>]*>[^<]*location\s*[=.]/);
  });
});

function expectManualCopy(page: ReturnType<typeof setup>) {
  expect(page.elements['invite-code']!.focus).toHaveBeenCalledOnce();
  expect(page.elements['invite-code']!.select).toHaveBeenCalledOnce();
  expect(page.elements['invite-code']!.setSelectionRange).toHaveBeenCalledWith(0, invite.length);
  expect(page.elements['invite-copy-status']!.textContent).toContain('Use your device’s Copy command');
  expect(page.elements['invite-copy-status']!.textContent).not.toContain('copied');
}
