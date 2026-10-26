---
trigger: glob
globs: "**/*.html, **/*.css, **/*.tsx, **/*.jsx, **/*.vue, **/*.svelte"
description: "Apply when creating or reviewing user interfaces, markup, styling, keyboard navigation, or assistive technology support."
---

# Accessibility

Accessibility is not a feature you bolt on at the end. It is a quality floor, like responsive layout or keyboard support. Build it in from the start.

## Semantic HTML

- Use the right element for the job. `<button>` for actions, `<a>` for navigation, `<nav>` for navigation containers, `<main>` for primary content, `<article>` for self-contained content.
- Do not use `<div>` or `<span>` with click handlers when a semantic element exists. A `<div onClick>` is not a button. It has no keyboard support, no focus ring, no screen reader announcement.
- Use heading hierarchy (`h1` through `h6`) in order, without skipping levels. One `h1` per page.
- Lists are `<ul>`, `<ol>`, or `<dl>`. Not divs with bullet-point styling.

## Keyboard navigation

- Every interactive element must be reachable and operable with the keyboard alone.
- Visible focus indicators on all focusable elements. Never `outline: none` without a replacement.
- Logical tab order that follows the visual flow. Use `tabindex="0"` to make custom elements focusable, `tabindex="-1"` to make elements programmatically focusable but not in the tab order. Never use `tabindex` values greater than 0.
- Trap focus inside modals and dialogs. Return focus to the trigger element when closing.

## ARIA

- Use ARIA only when native HTML semantics are insufficient. The first rule of ARIA is: don't use ARIA if you can use a native HTML element.
- Every image has an `alt` attribute. Decorative images get `alt=""`. Informative images get a description of what the image conveys, not what it looks like.
- Form inputs have associated `<label>` elements or `aria-label`. Placeholder text is not a label.
- Dynamic content updates use `aria-live` regions. Status messages, toast notifications, and loading indicators announce themselves to screen readers.
- Interactive custom components need appropriate `role`, `aria-expanded`, `aria-selected`, `aria-checked`, etc.

## Motion and perception

- Respect `prefers-reduced-motion`. Wrap all non-essential animations in a media query check. Provide a static fallback.
- Respect `prefers-color-scheme` when offering dark mode.
- Color is never the only indicator of state. Pair color with icons, text, patterns, or position.
- Minimum contrast ratios: 4.5:1 for normal text, 3:1 for large text (18pt / ~24px, or 14pt bold / ~18.67px), 3:1 for UI components and graphical objects.

## Touch targets

- Minimum touch target size: 44x44px for mobile, 24x24px for desktop.
- Adequate spacing between adjacent interactive elements to prevent mis-taps.

## Testing

- Tab through every page with the keyboard. If you cannot complete the core flow without a mouse, the page is broken.
- Use the browser's accessibility inspector or a tool like axe-core to catch common violations.
- Test with screen reader narration in mind: does the announced content make sense without seeing the page?
