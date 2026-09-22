# Turkish

Turkish text tools: deasciify what was typed without the Turkish letters
(`Turkce yazilmis bir cumle` → `Türkçe yazılmış bir cümle`), asciify the
other way, and the Turkish cases, where `i` and `ı` are two letters. An
input palette: what you type is the text; with nothing typed, the
selection in the app in front, else what is on the clipboard.

## The rows

Five, in this order, each named by the converted text with the
conversion and how many characters it touched beside it (`unchanged`
as a grey tag when it touched none):

| row | what |
| --- | --- |
| Deasciified | The Turkish letters restored from context: `sik` → `sık`, `kus` → `kuş`, `acik` → `açık`, `yas` → `yaş`, `Istanbul'da yasiyorum` → `İstanbul'da yaşıyorum`. Deniz Yüret's pattern-table algorithm from Emacs turkish-mode, in Mustafa Emre Acer's JavaScript port (`turkish-deasciifier` on npm, ISC). A text that is already Turkish comes back as it is. Meant for Turkish: an English text run through it can gain a letter or two (`this is` → `thiş iş`). |
| Asciified | `ç ğ ı ö ş ü` and their capitals as `c g i o s u`, for a form or a system that takes no Turkish letters. |
| UPPERCASE | `toLocaleUpperCase("tr")`: `i` → `İ`, `ı` → `I`. |
| lowercase | `toLocaleLowerCase("tr")`: `I` → `ı`, `İ` → `i`. |
| Title Case | Every word's first letter up and the rest down, the Turkish way; a suffix after an apostrophe stays down (`İstanbul'da`), a quote or a bracket before a word is left alone. |

The detail pane holds the whole converted text over the source, with
the count and where the text came from.

| keys | action |
| --- | --- |
| `enter` | Paste into the app in front; when the rows came from the selection, that is what it replaces |
| `cmd+enter`, `cmd+c` | Copy |
| `cmd+t` | The row in the Translate palette |
| `cmd+shift+c` | Copy the source text |

`primary_action = "copy"` makes `enter` copy and `cmd+enter` paste.

## From the selection

Select text in any app, open the palette, and the rows are the selection
converted (`selection.text()`: the accessibility API, else a copy-shortcut
snapshot with the clipboard put back; Accessibility on macOS). The
subtitle says "from the selection, Enter replaces it". Nothing selected:
the newest text on the clipboard, "from the clipboard". Neither: three
hints. The read is reused for 2 s across empty listings.

## Links

`pal://turkish/deasciify`, `asciify`, `upper`, `lower`, `title`, each with
`text` (optional) and `paste` (boolean):

- `pal://turkish/deasciify?text=Turkce` copies `Türkçe`; `&paste=1` pastes
  it into the app in front instead.
- `pal://turkish/deasciify` without `text` converts the selection (else
  the clipboard) and, from a selection, pastes over it: a keybind that
  fixes the letters of what you just typed. `paste=0` copies instead.

`pal call turkish/deasciify text=Turkce` is the command form.

## Not done

- A `{turkish …}` placeholder for snippets: `sdk/src/placeholders.ts`
  has a fixed grammar (seven names in one regex, no hook for a source an
  extension provides), so there is nothing to plug into. Pipe a snippet
  through the link instead.
- Sentence case, and a smarter title case for Turkish conjunctions
  (`ve`, `ile`): every word is capitalised.

## Settings, `[extensions.turkish]`

| key | type | default | what |
| --- | --- | --- | --- |
| `primary_action` | `paste`, `copy` | `paste` | What `enter` does on a row. |

## Platforms

macOS and Linux.
