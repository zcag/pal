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

# Bump patch version, commit, tag, push, and publish
release:
	@VERSION=$$(grep '^version' Cargo.toml | head -1 | sed 's/.*"\(.*\)"/\1/'); \
	MAJOR=$$(echo $$VERSION | cut -d. -f1); \
	MINOR=$$(echo $$VERSION | cut -d. -f2); \
	PATCH=$$(echo $$VERSION | cut -d. -f3); \
	NEW_PATCH=$$((PATCH + 1)); \
	NEW_VERSION="$$MAJOR.$$MINOR.$$NEW_PATCH"; \
	sed -i "s/^version = \"$$VERSION\"/version = \"$$NEW_VERSION\"/" Cargo.toml; \
	cargo check --quiet; \
	git add Cargo.toml Cargo.lock; \
	git commit -m "v$$NEW_VERSION"; \
	git tag "v$$NEW_VERSION"; \
	git push && git push --tags; \
	cargo publish; \
	echo "Released v$$NEW_VERSION"
