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
