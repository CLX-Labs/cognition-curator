(() => {
  'use strict';

  // The address is owner-configured public contact information, never user input.
  const email = window.RECOLLECT_SITE?.supportEmail;
  if (typeof email !== 'string' || !/^[A-Za-z0-9._+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/.test(email)) return;
  document.querySelectorAll('[data-support-email]').forEach((link) => {
    link.href = 'mailto:' + email;
    link.textContent = email;
  });
  document.querySelectorAll('[data-public-contact]').forEach((item) => {
    item.hidden = false;
  });
})();
