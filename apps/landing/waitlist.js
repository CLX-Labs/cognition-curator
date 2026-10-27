(() => {
  'use strict';

  const form = document.getElementById('waitlist-form');
  const fields = document.getElementById('waitlist-fields');
  const button = document.getElementById('waitlist-submit');
  const status = document.getElementById('waitlist-status');
  let submitting = false;
  let saved = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || saved || !form.reportValidity()) return;

    if (
      window.location.protocol !== 'https:' ||
      ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
    ) {
      status.textContent = 'This preview doesn’t save signups. Your email hasn’t been saved.';
      status.focus({ preventScroll: true });
      return;
    }

    const data = new FormData(form);
    data.set('email', String(data.get('email')).trim());
    // Build the payload before disabling fields, so their values are included.
    const body = new URLSearchParams(data).toString();
    submitting = true;
    fields.disabled = true;
    form.setAttribute('aria-busy', 'true');
    button.textContent = 'Saving…';
    status.textContent = '';
    status.setAttribute('role', 'status');

    try {
      const response = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Signup was not accepted.');
      saved = true;
      form.reset();
      fields.hidden = true;
      status.textContent = 'You’re on the list. We’ll email you when Recollect is available.';
      status.focus({ preventScroll: true });
    } catch {
      fields.disabled = false;
      button.textContent = 'Try again ↗';
      status.setAttribute('role', 'alert');
      status.textContent = 'We couldn’t save your email. Please try again.';
      status.focus({ preventScroll: true });
    } finally {
      submitting = false;
      form.removeAttribute('aria-busy');
    }
  });
})();
