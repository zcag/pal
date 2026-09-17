// The quicklink library: ready-made `{query}` searches the Browse library
// level offers, each added to the user's own links with one Enter. Names
// and urls only; the ids are the entry's slot in the list, so a row keeps
// its id across listings and a pick after a restart still finds it.

export type LibraryLink = { name: string; url: string; keywords: string[] };

export const LIBRARY: LibraryLink[] = [
  { name: "Google", url: "https://www.google.com/search?q={query}", keywords: ["g", "search", "web"] },
  { name: "DuckDuckGo", url: "https://duckduckgo.com/?q={query}", keywords: ["ddg", "search", "web"] },
  { name: "Bing", url: "https://www.bing.com/search?q={query}", keywords: ["search", "web"] },
  { name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search={query}", keywords: ["wiki", "encyclopedia"] },
  { name: "YouTube", url: "https://www.youtube.com/results?search_query={query}", keywords: ["yt", "video"] },
  { name: "GitHub", url: "https://github.com/search?q={query}", keywords: ["gh", "repo", "repositories"] },
  { name: "GitHub code", url: "https://github.com/search?type=code&q={query}", keywords: ["gh", "code", "grep"] },
  { name: "npm", url: "https://www.npmjs.com/search?q={query}", keywords: ["node", "package", "js"] },
  { name: "crates.io", url: "https://crates.io/search?q={query}", keywords: ["rust", "crate", "cargo"] },
  { name: "PyPI", url: "https://pypi.org/search/?q={query}", keywords: ["python", "pip", "package"] },
  { name: "MDN", url: "https://developer.mozilla.org/en-US/search?q={query}", keywords: ["web", "docs", "javascript", "css", "html"] },
  { name: "Stack Overflow", url: "https://stackoverflow.com/search?q={query}", keywords: ["so", "code", "question"] },
  { name: "Amazon", url: "https://www.amazon.com/s?k={query}", keywords: ["shop", "buy"] },
  { name: "Google Maps", url: "https://www.google.com/maps/search/{query}", keywords: ["map", "place", "directions"] },
  { name: "Google Translate", url: "https://translate.google.com/?sl=auto&tl=en&text={query}&op=translate", keywords: ["translate", "language"] },
  { name: "X", url: "https://x.com/search?q={query}", keywords: ["twitter", "tweet", "social"] },
  { name: "Reddit", url: "https://www.reddit.com/search/?q={query}", keywords: ["subreddit", "forum"] },
  { name: "Hacker News", url: "https://hn.algolia.com/?q={query}", keywords: ["hn", "news", "tech"] },
  { name: "IMDb", url: "https://www.imdb.com/find/?q={query}", keywords: ["movie", "film", "tv", "series"] },
  { name: "Spotify", url: "https://open.spotify.com/search/{query}", keywords: ["music", "song", "artist", "album"] },
  { name: "Unsplash", url: "https://unsplash.com/s/photos/{query}", keywords: ["photo", "image", "picture"] },
  { name: "Can I use", url: "https://caniuse.com/?search={query}", keywords: ["browser", "support", "css", "web"] },
  { name: "Rust docs", url: "https://docs.rs/releases/search?query={query}", keywords: ["rust", "docs.rs", "crate", "api"] },
  { name: "Homebrew", url: "https://formulae.brew.sh/formula/{query}", keywords: ["brew", "formula", "cask", "mac"] },
  { name: "Apple Developer", url: "https://developer.apple.com/search/?q={query}", keywords: ["apple", "swift", "docs", "api"] },
];

/** The library row's id: its slot, so it survives a restart and never collides with a stored link's uuid. */
export const LIBRARY_ID = "library:";
export const libraryId = (i: number) => `${LIBRARY_ID}${i}`;
export const libraryEntry = (id: string): LibraryLink | undefined => (id.startsWith(LIBRARY_ID) ? LIBRARY[Number(id.slice(LIBRARY_ID.length))] : undefined);
