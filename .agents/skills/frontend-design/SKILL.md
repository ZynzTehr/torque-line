---
name: frontend-design
description: Interface craft for new or redesigned UI once its direction is chosen, including composition, typography, imagery, color, motion, and interface writing. Apply the product brief without repeating approved discovery; to set the direction of a substantial new interface, use creative-direction first.
license: Apache-2.0
metadata:
  source: https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design/skills/frontend-design
  changes: modified
  status: stable
  reviewed: 2026-10-04
---

# Frontend Design

Make deliberate choices that give this product its own identity. Use the user's brief and established decisions. This skill owns visual craft; it does not restart product discovery or concept selection already completed in the surrounding workflow.

## Ground the design in its subject

The audience, primary task, domain language, materials, and real content should determine the design. Inspect existing product identity before changing it. If a consequential part of the brief is missing, identify the gap and propose a concrete direction. Do not invent a client history or assume that an unfamiliar style has been rejected.

Open with the most characteristic thing in the subject's world, in the form that serves the visitor: a headline, image, live task, demonstration, animation, or interactive moment. Design the rest of the journey with equal intent. A working application needs clear repeated actions and useful states; a narrative website may use a sequence of scenes to develop its idea.

## Choose a coherent visual language

Use the selected expression level, whether restrained, expressive, or immersive. Each can be professionally finished. Establish a visual hierarchy that tells the viewer where to look and what to do. Quiet supporting elements can strengthen a focal point; several coordinated focal moments can serve a longer narrative. Let the brief determine the intensity and sequence.

Typography carries personality and hierarchy. Choose typefaces for this subject, their legibility, available weights, language coverage, and delivery cost. Define roles, a type scale, spacing, and intentional weights and widths. One family can be sufficient; additional families need distinct jobs. Treat display type as part of the composition while keeping body content comfortable to read. Around 45–80 characters per line is a useful starting point for body text, adjusted for the typeface and audience.

Build color around the subject and actual content. Define a compact palette with named values and semantic roles, including interactive states. Check contrast in the combinations the interface uses. No palette, font category, border style, or layout is inherently original or inherently unsuitable. Explain why the choice belongs here.

Give imagery and other assets a compositional role. Specify crop, subject placement, aspect ratio, focal point, responsive behavior, and any relationship to typography or motion. Generic filler weakens a specific idea. If representative assets are unavailable, mark that limitation and revisit the composition with the intended material.

Use layout, spacing, alignment, and scale to express hierarchy. Avoid cutting unrelated content into identical containers merely for implementation convenience. Repetition is useful when the content has a repeated role; variation is useful when it communicates a different role. Borders, numbering, labels, and other structural devices should convey information. Number a sequence because it is a sequence.

## Design motion as behavior

Define what triggers important movement, what it communicates, where it settles, and how it responds to interruption. Motion may reveal a relationship, provide feedback, express character, or pace a narrative. Coordinate its rhythm with the rest of the experience. Repeated generic entrances and arbitrary hover effects do not substitute for a motion concept.

Match the interaction to its inputs. A pointer effect needs an intentional touch experience; a scroll sequence needs usable navigation and appropriate reduced-motion behavior. Keep essential content and actions available without optional motion or media. Evaluate timing and responsiveness in the running interface, including repeated use.

## Plan, build, and critique

Make the selected direction concrete before extending it across the interface:

- **Color and type.** Named palette roles, typefaces, scale, and key states.
- **Composition.** Layout, hierarchy, alignment, density, and mobile adaptation. Sketches or wireframes can resolve structure; representative renders can resolve visual balance.
- **Assets and content.** The real material, its treatment, and any remaining dependency.
- **Interaction.** Important behaviors, triggers, feedback, motion, and fallback states.
- **Identity.** The specific organizing idea and how these choices express it.

Keep this in the existing design artifact when there is one. For a small change, a brief decision is enough. If the direction is still unresolved, use the surrounding workflow's comparison step rather than quietly committing to the first layout. Do not repeat an approved exploration.

Critique concrete renders against the brief. Identify where hierarchy, imagery, density, copy, or behavior makes the product less clear or less specific, and revise that part. Looking different from a familiar template is not sufficient: choices must help this product. Preserve work the user values. Check desktop and mobile composition, actual interactions, visible focus, and reduced motion with available tools; state verification limits.

Keep CSS structure understandable so selector conflicts do not undermine deliberate spacing, layout, or states. Use the project's existing styling conventions unless the requested design requires a scoped change.

## Write for the experience

Words are design content. Use the product's real vocabulary and write from the visitor's perspective. A brand headline can be evocative when the concept supports it; navigation, actions, and status messages still need to be understandable. Match the voice to the audience and surface.

A CTA describes its action: “Save changes” is more informative than “Submit.” Keep action names consistent through the flow so “Publish” produces “Published.” Explain failures and empty states with a useful next step. Do not expose implementation terms unless they help the user make a decision.

Use active verbs, specific content, and enough detail to be credible. Treat capitalization, tone, and typographic emphasis as design choices rather than universal bans. Remove filler that competes with the message.
