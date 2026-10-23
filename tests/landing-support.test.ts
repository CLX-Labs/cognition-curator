import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const supportSource = readFileSync(new URL('../apps/landing/support.js', import.meta.url), 'utf8');
const contactSource = readFileSync(new URL('../apps/landing/public-contact.js', import.meta.url), 'utf8');
const supportHtml = readFileSync(new URL('../apps/landing/support/index.html', import.meta.url), 'utf8');

function setup(location = { protocol: 'https:', hostname: 'recollect-ai.netlify.app' }) {
  const values = new URLSearchParams({
    'form-name': 'recollect-support',
    email: 'alex+help@example.com',
    category: 'bug',
    message: 'My saved card will not open.',
    website: '',
  });
  const attributes = new Map<string, string>();
  let submit!: (event: { preventDefault: () => void }) => Promise<void>;
  const form = {
    reportValidity: vi.fn(() => true), reset: vi.fn(),
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    removeAttribute: (key: string) => attributes.delete(key),
    addEventListener: (_name: string, handler: typeof submit) => { submit = handler; },
  };
  const fields = { disabled: false, hidden: false };
  const button = { textContent: 'Send message ↗' };
  const status = {
    textContent: '', focus: vi.fn(),
    setAttribute: (key: string, value: string) => attributes.set(`status-${key}`, value),
  };
  const elements = { 'support-form': form, 'support-fields': fields, 'support-submit': button, 'support-status': status };
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  runInNewContext(supportSource, {
    document: { getElementById: (id: keyof typeof elements) => elements[id] },
    window: { location },
    FormData: class extends URLSearchParams { constructor() { super(values); } },
    URLSearchParams, AbortSignal, fetch,
  });
  return { values, attributes, form, fields, button, status, fetch, submit: () => submit({ preventDefault: vi.fn() }) };
}

describe('public support form', () => {
  it('waits for acceptance, preserves the message while pending, and prevents duplicate sends', async () => {
    const page = setup();
    let accept!: (value: { ok: boolean }) => void;
    page.fetch.mockReturnValueOnce(new Promise((resolve) => { accept = resolve; }));
    const pending = page.submit();
    await page.submit();
    expect(page.fetch).toHaveBeenCalledTimes(1);
    expect(page.form.reset).not.toHaveBeenCalled();
    expect(page.fields.disabled).toBe(true);
    expect(page.attributes.get('aria-busy')).toBe('true');
    expect(page.status.textContent).toBe('');
    const [endpoint, request] = page.fetch.mock.calls[0]!;
    expect(endpoint).toBe('/');
    expect(request.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(request.body))).toEqual(Object.fromEntries(page.values));
    expect(request.signal).toBeInstanceOf(AbortSignal);
    accept({ ok: true });
    await pending;
    expect(page.form.reset).toHaveBeenCalledOnce();
    expect(page.fields.hidden).toBe(true);
    expect(page.status.textContent).toContain('Your message was sent');
    expect(page.attributes.has('aria-busy')).toBe(false);
    await page.submit();
    expect(page.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['rejected', 'offline'])('preserves message on %s and permits retry', async (mode) => {
    const page = setup();
    if (mode === 'offline') page.fetch.mockRejectedValueOnce(new Error('Offline'));
    else page.fetch.mockResolvedValueOnce({ ok: false });
    await page.submit();
    expect(page.form.reset).not.toHaveBeenCalled();
    expect(page.fields.disabled).toBe(false);
    expect(page.fields.hidden).toBe(false);
    expect(page.status.textContent).toContain('Your text is still here');
    expect(page.attributes.get('status-role')).toBe('alert');
    await page.submit();
    expect(page.fetch).toHaveBeenCalledTimes(2);
    expect(page.fetch.mock.calls[1]![1].body).toBe(page.fetch.mock.calls[0]![1].body);
    expect(page.status.textContent).toContain('Your message was sent');
  });

  it.each([
    { protocol: 'file:', hostname: '' },
    { protocol: 'http:', hostname: '127.0.0.1' },
    { protocol: 'https:', hostname: 'localhost' },
  ])('does not transmit or claim delivery in a local preview', async (location) => {
    const page = setup(location);
    await page.submit();
    expect(page.fetch).not.toHaveBeenCalled();
    expect(page.form.reset).not.toHaveBeenCalled();
    expect(page.status.textContent).toContain('hasn’t been sent');
  });

  it('uses browser validation and has a native Netlify fallback with bounded inputs', async () => {
    const page = setup();
    page.form.reportValidity.mockReturnValue(false);
    await page.submit();
    expect(page.fetch).not.toHaveBeenCalled();
    expect(supportHtml).toContain('name="recollect-support" method="POST" action="/support/thanks/"');
    expect(supportHtml).toContain('data-netlify="true" netlify-honeypot="website"');
    expect(supportHtml).toContain('maxlength="5000" required');
    expect(supportHtml).toContain('type="email" autocomplete="email" maxlength="254" required');
  });
});

describe('verified public contact', () => {
  function render(supportEmail: unknown) {
    const links = [{ href: '', textContent: '' }, { href: '', textContent: '' }];
    const blocks = [{ hidden: true }];
    runInNewContext(contactSource, {
      window: { RECOLLECT_SITE: { supportEmail } },
      document: { querySelectorAll: (selector: string) => selector === '[data-support-email]' ? links : blocks },
    });
    return { links, blocks };
  }

  it('adds only the configured email as text and an explicit mail link', () => {
    const page = render('support+recollect@example.com');
    expect(page.links.every((link) => link.href === 'mailto:support+recollect@example.com')).toBe(true);
    expect(page.links.every((link) => link.textContent === 'support+recollect@example.com')).toBe(true);
    expect(page.blocks[0]!.hidden).toBe(false);
  });

  it.each([null, undefined, '', 'not-an-address', 'a@example.com?bcc=other@example.com', 'a%0D%0ABcc%3Aother@example.com', 'a\r\nb@example.com', '<script>@example.com'])('does not publish an unconfirmed or unsafe value %s', (email) => {
    const page = render(email);
    expect(page.links.every((link) => link.href === '')).toBe(true);
    expect(page.blocks[0]!.hidden).toBe(true);
  });
});
