.PHONY: run test build install watch raycast release

run:
	cargo run -- --config pal.default.toml

test:
	cargo test

build:
	cargo build

install:
	cargo install --path .

watch:
	cargo watch -x 'run -- --config pal.default.toml'

# The Raycast extension's command list is baked into its manifest at install
# time, so a palette added to config.toml has no command until this runs.
# Palette *contents* are read live and need nothing; item scripts re-sync
# hourly on their own. This is the only sync anything ever needs.
raycast:
	cd raycast && npm run sync && npm run build

# Release: `make release` bumps the patch version; `make release V=0.3.0` releases
# that exact version (and releases the current one as-is if it's already set).
release:
	@CUR=$$(grep -m1 '^version' Cargo.toml | sed 's/.*"\(.*\)"/\1/'); \
	NEW=$${V:-$$(echo $$CUR | awk -F. '{printf "%d.%d.%d", $$1, $$2, $$3 + 1}')}; \
	if [ "$$NEW" != "$$CUR" ]; then \
		perl -i -pe 's/^version = "'$$CUR'"/version = "'$$NEW'"/' Cargo.toml; \
	fi; \
	cargo check --quiet; \
	git diff --quiet Cargo.toml Cargo.lock || { git add Cargo.toml Cargo.lock; git commit -m "v$$NEW"; }; \
	git tag "v$$NEW"; \
	git push && git push --tags; \
	cargo publish; \
	echo "Released v$$NEW"
