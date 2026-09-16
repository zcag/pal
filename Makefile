# Runs every test suite: the Rust workspace, the app's vitest, the host's bun test.
.PHONY: test
test:
	cargo test --workspace
	cd app && npx vitest run
	cd host && bun test

# Sets one version everywhere it is written (tauri.conf.json is what the
# bundle and the tag guard in release.yml read; the two Cargo.toml and
# package.json follow, and their lockfiles), then prints the tag commands.
# No git here: review the diff, commit, then run what it printed.
# docs/releasing.md has the rest.
.PHONY: release
release:
	@[ -n "$(VERSION)" ] || { echo "usage: make release VERSION=x.y.z"; exit 1; }
	@echo "$(VERSION)" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$$' || { echo "VERSION must be x.y.z (or x.y.z-pre)"; exit 1; }
	perl -pi -e 's/^(  "version": ")[^"]*/$${1}$(VERSION)/' app/src-tauri/tauri.conf.json app/package.json
	perl -pi -e 's/^(version = ")[^"]*/$${1}$(VERSION)/' app/src-tauri/Cargo.toml core/Cargo.toml
	cargo update --workspace --offline -q
	cd app && npm install --package-lock-only --ignore-scripts --silent
	@echo
	@echo "Now: review the diff, commit, then"
	@echo "  git tag -a v$(VERSION) -m v$(VERSION) && git push origin v$(VERSION)"
