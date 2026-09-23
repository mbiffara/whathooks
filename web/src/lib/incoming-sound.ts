"use client";

/**
 * Sounds the inbox plays when a message comes in. They are synthesized with
 * the Web Audio API, so there are no audio files to ship or license.
 *
 * The list mirrors INCOMING_SOUNDS in api/src/auth/incoming-sounds.ts (the
 * API validates the saved value against it) and the `sound*` keys under
 * dash.settings in messages/*.json. Adding a sound means touching all three.
 */
export const INCOMING_SOUNDS = [
  "none",
  "chime",
  "pop",
  "ding",
  "double",
] as const;

export type IncomingSound = (typeof INCOMING_SOUNDS)[number];

export const DEFAULT_INCOMING_SOUND: IncomingSound = "chime";

/** Narrow a stored value; anything unknown (or missing) plays the default. */
export function toIncomingSound(value: unknown): IncomingSound {
  return (INCOMING_SOUNDS as readonly unknown[]).includes(value)
    ? (value as IncomingSound)
    : DEFAULT_INCOMING_SOUND;
}

const VOLUME = 0.2;
const ATTACK = 0.005;

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/**
 * One enveloped oscillator note: a ~5 ms attack, then an exponential decay to
 * silence over `duration`. `endFreq` sweeps the pitch across the note.
 */
function note(
  ac: AudioContext,
  opts: {
    type: OscillatorType;
    freq: number;
    endFreq?: number;
    start: number;
    duration: number;
  },
) {
  const { type, freq, endFreq, start, duration } = opts;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(VOLUME, start + ATTACK);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

function schedule(ac: AudioContext, sound: IncomingSound) {
  const t = ac.currentTime + 0.01;
  switch (sound) {
    case "chime":
      note(ac, { type: "sine", freq: 880, start: t, duration: 0.12 });
      note(ac, { type: "sine", freq: 1320, start: t + 0.12, duration: 0.12 });
      break;
    case "pop":
      note(ac, {
        type: "sine",
        freq: 600,
        endFreq: 200,
        start: t,
        duration: 0.08,
      });
      break;
    case "ding":
      note(ac, { type: "triangle", freq: 1046, start: t, duration: 0.4 });
      break;
    case "double":
      note(ac, { type: "sine", freq: 740, start: t, duration: 0.09 });
      note(ac, { type: "sine", freq: 740, start: t + 0.16, duration: 0.09 });
      break;
    case "none":
      break;
  }
}

/**
 * Play a sound. Never throws: when the browser has no Web Audio or blocks
 * playback (autoplay policy before any user gesture), it stays silent.
 */
export function playIncomingSound(sound: IncomingSound): void {
  if (sound === "none") return;
  try {
    const ac = audioContext();
    if (!ac) return;
    if (ac.state === "suspended") {
      // Without a prior user gesture, resume() can stay pending until the
      // next click; a sound that late would be confusing, so drop it.
      const requestedAt = Date.now();
      ac.resume()
        .then(() => {
          if (Date.now() - requestedAt > 1000) return;
          try {
            schedule(ac, sound);
          } catch {
            /* silent */
          }
        })
        .catch(() => {
          /* blocked by autoplay policy: stay silent */
        });
      return;
    }
    schedule(ac, sound);
  } catch {
    /* no audio: stay silent */
  }
}
