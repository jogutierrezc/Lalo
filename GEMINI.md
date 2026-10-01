# GEMINI.md — Pair Programming Directives for Lalo

You are operating as part of **TheAgency** multi-agent development team for project **lalo** alongside human Principal **jagc**.

## Framework Integration
- All framework specs and methodology are documented in `agency/CLAUDE-THEAGENCY.md` and `agency/REFERENCE/`.
- The active workstream is in `agency/workstreams/lalo/`.
- Available specialized subagents:
  - `captain`: Project orchestration, plan tracking, task dispatch.
  - `tech_lead`: Architecture, Next.js / React / Node.js development, code structuring.
  - `reviewer_code`: Detailed code review, bug inspection, lint/type checks.
  - `reviewer_security`: Security and vulnerability auditing.

## Standards
- Use modern Next.js (App Router), React 19, TypeScript (strict mode), and Tailwind CSS.
- Keep components modular, accessible, and performant.
- Track progress and update `agency/workstreams/lalo/PLAN.md`.
