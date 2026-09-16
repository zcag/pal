# Runs every test suite: the Rust workspace, the app's vitest, the host's bun test.
.PHONY: test
test:
	cargo test --workspace
	cd app && npx vitest run
	cd host && bun test
