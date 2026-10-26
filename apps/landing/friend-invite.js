(() => {
  'use strict';

  const ready = document.getElementById('invite-ready');
  const introduction = document.getElementById('invite-introduction');
  const invalid = document.getElementById('invite-invalid');
  const codeField = document.getElementById('invite-code');
  const copyButton = document.getElementById('invite-copy');
  const copyStatus = document.getElementById('invite-copy-status');
  const openLink = document.getElementById('invite-open');
  const downloadLink = document.getElementById('invite-download');
  const downloadNote = document.getElementById('invite-download-note');

  // Match the API contract. Reject ambiguous repeated parameters and never
  // interpret the invitation as markup or a destination supplied by the sender.
  const codes = new URLSearchParams(window.location.search).getAll('invite');
  const code = codes.length === 1 ? codes[0].trim() : '';
  if (/^[A-Za-z0-9_-]{16,256}$/.test(code)) {
    codeField.value = code;
    openLink.href = 'cognitioncurator://friends?invite=' + encodeURIComponent(code);
    introduction.textContent = 'Open Recollect to review and accept your friend’s invitation.';
    ready.hidden = false;

    copyButton.addEventListener('click', async () => {
      try {
        if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Copy manually.');
        await navigator.clipboard.writeText(code);
        copyStatus.textContent = 'Invite code copied. Keep it until you connect.';
      } catch {
        codeField.focus();
        codeField.select();
        codeField.setSelectionRange(0, code.length);
        copyStatus.textContent = 'Invite code selected. Use your device’s Copy command.';
      }
    });
  } else {
    introduction.hidden = true;
    invalid.hidden = false;
  }

  // This is a public, owner-configured destination, never an invite parameter.
  // A missing or invalid link keeps the availability-waitlist fallback in the HTML.
  const downloadUrl = window.RECOLLECT_SITE?.downloadUrl;
  if (typeof downloadUrl !== 'string') return;
  try {
    const url = new URL(downloadUrl);
    const store = url.hostname === 'apps.apple.com' && /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+\/?$/.test(url.pathname);
    const beta = url.hostname === 'testflight.apple.com' && /^\/join\/[A-Za-z0-9]{8}\/?$/.test(url.pathname);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || (!store && !beta)) return;
    downloadLink.href = url.href;
    downloadLink.textContent = beta ? 'Join the iPhone beta ↗' : 'Get Recollect for iPhone ↗';
    downloadNote.textContent = beta
      ? 'Install Recollect through TestFlight, then come back to this invitation. If the beta is full, join the waitlist on the Recollect homepage for availability updates.'
      : 'Download Recollect from the App Store, then come back to this invitation to connect with your friend.';
  } catch {
    // Keep the useful local fallback when a public Apple link is not ready.
  }
})();
