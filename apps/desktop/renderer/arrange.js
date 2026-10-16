function wheelAction({ deltaX = 0, deltaY = 0, shiftKey = false, ctrlKey = false }) {
  const horizontal = Math.abs(deltaX) > Math.abs(deltaY);
  if (ctrlKey) return { type: "zoom", delta: deltaY };
  if (horizontal || shiftKey) return { type: "pan", delta: horizontal && !shiftKey ? deltaX : deltaY };
  return { type: "zoom", delta: deltaY };
}

function clipSpan(clip) {
  return Math.max(0, Number(clip.out) - Number(clip.in));
}

function clipEnd(clip) {
  return Number(clip.start) + clipSpan(clip);
}

function splitTracks(tracks, time, nextId) {
  let count = 0;
  const next = tracks.map((track) => {
    const clips = [];
    for (const clip of track.clips) {
      const end = clipEnd(clip);
      if (time > clip.start + 0.05 && time < end - 0.05) {
        const local = clip.in + (time - clip.start);
        clips.push({ ...clip, out: local });
        clips.push({ ...clip, id: nextId(), in: local, start: time });
        count += 1;
      } else {
        clips.push(clip);
      }
    }
    return { ...track, clips };
  });
  return { tracks: next, count };
}

function trimClip(clip, side, time) {
  const end = clipEnd(clip);
  const source = Number(clip.sourceDuration) || end;
  if (side === "start") {
    const earliest = clip.start - clip.in;
    const nextStart = Math.min(end - 0.05, Math.max(earliest, time));
    const delta = nextStart - clip.start;
    return { ...clip, start: nextStart, in: clip.in + delta };
  }
  const latest = clip.start + (source - clip.in);
  const nextEnd = Math.max(clip.start + 0.05, Math.min(latest, time));
  return { ...clip, out: clip.in + (nextEnd - clip.start) };
}

function moveClip(clip, start) {
  return { ...clip, start: Math.max(0, start) };
}

function hitOnTrack(clips, time, secondsPerPixel) {
  const edge = Math.max(0.04, secondsPerPixel * 8);
  for (let index = clips.length - 1; index >= 0; index -= 1) {
    const clip = clips[index];
    const end = clipEnd(clip);
    if (time < clip.start - edge || time > end + edge) continue;
    if (Math.abs(time - clip.start) <= edge) return { index, edge: "start" };
    if (Math.abs(time - end) <= edge) return { index, edge: "end" };
    if (time >= clip.start && time <= end) return { index, edge: null };
  }
  return null;
}

const api = { wheelAction, clipSpan, clipEnd, splitTracks, trimClip, moveClip, hitOnTrack };

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.arrange = api;
