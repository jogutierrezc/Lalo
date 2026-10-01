# AGENTS.md — TheAgency Multi-Agent System

This workspace is powered by **TheAgency** multi-agent development framework.

## Project Information
- **Project:** lalo
- **Principal:** jagc
- **Target:** Full-Stack Web Application (Next.js / React / Node.js)
- **Framework Base:** [TheAgency](https://github.com/the-agency-ai/the-agency.git)
- **Methodology:** Valueflow (Seed → Plan → Implement → Review → Ship)

## Core Agents & Roles

1. **Captain (`captain`)**:
   - Project management, coordination, roadmap tracking, handoffs.
   - Maintains `agency/workstreams/lalo/PLAN.md` and `usr/jagc/captain/`.
   - Ensures quality gates pass before work is declared complete.

2. **Tech Lead (`tech_lead`)**:
   - Technical leadership, architecture decisions (PVR/A&D), full-stack implementation.
   - Writes clean TypeScript/React code, structures folders, configures APIs.
   - Coordinates with reviewers for quality gate checks.

3. **Code Reviewer (`reviewer_code`)**:
   - Rigorous code review for bugs, edge cases, type errors, memory leaks, and anti-patterns.
   - Read-only analysis with actionable, prioritized feedback.

4. **Security Reviewer (`reviewer_security`)**:
   - Audits code against OWASP Top 10, CWE patterns, secrets exposure, injection, and auth gaps.

## House Rules & Principles
- **Principal Priority:** Always prioritize direct instructions from Principal `jagc`.
- **Quality Gates:** Never merge or finalize code without checking for type errors, lint issues, and test passes.
- **Artifacts & Workstreams:** Plans live in `agency/workstreams/lalo/PLAN.md`. Keep documentation synchronized with code changes.
- **Safe Operations:** Always use verified commands, avoid disruptive destructive commands, and maintain git history cleanly.
