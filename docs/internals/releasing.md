# Releasing

k-bench releases are automated. A maintainer prepares a release pull request with `pnpm release <version>`; merging it to `main` runs the release workflow, which checks the build, publishes `@k-electron/k-bench` to npm with provenance, tags the commit and creates the GitHub Release. Nobody publishes from a laptop, and there is no npm token anywhere.

Versions follow [semantic versioning](https://semver.org/).

## Cutting a release

1. Make sure the changelog's Unreleased section describes what changed, as [CONTRIBUTING](../../CONTRIBUTING.md#changelog) says.
2. From a clean, up-to-date `main`, run:

   ```sh
   pnpm release <version>        # or --dry-run first: checks everything, prints the plan, changes nothing
   ```

   It checks that you are on `main` with a clean tree, that `main` equals `origin/main`, that the version is valid semver, newer than the current one and not already in the changelog, and that Unreleased has notes. Then it creates the branch `release-<version>`, bumps `package.json`, moves the Unreleased notes under `## [<version>] - <today>` (leaving a fresh empty Unreleased and updating the link references at the bottom of `CHANGELOG.md`), commits, pushes the branch and opens the pull request with `gh`, which must be signed in. `--date YYYY-MM-DD` overrides today's date.

   If the push or the pull request fails, you are left on the `release-<version>` branch and a re-run refuses because the branch exists. Switch to `main`, delete the branch (locally, and on `origin` if it was pushed), fix the cause and run it again.
3. Review the pull request (the diff is `package.json` and `CHANGELOG.md`) and merge it. To abandon the release, close it without merging and delete the branch.
4. The merge to `main` runs the release workflow. When it finishes, the version is on npm, `v<version>` is tagged on the merge commit, and the GitHub Release exists with that version's changelog section as its notes.

## What the release workflow does

`.github/workflows/release.yml` runs on every push to `main` and on manual dispatch. Runs are serialised and never cancelled part way.

1. **Plan** (`scripts/release-plan.ts`). Reads the package version and asks the npm registry whether it has that version. It publishes only when all of these hold:
   - the version is not `0.0.0`;
   - the package exists on npm (a 404 means "do not publish", with a log line saying the [one-off setup](#one-off-setup-done-once-kept-for-reference) is not done);
   - npm does not have this version yet;
   - the changelog has a section for it, which becomes the Release notes.

   If the registry can't be asked (any error other than a 404), the run fails instead of guessing. A push to `main` that doesn't change the version therefore stops here, cheaply.
2. **Check**: `pnpm install --frozen-lockfile`, `pnpm check` and `pnpm test:e2e`, only when it is going to publish, or on a dry run. `scripts/check-npm.ts` then refuses an npm too old for trusted publishing.
3. **Publish**: `npm publish --provenance --access public`, authenticated by GitHub's OIDC token through trusted publishing (`permissions: id-token: write`). A prerelease version (`<version>-rc.1`) goes out under the `next` dist-tag, not `latest`. Only a run on `main` that is not a dry run gets here.
4. **Tag**: `v<version>` on the commit that was tested and published, pushed with the workflow's token (`permissions: contents: write`).
5. **GitHub Release**: `gh release create v<version>` with the changelog section as the notes.

`scripts/release-lib.ts` holds the parts `pnpm release` and the plan step share: semver, the changelog section and its move, the publish decision and the npm lookup. `test/release.test.ts` tests both (see [Test seams](test-seams.md#the-release-tooling)); the workflow file itself is proved by its dry run.

### Dry run

Actions, then Release, then Run workflow, with `dry_run` ticked (the default for a manual run). It does everything except the publish, the tag and the Release, and its log shows the version, the tag, whether a real run on this commit would publish and why, the commands it would run, and the notes it would use. When the changelog has no section for the version yet, those are the Unreleased notes. Run it from any branch; a manual run with `dry_run` unticked still publishes only from `main`.

`node scripts/release-plan.ts` shows the same plan locally and changes nothing.

### If a release fails part way

- Failed before the publish step: fix the cause and re-run the failed workflow run. Nothing was published.
- Published, but the tag or the GitHub Release failed: the version is on npm, so re-running will neither publish again nor tag. Finish by hand on the commit that was published: `git tag v<version> <sha>`, `git push origin v<version>`, then `gh release create v<version> --verify-tag --title v<version> --notes-file <the changelog section>`. Don't publish the same version twice: npm refuses, and the fix is a new version.

## One-off setup (done once, kept for reference)

The owner did this before the first release. Trusted publishing can only be configured on a package that already exists, so the first release needed these manual steps; until they are done, the workflow logs that the package is missing from npm and stops.

1. Create the `k-electron` scope on npm (a user or organisation named `k-electron` that you control).
2. Publish a placeholder `0.0.0` by hand, once, so the package exists: from a clean checkout with `package.json` at `0.0.0`, `npm login`, then `npm publish --access public`. This is the only publish ever done by hand, and the workflow never publishes `0.0.0`.
3. Add a **trusted publisher** of type GitHub Actions, either from the command line or on npmjs.com (package settings):

   ```sh
   npm trust github @k-electron/k-bench --file release.yml --repo k-electron/k-bench --allow-publish --dry-run
   ```

   Run it again without `--dry-run` once the output looks right. The values are:
   - Organization or user: `k-electron`
   - Repository: `k-bench`
   - Workflow filename: `release.yml` (the file is `.github/workflows/release.yml`; every field is case-sensitive and must match exactly)
   - Environment: leave empty (the workflow does not use a GitHub environment)

   `npm trust list @k-electron/k-bench` shows what is configured.
4. Optionally, once a trusted publisher is working, require two-factor authentication and disallow tokens for the package, so that trusted publishing is the only way in: `npm access set mfa=publish @k-electron/k-bench`, or the package's publishing access setting on npmjs.com.

If your npm account's two-factor method is a passkey, npm asks you to approve each write (publish, deprecate, `trust`, `access`) in the browser. It only offers that when it has a terminal, so run the command in an interactive shell and open the link it prints promptly: the link expires within a minute or so.

Notes from [npm's trusted publishing docs](https://docs.npmjs.com/trusted-publishers):

- It needs npm 11.5.1 or later and Node 22.14 or later. The workflow runs Node 26 and checks the npm version before publishing.
- npm does not validate the trusted publisher when you save it; a typo shows up only as a failed publish.
- A new trusted publisher configuration must be used for a successful publish within two days, or it expires.
- `repository.url` in `package.json` must match the GitHub repository exactly.
- Provenance is generated automatically for a public repository and package.
