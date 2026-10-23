(() => {
  'use strict';

  const form = document.getElementById('support-form');
  const fields = document.getElementById('support-fields');
  const button = document.getElementById('support-submit');
  const status = document.getElementById('support-status');
  let submitting = false;
  let saved = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || saved || !form.reportValidity()) return;
    if (window.location.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
      status.textContent = 'This is a preview. Your message hasn’t been sent. Open the live Recollect support page to contact us.';
      status.focus({ preventScroll: true });
      return;
    }

    const data = new FormData(form);
    data.set('email', String(data.get('email')).trim());
    const body = new URLSearchParams(data).toString();
    submitting = true;
    fields.disabled = true;
    form.setAttribute('aria-busy', 'true');
    button.textContent = 'Sending…';
    status.textContent = '';
    status.setAttribute('role', 'status');
    try {
      const response = await fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Message was not accepted.');
      saved = true;
      form.reset();
      fields.hidden = true;
      status.textContent = 'Your message was sent. Keep an eye on the email address you provided for a reply.';
      status.focus({ preventScroll: true });
    } catch {
      fields.disabled = false;
      button.textContent = 'Try sending again ↗';
      status.setAttribute('role', 'alert');
      status.textContent = 'We couldn’t send your message. Your text is still here. Try again, or use the email address on this page if available.';
      status.focus({ preventScroll: true });
    } finally {
      submitting = false;
      form.removeAttribute('aria-busy');
    }
  });
})();
