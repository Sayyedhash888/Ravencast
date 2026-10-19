"""Original CC0 combat/footstep samples.

These are synthesised from noise and sine partials here, not sampled from
anyone else's recordings, so they are safe to ship with the project. They sound
richer than the real-time versions because there is no per-hit CPU budget.

    python tools/sfx_synth.py            # writes WAVs to tools/sfx_src
    ffmpeg -i footstep_1.wav -codec:a libmp3lame -b:a 128k footstep_1.mp3

Encode the WAVs into public/assets/audio/sfx/*.mp3 afterwards (see
README > Audio). The intermediates live outside public/ so the build does not
ship them.

The game loads the mp3s from public/assets/audio/sfx/ and falls back to the
runtime synth in Audio.js if they are missing, so replacing any file with a
CC0 sample of the same name (Kenney RPG Audio, OpenGameArt, ...) just works.
"""
import os
import wave

import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "tools", "sfx_src")


def fft_band(x, lo, hi, soft=0.35):
    """Soft-edged band-pass via FFT; fine for one-shot samples."""
    n = len(x)
    spec = np.fft.rfft(x)
    freq = np.fft.rfftfreq(n, 1 / SR)
    lo0, lo1 = lo * (1 - soft), lo * (1 + soft)
    hi0, hi1 = hi * (1 - soft), hi * (1 + soft)
    mask = np.clip((freq - lo0) / max(lo1 - lo0, 1e-9), 0, 1)
    mask *= np.clip((hi1 - freq) / max(hi1 - hi0, 1e-9), 0, 1)
    return np.fft.irfft(spec * mask, n)


def env(n, attack, decay):
    t = np.arange(n) / SR
    return (1 - np.exp(-t / max(attack, 1e-5))) * np.exp(-t / max(decay, 1e-5))


def norm(x, peak=0.9):
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 0 else x


def write(name, data):
    if data.ndim == 1:
        data = np.stack([data, data], axis=1)
    pcm = (np.clip(data, -1, 1) * 32767).astype("<i2")
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + ".wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print("wrote", path)


# ------------------------------------------------------------------ footsteps

def footstep(seed, dur=0.28, centre=520, thump=82, decay=0.10):
    """A soft scuff/thud: low-mid noise, a gentle sub thump and a little cloth.

    No high grit - on short MP3s that reads as a metallic tick, which is what
    turned the first version into "hammering metal".
    """
    rng = np.random.default_rng(seed)
    n = int(SR * dur)
    t = np.arange(n) / SR

    body = fft_band(rng.standard_normal(n), 140, 950)
    body *= env(n, 0.008, decay) * 0.72

    lowmid = fft_band(rng.standard_normal(n), 80, 260)
    lowmid *= env(n, 0.010, decay * 1.4) * 0.3

    low = np.sin(2 * np.pi * thump * t) * env(n, 0.006, 0.075) * 0.18

    cloth = fft_band(rng.standard_normal(n), 1500, 3200)
    cloth *= env(n, 0.012, 0.045) * 0.028

    x = body + lowmid + low + cloth
    right = body * 0.96 + lowmid * 1.04 + low + cloth * 1.2
    return norm(np.stack([x, right], axis=1), 0.55)


# -------------------------------------------------------------------- swings

def swing(seed, dur=0.32):
    rng = np.random.default_rng(seed)
    n = int(SR * dur)
    t = np.arange(n) / SR

    def gust(centre, width):
        return np.exp(-((t - centre) / width) ** 2)

    noise = rng.standard_normal(n)
    low = fft_band(noise, 160, 620) * gust(0.10, 0.048) * 0.9
    mid = fft_band(noise, 520, 1900) * gust(0.15, 0.045) * 1.05
    high = fft_band(noise, 1500, 5400) * gust(0.19, 0.034) * 0.75

    whoosh = (low + mid + high) * env(n, 0.018, 0.15)

    freq = 250 * np.exp(-t * 6.5) + 95
    phase = 2 * np.pi * np.cumsum(freq) / SR
    air = np.sin(phase) * env(n, 0.01, 0.10) * 0.055

    x = whoosh + air
    # 0.6 ms inter-channel delay gives the blade some width
    d = int(SR * 0.0006)
    right = np.concatenate([np.zeros(d), x[:-d]]) * 0.94
    return norm(np.stack([x, right], axis=1), 0.85)


# ---------------------------------------------------------------------- hits

def hit(seed, heavy=False):
    rng = np.random.default_rng(seed)
    dur = 0.55 if heavy else 0.38
    n = int(SR * dur)
    t = np.arange(n) / SR

    partials = ([318, 886, 1670, 2890] if heavy else [430, 1180, 2120, 3180])
    x = np.zeros(n)
    for i, f in enumerate(partials):
        det = 1 + (rng.random() - 0.5) * 0.012
        decay = (0.16 if heavy else 0.10) * (0.75 + i * 0.22)
        x += np.sin(2 * np.pi * f * det * t + rng.random() * 6.28) \
            * np.exp(-t / decay) * (0.9 / (1 + i * 0.55))

    thump = np.sin(2 * np.pi * (120 if heavy else 150) * t) * env(n, 0.001, 0.06) * 0.65

    crack = fft_band(rng.standard_normal(n), 1100, 6200) * env(n, 0.0008, 0.018) * 0.85

    x = x + thump + crack
    return norm(np.stack([x, x * 0.97], axis=1), 0.92)


if __name__ == "__main__":
    for i in range(4):
        write(f"footstep_{i + 1}", footstep(11 + i, centre=620 + i * 70,
                                            thump=84 + i * 7, decay=0.05 + i * 0.006))
    for i in range(3):
        write(f"swing_{i + 1}", swing(31 + i, dur=0.28 + i * 0.03))
    write("hit_1", hit(61, heavy=False))
    write("hit_2", hit(62, heavy=True))
