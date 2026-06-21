# TUI Agent Guide

## Scope

The interactive terminal app is split across:

- `src/tui.js` for the Ink app
- `src/tui/state.js` for the reducer/state machine
- `src/tui/format.js` for pure progress-event formatting and theme values
- `src/tui/presentation.js` for shared Ink presentation primitives
- `src/tui/workflows.js` for testable queue, conversion, and output-confirmation workflows

## Runtime

- Ink `7.x`
- React `19.2+`
- Node `22+`

The app requires a real interactive terminal with raw input support.

## Screens

- `startup`
- `catalog`
- `preparing`
- `confirm`
- `converting`
- `summary`
- `error`

## Key Bindings

- Arrow keys: navigate
- Page Up / Page Down: jump in lists or scroll logs
- Space: select/deselect current course
- Enter: confirm the current action
- `/`: enter search mode
- `A`: select all filtered courses
- `Q`: launch the full poster QA sweep
- `R`: refresh the poster
- `L`: toggle expanded logs during conversion
- `Esc`: leave search or return to the previous screen
- `Ctrl+C`: graceful cancel during conversion, exit otherwise

## State Notes

- `selectedCodes` is the source of truth for catalog selection.
- `queue` stores both resolved and failed selections so unavailable entries stay visible.
- `converting.logs` stores structured progress events, not preformatted strings.
- The log viewer renders the tail of the log and uses `logOffset` for scrollback.

## Accessibility

- Honor `NO_COLOR` by disabling color styling without removing labels or symbols.
- Keep status text readable without relying on color alone.
- The app should still make sense when rendered in a narrow terminal.

## Troubleshooting

- If the TUI looks frozen, check the stall warning threshold and the last progress event before changing rendering code.
- Avoid direct `console.log` calls while Ink is active; route activity through the progress event stream instead.
