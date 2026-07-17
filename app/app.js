let allCards = [];
let filter = 'all';
let index = 0;
let revealed = false;
let studyOrder = null;
let savedSessions = [];
let currentSessionId = localStorage.getItem('currentSessionId');
let baselineFingerprint = null;
let transitioning = false;

const $ = selector => document.querySelector(selector);
const request = async (path, options) => {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Something went wrong.');
  }
  return response.status === 204 ? null : response.json();
};
const showSessionError = error => {
  const message = error.message.includes('/app/api/sessions')
    ? 'The session server is outdated. Stop the running terminal with Ctrl+C, then run npm start again.'
    : error.message;
  $('#session-error').textContent = message;
  $('#session-error').hidden = false;
};
const clearSessionError = () => { $('#session-error').hidden = true; };
const runSessionAction = async action => {
  clearSessionError();
  try { await action(); } catch (error) { showSessionError(error); }
};
const statusOf = card => card.status || 'new';
const fingerprint = cards => JSON.stringify(cards.map(card => ({ id: card.id, front: card.front, back: card.back, source: card.source, status: statusOf(card) })));
const isDirty = () => baselineFingerprint !== null && fingerprint(allCards) !== baselineFingerprint;
const visibleCards = () => {
  const cards = filter === 'all' ? [...allCards] : allCards.filter(card => statusOf(card) === filter);
  if (!studyOrder) return cards;
  const positions = new Map(studyOrder.map((id, position) => [id, position]));
  return cards.sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
};
const escapeHtml = value => {
  const element = document.createElement('div');
  element.textContent = value || '';
  return element.innerHTML;
};
const statusLabel = status => ({ known: 'Know', dont_know: 'Don’t know', new: 'Unrated' })[status];

function fitCardText() {
  const card = $('#card');
  if (!card || card.hidden) return;
  const faces = [...card.querySelectorAll('.card-face')];
  const paragraphs = [...card.querySelectorAll('.card-face p')];
  if (!faces.length || !paragraphs.length) return;

  card.classList.remove('card-expanded');
  card.style.removeProperty('--card-font-size');
  const maximum = parseFloat(getComputedStyle(paragraphs[0]).fontSize);
  const minimum = Math.min(maximum, window.innerWidth <= 650 ? 18 : 22);
  const overflows = () => faces.some(face => face.scrollHeight > face.clientHeight + 1);
  if (!overflows()) return;

  card.style.setProperty('--card-font-size', `${minimum}px`);
  if (overflows()) {
    card.classList.add('card-expanded');
    return;
  }

  let low = minimum;
  let high = maximum;
  for (let step = 0; step < 7; step += 1) {
    const candidate = (low + high) / 2;
    card.style.setProperty('--card-font-size', `${candidate}px`);
    if (overflows()) high = candidate;
    else low = candidate;
  }
  card.style.setProperty('--card-font-size', `${Math.floor(low * 10) / 10}px`);
}

function render() {
  const deck = visibleCards();
  if (index >= deck.length) index = Math.max(0, deck.length - 1);
  const card = deck[index];
  const hasCard = Boolean(card);
  const knownCount = allCards.filter(item => statusOf(item) === 'known').length;
  const dontCount = allCards.filter(item => statusOf(item) === 'dont_know').length;

  $('#count').textContent = `${deck.length} ${filter === 'all' ? 'cards' : filter === 'known' ? 'known' : 'to review'}`;
  $('#all-count').textContent = allCards.length;
  $('#known-count').textContent = knownCount;
  $('#dont-count').textContent = dontCount;
  $('#remove-all').hidden = !allCards.length;
  $('#dirty-mark').hidden = !isDirty();
  $('#card').hidden = !hasCard;
  $('#rating-controls').hidden = !hasCard;
  $('.navigation').hidden = !hasCard;
  $('#empty').hidden = hasCard;

  document.querySelectorAll('.filter[data-filter]').forEach(button => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  if (hasCard) {
    const label = statusLabel(statusOf(card));
    $('#card-status-front').textContent = label;
    $('#card-status-back').textContent = label;
    $('#card-front-text').textContent = card.front;
    $('#card-back-text').textContent = card.back;
    $('#card').classList.toggle('flipped', revealed);
    $('.card-front').setAttribute('aria-hidden', String(revealed));
    $('.card-back').setAttribute('aria-hidden', String(!revealed));
    $('#card').setAttribute('aria-label', revealed ? 'Show question' : 'Reveal answer');
    $('#position').textContent = `${index + 1} / ${deck.length}`;
  }

  $('#list').innerHTML = allCards.map(cardItem => `
    <article class="mini">
      <small>${escapeHtml(cardItem.source)}</small>
      <p>${escapeHtml(cardItem.front)}</p>
      <small>${escapeHtml(cardItem.back)}</small>
      <div class="mini-actions"><span class="status">${statusLabel(statusOf(cardItem))}</span><button type="button" data-remove="${cardItem.id}">Remove</button></div>
    </article>`).join('');
  if (hasCard) fitCardText();
}

function renderSessions() {
  const select = $('#session-select');
  const previous = select.value;
  if (!savedSessions.length) {
    select.innerHTML = '<option value="">No saved sessions</option>';
  } else {
    select.innerHTML = savedSessions.map(session => `<option value="${session.id}">${escapeHtml(session.name)} (${session.cardCount})</option>`).join('');
    select.value = savedSessions.some(session => session.id === currentSessionId) ? currentSessionId : previous;
    if (!select.value) select.value = savedSessions[0].id;
  }
  const current = savedSessions.find(session => session.id === currentSessionId);
  $('#current-session').textContent = current?.name || 'Unsaved session';
  $('#rename-session').disabled = !select.value;
  $('#load-session').disabled = !select.value;
}

async function refreshSessions() {
  savedSessions = await request('/api/sessions');
  renderSessions();
}

async function load() {
  allCards = await request('/api/cards');
  studyOrder = null;
  render();
}

async function animateCardChange(update, direction = 1) {
  if (transitioning) return;
  const card = $('#card');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  transitioning = true;
  let ghost = null;
  try {
    if (reduceMotion || card.hidden) {
      update();
      render();
      return;
    }

    const movingForward = direction >= 0;
    const side = movingForward ? -1 : 1;
    const behind = 'translate(10px, 10px) scale(.975)';
    const around = `translate(${side * 44}px, 7px) rotate(${side * 1.2}deg) scale(.992)`;
    const bounds = card.getBoundingClientRect();

    ghost = card.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.removeAttribute('tabindex');
    ghost.removeAttribute('role');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.classList.add('card-stack-ghost');
    ghost.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    Object.assign(ghost.style, {
      top: `${card.offsetTop}px`,
      left: `${card.offsetLeft}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`
    });
    card.parentElement.append(ghost);

    card.style.transform = behind;
    update();
    render();

    await ghost.animate([
      { transform: 'translate(0, 0) rotate(0) scale(1)' },
      { transform: around }
    ], {
      duration: 160,
      easing: 'cubic-bezier(.4, 0, .8, .35)',
      fill: 'forwards'
    }).finished;

    ghost.style.zIndex = '0';
    await Promise.all([
      ghost.animate([
        { transform: around },
        { transform: behind }
      ], {
        duration: 240,
        easing: 'cubic-bezier(.2, .75, .2, 1)',
        fill: 'forwards'
      }).finished,
      card.animate([
        { transform: behind },
        { transform: 'translate(0, 0) scale(1)' }
      ], {
        duration: 240,
        easing: 'cubic-bezier(.2, .75, .2, 1)'
      }).finished
    ]);
  } finally {
    ghost?.remove();
    card.style.removeProperty('transform');
    transitioning = false;
  }
}

function move(amount) {
  const deck = visibleCards();
  if (!deck.length) return;
  animateCardChange(() => {
    index = (index + amount + deck.length) % deck.length;
    revealed = false;
  }, Math.sign(amount) || 1);
}

async function rate(status) {
  const deck = visibleCards();
  const card = deck[index];
  if (!card) return;
  await request(`/api/cards/${card.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  const stored = allCards.find(item => item.id === card.id);
  stored.status = status;
  await animateCardChange(() => {
    revealed = false;
    if (filter === 'all') index = Math.min(index + 1, allCards.length - 1);
  }, 1);
}

function applyPreferences() {
  const dark = localStorage.getItem('theme') === 'dark';
  const dyslexic = localStorage.getItem('font') === 'dyslexic';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.font = dyslexic ? 'dyslexic' : 'standard';
  $('#theme-toggle').setAttribute('aria-pressed', String(dark));
  $('#theme-toggle').textContent = dark ? 'Light mode' : 'Dark mode';
  $('#font-toggle').setAttribute('aria-pressed', String(dyslexic));
}

$('#card').onclick = () => { revealed = !revealed; render(); };
$('#next').onclick = () => move(1);
$('#previous').onclick = () => move(-1);
$('#know').onclick = () => rate('known').catch(error => alert(error.message));
$('#dont-know').onclick = () => rate('dont_know').catch(error => alert(error.message));

document.querySelectorAll('.filter[data-filter]').forEach(button => {
  button.onclick = () => { filter = button.dataset.filter; index = 0; revealed = false; render(); };
});

$('#shuffle').onclick = () => {
  studyOrder = allCards.map(card => card.id);
  for (let position = studyOrder.length - 1; position > 0; position--) {
    const random = Math.floor(Math.random() * (position + 1));
    [studyOrder[position], studyOrder[random]] = [studyOrder[random], studyOrder[position]];
  }
  index = 0;
  revealed = false;
  render();
};

document.onkeydown = event => {
  if (['TEXTAREA', 'INPUT'].includes(document.activeElement.tagName)) return;
  if (event.code === 'Space' && visibleCards().length) { event.preventDefault(); revealed = !revealed; render(); }
  if (event.key === '1') rate('dont_know').catch(error => alert(error.message));
  if (event.key === '2') rate('known').catch(error => alert(error.message));
  if (event.key === 'ArrowRight') move(1);
  if (event.key === 'ArrowLeft') move(-1);
};

$('#theme-toggle').onclick = () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  applyPreferences();
};
$('#font-toggle').onclick = () => {
  const dyslexic = document.documentElement.dataset.font !== 'dyslexic';
  localStorage.setItem('font', dyslexic ? 'dyslexic' : 'standard');
  applyPreferences();
  requestAnimationFrame(fitCardText);
};

let resizeFrame;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(fitCardText);
});
document.fonts?.ready.then(fitCardText);

$('#form').onsubmit = async event => {
  event.preventDefault();
  await request('/api/cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ front: $('#front').value, back: $('#back').value })
  });
  event.target.reset();
  await load();
};

$('#list').onclick = async event => {
  const id = event.target.dataset.remove;
  if (!id) return;
  await request(`/api/cards/${id}`, { method: 'DELETE' });
  await load();
};

$('#remove-all').onclick = async () => {
  if (!confirm(`Remove all ${allCards.length} cards? This cannot be undone.`)) return;
  try {
    await request('/api/cards/clear', { method: 'POST' });
    index = 0;
    revealed = false;
    await load();
  } catch (error) { alert(`Could not remove cards: ${error.message}`); }
};

function confirmDiscard() {
  return !isDirty() || confirm('This session has unsaved changes. Loading or starting another session will discard them. Continue?');
}

window.addEventListener('beforeunload', event => {
  if (!isDirty()) return;
  event.preventDefault();
  event.returnValue = '';
});

$('#new-session').onclick = () => runSessionAction(async () => {
  if (!confirmDiscard()) return;
  const result = await request('/api/sessions/new', { method: 'POST' });
  allCards = result.cards;
  currentSessionId = null;
  localStorage.removeItem('currentSessionId');
  baselineFingerprint = fingerprint([]);
  studyOrder = null;
  index = 0;
  revealed = false;
  renderSessions();
  render();
});

$('#save-session').onclick = () => runSessionAction(async () => {
  let saved;
  if (currentSessionId) {
    saved = await request(`/api/sessions/${currentSessionId}`, { method: 'PUT' });
  } else {
    const name = prompt('Name this session:');
    if (!name?.trim()) return;
    saved = await request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    currentSessionId = saved.id;
    localStorage.setItem('currentSessionId', currentSessionId);
  }
  baselineFingerprint = fingerprint(saved.cards);
  await refreshSessions();
  render();
});

$('#load-session').onclick = () => runSessionAction(async () => {
  const id = $('#session-select').value;
  if (!id || !confirmDiscard()) return;
  const result = await request(`/api/sessions/${id}/load`, { method: 'POST' });
  allCards = result.cards;
  currentSessionId = id;
  localStorage.setItem('currentSessionId', id);
  baselineFingerprint = fingerprint(result.cards);
  studyOrder = null;
  index = 0;
  revealed = false;
  await refreshSessions();
  render();
});

$('#rename-session').onclick = () => {
  const id = $('#session-select').value;
  const session = savedSessions.find(item => item.id === id);
  if (!session) return;
  $('#rename-input').value = session.name;
  $('#rename-dialog').showModal();
  $('#rename-input').focus();
  $('#rename-input').select();
};

$('#rename-cancel').onclick = () => $('#rename-dialog').close();
$('#rename-form').onsubmit = event => runSessionAction(async () => {
  event.preventDefault();
  const id = $('#session-select').value;
  const session = savedSessions.find(item => item.id === id);
  const name = $('#rename-input').value.trim();
  if (!session || !name) return;
  if (name === session.name) { $('#rename-dialog').close(); return; }
  await request(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  await refreshSessions();
  $('#rename-dialog').close();
});

applyPreferences();
async function initialize() {
  try {
    allCards = await request('/api/cards');
    baselineFingerprint = fingerprint([]);
    render();
  } catch (error) {
    $('#count').textContent = 'Could not load cards';
    alert(`Could not load cards: ${error.message}`);
    return;
  }
  try {
    savedSessions = await request('/api/sessions');
    const current = savedSessions.find(session => session.id === currentSessionId);
    if (current) {
      const saved = await request(`/api/sessions/${currentSessionId}`);
      baselineFingerprint = fingerprint(saved.cards);
    } else {
      currentSessionId = null;
      localStorage.removeItem('currentSessionId');
    }
    clearSessionError();
  } catch (error) {
    savedSessions = [];
    showSessionError(error);
  }
  renderSessions();
  render();
}
initialize();
