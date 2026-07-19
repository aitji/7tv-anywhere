<h1><img src="extension/icons/icon.svg" alt="7TV Anywhere Logo" width="48" /> 7TV Anywhere</h1>

Bring 7TV emotes to <code>text fields</code> and <code>rendered text</code> on any website\*

A browser extension for **[7TV](https://7tv.app)** emote images wherever they show up, and adds a classic autocomplete to text fields <i>so you can type them yourself</i>.

## Inspiration

Heavily inspired by [SwarmTube](https://github.com/Igrolodz/7tv-SwarmTube)
> you can tell by the default channel being [vedal987](https://www.twitch.tv/vedal987)

same idea, but SwarmTube is scoped to YouTube's comment section. <u>7TV Anywhere</u> takes that idea further and runs everywhere\* instead.

## How site support works

Some sites don't play nicely with a script that rewrites text nodes on the fly, an input a box owns, or a rich text editor, can break in ways that aren't worth working around. Instead of guessing per-site, the extension pulls a small <u>maintainer-authored</u> config, [`sites.jsonc`](./sites.jsonc), and checks the current page's URL against it before deciding whether to run

## Installation

There's no store listing yet, so it's a manual install for now:

1. Grab the code, either clone this repo, or download a packaged zip from the [Releases](../../releases) page (there's a `-chrome` and a `-firefox` build).
2. Open `chrome://extensions` (or `about:debugging#/runtime/this-firefox` on Firefox).
3. Enable **Developer mode** (Chrome) or use **Load Temporary Add-on** (Firefox).
4. Click **Load unpacked** and select the `extension/` folder.
5. The extension should now be installed and active.

> [!NOTE]
> The extension checks for updates against this repo's `main` branch once a week and shows a badge when a newer version is out, but since it isn't on a store, updating still means grabbing the repo again and reloading it manually.

<hr>

Developed by <a href="https://aitji.xyz">@aitji</a> · Swarm Property. All rights reserved