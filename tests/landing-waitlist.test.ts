import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../apps/landing/waitlist.js', import.meta.url), 'utf8');

function setup(location = { protocol: 'https:', hostname: 'recollect.netlify.app' }) {
  const values = new URLSearchParams({
    'form-name': 'recollect-waitlist',
    email: 'alex+beta@example.com',
    interest: 'languages',
    source: 'landing-page',
    consent: 'recollect-availability-updates',
    website: '',
  });
  const attributes = new Map<string, string>();
  let submit: (event: { preventDefault: () => void }) => Promise<void>;
  const form = {
    reportValidity: vi.fn(() => true),
    reset: vi.fn(),
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    removeAttribute: (key: string) => attributes.delete(key),
    addEventListener: (_name: string, handler: typeof submit) => {
      submit = handler;
    },
  };
  const fields = { disabled: false, hidden: false };
  const button = { textContent: 'Keep me posted ↗' };
  const status = {
    textContent: '',
    focus: vi.fn(),
    setAttribute: (key: string, value: string) => attributes.set(`status-${key}`, value),
  };
  const elements = {
    'waitlist-form': form,
    'waitlist-fields': fields,
    'waitlist-submit': button,
    'waitlist-status': status,
  };
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  runInNewContext(source, {
    document: { getElementById: (id: keyof typeof elements) => elements[id] },
    window: { location },
    FormData: class extends URLSearchParams {
      constructor() {
        super(values);
      }
    },
    URLSearchParams,
    AbortSignal,
    fetch,
  });
  return {
    values,
    attributes,
    form,
    fields,
    button,
    status,
    fetch,
    submit: () => submit({ preventDefault: vi.fn() }),
  };
}

describe('landing waitlist', () => {
  it('waits for acceptance and prevents duplicate submissions while saving', async () => {
    const page = setup();
    let accept: (value: { ok: boolean }) => void;
    page.fetch.mockReturnValueOnce(
      new Promise((resolve) => {
        accept = resolve;
      }),
    );
    const first = page.submit();
    await page.submit();
    expect(page.fetch).toHaveBeenCalledTimes(1);
    expect(page.fields.disabled).toBe(true);
    expect(page.form.reset).not.toHaveBeenCalled();
    expect(page.status.textContent).not.toContain('on the list');
    expect(page.attributes.get('aria-busy')).toBe('true');

    const [endpoint, request] = page.fetch.mock.calls[0]!;
    expect(endpoint).toBe('/');
    expect(request.method).toBe('POST');
    expect(request.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(request.body))).toEqual(
      Object.fromEntries(page.values),
    );
    expect(request.signal).toBeInstanceOf(AbortSignal);

    accept!({ ok: true });
    await first;
    expect(page.form.reset).toHaveBeenCalledOnce();
    expect(page.fields.hidden).toBe(true);
    expect(page.status.textContent).toContain('You’re on the list');
    expect(page.attributes.has('aria-busy')).toBe(false);
    await page.submit();
    expect(page.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves entries on rejection and allows a successful retry', async () => {
    const page = setup();
    page.fetch.mockResolvedValueOnce({ ok: false });
    await page.submit();
    expect(page.form.reset).not.toHaveBeenCalled();
    expect(page.fields).toEqual({ disabled: false, hidden: false });
    expect(page.attributes.get('status-role')).toBe('alert');
    expect(page.status.textContent).toContain('couldn’t save');
    expect(page.attributes.has('aria-busy')).toBe(false);
    await page.submit();
    expect(page.fetch).toHaveBeenCalledTimes(2);
    expect(page.fetch.mock.calls[1]![1].body).toBe(page.fetch.mock.calls[0]![1].body);
    expect(page.status.textContent).toContain('You’re on the list');
  });

  it('handles network errors without reporting a signup', async () => {
    const page = setup();
    page.fetch.mockRejectedValueOnce(new Error('offline'));
    await page.submit();
    expect(page.form.reset).not.toHaveBeenCalled();
    expect(page.fields.disabled).toBe(false);
    expect(page.status.textContent).toContain('couldn’t save');
  });

  it.each([
    { protocol: 'file:', hostname: '' },
    { protocol: 'http:', hostname: '127.0.0.1' },
    { protocol: 'https:', hostname: 'localhost' },
  ])('does not send or claim a signup in a preview at $protocol//$hostname', async (location) => {
    const page = setup(location);
    await page.submit();
    expect(page.fetch).not.toHaveBeenCalled();
    expect(page.form.reset).not.toHaveBeenCalled();
    expect(page.status.textContent).toContain('hasn’t been saved');
  });

  it('leaves invalid email input to browser validation', async () => {
    const page = setup();
    page.form.reportValidity.mockReturnValue(false);
    await page.submit();
    expect(page.fetch).not.toHaveBeenCalled();
    expect(page.fields.disabled).toBe(false);
  });
});
