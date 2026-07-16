# Publishing Progress Dock

1. Update the version in `manifest.json`, `package.json`, and `versions.json`.
2. Run `pnpm install` and `pnpm run build`.
3. Commit and push the source code. Generated `main.js` files remain excluded from the repository.
4. Create a GitHub release whose tag exactly matches the manifest version, without a `v` prefix.
5. Attach `release/main.js`, `release/manifest.json`, and `release/styles.css` to the release.
6. For the initial listing, submit the repository URL through the Obsidian Community directory.
7. Address review feedback with a new semantic version and matching GitHub release.
