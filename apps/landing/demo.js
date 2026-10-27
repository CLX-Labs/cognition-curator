(() => {
  'use strict';

  // Three real cards from each corresponding Recollect AI starter deck.
  const decks = {
    italian: {
      name: 'Italian for travel',
      cards: [
        {
          front: 'Buongiorno',
          prompt: 'How would you greet a new day?',
          back: 'Good morning; hello during the day.',
        },
        {
          front: 'Buonasera',
          prompt: 'A greeting for the evening.',
          back: 'Good evening.',
        },
        {
          front: 'Arrivederci',
          prompt: 'A goodbye to take with you.',
          back: 'Goodbye.',
        },
      ],
    },
    science: {
      name: 'Everyday physics',
      cards: [
        {
          front: 'Inertia',
          prompt: 'Why does motion keep going?',
          back: 'An object resists changes to its velocity unless a net force acts on it.',
        },
        {
          front: 'Force',
          prompt: 'What can change an object’s motion?',
          back: "A push or pull that can change an object's motion.",
        },
        {
          front: 'Acceleration',
          prompt: 'How quickly is velocity changing?',
          back: 'The rate at which velocity changes over time.',
        },
      ],
    },
    ideas: {
      name: 'Logical fallacies',
      cards: [
        {
          front: 'Ad hominem',
          prompt: 'Does the person change the argument?',
          back: 'Rejects an argument by attacking an irrelevant trait of the person making it.',
        },
        {
          front: 'Straw man',
          prompt: 'Is this the argument that was made?',
          back: 'Misrepresents an argument to attack an easier version.',
        },
        {
          front: 'False dilemma',
          prompt: 'Are these really the only options?',
          back: 'Treats a restricted set of choices as exhaustive without justification.',
        },
      ],
    },
    art: {
      name: 'Art movements',
      cards: [
        {
          front: 'Impressionism',
          prompt: 'A moment of light, caught in paint.',
          back: 'Painters captured fleeting light and everyday scenes with visible brushwork.',
        },
        {
          front: 'Post-Impressionism',
          prompt: 'What came after Impressionism?',
          back: 'Artists built on Impressionism while exploring more expressive color, structure, or symbolism.',
        },
        {
          front: 'Cubism',
          prompt: 'One subject. More than one viewpoint.',
          back: 'Artists broke subjects into geometric forms, often combining several viewpoints.',
        },
      ],
    },
    japanese: {
      name: 'Japanese greetings & essentials',
      cards: [
        {
          front: 'こんにちは',
          prompt: 'konnichiwa',
          back: 'Hello; good afternoon.',
        },
        {
          front: 'おはようございます',
          prompt: 'ohayō gozaimasu',
          back: 'Good morning.',
        },
        {
          front: 'こんばんは',
          prompt: 'konbanwa',
          back: 'Good evening.',
        },
      ],
    },
    music: {
      name: 'Music fundamentals',
      cards: [
        {
          front: 'Pitch',
          prompt: 'How high or low does a note sound?',
          back: 'How high or low a musical sound seems.',
        },
        {
          front: 'Beat',
          prompt: 'Find the pulse beneath the music.',
          back: 'The underlying pulse used to organize musical time.',
        },
        {
          front: 'Tempo',
          prompt: 'How quickly does the beat move?',
          back: 'The speed of the beat, often measured in beats per minute.',
        },
      ],
    },
    geography: {
      name: 'World geography',
      cards: [
        {
          front: 'Equator',
          prompt: 'An imaginary line around the world.',
          back: 'The line at zero degrees latitude, halfway between the geographic poles.',
        },
        {
          front: 'Latitude',
          prompt: 'How far north or south are you?',
          back: "A location's angular position north or south of the equator.",
        },
        {
          front: 'Longitude',
          prompt: 'How far east or west are you?',
          back: "A location's angular position east or west of the prime meridian.",
        },
      ],
    },
  };
  const card = document.getElementById('demo-card');
  const elements = Object.fromEntries(
    [
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
    ].map((id) => [id, document.getElementById(id)]),
  );

  if (card && Object.values(elements).every(Boolean)) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const deckButtons = document.querySelectorAll('[data-deck]');
    let deckKey = 'italian';
    let cardIndex = 0;
    let revealed = false;
    let pointer = null;
    let suppressPointerClick = false;
    let feedbackTimer;

    function currentCard() {
      return decks[deckKey].cards[cardIndex];
    }

    function describeCard() {
      return `${decks[deckKey].name}, card ${cardIndex + 1} of ${decks[deckKey].cards.length}: ${currentCard().front}.`;
    }

    function resetDrag() {
      const activePointer = pointer;
      pointer = null;
      card.classList.remove('is-dragging');
      card.style.removeProperty('--drag-x');
      card.style.removeProperty('--drag-rotation');
      if (activePointer && card.hasPointerCapture(activePointer.id)) {
        card.releasePointerCapture(activePointer.id);
      }
    }

    function cancelDrag() {
      if (pointer) suppressPointerClick = true;
      resetDrag();
    }

    function clearFeedback() {
      clearTimeout(feedbackTimer);
      elements['demo-feedback'].textContent = '';
    }

    function renderCard(announce = false) {
      resetDrag();
      revealed = false;
      const deck = decks[deckKey];
      const example = currentCard();
      elements['demo-deck'].textContent = deck.name;
      elements['demo-counter'].textContent =
        `${String(cardIndex + 1).padStart(2, '0')} / ${String(deck.cards.length).padStart(2, '0')}`;
      elements['demo-front'].textContent = example.front;
      elements['demo-prompt'].textContent = example.prompt;
      elements['demo-back'].textContent = example.back;
      elements['demo-answer'].hidden = true;
      elements['demo-prompt'].hidden = false;
      elements['demo-flip-label'].textContent = 'Show answer';
      elements['demo-progress'].style.width = `${((cardIndex + 1) / deck.cards.length) * 100}%`;
      elements['demo-progress'].setAttribute('aria-valuenow', String(cardIndex + 1));
      elements['demo-progress'].setAttribute(
        'aria-valuetext',
        `Example card ${cardIndex + 1} of ${deck.cards.length}`,
      );
      card.classList.remove('is-revealed');
      card.setAttribute('aria-pressed', 'false');
      card.setAttribute('aria-label', `${example.front}. Show answer.`);
      if (announce) elements['demo-announcement'].textContent = describeCard();
    }

    function flipCard() {
      revealed = !revealed;
      elements['demo-answer'].hidden = !revealed;
      elements['demo-prompt'].hidden = revealed;
      elements['demo-flip-label'].textContent = revealed ? 'Hide answer' : 'Show answer';
      card.classList.toggle('is-revealed', revealed);
      card.setAttribute('aria-pressed', String(revealed));
      card.setAttribute(
        'aria-label',
        revealed
          ? `${currentCard().front}. ${currentCard().back} Hide answer.`
          : `${currentCard().front}. Show answer.`,
      );
      elements['demo-announcement'].textContent = revealed ? currentCard().back : describeCard();
    }

    function advance(confidence) {
      if (!['known', 'unsure'].includes(confidence)) return;
      clearFeedback();
      cardIndex = (cardIndex + 1) % decks[deckKey].cards.length;
      renderCard();
      const feedback =
        confidence === 'known' ? 'Remembered. Next card.' : 'Not sure yet. Next card.';
      elements['demo-feedback'].textContent = feedback;
      elements['demo-announcement'].textContent = `${feedback} ${describeCard()}`;
      feedbackTimer = setTimeout(() => {
        elements['demo-feedback'].textContent = '';
      }, 1800);
    }

    function selectDeck(key) {
      if (!Object.prototype.hasOwnProperty.call(decks, key)) return false;
      deckKey = key;
      cardIndex = 0;
      clearFeedback();
      deckButtons.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.deck === key));
      });
      renderCard(true);
      return true;
    }

    // A native button supplies Enter/Space activation and assistive-technology clicks.
    card.addEventListener('click', (event) => {
      if (suppressPointerClick && event.detail !== 0) {
        suppressPointerClick = false;
        return;
      }
      suppressPointerClick = false;
      flipCard();
    });

    // Let vertical gestures remain page scrolling; capture only a horizontal drag.
    card.style.touchAction = 'pan-y';
    card.addEventListener('pointerdown', (event) => {
      if (pointer || event.isPrimary === false || event.button !== 0) return;
      suppressPointerClick = false;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null };
    });
    card.addEventListener('pointermove', (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const x = event.clientX - pointer.x;
      const y = event.clientY - pointer.y;
      if (!pointer.axis && Math.max(Math.abs(x), Math.abs(y)) >= 10) {
        pointer.axis = Math.abs(x) > Math.abs(y) * 1.15 ? 'horizontal' : 'vertical';
        suppressPointerClick = true;
        if (pointer.axis === 'horizontal') card.setPointerCapture(event.pointerId);
      }
      if (pointer.axis !== 'horizontal') return;
      event.preventDefault();
      if (!reducedMotion.matches) {
        card.classList.add('is-dragging');
        card.style.setProperty('--drag-x', `${Math.max(-140, Math.min(140, x))}px`);
        card.style.setProperty('--drag-rotation', `${Math.max(-8, Math.min(8, x / 18))}deg`);
      }
    });
    card.addEventListener('pointerup', (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const x = event.clientX - pointer.x;
      const y = event.clientY - pointer.y;
      const horizontal = pointer.axis !== 'vertical' && Math.abs(x) > Math.abs(y) * 1.15;
      if (Math.max(Math.abs(x), Math.abs(y)) >= 10) suppressPointerClick = true;
      resetDrag();
      if (horizontal && Math.abs(x) >= 70) advance(x > 0 ? 'known' : 'unsure');
    });
    card.addEventListener('pointerleave', (event) => {
      if (pointer?.id === event.pointerId && !card.hasPointerCapture(pointer.id)) cancelDrag();
    });
    card.addEventListener('pointercancel', cancelDrag);
    card.addEventListener('lostpointercapture', (event) => {
      if (pointer?.id === event.pointerId) cancelDrag();
    });
    window.addEventListener('blur', cancelDrag);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelDrag();
    });
    reducedMotion.addEventListener('change', cancelDrag);

    document.querySelectorAll('[data-confidence]').forEach((button) => {
      button.addEventListener('click', () => advance(button.dataset.confidence));
    });
    deckButtons.forEach((button) => {
      button.addEventListener('click', () => selectDeck(button.dataset.deck));
    });
    document.querySelectorAll('[data-demo-deck]').forEach((link) => {
      link.addEventListener('click', () => {
        if (selectDeck(link.dataset.demoDeck)) card.focus({ preventScroll: true });
      });
    });
    renderCard();
    document.querySelectorAll('.demo-stage button, [data-deck]').forEach((button) => {
      button.disabled = false;
    });
  }

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  const downloadUrl = window.RECOLLECT_SITE?.downloadUrl;
  if (typeof downloadUrl === 'string' && downloadUrl) {
    try {
      const url = new URL(downloadUrl);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        !['apps.apple.com', 'testflight.apple.com'].includes(url.hostname)
      ) {
        throw new Error('Use an official public Apple download URL.');
      }
      const beta = url.hostname === 'testflight.apple.com';
      const label = beta ? 'Join the iPhone beta' : 'Get Recollect for iPhone';
      document.querySelectorAll('[data-download-link]').forEach((link) => {
        link.href = url.href;
        link.textContent = `${label} ↗`;
      });
      document.querySelectorAll('[data-availability]').forEach((item) => {
        item.textContent = beta ? 'In beta for iPhone' : 'Made for iPhone';
      });
      const note = document.querySelector('[data-download-note]');
      if (note)
        note.textContent = beta
          ? 'Available in TestFlight for iPhone.'
          : 'Available on the App Store for iPhone.';
      const downloadFaq = document.getElementById('download-faq');
      if (downloadFaq)
        downloadFaq.textContent = beta
          ? 'Recollect is available to test on iPhone through TestFlight. Use “Join the iPhone beta” to check whether places are available.'
          : 'Recollect is available on the App Store for iPhone. Choose “Get Recollect for iPhone” to download it.';
      const availabilityDescription = document.getElementById('availability-description');
      if (availabilityDescription)
        availabilityDescription.textContent = beta
          ? 'Try Recollect on iPhone through TestFlight, or join the waitlist for availability updates.'
          : 'Get Recollect for iPhone, or join the waitlist for availability updates.';
    } catch {
      // Keep the preview links when a public download URL has not been configured.
    }
  }
})();
