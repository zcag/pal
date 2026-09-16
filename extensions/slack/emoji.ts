// Slack status emoji as text. A status names its emoji by Slack shortcode
// (`:palm_tree:`), and the row wants the picture: the common status ones are
// tabled here (Slack's own suggestions first, then what people set), the
// current status comes with its code point from the API, and a shortcode
// nobody tabled stays as typed. Not the emoji extension's 300 KB catalog:
// its names are Unicode's, not Slack's, and the bundle inlines imports.
const TABLE: Record<string, string> = {
  spiral_calendar_pad: "🗓️", bus: "🚌", face_with_thermometer: "🤒", palm_tree: "🌴", house_with_garden: "🏡", house: "🏠", office: "🏢",
  knife_fork_plate: "🍽️", fork_and_knife: "🍴", coffee: "☕", tea: "🍵", hamburger: "🍔", pizza: "🍕", sandwich: "🥪", bento: "🍱",
  headphones: "🎧", no_entry: "⛔", no_entry_sign: "🚫", no_bell: "🔕", bell: "🔔", zzz: "💤", sleeping: "😴", bed: "🛏️",
  airplane: "✈️", car: "🚗", train: "🚆", bike: "🚲", runner: "🏃", walking: "🚶", phone: "☎️", telephone_receiver: "📞",
  calendar: "📅", date: "📆", clock1: "🕐", hourglass: "⏳", hourglass_flowing_sand: "⏳", alarm_clock: "⏰",
  writing_hand: "✍️", memo: "📝", pencil2: "✏️", books: "📚", book: "📖", computer: "💻", keyboard: "⌨️", dart: "🎯",
  rocket: "🚀", fire: "🔥", eyes: "👀", wave: "👋", tada: "🎉", muscle: "💪", brain: "🧠", thinking_face: "🤔",
  speech_balloon: "💬", mag: "🔍", wrench: "🔧", hammer_and_wrench: "🛠️", construction: "🚧", warning: "⚠️",
  white_check_mark: "✅", x: "❌", heart: "❤️", star: "⭐", sparkles: "✨", crescent_moon: "🌙", sunny: "☀️", sun_with_face: "🌞",
  rain_cloud: "🌧️", snowflake: "❄️", umbrella: "☂️", beach_with_umbrella: "🏖️", mountain: "⛰️", hospital: "🏥", baby: "👶", dog: "🐶", cat: "🐱",
  video_camera: "📹", microphone: "🎤", movie_camera: "🎥", art: "🎨", musical_note: "🎵", game_die: "🎲", trophy: "🏆",
  smile: "😄", slightly_smiling_face: "🙂", sunglasses: "😎", nerd_face: "🤓", mask: "😷", pray: "🙏", raised_hands: "🙌", "+1": "👍",
};

/** The emoji for a Slack shortcode (`:palm_tree:`, with or without the colons; a skin tone suffix dropped), or undefined when it is not tabled. */
export function emojiFor(shortcode: string): string | undefined {
  const name = shortcode.replace(/^:|:$/g, "").replace(/::skin-tone-\d$/, "");
  return TABLE[name];
}

/** Slack's `unicode` for a status emoji (`1f334`, or `1f468-200d-1f4bb` joined by dashes) as the character. */
export const fromCodePoints = (unicode: string | undefined): string | undefined => (unicode ? String.fromCodePoint(...unicode.split("-").map((h) => parseInt(h, 16))) : undefined);
