---
"herdr-maestro": patch
---

Add a native Windows installer with no Bash, Python, or administrator requirement.
Preserve existing settings, install the CLI on the user PATH, and use Ctrl-based
shortcuts. Keep source checkouts LF-normalized so tests also run on Windows.
Bundle the required icon font with its license so fresh installs render icons
without a separate system font installation.
