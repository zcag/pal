# What CI runs (.github/workflows/ci.yml, the check job), in its order, so
# a green `make test` is a green push: clippy with warnings as errors, the
# Rust workspace, the SDK's declarations (the app's typecheck reads them),
# the app's typecheck and vitest, the host's typecheck (which covers the
# extensions and the examples) and bun test, the SDK's pack. The host's
# files run in parallel workers, one per core up to 8 (CI: one per core),
# and host/test/budget.ts fails a file over its time budget: host/test/README.md.
.PHONY: test
test:
	cargo clippy --workspace --all-targets -- -D warnings
	cargo test --workspace
	npm --prefix sdk run build
	cd app && npx tsc --noEmit && npx vitest run
	cd host && bunx tsc --noEmit && bun test --parallel=$$(n=$$(getconf _NPROCESSORS_ONLN); echo $$(( n < 8 ? n : 8 ))) --reporter=junit --reporter-outfile=$${TMPDIR:-/tmp}/pal-host-tests.xml && bun test/budget.ts $${TMPDIR:-/tmp}/pal-host-tests.xml
	cd sdk && npm pack --dry-run

# Sets one version everywhere it is written (tauri.conf.json is what the
# bundle and the tag guard in release.yml read; the two Cargo.toml,
# app/package.json and sdk/package.json (`@zcag/pal` on npm, published by
# hand: docs/releasing.md) follow, and their lockfiles; host/package.json
# carries no version), commits that bump alone, tags v$(VERSION) and pushes
# the branch and the tag, which starts release.yml (it publishes). DRY_RUN=1 prints every
# step (`+ ...`) and runs none. Refuses a dirty tree (the commit would sweep
# it up) and a tag that exists here or on origin. docs/releasing.md has the rest.
.PHONY: release
release:
	@[ -n "$(VERSION)" ] || { echo "usage: make release VERSION=x.y.z [DRY_RUN=1]"; exit 1; }
	@echo "$(VERSION)" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$$' || { echo "VERSION must be x.y.z (or x.y.z-pre)"; exit 1; }
	@set -e; tag=v$(VERSION); \
	run() { echo "+ $$*"; [ -n "$(DRY_RUN)" ] || "$$@"; }; \
	if git rev-parse -q --verify "refs/tags/$$tag" >/dev/null || git ls-remote --exit-code --tags origin "$$tag" >/dev/null 2>&1; then echo "$$tag exists already (here or on origin)"; exit 1; fi; \
	[ -n "$(DRY_RUN)" ] || [ -z "$$(git status --porcelain)" ] || { echo "working tree is dirty: commit or stash first, the release commit is the version bump alone"; exit 1; }; \
	grep -q "^## $(VERSION) · " docs/changelog.md || { echo "docs/changelog.md has no \"## $(VERSION) · <date>\" section: write what changed for users first (the release notes and pal.cagdas.io/changelog are made from it)"; exit 1; }; \
	run perl -pi -e 's/^(  "version": ")[^"]*/$${1}$(VERSION)/' app/src-tauri/tauri.conf.json app/package.json sdk/package.json; \
	run perl -pi -e 's/^(version = ")[^"]*/$${1}$(VERSION)/' app/src-tauri/Cargo.toml core/Cargo.toml; \
	run cargo update --workspace --offline -q; \
	run npm --prefix app install --package-lock-only --ignore-scripts --silent; \
	run bun install --lockfile-only; \
	run git commit -qam "$$tag"; \
	run git tag -a "$$tag" -m "$$tag"; \
	run git push origin HEAD "$$tag"; \
	echo "$$tag pushed: https://github.com/zcag/pal/actions/workflows/release.yml (published as the latest release once every bundle is on it)"

# Builds the macOS app and installs it to /Applications, signed with the
# "pal-dev" identity every release is signed with too (release.yml), so a
# local build, a release and an update are one app to macOS and keep its
# Accessibility and other grants. A keychain without it imports it from
# PAL_DEV_P12 (default: the Syncthing secrets, the password beside it in
# pal-dev.env); with neither, nothing is built: an ad-hoc pal would drop
# every grant. Quits the running instance, swaps the bundle, relaunches
# through LaunchServices.
PAL_DEV_P12 ?= $(HOME)/Sync/.secrets/pal/pal-dev.p12
.PHONY: app
app:
	@security find-identity -p codesigning 2>/dev/null | grep -q '"pal-dev"' || { \
		[ -f "$(PAL_DEV_P12)" ] || { echo "no pal-dev signing identity and no $(PAL_DEV_P12) to import it from (docs/releasing.md)"; exit 1; }; \
		. "$(dir $(PAL_DEV_P12))pal-dev.env" && app/scripts/signing-key.sh "$(PAL_DEV_P12)" "$$PAL_DEV_P12_PASSWORD"; }
	cd app && npm run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false,"macOS":{"signingIdentity":"pal-dev"}}}'
	-pal quit 2>/dev/null; sleep 1
	rm -rf /Applications/pal.app && cp -R target/release/bundle/macos/pal.app /Applications/pal.app
	open -a /Applications/pal.app
	@codesign -dv /Applications/pal.app 2>&1 | grep -E '^Authority|^Signature' | head -2
