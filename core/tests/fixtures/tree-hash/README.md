The `pal-tree-v1` conformance case (`docs/registry.md`): `tree/` hashes to
`expected.txt`. The Rust (`pal_core::registry::tree_hash`) and TypeScript
(`sdk/pack`) implementations both test against it. It covers the sort (bytes,
so `Z` before `a`), nested directories, a non-ASCII name, an empty file, the
executable bit, and dotfiles skipped at any depth (`.pal-install.json`,
`.DS_Store`, a dot directory).
