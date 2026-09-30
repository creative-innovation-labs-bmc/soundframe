export function sanitiseTrack(input = {}) {
  return {
    gain: Number.isFinite(input.gain) ? Math.max(0, Math.min(2, input.gain)) : 1,
    muted: input.muted === true,
    offset: Number.isFinite(input.offset) ? Math.max(0, Math.min(86400, input.offset)) : 0,
    loop: input.loop === true,
  };
}
// All decoded inputs use the AudioContext's sample rate. The podcast owns duration.
export function mixTracks(tracks, length, channels = 2) {
  const output = Array.from({length: channels}, () => new Float32Array(length));
  for (const track of tracks) {
    const {gain, muted, loop} = sanitiseTrack(track);
    if (muted || gain === 0 || !track.samples?.length) continue;
    const start = Math.max(0, Math.round(track.startFrame || 0));
    const sourceLength = track.samples[0].length;
    if (!sourceLength || start >= length) continue;
    const end = loop ? length : Math.min(length, start + sourceLength);
    for (let c = 0; c < channels; c++) {
      const source = track.samples[Math.min(c, track.samples.length - 1)];
      for (let i = start; i < end; i++) output[c][i] += source[(i - start) % sourceLength] * gain;
    }
  }
  let peak = 0;
  for (const channel of output) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  const reduction = peak > 0.98 ? 0.98 / peak : 1;
  if (reduction < 1) for (const channel of output) for (let i = 0; i < channel.length; i++) channel[i] *= reduction;
  return {samples: output, reduction};
}
export function encodeWav(channels, sampleRate) {
  const frames = channels[0].length, count = channels.length;
  const data = new ArrayBuffer(44 + frames * count * 2), view = new DataView(data);
  const word = (at, text) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  word(0, 'RIFF');view.setUint32(4, data.byteLength - 8, true);word(8, 'WAVE');word(12, 'fmt ');
  view.setUint32(16, 16, true);view.setUint16(20, 1, true);view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);view.setUint16(34, 16, true);word(36, 'data');view.setUint32(40, data.byteLength - 44, true);
  let at = 44;
  for (let frame = 0; frame < frames; frame++) for (let c = 0; c < count; c++) {
    const sample = Math.max(-1, Math.min(1, channels[c][frame]));
    view.setInt16(at, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);at += 2;
  }
  return data;
}
