# Changesets

Every pull request that changes behavior adds a changeset: run `npx changeset`,
pick the bump, and write one or two user-facing sentences. Commit the generated
`.changeset/*.md` file with the change.

- **patch**: bug fixes and small behavior corrections.
- **minor**: new features, commands, or visible behavior that stays compatible.
- **major**: breaking changes to the CLI, installed layout, or data files.

Docs-only and CI-only pull requests run `npx changeset --empty`, or carry the
`no-changeset` label. `npm run version` folds pending changesets into
`CHANGELOG.md` and bumps `package.json`.
