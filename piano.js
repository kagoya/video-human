const keys = [...document.querySelectorAll(".key")];
const keyByCharacter = new Map(keys.map(key => [key.dataset.key, key]));
const activeNotes = new Map();
const status = document.querySelector(".note");
let audioContext;

function startNote(key) {
  const note = key.dataset.note;
  if (activeNotes.has(note)) return;

  audioContext ??= new AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();

  const oscillator = audioContext.createOscillator();
  const envelope = audioContext.createGain();
  const now = audioContext.currentTime;

  oscillator.type = "triangle";
  oscillator.frequency.value = Number(key.dataset.frequency);
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(0.22, now + 0.025);
  oscillator.connect(envelope);
  envelope.connect(audioContext.destination);
  oscillator.start(now);

  activeNotes.set(note, { oscillator, envelope });
  key.classList.add("is-active");
  status.textContent = `${note} を演奏中`;
}

function stopNote(key) {
  const note = key.dataset.note;
  const voice = activeNotes.get(note);
  if (!voice) return;

  const now = audioContext.currentTime;
  voice.envelope.gain.cancelScheduledValues(now);
  voice.envelope.gain.setTargetAtTime(0.0001, now, 0.06);
  voice.oscillator.stop(now + 0.25);
  activeNotes.delete(note);
  key.classList.remove("is-active");

  if (!activeNotes.size) status.textContent = "鍵盤を押して音を鳴らしましょう";
}

for (const key of keys) {
  key.addEventListener("pointerdown", event => {
    event.preventDefault();
    key.setPointerCapture(event.pointerId);
    startNote(key);
  });
  key.addEventListener("pointerup", () => stopNote(key));
  key.addEventListener("pointercancel", () => stopNote(key));
  key.addEventListener("lostpointercapture", () => stopNote(key));
}

document.addEventListener("keydown", event => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  const key = keyByCharacter.get(event.key.toLowerCase());
  if (!key) return;

  event.preventDefault();
  startNote(key);
});

document.addEventListener("keyup", event => {
  const key = keyByCharacter.get(event.key.toLowerCase());
  if (key) stopNote(key);
});

window.addEventListener("blur", () => {
  for (const key of keys) stopNote(key);
});
