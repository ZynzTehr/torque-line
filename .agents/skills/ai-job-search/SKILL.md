---
name: ai-job-search
description: Assists with job applications, evaluating job postings, tailoring CVs and resumes, writing cover letters, and preparing for interviews. Triggers on keywords like /job-search, "job search", "job application", "tailor CV", "cover letter", "resume", "interview prep", "job fit", "evaluate posting".
license: MIT
metadata:
  source: original
  status: stable
  reviewed: 2026-10-07
---

# AI Job Search

An intelligent framework for evaluating career opportunities, tailoring application materials, and preparing for interviews.

## Application workflow

When provided with a job posting (URL or text) and a candidate profile, execute this structured sequence:

### 1. Research and evaluate fit
- **Extract job posting details:** Record company name, role title, required technical competencies, preferred qualifications, and mission.
- **Background research:** Inspect company website, product offerings, engineering culture, and recent news.
- **Match evaluation:** Score alignment between candidate background and job requirements across core technical skills, domain experience, and leadership.
- **Gap analysis:** Identify gaps and formulate honest talking points or mitigations.

### 2. Tailor CV / Resume
- **Headline & Summary:** Align the candidate summary statement directly with the role's primary mission.
- **Experience bullets:** Reorder and emphasize bullet points demonstrating quantified business impact directly related to the employer's tech stack.
- **Skill prioritization:** Group and highlight relevant technologies, placing required proficiencies prominently.
- **Honesty invariant:** Never fabricate achievements, companies, or credentials; emphasize authentic strengths.

### 3. Draft tailored cover letter
- **Opening:** Lead with specific enthusiasm for the company's product or engineering challenge; avoid generic openings ("I am writing to apply for...").
- **Body:** Connect 2-3 specific past achievements directly to problems the hiring team is solving.
- **Tone:** Confident, collaborative, and free of AI cliches or exaggerated claims.
- **Call to action:** Reiterate excitement for a technical conversation and next steps.

### 4. Interview preparation
- **STAR framework:** Prepare concrete Situation, Task, Action, Result stories for common behavioral questions.
- **Technical deep-dives:** Formulate talking points around complex architecture decisions, trade-offs, and failure recoveries.
- **Reverse questions:** Prepare 3-5 thoughtful questions for the interview team about team structure, engineering velocity, and technical roadmaps.
