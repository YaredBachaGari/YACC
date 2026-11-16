---
name: accessibility-checklist
description: "Use before opening or approving a pull request that changes a page: the accessibility checks it must pass."
---

# Accessibility checklist

Check every page your change touches:

- Everything works with the keyboard alone: Tab reaches each control in a sensible order, focus is always visible, Escape closes dialogs.
- Text contrast is at least 4.5:1 (3:1 for large text and icons that carry meaning).
- Every image has alt text (empty alt="" for decoration); every form field has a visible label.
- Headings go in order (one h1, then h2…), and links say where they go.
- Nothing flashes, and animations respect prefers-reduced-motion.
- The page still works at 200% zoom and 320px wide.

Note what you checked in the PR description.
