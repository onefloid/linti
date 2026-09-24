---
title: LinTi
description: Lint TM1 TurboIntegrator scripts with actionable findings.
---

::u-page-hero
#title
Lint your TurboIntegrator code

#description
LinTi checks TM1 TurboIntegrator scripts for formatting mistakes, naming conventions, and subtle code-quality issues. Its rule reference and interactive examples run entirely in your browser.

#links
  :::u-button
  ---
  to: /rules
  size: xl
  icon: i-lucide-list-filter
  ---
  Explore the rules
  :::

  :::u-button
  ---
  to: https://github.com/deutschebahn/linti
  target: _blank
  size: xl
  color: neutral
  variant: outline
  icon: i-simple-icons-github
  ---
  Source on GitHub
  :::
::

::u-page-section
#title
What LinTi checks

#description
Every rule has a stable ID, an explanation, and examples you can edit and run.

#body
  :::u-page-grid
    ::::u-page-card
    ---
    title: Code quality
    description: Catch misplaced TI functions, empty blocks, unreachable code, and other logic smells.
    icon: i-lucide-shield-check
    to: /rules?group=C
    spotlight: true
    ---
    ::::

    ::::u-page-card
    ---
    title: Formatting
    description: Keep keyword casing, whitespace, and indentation consistent across processes.
    icon: i-lucide-align-left
    to: /rules?group=F
    spotlight: true
    ---
    ::::

    ::::u-page-card
    ---
    title: Naming conventions
    description: Enforce variable prefixes, consistent casing, and parameter naming.
    icon: i-lucide-tag
    to: /rules?group=N
    spotlight: true
    ---
    ::::

    ::::u-page-card
    ---
    title: External interactions
    description: Flag shell commands, hardcoded secrets, and inefficient ODBC access.
    icon: i-lucide-plug
    to: /rules?group=X
    spotlight: true
    ---
    ::::

    ::::u-page-card
    ---
    title: Auto-fix
    description: Safe findings are fixed for you with linti --auto-fix.
    icon: i-lucide-wand-sparkles
    to: /rules
    spotlight: true
    ---
    ::::

    ::::u-page-card
    ---
    title: Runs in your browser
    description: The playground runs the real Python rules with Pyodide. Code is not sent to a server.
    icon: i-lucide-monitor-play
    to: /rules
    spotlight: true
    ---
    ::::
  :::
::

::u-page-section
#title
Install the CLI

#body
  ```bash
  pip install linti
  linti path/to/process.ti
  ```
::
