/**
 * Dialogue: an ordered queue of lines, advanced by the player.
 *
 * A line is either spoken (`{ speaker, text }`) or a prompt for typed input
 * (`{ input, placeholder, label }`), which is how registration asks for the
 * player's name. The UI subscribes via `onChange` and renders whatever
 * `current` holds.
 */
export class Dialogue {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.lines = [];
    this.index = 0;
    this.active = false;
    this.typed = '';
    this.onInput = null;
    /** Fired when the whole queue drains. */
    this.onComplete = null;
  }

  start(lines, { onComplete = null } = {}) {
    this.lines = lines.filter(Boolean);
    this.index = 0;
    this.active = this.lines.length > 0;
    this.onComplete = onComplete;
    this.typed = '';
    this._emit();
    return this;
  }

  get current() {
    return this.active ? this.lines[this.index] : null;
  }

  get isInput() {
    const c = this.current;
    return !!c && c.input === true;
  }

  /** Advance one line. Ignored while an input line is waiting for a submit. */
  next() {
    if (this.isInput) return false;
    return this._step();
  }

  /** Submit the typed value for the current input line. */
  submit(value) {
    const line = this.current;
    if (!line || !line.input) return false;
    const trimmed = (value ?? this.typed).trim();
    if (line.required && !trimmed) return false;
    if (typeof line.onSubmit === 'function') line.onSubmit(trimmed);
    this.typed = '';
    // step past the input line unconditionally — `next()` would refuse, since
    // the line it is sitting on is the input one
    return this._step();
  }

  /** Move to the next line, or finish the queue. No guards. */
  _step() {
    if (!this.active) return false;
    this.index++;
    if (this.index >= this.lines.length) {
      this.active = false;
      this.index = 0;
      this._emit();
      const done = this.onComplete;
      this.onComplete = null;
      if (done) done();
      return false;
    }
    this._emit();
    return true;
  }

  setTyped(value) {
    this.typed = value;
    this._emit();
  }

  /** Drop the rest of the queue. */
  skip() {
    if (!this.active) return;
    this.active = false;
    this.lines = [];
    this.index = 0;
    this.onComplete = null;
    this._emit();
  }

  _emit() {
    this.onChange(this.current, this.active, this.isInput, this.typed);
  }
}

/**
 * The opening script and the guild registration script.
 *
 * Kept as data so the cutscene runner and the gameplay triggers can share the
 * same shape.
 */

export function introLines(cityName) {
  return [
    { speaker: 'Chronicler', text: `Ravenshold. The last walled town before the wild takes over.` },
    { speaker: 'Chronicler', text: `You arrived this morning with a sword you barely know how to hold and a purse that rattles when you breathe.` },
    { speaker: 'Chronicler', text: `The Guild hall stands on the north side of the square. That is where work is found.` },
  ];
}

export function registrationLines(playerRef, onName, onDone) {
  return [
    { speaker: 'Receptionist', text: 'Next. Yes, you — the one with the sword.' },
    { speaker: 'Receptionist', text: 'You want work, you register first. Guild rules. Name?' },
    {
      input: true,
      speaker: 'You',
      label: 'Enter your name',
      placeholder: 'Ranger',
      required: true,
      onSubmit: (name) => {
        playerRef.name = name || 'Ranger';
        if (onName) onName(playerRef.name);
      },
    },
    { speaker: 'Receptionist', text: 'Right. Sign here — or make your mark, I am not fussy.' },
    { speaker: 'Receptionist', text: (self) => `Entered in the ledger. Welcome to the guild, ${playerRef.name}.` },
    { speaker: 'Receptionist', text: 'Pay is by the contract and the contract is by the head. Board is behind you.' },
    { speaker: 'Receptionist', text: 'Take one. Come back breathing, and we settle up.' },
    { speaker: 'Receptionist', text: 'And — talk to the quartermaster before you go. You will want better steel than that.' },
  ].map((l) => (typeof l.text === 'function' ? { ...l, text: l.text() } : l)).map((l) => ({
    ...l,
    onComplete: onDone,
  }));
}

export function npcBark(npc) {
  if (npc.lines && npc.lines.length) {
    return npc.lines.map((t) => ({ speaker: npc.displayName, text: t }));
  }
  return [{ speaker: npc.displayName, text: '...' }];
}
