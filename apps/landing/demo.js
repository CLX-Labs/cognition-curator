(() => {
  'use strict';

  const decks = {
    italian: {
      name: 'Italian essentials',
      label: 'A LITTLE ITALIAN',
      answerLabel: 'THE MEANING',
      cards: [
        {
          front: 'Buongiorno',
          prompt: 'A new day. A new word.',
          back: 'Good morning. Or simply, good day.',
        },
        { front: 'Grazie', prompt: 'A little word that goes a long way.', back: 'Thank you.' },
        {
          front: 'A presto',
          prompt: 'Some goodbyes are only for a little while.',
          back: 'See you soon.',
        },
      ],
    },
    science: {
      name: 'Everyday science',
      label: 'A LITTLE EVERYDAY SCIENCE',
      answerLabel: 'THE IDEA',
      cards: [
        {
          front: 'Alternator',
          prompt: 'A little curiosity under the hood.',
          back: 'Turns mechanical energy into electricity to power a vehicle and charge its battery.',
        },
        {
          front: 'Photosynthesis',
          prompt: 'A little sunlight goes a long way.',
          back: 'Plants use light energy to turn water and carbon dioxide into sugars, releasing oxygen.',
        },
        {
          front: 'Evaporation',
          prompt: 'The little science in everyday life.',
          back: 'The change from liquid to gas at a liquid’s surface.',
        },
      ],
    },
    ideas: {
      name: 'Big ideas',
      label: 'A LITTLE FOOD FOR THOUGHT',
      answerLabel: 'THE IDEA',
      cards: [
        {
          front: 'Opportunity cost',
          prompt: 'Every choice makes a little trade.',
          back: 'The value of the next-best alternative you give up when you choose something.',
        },
        {
          front: 'Feedback loop',
          prompt: 'What happens next can change what happens after.',
          back: 'A process whose output feeds back into its input, influencing what it does next.',
        },
        {
          front: 'First principles',
          prompt: 'Start with what you know to be true.',
          back: 'Reasoning from basic facts or assumptions instead of relying only on analogy.',
        },
      ],
    },
  };
  const elements = Object.fromEntries(
    [
      'demo-deck',
      'demo-counter',
      'demo-label',
      'demo-front',
      'demo-prompt',
      'demo-answer',
      'demo-back',
      'choice-actions',
      'rating-actions',
      'rating-first',
      'rating-second',
      'change-choice',
      'demo-announcement',
    ].map((id) => [id, document.getElementById(id)]),
  );
  const cardElement = document.querySelector('.flashcard');
  let deckKey = 'italian';
  let cardIndex = 0;

  function renderCard(announce = false) {
    const deck = decks[deckKey];
    const card = deck.cards[cardIndex];
    elements['demo-deck'].textContent = deck.name;
    elements['demo-label'].textContent = deck.label;
    elements['demo-front'].textContent = card.front;
    elements['demo-counter'].textContent = `${String(cardIndex + 1).padStart(2, '0')} / 03`;
    elements['demo-prompt'].textContent = card.prompt;
    elements['demo-back'].textContent = card.back;
    elements['demo-answer'].querySelector('.eyebrow').textContent = deck.answerLabel;
    elements['demo-answer'].hidden = true;
    elements['demo-prompt'].hidden = false;
    elements['choice-actions'].hidden = false;
    elements['rating-actions'].hidden = true;
    cardElement.classList.remove('is-revealed');
    if (announce)
      elements['demo-announcement'].textContent =
        `${deck.name}, card ${cardIndex + 1} of 3: ${card.front}.`;
  }

  function reveal(confidence) {
    elements['demo-answer'].hidden = false;
    elements['demo-prompt'].hidden = true;
    elements['choice-actions'].hidden = true;
    elements['rating-actions'].hidden = false;
    cardElement.classList.add('is-revealed');
    const unsure = confidence === 'unsure';
    elements['rating-first'].textContent = unsure ? 'Again · 1m' : 'Good · 10m';
    elements['rating-second'].textContent = unsure ? 'Hard · 1m' : 'Easy · 4d';
    elements['demo-announcement'].textContent = decks[deckKey].cards[cardIndex].back;
    elements['rating-first'].focus({ preventScroll: true });
  }

  document.querySelectorAll('[data-confidence]').forEach((button) => {
    button.addEventListener('click', () => reveal(button.dataset.confidence));
  });
  [elements['rating-first'], elements['rating-second']].forEach((button) => {
    button.addEventListener('click', () => {
      cardIndex = (cardIndex + 1) % decks[deckKey].cards.length;
      renderCard(true);
      document.querySelector('[data-confidence]').focus({ preventScroll: true });
    });
  });
  elements['change-choice'].addEventListener('click', () => {
    elements['choice-actions'].hidden = false;
    elements['rating-actions'].hidden = true;
    document.querySelector('[data-confidence]').focus({ preventScroll: true });
  });
  document.querySelectorAll('[data-deck]').forEach((button) => {
    button.addEventListener('click', () => {
      deckKey = button.dataset.deck;
      cardIndex = 0;
      document
        .querySelectorAll('[data-deck]')
        .forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      renderCard(true);
    });
  });
  document.querySelectorAll('.demo-stage button, [data-deck]').forEach((button) => {
    button.disabled = false;
  });
  document.getElementById('year').textContent = String(new Date().getFullYear());

  const downloadUrl = window.RECOLLECT_SITE?.downloadUrl;
  if (downloadUrl) {
    try {
      const url = new URL(downloadUrl);
      if (
        url.protocol !== 'https:' ||
        !['apps.apple.com', 'testflight.apple.com'].includes(url.hostname)
      )
        throw new Error('Use an official public Apple download URL.');
      const beta = url.hostname === 'testflight.apple.com';
      const label = beta ? 'Join the iPhone beta' : 'Get Recollect for iPhone';
      document.querySelectorAll('[data-download-link]').forEach((link) => {
        link.href = url.href;
        link.textContent = label + ' ↗';
      });
      document.querySelectorAll('[data-availability]').forEach((item) => {
        item.textContent = beta ? 'In beta for iPhone' : 'Made for iPhone';
      });
      document.querySelector('[data-download-note]').textContent = beta
        ? 'Available in TestFlight for iPhone.'
        : 'Available on the App Store for iPhone.';
    } catch {
      // Leave the working interactive preview in place if the public link is not ready.
    }
  }
})();
