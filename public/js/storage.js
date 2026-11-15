// Browser persistence.
//  - session: per tab (sessionStorage) so several tabs can be different players;
//    survives reloads, which is what lets a player rejoin after a refresh.
//  - preferences: shared (localStorage), e.g. the last name you used.

const SESSION_KEY = 'impostor.session.v2';
const REVEALED_KEY = 'impostor.revealed.v2';
const NAME_KEY = 'impostor.name';

const read = (store, key) => {
  try {
    return JSON.parse(store.getItem(key));
  } catch {
    return null;
  }
};
const write = (store, key, value) => {
  try {
    if (value == null) store.removeItem(key);
    else store.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or disabled (private mode) */
  }
};

export const session = {
  load() {
    const s = read(sessionStorage, SESSION_KEY);
    return s && s.roomCode && s.token ? s : null;
  },
  save(s) {
    write(sessionStorage, SESSION_KEY, s);
  },
  clear() {
    write(sessionStorage, SESSION_KEY, null);
    write(sessionStorage, REVEALED_KEY, null);
  },
};

/** Which round's card this tab has already flipped (so a reload doesn't re-show it). */
export const revealed = {
  get: () => read(sessionStorage, REVEALED_KEY),
  set: (key) => write(sessionStorage, REVEALED_KEY, key),
};

export const prefs = {
  get name() {
    return read(localStorage, NAME_KEY) || '';
  },
  set name(value) {
    write(localStorage, NAME_KEY, value || null);
  },
};
