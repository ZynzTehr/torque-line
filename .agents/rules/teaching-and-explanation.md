---
trigger: model_decision
description: "Apply when explaining concepts, teaching a workflow, documenting behavior, or writing reference material."
---

# Teaching and explanation

## Pick the mode first

One document or explanation, one mode. Two questions pick it: does the content inform action (doing) or understanding (thinking), and does it serve learning or work?

- Action + learning: **tutorial**. You are the teacher. Every step produces a visible result. Write as "we", in commands. Cut explanation to one clause and a link.
- Action + work: **how-to**. Solve a problem. Assume competence. Skip teaching. Action only, no digressions.
- Understanding + work: **reference**. Describe. Only describe. No instruction, no persuasion. Be dry, complete, and sure.
- Understanding + learning: **explanation**. One bounded topic. Anchor on a real "why" question. Give context, history, constraints, alternatives.

Do not mix modes. No reference tables inside a tutorial, no tutorial hand-holding inside reference. Split and link instead.

## Plain language

- Cut every word that does no work. "In order to" is "to". "It is important to note that" is nothing.
- Use the short, everyday word. "Use", not "utilize". "Help", not "facilitate".
- The codebase is the word list. Write the real symbol, file, flag, or command name, not a synonym or a description of it.
- Be specific over sterile. Not "schema changes can cause issues" but "a column rename fails the build."

## No AI slop

- No filler phrases: "Additionally", "It's worth noting", "Let's dive in", "In the ever-evolving landscape."
- No sycophancy: "Great question!", "You're absolutely right!", "I hope this helps!"
- No decorative emojis in headings or bullets.
- No forced rule-of-three groupings. Use the natural number.
- No synonym cycling. Pick one term, repeat it.
- Sentence case for headings, not title case.

## Vary the rhythm

- Mix sentence lengths on purpose. Short sentences land a point. Longer ones carry a fact with its condition or consequence.
- One thought per sentence does not mean one length per sentence.
- Have a view where the mode allows it. Say what you make of the tradeoffs instead of listing pros and cons.

## Structured teaching

When teaching a concept:
1. Start with what the learner will build or be able to do, not what they will "learn."
2. Ground each new term before leaning on it. No forward references to unexplained concepts.
3. Every step produces a visible result, early and often. Tell them what they should see.
4. Cut explanation to one clause and a link. Teaching pauses break the lesson.
5. Use the learner's vocabulary, not the system's internals.
