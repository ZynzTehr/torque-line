---
name: taste-skill
description: Anti-slop frontend design framework for landing pages, portfolios, and redesigns. Reads the room before styling, infers design direction, avoids generic AI templates, and provides opinionated design archetypes (brutalist, minimalist, retro). Use for /taste-skill, "taste-skill", "frontend taste", "anti-slop UI", "design landing page", "portfolio design", "redesign UI".
license: MIT
metadata:
  source: original
  status: stable
  reviewed: 2026-10-07
---

# Taste Skill

An anti-slop frontend design framework for creating distinctive landing pages, portfolios, and marketing sites that avoid generic AI-generated design patterns.

## Brief inference: Read the room first

Before writing CSS or markup, infer the user's intended aesthetic from the domain context:
- **Product type:** Developer tool, luxury brand, B2B enterprise, consumer app, or creative studio.
- **Tone:** Technical and dense, calm and editorial, bold and brutalist, or playful and vibrant.
- **Audience:** Engineers expect high density, monospace accents, and zero marketing fluff; consumers expect warm contrast, clear value props, and intuitive hierarchy.

## Anti-slop rules

1. **Banish default AI fonts:** Avoid defaulting to Inter or Roboto everywhere without intent. Pair characterful display typefaces with readable body fonts (e.g., Space Grotesk, Syne, Clash Display, Newsreader, Geist).
2. **Eliminate generic AI palettes:** No default purple-blue gradients on dark gray cards unless requested. Build curated HSL palettes with distinct contrast ratios and intentional accent colors.
3. **Break the three-card grid:** Do not default every feature section to three identical rectangular cards with a small centered icon. Use asymmetric bento grids, split comparison rows, or progressive disclosure lists.
4. **Authentic copy over stock placeholders:** Use domain-specific terms, realistic metrics, and actual technical examples instead of "Acme Corp" or "Jane Doe".

## Curated design archetypes

- **Minimalist / Editorial:** Generous whitespace, refined serif/sans pairing, muted monochrome palette with single sharp accent, high typographical hierarchy.
- **Technical / Developer:** Dark-first, compact spacing, tabular numbers, monospace accents, subtle borders, syntax-highlighted code blocks, visible system status.
- **Brutalist / Expressive:** High-contrast borders, raw geometry, bold typography, monochromatic foundations with saturated pop accents, exposed layout structures.
- **Craft / Warm:** Soft natural tones, tactile subtle borders, warm off-white backgrounds, smooth micro-interactions, rich organic textures.

## Pre-flight verification checklist

- [ ] Distinctive typography with readable body scale.
- [ ] Accessible color contrast meeting WCAG AA standards.
- [ ] Responsive layouts that adapt gracefully across mobile, tablet, and desktop breakpoints.
- [ ] No generic AI stock cliches or repetitive card grids.
