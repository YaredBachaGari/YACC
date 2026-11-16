# Releasing

YACC is published to npm as [`yacc-hq`](https://www.npmjs.com/package/yacc-hq).

1. Update `CHANGELOG.md`: a `## <version>` section with what changed.
2. Bump `version` in `package.json` and merge to `main`.
3. Tag and push: `git tag v0.12.0 && git push origin v0.12.0`.

The **Release** workflow (`.github/workflows/release.yml`) then checks that the tag matches `package.json`, builds, runs the tests, packs the package, installs it from the tarball and runs the acceptance test (`scripts/acceptance-test.mjs`) on it, publishes to npm with provenance, and creates a GitHub release with the tarball and that version's changelog.

One-time setup: an npm automation token in the repository secret `NPM_TOKEN` (Settings → Secrets and variables → Actions).

To try a release locally without publishing:

```bash
pnpm build && npm pack --pack-destination pack
node scripts/smoke-test.mjs pack/yacc-hq-*.tgz
node scripts/acceptance-test.mjs pack/yacc-hq-*.tgz
```
