---
name: hyperframes
description: Create, edit, animate, preview, and render programmatic video compositions, motion graphics, explainer clips, captions, and title cards using HyperFrames and HTML/CSS. Use for /hyperframes, "hyperframes", "render video", "HTML video", "motion graphic", "changelog video", "captions overlay", "video animation".
license: Apache-2.0
metadata:
  source: original
  status: stable
  reviewed: 2026-10-07
---

# HyperFrames

Create, animate, and render video programmatically using standard HTML, CSS, and modern web animation standards. HyperFrames allows agents to compose video sequences with familiar web technologies and render them headless to MP4/WebM.

## Core concepts

- **Compositions:** Defined in HTML and CSS with semantic containers and tracks.
- **Timing attributes:**
  - `data-start`: Time offset in seconds where the clip or layer begins.
  - `data-duration`: Duration in seconds for the clip or animation segment.
  - `data-playback-rate`: Speed factor for media playback and pitch-preserved audio.
- **Animation standards:** Animate elements using CSS keyframes, Web Animations API (WAAPI), or GSAP.

## Project workflows

### 1. Initialization and project setup
Initialize a HyperFrames project or component:
```bash
npx hyperframes init [project-dir]
```

### 2. Live preview and studio
Launch the local studio preview server to inspect animations in real time:
```bash
npx hyperframes dev
```

### 3. Rendering deliverables
Render the composition headlessly to video:
```bash
npx hyperframes render --output dist/video.mp4
```

## Motion and layout doctrine

- **Track separation:** Keep visual layers, text overlays, captions, and background music on separated track containers.
- **Transforms over layout shifts:** Animate `transform` (scale, translate, rotate) and `opacity` rather than top/left/width/height to guarantee frame-perfect 60fps rendering.
- **Safe margins:** Respect 16:9 (1920x1080) and 9:16 vertical safe margins for captions and critical text.
- **Audio automation:** Apply smooth volume envelopes and crossfades to avoid audio clipping between scene transitions.
