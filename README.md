# CoreWar Arena

A full-featured, browser-based CoreWar simulator implementing the **ICWS-94 standard**. No build tools, no dependencies — just open `index.html` and play.

## What is CoreWar?

CoreWar is a programming game from 1984 where warriors — programs written in Redcode assembly — battle inside a virtual computer's memory (the "core"). Each warrior tries to survive while crashing opponents by forcing them to execute a `DAT` instruction.

## Features

- **ICWS-94 MARS Engine** — All 18 opcodes, 8 addressing modes, 7 modifiers, P-Space
- **Redcode Parser** — Labels, EQU, FOR/ROF macros, `;assert` directives
- **Visual Core Display** — Real-time animated core memory with zoom/pan (fancy + fast mode)
- **Syntax Highlighting Editor** — Color-coded Redcode with live highlighting
- **Time-Travel Debugger** — Step forward/backward through battle history, inspect any cell
- **Tournament System** — Round-robin tournaments with Elo ratings and head-to-head stats
- **Analytics Dashboard** — Heatmaps, territory charts, process counts, write rates, strategy detection
- **Sound Engine** — Procedural audio feedback for writes, jumps, splits, and deaths
- **566 Warrior Library** — Searchable, categorized collection from the CoreWar community
- **Mobile Responsive** — Works on phones and tablets

## Quick Start

1. Open `index.html` in any modern browser
2. A default warrior (Dwarf) is loaded — click **Load & Run**
3. Browse the **Library** tab for 566 classic warriors
4. Write your own in the **Editor** tab
5. Press `Space` to play/pause, `S` to step, `D` for debugger

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `S` | Step |
| `R` | Reset |
| `D` | Toggle debugger |
| `V` | Toggle fast/fancy mode |
| `M` | Toggle sound |
| `Ctrl+Enter` | Load & Run |

## Project Structure

```
index.html              Main page
css/styles.css          All styling
js/
  constants.js          Opcodes, modifiers, addressing modes
  engine.js             Parser, MARS, Core, Warrior, Instruction
  editor-highlight.js   Redcode syntax highlighting
  visualizer.js         Core memory visualization
  debugger.js           Time-travel debugger
  sound.js              Procedural sound engine
  tournament.js         Tournament manager
  analytics-*.js        Battle analytics and strategy detection
  warrior-catalog.js    Warrior library catalog
  warriors.js           Built-in warriors and library UI
  ui.js                 UI helpers, tabs, mobile nav
  app.js                Init, game loop, event bindings
scripts/
  build-catalog.js      Generates warrior-catalog.js from .red files
test/
  test-harness.js       Behavioral test suite (2214 tests)
  test-opcodes.js       Opcode-level unit tests
  test-edgecases.js     Edge case tests
  warriors/             566 warrior files (.red)
```

## Running Tests

```bash
node test/test-harness.js
```

## Warrior Library

The `test/warriors/` directory contains 566 Redcode warriors collected from public CoreWar hills (online tournaments where players submit warriors openly). These warriors were originally aggregated by [n1LS/redcode-warriors](https://github.com/n1LS/redcode-warriors) and were authored by many different members of the CoreWar community over the years. Each `.red` file contains `;author` comments crediting the original creator.

## Resources

- [ICWS-94 Standard](http://www.koth.org/info/icws94.html) — The official Redcode specification
- [corewar.co.uk](http://corewar.co.uk/) — CoreWar community and tutorials
- [KOTH](http://www.koth.org/) — King of the Hill, the original online CoreWar tournament
- [rec.games.corewar FAQ](http://www.koth.org/info/akfaq.html) — Classic FAQ from the Usenet era

## License

MIT — see [LICENSE](LICENSE).

The warrior files in `test/warriors/` are community-created works collected from public CoreWar hills. Each file credits its original author.
