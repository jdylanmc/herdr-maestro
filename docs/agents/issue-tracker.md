# Issue Tracker: GitHub

Issues and specifications for this repository live in GitHub Issues. Use `gh` for tracker operations.

## Configuration

- Provider: GitHub
- Client: `gh`
- Repository: infer from the working tree's Git remote
- Pull requests as request surface: no

Let `gh` infer the repository inside a clone. Use `-R OWNER/REPO` only to resolve ambiguity, work outside the clone, or target another repository intentionally.

## Issue Operations

- **Create:** `gh issue create --title "TITLE" --body "BODY"`; use a heredoc for multiline bodies and add `--label` as needed.
- **Read:** `gh issue view NUMBER --comments`; request structured fields with `--json` and filter them with `--jq`.
- **List:** `gh issue list --state open --json number,title,body,labels,comments`; add label, state, assignee, author, or search filters as required.
- **Comment:** `gh issue comment NUMBER --body "COMMENT"`.
- **Add or remove labels:** `gh issue edit NUMBER --add-label "LABEL"` and `gh issue edit NUMBER --remove-label "LABEL"`.
- **Assign:** `gh issue edit NUMBER --add-assignee LOGIN`.
- **Close:** `gh issue close NUMBER --comment "RESOLUTION"`; when the installed client cannot comment while closing, comment first.

GitHub issues and pull requests share a number space. Resolve an ambiguous `#NUMBER` with `gh pr view NUMBER`, then fall back to `gh issue view NUMBER`.

## Pull Requests as a Request Surface

The configuration flag is `no`. A user may change it later.

When enabled:

- read with `gh pr view NUMBER --comments` and `gh pr diff NUMBER`;
- list open pull requests with author and association fields;
- keep only the configured external-author associations;
- comment, label, assign, or close with the corresponding `gh pr` commands.

## Skill Semantics

- **Publish to the issue tracker:** Create a GitHub issue.
- **Fetch the relevant ticket:** Read the referenced issue with comments, labels, and required structured fields.

## Discovery Operations

- **Map:** A GitHub issue labelled `discovery:map`.
- **Child:** A native sub-issue labelled with one of `discovery:research`, `discovery:prototype`, `discovery:interrogate`, or `discovery:task`. If sub-issues are unavailable, maintain a map task list and put `Part of #MAP` at the top of each child.
- **Blocking:** Use native issue dependencies. Add a blocked-by edge through the repository issue-dependencies API using the blocker's numeric database ID, not its visible issue number or node ID. Fall back to a `Blocked by: #NUMBER` line only when dependencies are unavailable.
- **Frontier:** List the map's open children in map order, remove tickets with open blockers, and remove assigned tickets.
- **Claim:** `gh issue edit NUMBER --add-assignee @me`.
- **Resolve:** Comment with the answer, close the child, verify closure, then update only the map's `Decisions so far` section with the linked ticket title, one-line gist, and context pointer.

## Shared Discovery Semantics

### Planning Model

`/discovery` plans efforts too large for one agent session as one shared map item, child decision or investigation tickets, and dependency relationships between child tickets.

Resolve at most one non-research ticket per session. Research tickets may proceed in parallel when the Discovery workflow supports it.

### Markers

The map uses `discovery:map`. Each child carries exactly one type marker: `discovery:research`, `discovery:prototype`, `discovery:interrogate`, or `discovery:task`.

### Map Body

```markdown
## Destination

<The end state and observable success conditions.>

## Notes

<Durable shared context, standing preferences, and skills to consult.>

## Decisions so far

- [<resolved ticket title>](<ticket link>) - <one-line outcome and optional context link>

## Not yet specified

<In-scope fog that is not yet precise enough to become a ticket.>

## Out of scope

<Concerns intentionally excluded from this effort.>
```

The map is an index, not the full decision record. Do not list open child tickets in its body when the tracker can query native children.

### Child Tickets

Each child belongs to the map through the provider's hierarchy, contains a `## Question` section, carries one Discovery type marker, represents one bounded decision or investigation, uses a provider-issued identifier for machine operations, and is referenced by linked title in human-facing prose.

### Fog and Scope

Use `Not yet specified` for in-scope questions that cannot yet be stated precisely. Graduate fog into a ticket only when its question becomes clear.

Use `Out of scope` for consciously excluded work. Out-of-scope content does not graduate unless the destination is explicitly redrawn.

### Dependencies and Frontier

Prefer native blocking or dependency relationships. The frontier is the set of child tickets that are open, unblocked by another open ticket, unassigned, and precise enough to contain a Question.

Use `Blocked by:` body metadata only when the tracker lacks usable native dependencies.

### Claim

Claiming is the first execution write:

1. refresh state, parent, dependencies, and assignment;
2. verify the ticket remains open, unblocked, and unclaimed;
3. assign it to the acting identity;
4. begin work only after assignment succeeds.

### Resolve

1. record a resolution through the provider's discussion mechanism;
2. close the child using the provider's terminal state;
3. verify closure;
4. append a linked title and one-line gist to the map's `Decisions so far`;
5. preserve every other map section and existing decision entry.

Newly clarified fog may become child tickets after the resolution. Tickets found beyond the destination are closed and linked from `Out of scope`, not `Decisions so far`.
