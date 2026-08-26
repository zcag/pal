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
