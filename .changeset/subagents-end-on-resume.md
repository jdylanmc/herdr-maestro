---
"herdr-maestro": patch
---

Subagents still running or idle when Copilot restarts (`session.resume`) or exits (`session.shutdown`) now show as ended and expire, instead of lingering as idle forever.

The sidebar now lists only running subagents by default; the show-finished toggle also lists idle and finished ones.
