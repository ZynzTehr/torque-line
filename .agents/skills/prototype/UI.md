# UI Prototype

Compare structurally different UI variations when composition or hierarchy is unresolved. Use a shared route or scratch artifact with a small switcher so the options can be judged under the same conditions. Reuse an approved direction; do not generate alternatives merely to satisfy this procedure.

For logic or state, use [LOGIC.md](LOGIC.md). For how a chosen interaction feels, use [INTERACTION.md](INTERACTION.md).

<!-- reference-contents:start -->
## Contents

- [When this is the right shape](#when-this-is-the-right-shape)
- [Choose the comparison context](#choose-the-comparison-context)
  - [Sub-shape A: adjustment to an existing page (preferred)](#sub-shape-a-adjustment-to-an-existing-page-preferred)
  - [Sub-shape B: an independent page or scratch artifact](#sub-shape-b-an-independent-page-or-scratch-artifact)
- [Process](#process)
  - [1. State the question and pick N](#1-state-the-question-and-pick-n)
  - [2. Generate radically different variants](#2-generate-radically-different-variants)
  - [3. Wire them together](#3-wire-them-together)
  - [4. Build the floating switcher](#4-build-the-floating-switcher)
  - [5. Compare the evidence](#5-compare-the-evidence)
  - [6. Capture the answer and clean up](#6-capture-the-answer-and-clean-up)
- [Anti-patterns](#anti-patterns)
<!-- reference-contents:end -->

## When this is the right shape

- "What should this page look like?"
- "I want to see a few options for this dashboard before committing."
- "Try a different layout for the settings screen."
- Any time the user would otherwise spend a day picking between three vague mockups in their head.

## Choose the comparison context

Apply the [prototype context criteria](SKILL.md#choose-the-context). Use the host page when its navigation, data, or density affects the decision. Use a new route or scratch artifact when there is no relevant host or the experiment is independent. Keep the comparison faithful to the context it claims to evaluate.

### Sub-shape A: adjustment to an existing page (preferred)

The route already exists. Variants are rendered **on the same route**, gated by a `?variant=` URL search param. The existing data fetching, params, and auth all stay. Only the rendering swaps. This is the default; pick it unless there's a specific reason not to.

If the prototype is for something that doesn't yet have a page but *would naturally live inside one* (a new section of the dashboard, a new card on the settings screen, a new step in an existing flow), it's still sub-shape A. Mount the variants inside the host page.

### Sub-shape B: an independent page or scratch artifact

Use this for a new surface with no relevant host, or an independent composition study. Choose the lightest stack that preserves the question. Record what host integration remains untested.

Inside an existing project, create a development-only route following its routing convention. For a scratch artifact, keep it separate from production source. Name it so it is visibly a prototype. Use the same `?variant=` pattern where practical.

Include representative content and surroundings when they affect the comparison. An empty page cannot establish how a dense workflow will feel.

In both sub-shapes the floating bottom bar is identical.

## Process

### 1. State the question and pick N

Two or three variants usually expose meaningful tradeoffs. Build only enough to answer the unresolved choice. If the direction is already approved, skip this comparison and implement it or test its specific interaction.

Write down the plan in one line, in the prototype's location or a top-of-file comment:

> "Three variants of the settings page, switchable via `?variant=`, on the existing `/settings` route."

This works whether the user is here to push back or not.

### 2. Generate radically different variants

Draft each variant. Hold each one to:

- The page's purpose and the data it has access to.
- The project's component library and styling conventions when hosted; the selected experiment stack when independent.
- A clear exported component name, e.g. `VariantA`, `VariantB`, `VariantC`.

Variants must be **structurally different**: different layout, different information hierarchy, different primary affordance, not just different colours. Three slightly-tweaked card grids isn't a UI prototype, it's wallpaper. If two drafts come out too similar, redo one with explicit "do not use a card grid" guidance.

### 3. Wire them together

Create a single switcher component on the route:

```tsx
// pseudo-code, adapt to the project's framework
const variant = searchParams.get('variant') ?? 'A';
return (
  <>
    {variant === 'A' && <VariantA {...data} />}
    {variant === 'B' && <VariantB {...data} />}
    {variant === 'C' && <VariantC {...data} />}
    <PrototypeSwitcher variants={['A','B','C']} current={variant} />
  </>
);
```

For sub-shape A (existing page): keep all the existing data fetching above the switcher; only the rendered subtree changes per variant.

For sub-shape B, the development route or scratch artifact mounts the same switcher pattern. Follow the project's route conventions rather than requiring a particular prototype path.

### 4. Build the floating switcher

A small fixed-position bar at the bottom-centre of the screen with three pieces:

- **Left arrow**: cycles to the previous variant (wraps around).
- **Variant label**: shows the current variant key and, if the variant exports a name, that name too. e.g. `B (Sidebar layout)`.
- **Right arrow**: cycles forward (wraps around).

Behaviour:

- Clicking an arrow updates the URL search param (use the framework's router, e.g. `router.replace` on Next, `navigate` on React Router, etc) so the variant is shareable and reload-stable.
- Keyboard: make the switcher's buttons focusable with clear accessible names. Optional `←` and `→` shortcuts operate only while the switcher is focused; do not steal keys from inputs or the interface being evaluated.
- Visually distinct from the page (e.g. high-contrast pill, subtle shadow) so it's obviously not part of the design being evaluated.
- Gate the entire experiment, including variant selection and controls, out of production using the project's development check. Hiding only the bar still leaves alternate variants reachable by URL. Keep an independent scratch artifact outside production build inputs.

Keep the switcher local to the experiment unless an existing prototype utility already provides it. A scratch artifact does not need to introduce a new shared component into the product.

### 5. Compare the evidence

Inspect each variant at the relevant desktop and mobile sizes with representative content. Drive its primary action and compare against the brief's task and identity. Surface the URL, variant keys, useful captures, tradeoffs, and recommendation. Use the user's established priorities for routine decisions; request a choice only when a missing preference materially changes the result. A hybrid is useful when its parts form one coherent hierarchy.

### 6. Capture the answer and clean up

Once a variant has won, record which variant and why, its acceptance checks, and any unverified assumptions. Preserve useful evidence using the [prototype skill's capture guidance](SKILL.md#capture-the-decision). Carry the decision into production work:

- **Sub-shape A**: implement the winner in the existing page under normal production checks.
- **Sub-shape B**: implement the winner in its intended host and verify the integration the scratch artifact did not exercise.

Keep temporary variants and controls out of the shipped interface. Preserve user work and useful decision evidence when cleaning up; follow the canonical skill's scope and authorization guidance.

## Anti-patterns

- **Variants that differ only in colour or copy.** That's a tweak, not a prototype. Real variants disagree about structure.
- **Sharing too much code between variants.** A shared `<Header>` is fine; a shared `<Layout>` defeats the point. Each variant should be free to throw out the layout.
- **Wiring variants to real mutations.** Read-only prototypes are fine. If a variant needs to mutate, point it at a stub: the question is "what should this look like", not "does the backend work".
- **Promoting the prototype directly to production.** The variant code was written under prototype constraints (no tests, minimal error handling). Rewrite it properly when you fold it in.
