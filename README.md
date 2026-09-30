# Soundframe

Published website assets for the SAVI audio-to-video editor.

The app processes audio and captions in the browser. Upload a podcast and SRT, then add background audio with independent volume, mute, offset and loop controls. Save your project to retain all tracks.

## Dynamic waveform update

Independent frequency bands drive the waveform contour from the mixed audio. The bars stay anchored while local peaks change with the sound. Preview, seeking and export use the same precomputed frames; there is no random animation or scrolling history. Smooth attack/release and neighbouring-band interpolation keep the thin SAVI bars fluid.

## Export settings

Export video opens resolution (540/720/1080), video quality and audio bitrate (128–320 kbps) controls, with approximate output size. Output preserves the canvas aspect ratio. Automatic format prefers H.264/AAC MP4; if unavailable, it uses WebM/Opus. Explicit MP4 is disabled when AAC recording is unavailable. The browser may produce a smaller file than the target bitrate suggests. Save the project before refreshing. Lowering export quality does not repair distortion in source recordings.

## Soundframe branding

Soundframe · Turn sound into stories. The app icon is an SVG frame containing three audio bars, shared by the header and favicon. SAVI remains the supplied episode template. The existing repository and live URL remain compatible with existing bookmarks.

## Live app

https://creative-innovation-labs-bmc.github.io/soundframe/

This is the current public website repository. The earlier /savi-audiogram/ app remains available for existing bookmarks. All browser assets use relative paths.
