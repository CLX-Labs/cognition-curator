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
      'demo-flip',
      'demo-instruction',
      'demo-feedback',
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
    elements['demo-flip'].setAttribute('aria-expanded', 'false');
    elements['demo-flip'].setAttribute('aria-label', `Show answer for ${card.front}`);
    elements['demo-instruction'].textContent = 'Tap the card to show the answer.';
    cardElement.classList.remove('is-revealed');
    if (announce)
      elements['demo-announcement'].textContent =
        `${deck.name}, card ${cardIndex + 1} of 3: ${card.front}.`;
  }

  // A native button supports tap, pointer, Enter, and Space without separate
  // keyboard handlers. Flipping never records a recall choice.
  elements['demo-flip'].addEventListener('click', () => {
    const card = decks[deckKey].cards[cardIndex];
    const revealed = elements['demo-answer'].hidden;
    elements['demo-answer'].hidden = !revealed;
    elements['demo-prompt'].hidden = revealed;
    elements['demo-flip'].setAttribute('aria-expanded', String(revealed));
    elements['demo-flip'].setAttribute(
      'aria-label',
      revealed ? `Hide answer for ${card.front}. ${card.back}` : `Show answer for ${card.front}`,
    );
    elements['demo-instruction'].textContent = revealed
      ? 'Tap to flip back, or choose what you remembered.'
      : 'Tap the card to show the answer.';
    cardElement.classList.toggle('is-revealed', revealed);
    elements['demo-announcement'].textContent = revealed ? card.back : card.front;
  });
  document.querySelectorAll('[data-confidence]').forEach((button) => {
    button.addEventListener('click', () => {
      const unsure = button.dataset.confidence === 'unsure';
      const feedback = `${unsure ? 'Not sure' : 'I remember'} · Example next review: in ${unsure ? 3 : 7} days.`;
      cardIndex = (cardIndex + 1) % decks[deckKey].cards.length;
      renderCard();
      elements['demo-feedback'].textContent = feedback + ' Your choice isn’t saved.';
      const deck = decks[deckKey];
      elements['demo-announcement'].textContent =
        `${feedback} Next card: ${deck.cards[cardIndex].front}, ${cardIndex + 1} of 3.`;
      // The same two buttons stay mounted, so keyboard focus stays in place.
    });
  });
  document.querySelectorAll('[data-deck]').forEach((button) => {
    button.addEventListener('click', () => {
      deckKey = button.dataset.deck;
      cardIndex = 0;
      document
        .querySelectorAll('[data-deck]')
        .forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      renderCard(true);
      elements['demo-feedback'].textContent =
        'In the app, swipe left for “Not sure” or right for “I remember.”';
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
