# Releasing

k-bench releases are automated. A maintainer prepares a release pull request with `pnpm release <version>`; merging it to `main` runs the release workflow, which checks the build, publishes `@k-electron/k-bench` to npm with provenance, tags the commit and creates the GitHub Release. Nobody publishes from a laptop, and there is no npm token anywhere.

Versions follow [semantic versioning](https://semver.org/) and the changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## One-off setup (the owner, before the first release)

Trusted publishing can only be configured on a package that already exists, so the first release needs these manual steps. Until they are done the workflow publishes nothing: it logs that the package is missing from npm and stops.

1. Create the `k-electron` scope on npm (a user or organisation named `k-electron` that you control).
2. Publish a placeholder `0.0.0` by hand, once, so the package exists. The repo's `package.json` is at `0.0.0` for exactly this: from a clean checkout, `npm login`, then `npm publish --access public`. (`prepack` builds the package first. This is the only publish ever done by hand, and the workflow never publishes `0.0.0`.)
3. On npmjs.com, open the package's settings and add a **trusted publisher** of type GitHub Actions:
   - Organization or user: `k-electron`
   - Repository: `k-bench`
   - Workflow filename: `release.yml` (the file is `.github/workflows/release.yml`; every field is case-sensitive and must match exactly)
   - Environment: leave empty (the workflow does not use a GitHub environment)
4. Optionally, once a trusted publisher is working, set the package's publishing access to require two-factor authentication and disallow tokens, so that trusted publishing is the only way in.

Notes from [npm's trusted publishing docs](https://docs.npmjs.com/trusted-publishers):

- It needs npm 11.5.1 or later and Node 22.14 or later. The workflow runs Node 26 (which bundles a newer npm) and checks the npm version before publishing.
- npm does not validate the trusted publisher when you save it; a typo shows up only as a failed publish.
- A new trusted publisher configuration must be used for a successful publish within two days, or it expires. Configure it shortly before cutting the first release, or dry-run the workflow first and then configure it.
- `repository.url` in `package.json` must match the GitHub repository exactly.
- Provenance is generated automatically for a public repository and package.

## Cutting a release

1. Make sure the changelog's Unreleased section describes what changed. Add notes with each change, in the sections Added, Changed, Deprecated, Removed, Fixed and Security.
2. From a clean, up-to-date `main`, run:

   ```sh
   pnpm release 0.1.0            # or --dry-run first: checks everything, prints the plan, changes nothing
   ```

   It checks that you are on `main` with a clean tree, that `main` equals `origin/main`, that the version is valid semver, newer than the current one and not already in the changelog, and that Unreleased has notes. Then it creates the branch `release-0.1.0`, bumps `package.json`, moves the Unreleased notes under `## [0.1.0] - <today>` (leaving a fresh empty Unreleased and updating the link references at the bottom of `CHANGELOG.md`), commits, pushes the branch and opens the pull request with `gh pr create`. It needs `gh` signed in. `--date YYYY-MM-DD` overrides today's date.
3. Review the PR (the diff is `package.json` and `CHANGELOG.md`) and merge it. To abandon the release, close the PR without merging and delete the branch.
4. The merge to `main` runs the release workflow. When it finishes, the version is on npm, `v<version>` is tagged on the merge commit, and the GitHub Release exists with that version's changelog section as its notes.

## What the release workflow does

`.github/workflows/release.yml` runs on every push to `main` and on manual dispatch.

1. **Plan** (`scripts/release-plan.ts`). Reads the package version and asks the npm registry whether it has that version. It publishes only when all of these hold:
   - the version is not `0.0.0`;
   - the package exists on npm (a 404 means "do not publish", with a log line saying the owner setup is not done);
   - npm does not have this version yet;
   - the changelog has a section for it, which becomes the Release notes.

   If the registry cannot be asked (any error other than a 404), the run fails instead of guessing. An ordinary push to `main` that does not change the version therefore finds nothing to do, and stops here, cheaply.
2. **Check**: `pnpm install --frozen-lockfile`, `pnpm check`, then `pnpm test:e2e`, only when it is going to publish (or on a dry run).
3. **Publish**: `npm publish --provenance --access public`, authenticated by GitHub's OIDC token through trusted publishing (`permissions: id-token: write`). Prerelease versions (`1.0.0-rc.1`) go out under the `next` dist-tag, not `latest`. Only a run on `main` that is not a dry run gets here.
4. **Tag**: `v<version>` on the commit that was tested and published, pushed with the workflow's token (`permissions: contents: write`).
5. **GitHub Release**: `gh release create v<version>` with the changelog section as the notes.

Runs are serialised and never cancelled part way.

### Dry run

Actions, then Release, then Run workflow, with `dry_run` ticked (the default for a manual run). It does everything except the publish, the tag and the Release, and its log shows the version, the tag, whether a real run on this commit would publish and why, the commands it would run, and the notes it would use. While the version is still `0.0.0` it shows the Unreleased notes. Run it from any branch; a manual run with `dry_run` unticked still publishes only from `main`.

You can see the same plan locally, which makes no changes: `node scripts/release-plan.ts`.

### If a release fails part way

- Failed before the publish step: fix the cause and re-run the failed workflow run; nothing was published.
- Published, but the tag or the GitHub Release failed: the version is on npm, so re-running will not publish again, and will not tag either. Finish by hand on the commit that was published: `git tag v<version> <sha>`, `git push origin v<version>`, then `gh release create v<version> --verify-tag --title v<version> --notes-file <the changelog section>`. Do not publish the same version twice; npm refuses, and the fix is a new version.

## The pieces

- `CHANGELOG.md`: hand-written. Only `pnpm release` moves notes out of Unreleased.
- `scripts/release.ts`: `pnpm release <version>`.
- `scripts/release-plan.ts`: the workflow's decision step. `scripts/check-npm.ts`: refuses an npm too old for trusted publishing.
- `scripts/release-lib.ts`: the pure parts both share (semver, changelog section and move, the publish decision, the npm lookup).
- `test/release.test.ts`: runs `pnpm release` against throwaway git repos (a bare origin on disk and a stub `gh`) and the plan step against a stub registry. The workflow itself is proved by its dry run.
