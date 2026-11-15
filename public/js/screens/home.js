// Home screen + create/join dialogs.
import { $, show } from '../dom.js';
import { openDialog, closeDialog, setupDialog, withBusy } from '../ui.js';
import { prefs, session } from '../storage.js';
import { sounds } from '../sounds.js';

const cleanCode = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

function setError(id, message) {
  const el = $(id);
  el.textContent = message || '';
  show(el, Boolean(message));
}

/** Removes ?room=… from the address bar once it has been used. */
function clearInviteFromUrl() {
  if (location.search) history.replaceState(null, '', location.pathname);
}

export function openCreate() {
  setError('create-error', '');
  $('create-name').value = prefs.name;
  openDialog($('dialog-create'));
  $('create-name').select();
}

export function openJoin(code = '') {
  setError('join-error', '');
  $('join-code').value = cleanCode(code);
  $('join-name').value = prefs.name;
  openDialog($('dialog-join'));
  (code ? $('join-name') : $('join-code')).focus();
}

/** Opens the join dialog when the page was opened from an invite link. */
export function openInviteIfAny(app) {
  const code = new URLSearchParams(location.search).get('room');
  if (code && !app.game) openJoin(code);
}

function onJoined(app, res, name) {
  if (name) prefs.name = name;
  session.save(res.session);
  clearInviteFromUrl();
  sounds.play('chime');
}

export function init(app) {
  const dCreate = $('dialog-create');
  const dJoin = $('dialog-join');
  setupDialog(dCreate);
  setupDialog(dJoin);

  $('btn-create').addEventListener('click', openCreate);
  $('btn-join').addEventListener('click', () => openJoin());

  $('form-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('create-error', '');
    const name = $('create-name').value.trim();
    const res = await withBusy($('create-submit'), () => app.net.request('room:create', { name }));
    if (!res) return;
    if (!res.ok) {
      setError('create-error', res.error);
      return;
    }
    onJoined(app, res, name);
    closeDialog(dCreate);
  });

  $('join-code').addEventListener('input', (e) => {
    const cleaned = cleanCode(e.target.value);
    if (cleaned !== e.target.value) e.target.value = cleaned;
  });

  $('form-join').addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('join-error', '');
    const roomCode = cleanCode($('join-code').value);
    const name = $('join-name').value.trim();
    if (!roomCode) {
      setError('join-error', 'Enter the room code.');
      $('join-code').focus();
      return;
    }
    if (!name) {
      setError('join-error', 'Enter your name.');
      $('join-name').focus();
      return;
    }
    const res = await withBusy($('join-submit'), () => app.net.request('room:join', { roomCode, name }));
    if (!res) return;
    if (!res.ok) {
      setError('join-error', res.error);
      return;
    }
    onJoined(app, res, name);
    closeDialog(dJoin);
  });
}

export function render() {
  /* static screen */
}
