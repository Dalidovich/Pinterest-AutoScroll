# Pinterest AutoScroll

A Chrome extension that slowly scrolls the Pinterest feed, turning a browser window into a screensaver of pins.

It scrolls the real, live feed, so Pinterest keeps loading new pins for as long as it runs. While the page is moving, the site header, the tab bar and the mouse cursor are hidden.

## Install

The extension is not published in the Chrome Web Store. Load it from this folder:

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Pin the extension icon to the toolbar.

After updating the files, press the reload button on the extension card and reload the Pinterest tab.

## Use

Open Pinterest and click the extension icon. The icon shows `ON` for the tab where scrolling is active. On other sites the icon does nothing.

| Action | Effect |
|---|---|
| Click the extension icon | Start or stop scrolling |
| `■ Stop` button (bottom right) or `Esc` | Stop scrolling |
| `Space` | Pause and resume |
| `+` / `-` | Change speed by 5 px/s (range 5–400, default 40) |
| Mouse move, wheel, click | Pause for 5 seconds, then resume |

The `■ Stop` button and the version number under it appear when you move the mouse and fade out when scrolling resumes.

The speed is remembered across tabs and browser restarts. The on/off state belongs to a single tab and survives a page reload.

## What it does on its own

- Keeps the screen awake while scrolling.
- Returns to the home feed every 30 minutes, so the page does not grow without limit.
- Returns to the home feed if the page has not moved for a minute.

## How the scrolling works

Moving the page from script on every frame stutters on large windows, because Pinterest recalculates its grid on each scroll event in the same thread.

Instead, the extension starts one long linear animation that shifts the page, which Chrome runs on its compositor thread. Every 0.4 seconds the accumulated shift is transferred into the real scroll position and compensated in the same frame, so the picture does not jump and Pinterest still sees the scroll and loads more pins.

## Files

| File | Role |
|---|---|
| `manifest.json` | Extension manifest (Manifest V3) |
| `background.js` | Handles the icon click and the `ON` badge |
| `content.js` | Scrolling, controls and timers on the Pinterest page |
| `content.css` | Hides the site chrome and styles the controls |

## Permissions

- `storage` — remembers the scroll speed.
- `activeTab`, `scripting` — start the script in a Pinterest tab that was open before the extension was installed.

The extension makes no network requests and collects no data.

## Limitations

- Scrolling stops while the window is minimised or fully covered by other windows, because Chrome stops drawing it.
- The header and tab bar are found by Pinterest's current markup and may need updating when the site changes.
