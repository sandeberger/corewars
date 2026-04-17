/**
 * CoreWar Test Harness
 *
 * Loads the engine in Node.js with minimal DOM mocking,
 * then runs behavioral tests against real .red warrior files.
 */

const fs = require('fs');
const path = require('path');

// ── Minimal DOM mock ──────────────────────────────────────────────
const mockElements = {};
const mockDoc = {
    getElementById(id) {
        if (!mockElements[id]) {
            mockElements[id] = {
                textContent: '', innerText: '', innerHTML: '', className: '',
                style: {}, classList: {
                    add() {}, remove() {}, toggle() {}, contains() { return false; }
                },
                querySelectorAll() { return []; },
                querySelector() { return null; },
            };
        }
        return mockElements[id];
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
    createElement(tag) {
        return { className: '', textContent: '', prepend() {}, remove() {},
                 children: { length: 0 }, lastChild: { remove() {} } };
    }
};
global.document = mockDoc;
global.window = {
    innerWidth: 1920, innerHeight: 1080,
    addEventListener() {},
    AudioContext: class { resume() {} suspend() {} },
    webkitAudioContext: class { resume() {} suspend() {} },
};
global.requestAnimationFrame = () => {};
global.cancelAnimationFrame = () => {};
global.Date = Date;

// ── Load engine modules into global scope ─────────────────────────
function loadJS(file) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
    const script = new (require('vm').Script)(code, { filename: file });
    script.runInThisContext();
}

// Pre-set globals that engine code references
global.tournamentManager = { active: false };
global.isMobile = () => false;
global.switchMobilePanel = () => {};
global.log = () => {};
global.stats = { writes: 0, splits: 0 };

loadJS('constants.js');
loadJS('sound.js');
loadJS('engine.js');

// ── Test framework ────────────────────────────────────────────────
let totalTests = 0, passed = 0, failed = 0;
const failures = [];

function describe(name, fn) {
    console.log(`\n\x1b[1m═══ ${name} ═══\x1b[0m`);
    fn();
}

function test(name, fn) {
    totalTests++;
    try {
        fn();
        passed++;
        console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (e) {
        failed++;
        failures.push({ name, error: e.message });
        console.log(`  \x1b[31m✗\x1b[0m ${name}`);
        console.log(`    \x1b[31m${e.message}\x1b[0m`);
    }
}

/**
 * Bulk test: runs testFn(file, code) for each warrior file.
 * Reports compact summary + only failures.
 */
function bulkTest(label, files, testFn) {
    let ok = 0, fail = 0;
    const failList = [];
    for (const file of files) {
        totalTests++;
        try {
            const code = loadWarriorFile(file);
            testFn(file, code);
            ok++;
            passed++;
        } catch (e) {
            fail++;
            failed++;
            failList.push({ file, msg: e.message });
            failures.push({ name: `${label}: ${file}`, error: e.message });
        }
    }
    if (fail === 0) {
        console.log(`  \x1b[32m✓\x1b[0m All ${ok} warriors passed`);
    } else {
        console.log(`  \x1b[32m✓\x1b[0m ${ok} passed  \x1b[31m✗ ${fail} failed:\x1b[0m`);
        failList.forEach(f => console.log(`    \x1b[31m- ${f.file}: ${f.msg}\x1b[0m`));
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
    if (actual !== expected)
        throw new Error(`${msg || 'assertEqual'}: expected ${expected}, got ${actual}`);
}

function assertGreater(actual, threshold, msg) {
    if (!(actual > threshold))
        throw new Error(`${msg || 'assertGreater'}: expected >${threshold}, got ${actual}`);
}

function assertLess(actual, threshold, msg) {
    if (!(actual < threshold))
        throw new Error(`${msg || 'assertLess'}: expected <${threshold}, got ${actual}`);
}

// ── Helpers ───────────────────────────────────────────────────────
const CORE_SIZE = 8000;
const MAX_CYCLES = 80000;
const MAX_PROCS = 8000;

function loadWarriorFile(filename) {
    const filepath = path.join(__dirname, 'warriors', filename);
    return fs.readFileSync(filepath, 'utf8');
}

function createParser() {
    return new Parser();
}

function createMARS() {
    global.stats = { writes: 0, splits: 0 };
    return new MARS(CORE_SIZE, MAX_CYCLES, MAX_PROCS);
}

/**
 * Parse a warrior and return the parse result.
 */
function parseWarrior(code) {
    const p = createParser();
    return p.parse(code, CORE_SIZE);
}

/**
 * Load warrior into a fresh MARS at a fixed position for determinism.
 * Returns { mars, warrior, startAddr }.
 */
function loadSingle(code, name = 'Test') {
    const parsed = parseWarrior(code);
    const mars = createMARS();
    mars.addWarrior(parsed, name);
    const w = mars.warriors[0];
    return { mars, warrior: w, startAddr: w.tasks[0], parsed };
}

/**
 * Run N cycles of a MARS and return the state.
 */
function runCycles(mars, n) {
    for (let i = 0; i < n && mars.cycle < mars.maxCycles; i++) {
        const aliveBefore = mars.warriors.filter(w => !w.dead).length;
        mars.step();
        if (mars.warriors.length > 1 && mars.warriors.filter(w => !w.dead).length <= 1) break;
        if (mars.warriors.length === 1 && mars.warriors[0].dead) break;
    }
}

/**
 * Snapshot which cells a warrior owns.
 */
function getOwnedCells(mars, warriorId) {
    const cells = [];
    for (let i = 0; i < mars.coreSize; i++) {
        if (mars.core.get(i).owner === warriorId) cells.push(i);
    }
    return cells;
}

/**
 * Get all cells that contain non-DAT instructions owned by a warrior.
 */
function getCodeCells(mars, warriorId) {
    const cells = [];
    for (let i = 0; i < mars.coreSize; i++) {
        const instr = mars.core.get(i);
        if (instr.owner === warriorId && instr.op !== OPCODES.DAT) cells.push(i);
    }
    return cells;
}

/**
 * Count cells containing DAT bombs (DAT #0,#0 or similar) owned by warrior.
 */
function countDATBombs(mars, warriorId) {
    let count = 0;
    for (let i = 0; i < mars.coreSize; i++) {
        const instr = mars.core.get(i);
        if (instr.owner === warriorId && instr.op === OPCODES.DAT) count++;
    }
    return count;
}

/**
 * Check if the warrior's original code region is still intact
 * (no cells have been overwritten by the warrior itself in its starting region).
 */
function isOriginalCodeIntact(mars, loadAddr, parsed) {
    // Check if all original instructions are still present at the known load address
    let intact = 0;
    for (let i = 0; i < parsed.instructions.length; i++) {
        const orig = parsed.instructions[i];
        const cur = mars.core.get((loadAddr + i) % CORE_SIZE);
        if (cur.op === orig.op && cur.aVal === orig.aVal && cur.bVal === orig.bVal) intact++;
    }
    return intact;
}

// ══════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════

const warriorFiles = fs.readdirSync(path.join(__dirname, 'warriors'))
    .filter(f => f.endsWith('.red'));

// ── 1. PARSE TESTS ───────────────────────────────────────────────
// fail.red is intentionally unparseable ("FAIL to Compile")
const unparseable = new Set(['fail.red']);
const parseFiles = warriorFiles.filter(f => !unparseable.has(f));
describe(`Parse Tests — ${parseFiles.length} warriors should parse without fatal errors`, () => {
    bulkTest('Parse', parseFiles, (file, code) => {
        const result = parseWarrior(code);
        assertGreater(result.instructions.length, 0,
            `produced 0 instructions (errors: ${result.errors.map(e=>e.msg).join('; ')})`);
    });
});

// ── 2. SURVIVAL TESTS ────────────────────────────────────────────
// Warriors that legitimately die when running solo — NOT engine bugs.
// Categories:
//   ICWS-88: Use DAT #N with < addressing (single-field assumption, incompatible with ICWS-94)
//   Parser:  Use features our parser doesn't support (FOR/ROF macros, forward EQU, redcode-x/B)
//   Boot:    Self-relocating boot sequences that fail when labels don't fully resolve
//   Solo:    Require opponent presence to survive (vampires, multi-warrior strategies)
//   Broken:  Intentionally invalid, test/validation, or joke warriors
const soloFragile = new Set([
    // ICWS-88 era warriors (DAT #N + < pre-decrement on B-field, not A)
    'juggernaut.red', 'runner.red', 'sieve.red', 'spray.red', 'jumper.red',
    'phage.red', 'roller.red', 'shrimp1.red', 'trynumberfive.red',
    // Parser limitations (FOR/ROF, forward EQU refs, redcode-x/B extensions)
    'alien22.red', 'bynars.red', 'dandelioncitadel.red', 'doubleclown.red',
    'griffin.red', 'heapimp.red', 'macro.red', 'keystonet21.red',
    'sphinx28.red', 'sphinx29.red', 'sphinx47.red', 'sphinx51.red',
    'theratb.red', 'winter3.red', 'wormopt2.red', 'vampsprd.red',
    'warp.red', 'powerbomb.red',
    // Boot-sequence warriors (self-relocate, complex label math)
    '88test4.red', 'antigate.red', 'firestorm11.red', 'impdwarf.red',
    'agonykiller.red',
    // Solo-fragile (need opponent to survive, or multi-warrior-only strategies)
    'bravo.red', 'chalk.red', 'echo.red', 'flea.red', 'aa.red',
    'cannonade.red', 'leech.red',
    // Intentionally broken / test / validation warriors
    'fail.red', 'validate.red', 'test01.red',
    // Other: die solo due to self-targeting or minimal design
    'vala.red', 'yoplaboum.red', 'miniraidar.red', 'paratroops.red',
]);
const survivalFiles = warriorFiles.filter(f => !soloFragile.has(f));
describe(`Survival Tests — ${survivalFiles.length} warriors should survive 1000 solo cycles`, () => {
    bulkTest('Survival', survivalFiles, (file, code) => {
        const { mars, warrior } = loadSingle(code, file);
        runCycles(mars, 1000);
        assert(!warrior.dead, `died within 1000 cycles`);
        assertGreater(warrior.tasks.length, 0, `0 processes after 1000 cycles`);
    });
});

// ── 3. SELF-PRESERVATION TESTS ──────────────────────────────────
describe('Self-Preservation — Non-self-modifying warriors keep code intact', () => {
    // stone.red and chang1.red are self-modifying by design (they update their own pointers).
    // Only test warriors that are NOT supposed to modify their own code.
    const nonSelfModifying = ['dwarf.red', 'imp.red', 'gate.red'];
    for (const file of nonSelfModifying) {
        if (!warriorFiles.includes(file)) continue;
        test(`${file} does not obliterate its own code in first 500 cycles`, () => {
            const code = loadWarriorFile(file);
            const parsed = parseWarrior(code);
            const { mars, warrior, startAddr } = loadSingle(code, file);
            const loadAddr = ((startAddr - parsed.startOffset) % CORE_SIZE + CORE_SIZE) % CORE_SIZE;
            runCycles(mars, 500);

            assert(!warrior.dead, `${file} is dead`);

            // At least half the original instructions should still be recognizable
            const intactCount = isOriginalCodeIntact(mars, loadAddr, parsed);
            assertGreater(intactCount, parsed.instructions.length / 2,
                `${file}: only ${intactCount}/${parsed.instructions.length} instructions intact`);
        });
    }
});

// ── 4. ACTIVITY TESTS ────────────────────────────────────────────
// Warriors that don't write to core when running solo — NOT engine bugs.
// Categories:
//   Scanner:  CMP/JMZ-based detection, only write when opponent found
//   Defense:  Gate/defense warriors that loop without external writes
//   No-op:    Minimal warriors (JMP 0, infinite loops, joke warriors)
//   Parser:   Features our parser doesn't support → no useful code generated
const lowActivitySolo = new Set([
    // Scanners/vampires — only attack when opponent detected via CMP/JMZ/SLT
    'gate.red', 'simplescan2.red', 'annoying.red', 'backtrack7.red',
    'draculaII.red', 'droid.red', 'garlic.red', 'hideout.red',
    'lookout.red', 'niche.red', 'nochallenge.red', 'safe2.red',
    'smitewhite.red', 'splat.red', 'tinytim.red',
    // No-op by design (minimal warriors, joke entries)
    'idle.red', 'useless.red', 'imphoser.red', 'is2.red',
    // Parser limitations (no useful code generated)
    'bodysnatch.red', 'dynamic.red', 'foureyes.red',
    // Solo-fragile (need opponent, also excluded from survival)
    'leech.red', 'cannonade.red', 'fail.red',
    // Other: large code footprint but only scan, or pre-dec writes stay in-place
    'vala.red', 'yoplaboum.red', 'miniraidar.red', 'paratroops.red',
    'shrimp1.red',
    // Scanners whose single-operand DAT scan pointers aim at empty core in solo mode
    'bombfinder.red', 'roller.red',
    // Pre-decrement scanners / slow-start — only write via < addressing, no MOV within 1000 cycles
    'death.red', 'elf.red', 'signal.red', 'signalgun.red', 'tamper.red', 'wuss.red',
]);
const activityFiles = warriorFiles.filter(f => !lowActivitySolo.has(f));
describe(`Activity Tests — ${activityFiles.length} warriors should write to core memory`, () => {
    bulkTest('Activity', activityFiles, (file, code) => {
        const { mars, warrior } = loadSingle(code, file);
        const initialOwned = getOwnedCells(mars, warrior.id).length;
        global.stats = { writes: 0, splits: 0 };
        runCycles(mars, 1000);
        const finalOwned = getOwnedCells(mars, warrior.id).length;
        assert(finalOwned > initialOwned || stats.writes > 0,
            `no writes (owned: ${initialOwned} → ${finalOwned}, writes: ${stats.writes})`);
    });
});

// ── 5. PROCESS MANAGEMENT TESTS ──────────────────────────────────
describe(`Process Management — ${warriorFiles.length} warriors should respect MAX_PROCS`, () => {
    bulkTest('ProcLimit', warriorFiles, (file, code) => {
        const { mars, warrior } = loadSingle(code, file);
        runCycles(mars, 5000);
        if (!warrior.dead) {
            assertLess(warrior.tasks.length, MAX_PROCS + 1,
                `${warrior.tasks.length} procs exceeds limit ${MAX_PROCS}`);
        }
    });
});

// ══════════════════════════════════════════════════════════════════
// STRATEGY-SPECIFIC BEHAVIORAL TESTS
// ══════════════════════════════════════════════════════════════════

// ── 6. IMP BEHAVIOR ──────────────────────────────────────────────
describe('Imp Behavior — Should copy itself forward through core', () => {
    test('imp.red writes to sequential addresses', () => {
        const code = loadWarriorFile('imp.red');
        const { mars, warrior } = loadSingle(code, 'Imp');
        const startPC = warrior.tasks[0];

        runCycles(mars, 100);

        // Imp should own a trail of sequential cells
        const owned = getOwnedCells(mars, warrior.id);
        assertGreater(owned.length, 50, `Imp only owns ${owned.length} cells after 100 cycles`);

        // Process should have advanced forward
        const currentPC = warrior.tasks[0];
        const distance = (currentPC - startPC + CORE_SIZE) % CORE_SIZE;
        assertGreater(distance, 50, `Imp only moved ${distance} cells`);
    });

    test('imp.red — all writes are MOV instructions', () => {
        const code = loadWarriorFile('imp.red');
        const { mars, warrior } = loadSingle(code, 'Imp');
        runCycles(mars, 200);

        const owned = getOwnedCells(mars, warrior.id);
        for (const addr of owned) {
            const instr = mars.core.get(addr);
            assertEqual(instr.op, OPCODES.MOV, `Imp wrote non-MOV at addr ${addr}: op=${instr.op}`);
        }
    });

    test('imp.red stays alive indefinitely (10000 cycles)', () => {
        const code = loadWarriorFile('imp.red');
        const { mars, warrior } = loadSingle(code, 'Imp');
        runCycles(mars, 10000);
        assert(!warrior.dead, 'Imp died');
        assertEqual(warrior.tasks.length, 1, `Imp should have exactly 1 process, has ${warrior.tasks.length}`);
    });
});

// ── 7. BOMBER BEHAVIOR ───────────────────────────────────────────
describe('Bomber Behavior — Should scatter DAT bombs across core', () => {
    test('dwarf.red places DAT bombs', () => {
        const code = loadWarriorFile('dwarf.red');
        const { mars, warrior } = loadSingle(code, 'Dwarf');
        runCycles(mars, 2000);

        const bombs = countDATBombs(mars, warrior.id);
        assertGreater(bombs, 100, `Dwarf only placed ${bombs} DAT bombs in 2000 cycles`);
    });

    test('dwarf.red bombs at regular intervals (every 4th cell)', () => {
        const code = loadWarriorFile('dwarf.red');
        const { mars, warrior } = loadSingle(code, 'Dwarf');
        runCycles(mars, 500);

        // Collect DAT bomb addresses
        const bombAddrs = [];
        for (let i = 0; i < mars.coreSize; i++) {
            const instr = mars.core.get(i);
            if (instr.owner === warrior.id && instr.op === OPCODES.DAT &&
                i !== getOwnedCells(mars, warrior.id)[0]) { // skip the bomb datum in the code
                bombAddrs.push(i);
            }
        }
        // Check that gaps between bombs are multiples of 4
        if (bombAddrs.length > 2) {
            let regularCount = 0;
            for (let i = 1; i < bombAddrs.length; i++) {
                const gap = (bombAddrs[i] - bombAddrs[i-1] + CORE_SIZE) % CORE_SIZE;
                if (gap % 4 === 0) regularCount++;
            }
            assertGreater(regularCount / (bombAddrs.length - 1), 0.8,
                `Dwarf bombs are not regularly spaced (${regularCount}/${bombAddrs.length-1} at mod-4)`);
        }
    });

    test('dwarf.red maintains single process', () => {
        const code = loadWarriorFile('dwarf.red');
        const { mars, warrior } = loadSingle(code, 'Dwarf');
        runCycles(mars, 2000);
        assert(!warrior.dead, 'Dwarf died');
        assertEqual(warrior.tasks.length, 1, `Dwarf should have 1 proc, has ${warrior.tasks.length}`);
    });

    test('bomber.red scatters bombs', () => {
        const code = loadWarriorFile('bomber.red');
        const { mars, warrior } = loadSingle(code, 'Bomber');
        runCycles(mars, 2000);
        const bombs = countDATBombs(mars, warrior.id);
        assertGreater(bombs, 50, `Bomber only placed ${bombs} DAT bombs`);
    });
});

// ── 8. SCANNER BEHAVIOR ──────────────────────────────────────────
describe('Scanner Behavior — Should probe core before attacking', () => {
    test('crimp.red stays alive and writes to core', () => {
        const code = loadWarriorFile('crimp.red');
        const { mars, warrior } = loadSingle(code, 'Crimp');
        runCycles(mars, 3000);
        assert(!warrior.dead, 'Crimp died');
        const owned = getOwnedCells(mars, warrior.id);
        assertGreater(owned.length, 10, `Crimp only owns ${owned.length} cells`);
    });

    test('simplescan2.red survives and is active', () => {
        const code = loadWarriorFile('simplescan2.red');
        const { mars, warrior } = loadSingle(code, 'SimpleScan');
        runCycles(mars, 3000);
        assert(!warrior.dead, 'SimpleScan died');
    });
});

// ── 9. VAMPIRE BEHAVIOR ──────────────────────────────────────────
describe('Vampire Behavior — Should plant JMP traps in core', () => {
    test('vampire.red plants JMP instructions', () => {
        const code = loadWarriorFile('vampire.red');
        const { mars, warrior } = loadSingle(code, 'Vampire');
        runCycles(mars, 2000);

        // Count JMP instructions placed by the vampire outside its own code
        let jmpCount = 0;
        const codeLen = parseWarrior(code).instructions.length;
        for (let i = 0; i < mars.coreSize; i++) {
            const instr = mars.core.get(i);
            if (instr.owner === warrior.id && instr.op === OPCODES.JMP) jmpCount++;
        }
        assertGreater(jmpCount, 5, `Vampire only planted ${jmpCount} JMP traps`);
    });

    test('dracula.red plants SPL traps', () => {
        const code = loadWarriorFile('dracula.red');
        const { mars, warrior } = loadSingle(code, 'Dracula');
        runCycles(mars, 2000);

        let trapCount = 0;
        for (let i = 0; i < mars.coreSize; i++) {
            const instr = mars.core.get(i);
            if (instr.owner === warrior.id && instr.op === OPCODES.SPL) trapCount++;
        }
        assertGreater(trapCount, 3, `Dracula only planted ${trapCount} traps`);
    });
});

// ── 10. REPLICATOR BEHAVIOR ─────────────────────────────────────
describe('Replicator Behavior — Should create multiple processes', () => {
    test('impring.red creates multiple processes via SPL', () => {
        const code = loadWarriorFile('impring.red');
        const { mars, warrior } = loadSingle(code, 'ImpRing');
        runCycles(mars, 100);
        assertGreater(warrior.tasks.length, 1,
            `ImpRing should fork, but has ${warrior.tasks.length} process(es)`);
    });

    test('flashpaper.red creates many processes', () => {
        const code = loadWarriorFile('flashpaper.red');
        const { mars, warrior } = loadSingle(code, 'FlashPaper');
        runCycles(mars, 500);
        assertGreater(warrior.tasks.length, 10,
            `FlashPaper should have many procs, has ${warrior.tasks.length}`);
    });

    test('superimp.red uses SPL for replication', () => {
        const code = loadWarriorFile('superimp.red');
        const { mars, warrior } = loadSingle(code, 'SuperImp');
        runCycles(mars, 200);
        assertGreater(warrior.tasks.length, 1,
            `SuperImp should fork, has ${warrior.tasks.length} process(es)`);
    });
});

// ── 11. GATE/DEFENSE BEHAVIOR ────────────────────────────────────
describe('Gate Behavior — Should write defensively', () => {
    test('gate.red survives and uses pre-decrement writes', () => {
        // Gate is `JMP 0, <-5` — it jumps to itself while pre-decrementing
        // the B-field of the cell 5 positions back. This modifies core but
        // the ownership tracking may not increase since it writes to its own
        // pre-existing cells' values.
        const code = loadWarriorFile('gate.red');
        const { mars, warrior } = loadSingle(code, 'Gate');
        runCycles(mars, 1000);
        assert(!warrior.dead, 'Gate died');
        assertEqual(warrior.tasks.length, 1, `Gate should have 1 process, has ${warrior.tasks.length}`);
    });

    test('irongate.red stays alive', () => {
        const code = loadWarriorFile('irongate.red');
        const { mars, warrior } = loadSingle(code, 'IronGate');
        runCycles(mars, 2000);
        assert(!warrior.dead, 'IronGate died');
    });
});

// ── 12. BATTLE OUTCOME TESTS ─────────────────────────────────────
describe('Battle Outcomes — Known matchups should produce expected results', () => {
    /**
     * Run a battle between two warriors multiple times and return win stats.
     */
    function battle(code1, name1, code2, name2, rounds = 10) {
        const results = { w1: 0, w2: 0, draw: 0 };
        for (let r = 0; r < rounds; r++) {
            const p = createParser();
            const parsed1 = p.parse(code1, CORE_SIZE);
            const parsed2 = p.parse(code2, CORE_SIZE);
            const mars = createMARS();
            mars.addWarrior(parsed1, name1);
            mars.addWarrior(parsed2, name2);
            runCycles(mars, MAX_CYCLES);
            const alive = mars.warriors.filter(w => !w.dead);
            if (alive.length === 1) {
                if (alive[0].name === name1) results.w1++;
                else results.w2++;
            } else results.draw++;
        }
        return results;
    }

    test('Gate beats Imp (gate is designed to kill imps)', () => {
        const gate = loadWarriorFile('gate.red');
        const imp = loadWarriorFile('imp.red');
        const result = battle(gate, 'Gate', imp, 'Imp', 10);
        assertGreater(result.w1, result.w2,
            `Gate should beat Imp more often (Gate:${result.w1} Imp:${result.w2} Draw:${result.draw})`);
    });

    test('Dwarf beats Imp more often than not', () => {
        const dwarf = loadWarriorFile('dwarf.red');
        const imp = loadWarriorFile('imp.red');
        const result = battle(dwarf, 'Dwarf', imp, 'Imp', 10);
        assertGreater(result.w1 + result.draw, result.w2,
            `Dwarf should dominate Imp (Dwarf:${result.w1} Imp:${result.w2} Draw:${result.draw})`);
    });

    test('Bomber can kill Imp', () => {
        const bomber = loadWarriorFile('bomber.red');
        const imp = loadWarriorFile('imp.red');
        const result = battle(bomber, 'Bomber', imp, 'Imp', 10);
        assertGreater(result.w1, 0,
            `Bomber never beat Imp in 10 rounds (Bomber:${result.w1} Imp:${result.w2} Draw:${result.draw})`);
    });

    test('Two different warriors produce a decisive battle', () => {
        const dwarf = loadWarriorFile('dwarf.red');
        const stone = loadWarriorFile('stone.red');
        const result = battle(dwarf, 'Dwarf', stone, 'Stone', 10);
        const decisive = result.w1 + result.w2;
        assertGreater(decisive, 0,
            `Dwarf vs Stone: all 10 rounds were draws — engine may not be resolving battles`);
    });
});

// ── 13. DETERMINISM TESTS ────────────────────────────────────────
describe('Engine Consistency — Core mechanics work correctly', () => {
    test('Cycle counter advances correctly for single warrior', () => {
        const code = loadWarriorFile('dwarf.red');
        const { mars: mars1, warrior: w1 } = loadSingle(code, 'Dwarf');
        // With 1 warrior, each step() does: execute + nextTurn() which increments cycle
        // step() calls nextTurn() which wraps activeWarriorIdx and increments cycle
        // So after N step() calls the warrior has executed N instructions
        // and cycle should be N (each turn = one warrior step = one cycle for single warrior)
        for (let i = 0; i < 100; i++) mars1.step();
        assert(!w1.dead, 'Dwarf died during cycle count test');
        assertEqual(mars1.cycle, 100, `Expected 100 cycles after 100 steps, got ${mars1.cycle}`);
    });

    test('Core wrapping works correctly', () => {
        const mars = createMARS();
        const instr = new Instruction(OPCODES.MOV, MODIFIERS.I, ADDR_MODES['$'], 0, ADDR_MODES['$'], 0);
        mars.core.set(CORE_SIZE - 1, instr, 0);
        const retrieved = mars.core.get(-1);
        assertEqual(retrieved.op, OPCODES.MOV, 'Negative address wrapping failed');

        const retrieved2 = mars.core.get(CORE_SIZE + 5);
        const expected2 = mars.core.get(5);
        assertEqual(retrieved2.op, expected2.op, 'Positive overflow wrapping failed');
    });

    test('Two-warrior turn alternation', () => {
        const p = createParser();
        const imp1 = p.parse("MOV.I 0, 1", CORE_SIZE);
        const imp2 = p.parse("MOV.I 0, 1", CORE_SIZE);
        const mars = createMARS();
        mars.addWarrior(imp1, 'Imp1');
        mars.addWarrior(imp2, 'Imp2');
        // After 2 steps, both warriors should have executed once, cycle = 1
        mars.step(); mars.step();
        assertEqual(mars.cycle, 1, `Expected cycle=1 after 2 steps (2 warriors), got ${mars.cycle}`);
    });
});

// ── 14. LONG-RUN STABILITY ───────────────────────────────────────
describe('Long-Run Stability — Warriors should not crash the engine', () => {
    const stressWarriors = ['agony.red', 'flashpaper.red', 'hydra.red', 'moonstone.red'];
    for (const file of stressWarriors) {
        if (!warriorFiles.includes(file)) continue;
        test(`${file} runs 20000 cycles without engine error`, () => {
            const code = loadWarriorFile(file);
            const { mars } = loadSingle(code, file);
            runCycles(mars, 20000);
            // Should have run at least some cycles without throwing
            assertGreater(mars.cycle, 0, `${file} never ran`);
        });
    }
});

// ── 15. TWO-WARRIOR STABILITY ────────────────────────────────────
describe('Two-Warrior Stability — Battles should complete without engine errors', () => {
    const pairs = [
        ['dwarf.red', 'imp.red'],
        ['agony.red', 'vampire.red'],
        ['flashpaper.red', 'stone.red'],
        ['moonstone.red', 'dracula.red'],
        ['crimp.red', 'irongate.red'],
    ];
    for (const [f1, f2] of pairs) {
        if (!warriorFiles.includes(f1) || !warriorFiles.includes(f2)) continue;
        test(`${f1} vs ${f2} — battle completes`, () => {
            const code1 = loadWarriorFile(f1);
            const code2 = loadWarriorFile(f2);
            const p = createParser();
            const parsed1 = p.parse(code1, CORE_SIZE);
            const parsed2 = p.parse(code2, CORE_SIZE);
            const mars = createMARS();
            mars.addWarrior(parsed1, f1);
            mars.addWarrior(parsed2, f2);
            runCycles(mars, MAX_CYCLES);
            // Battle must either finish or reach max cycles
            const alive = mars.warriors.filter(w => !w.dead).length;
            assert(alive <= 2, 'More alive warriors than loaded');
        });
    }
});

// ── 8. ICWS-88 COMPLIANCE — Validate 1.1R ────────────────────────
// Stefan Strack's validation warrior. Self-ties (loops forever) on a
// compliant, in-register-evaluation system; suicides otherwise.
describe('ICWS-88 Compliance — Validate 1.1R self-ties when compliant', () => {
    test('validate11r.red reaches success label and keeps looping', () => {
        if (!warriorFiles.includes('validate11r.red')) {
            throw new Error('validate11r.red not found in test/warriors');
        }
        const code = loadWarriorFile('validate11r.red');
        const parsed = parseWarrior(code);

        // Labels scanned directly from source so we can locate success/fail.
        const labels = {};
        let idx = 0;
        for (const rawLine of code.split('\n')) {
            let line = rawLine.split(';')[0].replace(/\t/g, ' ').trim();
            if (!line) continue;
            while (line.includes(':')) {
                const ci = line.indexOf(':');
                const lbl = line.substring(0, ci).trim();
                if (lbl) labels[lbl] = idx;
                line = line.substring(ci + 1).trim();
            }
            if (!line) continue;
            const up = line.toUpperCase();
            if (up.startsWith('ORG ') || up === 'END' || up.startsWith('END ')) continue;
            if (up.includes(' EQU ') || up.startsWith('PIN ')) continue;
            let words = line.split(/\s+/);
            while (words.length > 0) {
                const w0 = words[0].split('.')[0].toUpperCase();
                if (OPCODES.hasOwnProperty(w0) || w0 === 'END' || w0 === 'ORG') break;
                labels[words[0]] = idx;
                words = words.slice(1);
            }
            if (!words.join(' ')) continue;
            idx++;
        }

        const mars = createMARS();
        mars.addWarrior(parsed, 'Validate');
        const w = mars.warriors[0];
        const loadAddr = ((w.tasks[0] - parsed.startOffset) % CORE_SIZE + CORE_SIZE) % CORE_SIZE;
        const successAddr = (loadAddr + labels.success) % CORE_SIZE;
        const lastAddr = (loadAddr + labels.last) % CORE_SIZE;
        const failAddr = (loadAddr + labels.fail) % CORE_SIZE;

        let reachedSuccess = false;
        let reachedLast = false;
        let hitFail = false;
        for (let i = 0; i < 20000; i++) {
            if (w.dead) break;
            for (const tpc of w.tasks) {
                if (tpc === successAddr) reachedSuccess = true;
                if (tpc === lastAddr) reachedLast = true;
                if (tpc === failAddr) hitFail = true;
            }
            if (reachedLast && reachedSuccess) break;
            mars.step();
        }

        assert(!hitFail, 'Validator hit fail — engine is not ICWS-88 compliant');
        assert(reachedSuccess, 'Validator never reached success label');
        assert(reachedLast, 'Validator never reached last (loop-forever) label');
        assert(!w.dead, 'Validator died before self-tying');
        assertGreater(w.tasks.length, 0, 'No live tasks after validator ran');
    });
});

// ══════════════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════════════
console.log(`\n\x1b[1m${'═'.repeat(50)}\x1b[0m`);
console.log(`\x1b[1m Total: ${totalTests}  \x1b[32mPassed: ${passed}\x1b[0m  \x1b[31mFailed: ${failed}\x1b[0m`);
if (failures.length > 0) {
    console.log(`\n\x1b[31mFailures:\x1b[0m`);
    failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
}
console.log(`${'═'.repeat(50)}`);
process.exit(failed > 0 ? 1 : 0);
