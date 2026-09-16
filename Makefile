# Runs every test suite: the Rust workspace, the app's vitest, the host's bun test.
.PHONY: test
test:
	cargo test --workspace
	cd app && npx vitest run
	cd host && bun test

# Sets one version everywhere it is written (tauri.conf.json is what the
# bundle and the tag guard in release.yml read; the two Cargo.toml,
# app/package.json and sdk/package.json (`@zcag/pal` on npm, published by
# hand: docs/releasing.md) follow, and their lockfiles), then prints the tag
# commands.
# No git here: review the diff, commit, then run what it printed.
# docs/releasing.md has the rest.
.PHONY: release
release:
	@[ -n "$(VERSION)" ] || { echo "usage: make release VERSION=x.y.z"; exit 1; }
	@echo "$(VERSION)" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$$' || { echo "VERSION must be x.y.z (or x.y.z-pre)"; exit 1; }
	perl -pi -e 's/^(  "version": ")[^"]*/$${1}$(VERSION)/' app/src-tauri/tauri.conf.json app/package.json sdk/package.json
	perl -pi -e 's/^(version = ")[^"]*/$${1}$(VERSION)/' app/src-tauri/Cargo.toml core/Cargo.toml
	cargo update --workspace --offline -q
	cd app && npm install --package-lock-only --ignore-scripts --silent
	bun install --lockfile-only
	@echo
	@echo "Now: review the diff, commit, then"
	@echo "  git tag -a v$(VERSION) -m v$(VERSION) && git push origin v$(VERSION)"

# Builds the macOS app and installs it to /Applications, signed with the
# local self-signed "pal-dev" identity when the login keychain has one (a
# stable signature keeps macOS's Accessibility grant across rebuilds; ad-hoc
# otherwise, which loses it on every build). Quits the running instance,
# swaps the bundle, relaunches through LaunchServices.
.PHONY: app
app:
	@id=$$(security find-identity -v -p codesigning 2>/dev/null | grep -q '"pal-dev"' && echo pal-dev || echo -); \
	echo "signing identity: $$id"; \
	cd app && npm run tauri build -- --config "{\"bundle\":{\"createUpdaterArtifacts\":false,\"macOS\":{\"signingIdentity\":\"$$id\"}}}"
	-pal quit 2>/dev/null; sleep 1
	rm -rf /Applications/pal.app && cp -R target/release/bundle/macos/pal.app /Applications/pal.app
	open -a /Applications/pal.app
	@codesign -dv /Applications/pal.app 2>&1 | grep -E '^Authority|^Signature' | head -2
