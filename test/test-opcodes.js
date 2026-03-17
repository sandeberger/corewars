/**
 * ICWS-94 Opcode & Addressing Mode Tests
 *
 * Tests every instruction, modifier, and addressing mode defined in the
 * ICWS-94 standard by directly placing instructions in the core and
 * verifying results after execution.
 */

const fs = require('fs');
const path = require('path');

// ── Minimal DOM mock ──────────────────────────────────────────────
const mockElements = {};
global.document = {
    getElementById(id) {
        if (!mockElements[id]) {
            mockElements[id] = {
                textContent: '', innerText: '', innerHTML: '', className: '',
                style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
                querySelectorAll() { return []; }, querySelector() { return null; },
            };
        }
        return mockElements[id];
    },
    querySelectorAll() { return []; }, querySelector() { return null; },
    addEventListener() {},
    createElement() { return { className: '', textContent: '', prepend() {}, remove() {}, children: { length: 0 }, lastChild: { remove() {} } }; }
};
global.window = { innerWidth: 1920, innerHeight: 1080, addEventListener() {}, AudioContext: class { resume() {} suspend() {} } };
global.requestAnimationFrame = () => {};
global.cancelAnimationFrame = () => {};
global.Date = Date;
global.tournamentManager = { active: false };
global.isMobile = () => false;
global.switchMobilePanel = () => {};
global.log = () => {};
global.stats = { writes: 0, splits: 0 };

// ── Load engine ───────────────────────────────────────────────────
function loadJS(file) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
    new (require('vm').Script)(code, { filename: file }).runInThisContext();
}
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

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg || 'assertEqual'}: expected ${b}, got ${a}`); }

// ── Helpers ───────────────────────────────────────────────────────
const CS = 8000;
const BASE = 100; // fixed base address for determinism

function I(op, mod, aMode, aVal, bMode, bVal) {
    return new Instruction(op, mod, aMode, aVal, bMode, bVal);
}

/**
 * Create a MARS, place instructions at BASE, create a warrior starting at BASE+startOffset,
 * and return { mars, warrior }.
 */
function setup(instrs, startOffset = 0) {
    global.stats = { writes: 0, splits: 0 };
    const mars = new MARS(CS, 80000, 8000);
    for (let i = 0; i < instrs.length; i++) {
        mars.core.set(BASE + i, instrs[i], 0);
    }
    const w = new Warrior(0, 'test', [], BASE + startOffset, null, mars.pSpaceSize);
    mars.warriors.push(w);
    return { mars, warrior: w };
}

/** Run n steps */
function step(mars, n = 1) {
    for (let i = 0; i < n; i++) mars.step();
}

/** Get core cell at BASE+offset */
function cell(mars, offset) { return mars.core.get(BASE + offset); }

/** Current PC of first process */
function pc(warrior) { return warrior.tasks.length > 0 ? warrior.tasks[0] : -1; }

// Shorthand constants
const O = OPCODES, M = MODIFIERS, A = ADDR_MODES;

// ══════════════════════════════════════════════════════════════════
// DAT
// ══════════════════════════════════════════════════════════════════
describe('DAT — Terminates the current process', () => {
    test('DAT kills the only process', () => {
        const { mars, warrior } = setup([
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
        ]);
        step(mars);
        assertEqual(warrior.tasks.length, 0, 'should have 0 processes');
        // warrior.dead is set on the NEXT step() call (lazy check)
        step(mars);
        assert(warrior.dead, 'warrior should be dead');
    });

    test('DAT kills one process but warrior survives with others', () => {
        const { mars, warrior } = setup([
            I(O.JMP, M.B, A['$'], 0, A['$'], 0), // [0] infinite loop
            I(O.DAT, M.F, A['#'], 0, A['#'], 0), // [1] death
        ]);
        // Add a second process pointing to the DAT
        warrior.tasks.push(BASE + 1);
        step(mars); // first process executes JMP 0 → survives
        step(mars); // second process executes DAT → dies
        assertEqual(warrior.tasks.length, 1, 'should have 1 process left');
        assert(!warrior.dead, 'warrior should still be alive');
    });
});

// ══════════════════════════════════════════════════════════════════
// MOV — all 7 modifiers
// ══════════════════════════════════════════════════════════════════
describe('MOV — Copy data between core cells', () => {
    test('MOV.A copies A-field of source to A-field of dest', () => {
        const { mars } = setup([
            I(O.MOV, M.A, A['$'], 1, A['$'], 2),   // MOV.A $1, $2
            I(O.DAT, M.F, A['#'], 42, A['#'], 99),  // source: A=42, B=99
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),    // dest: A=0, B=0
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 42, 'A-field should be 42');
        assertEqual(cell(mars, 2).bVal, 0, 'B-field should be unchanged');
    });

    test('MOV.B copies B-field of source to B-field of dest', () => {
        const { mars } = setup([
            I(O.MOV, M.B, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 42, A['#'], 99),
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 0, 'A-field should be unchanged');
        assertEqual(cell(mars, 2).bVal, 99, 'B-field should be 99');
    });

    test('MOV.AB copies A-field of source to B-field of dest', () => {
        const { mars } = setup([
            I(O.MOV, M.AB, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 42, A['#'], 99),
            I(O.DAT, M.F, A['#'], 10, A['#'], 20),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 10, 'A-field unchanged');
        assertEqual(cell(mars, 2).bVal, 42, 'B-field = source A');
    });

    test('MOV.BA copies B-field of source to A-field of dest', () => {
        const { mars } = setup([
            I(O.MOV, M.BA, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 42, A['#'], 99),
            I(O.DAT, M.F, A['#'], 10, A['#'], 20),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 99, 'A-field = source B');
        assertEqual(cell(mars, 2).bVal, 20, 'B-field unchanged');
    });

    test('MOV.F copies both A and B fields', () => {
        const { mars } = setup([
            I(O.MOV, M.F, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 42, A['#'], 99),
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 42, 'A-field copied');
        assertEqual(cell(mars, 2).bVal, 99, 'B-field copied');
    });

    test('MOV.X cross-copies A→B and B→A', () => {
        const { mars } = setup([
            I(O.MOV, M.X, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 42, A['#'], 99),
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 99, 'A-field = source B');
        assertEqual(cell(mars, 2).bVal, 42, 'B-field = source A');
    });

    test('MOV.I copies entire instruction', () => {
        const { mars } = setup([
            I(O.MOV, M.I, A['$'], 1, A['$'], 2),
            I(O.ADD, M.AB, A['#'], 42, A['@'], 99),
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
        ]);
        step(mars);
        const d = cell(mars, 2);
        assertEqual(d.op, O.ADD, 'opcode copied');
        assertEqual(d.mod, M.AB, 'modifier copied');
        assertEqual(d.aMode, A['#'], 'A-mode copied');
        assertEqual(d.aVal, 42, 'A-val copied');
        assertEqual(d.bMode, A['@'], 'B-mode copied');
        assertEqual(d.bVal, 99, 'B-val copied');
    });

    test('MOV with immediate source uses instruction itself', () => {
        // MOV.AB #5, $1 → dest.B = 5 (A-field of the MOV instruction itself)
        const { mars } = setup([
            I(O.MOV, M.AB, A['#'], 5, A['$'], 1),
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 5, 'immediate A-field written to dest B');
    });
});

// ══════════════════════════════════════════════════════════════════
// ADD — all modifiers
// ══════════════════════════════════════════════════════════════════
describe('ADD — Arithmetic addition', () => {
    test('ADD.A: dest.A += src.A', () => {
        const { mars } = setup([
            I(O.ADD, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 10, A['#'], 20),
            I(O.DAT, M.F, A['#'], 100, A['#'], 200),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 110, 'A: 100+10');
        assertEqual(cell(mars, 2).bVal, 200, 'B unchanged');
    });

    test('ADD.B: dest.B += src.B', () => {
        const { mars } = setup([
            I(O.ADD, M.B, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 10, A['#'], 20),
            I(O.DAT, M.F, A['#'], 100, A['#'], 200),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 100, 'A unchanged');
        assertEqual(cell(mars, 2).bVal, 220, 'B: 200+20');
    });

    test('ADD.AB: dest.B += src.A', () => {
        const { mars } = setup([
            I(O.ADD, M.AB, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 10, A['#'], 20),
            I(O.DAT, M.F, A['#'], 100, A['#'], 200),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).bVal, 210, 'B: 200+10');
        assertEqual(cell(mars, 2).aVal, 100, 'A unchanged');
    });

    test('ADD.BA: dest.A += src.B', () => {
        const { mars } = setup([
            I(O.ADD, M.BA, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 10, A['#'], 20),
            I(O.DAT, M.F, A['#'], 100, A['#'], 200),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 120, 'A: 100+20');
        assertEqual(cell(mars, 2).bVal, 200, 'B unchanged');
    });

    test('ADD.F: both fields added in parallel', () => {
        const { mars } = setup([
            I(O.ADD, M.F, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 10, A['#'], 20),
            I(O.DAT, M.F, A['#'], 100, A['#'], 200),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 110, 'A: 100+10');
        assertEqual(cell(mars, 2).bVal, 220, 'B: 200+20');
    });

    test('ADD.X: cross-add (dest.A += src.B, dest.B += src.A)', () => {
        const { mars } = setup([
            I(O.ADD, M.X, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 10, A['#'], 20),
            I(O.DAT, M.F, A['#'], 100, A['#'], 200),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 120, 'A: 100+20');
        assertEqual(cell(mars, 2).bVal, 210, 'B: 200+10');
    });

    test('ADD wraps at core size', () => {
        const { mars } = setup([
            I(O.ADD, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 5000, A['#'], 0),
            I(O.DAT, M.F, A['#'], 5000, A['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 2000, 'wraps: (5000+5000)%8000 = 2000');
    });

    test('ADD.AB with immediate source', () => {
        // ADD #7, $1 → dest.B += 7 (default modifier for ADD with # source)
        const { mars } = setup([
            I(O.ADD, M.AB, A['#'], 7, A['$'], 1),
            I(O.DAT, M.F, A['#'], 100, A['#'], 200),
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 207, 'B: 200+7');
    });
});

// ══════════════════════════════════════════════════════════════════
// SUB — Arithmetic subtraction
// ══════════════════════════════════════════════════════════════════
describe('SUB — Arithmetic subtraction', () => {
    test('SUB.A: dest.A -= src.A', () => {
        const { mars } = setup([
            I(O.SUB, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 10, A['#'], 0),
            I(O.DAT, M.F, A['#'], 100, A['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 90, 'A: 100-10');
    });

    test('SUB.B: dest.B -= src.B', () => {
        const { mars } = setup([
            I(O.SUB, M.B, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 0, A['#'], 30),
            I(O.DAT, M.F, A['#'], 0, A['#'], 100),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).bVal, 70, 'B: 100-30');
    });

    test('SUB.AB: dest.B -= src.A', () => {
        const { mars } = setup([
            I(O.SUB, M.AB, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 25, A['#'], 0),
            I(O.DAT, M.F, A['#'], 0, A['#'], 100),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).bVal, 75, 'B: 100-25');
    });

    test('SUB.F: both fields subtracted', () => {
        const { mars } = setup([
            I(O.SUB, M.F, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 10, A['#'], 20),
            I(O.DAT, M.F, A['#'], 100, A['#'], 200),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 90, 'A: 100-10');
        assertEqual(cell(mars, 2).bVal, 180, 'B: 200-20');
    });

    test('SUB wraps negative values', () => {
        const { mars } = setup([
            I(O.SUB, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 100, A['#'], 0),
            I(O.DAT, M.F, A['#'], 10, A['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, CS - 90, 'wraps: (10-100+8000)%8000 = 7910');
    });
});

// ══════════════════════════════════════════════════════════════════
// MUL — Multiplication
// ══════════════════════════════════════════════════════════════════
describe('MUL — Multiplication', () => {
    test('MUL.A: dest.A *= src.A', () => {
        const { mars } = setup([
            I(O.MUL, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 7, A['#'], 0),
            I(O.DAT, M.F, A['#'], 6, A['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 42, 'A: 6*7');
    });

    test('MUL.AB: dest.B *= src.A', () => {
        const { mars } = setup([
            I(O.MUL, M.AB, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 5, A['#'], 0),
            I(O.DAT, M.F, A['#'], 0, A['#'], 100),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).bVal, 500, 'B: 100*5');
    });

    test('MUL.F: both fields multiplied', () => {
        const { mars } = setup([
            I(O.MUL, M.F, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 3, A['#'], 4),
            I(O.DAT, M.F, A['#'], 10, A['#'], 20),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 30, 'A: 10*3');
        assertEqual(cell(mars, 2).bVal, 80, 'B: 20*4');
    });

    test('MUL.X: cross-multiply', () => {
        const { mars } = setup([
            I(O.MUL, M.X, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 3, A['#'], 5),
            I(O.DAT, M.F, A['#'], 10, A['#'], 20),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 50, 'A: 10*5');
        assertEqual(cell(mars, 2).bVal, 60, 'B: 20*3');
    });

    test('MUL wraps at core size', () => {
        const { mars } = setup([
            I(O.MUL, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 1000, A['#'], 0),
            I(O.DAT, M.F, A['#'], 1000, A['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, (1000 * 1000) % CS, 'wraps: 1000000%8000');
    });

    test('MUL by zero', () => {
        const { mars } = setup([
            I(O.MUL, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
            I(O.DAT, M.F, A['#'], 42, A['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 0, 'A: 42*0 = 0');
    });
});

// ══════════════════════════════════════════════════════════════════
// DIV — Division (kills process on divide-by-zero)
// ══════════════════════════════════════════════════════════════════
describe('DIV — Integer division', () => {
    test('DIV.A: dest.A /= src.A', () => {
        const { mars } = setup([
            I(O.DIV, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 3, A['#'], 0),
            I(O.DAT, M.F, A['#'], 10, A['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 3, 'A: floor(10/3)');
    });

    test('DIV.B: dest.B /= src.B', () => {
        const { mars } = setup([
            I(O.DIV, M.B, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 0, A['#'], 4),
            I(O.DAT, M.F, A['#'], 0, A['#'], 20),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).bVal, 5, 'B: 20/4');
    });

    test('DIV.AB: dest.B /= src.A', () => {
        const { mars } = setup([
            I(O.DIV, M.AB, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 5, A['#'], 0),
            I(O.DAT, M.F, A['#'], 0, A['#'], 25),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).bVal, 5, 'B: 25/5');
    });

    test('DIV.F: both fields divided', () => {
        const { mars } = setup([
            I(O.DIV, M.F, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 3, A['#'], 7),
            I(O.DAT, M.F, A['#'], 21, A['#'], 49),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 7, 'A: 21/3');
        assertEqual(cell(mars, 2).bVal, 7, 'B: 49/7');
    });

    test('DIV by zero kills process (single field)', () => {
        const { mars, warrior } = setup([
            I(O.DIV, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 0, A['#'], 5),  // A=0 → divide by zero
            I(O.DAT, M.F, A['#'], 10, A['#'], 20),
        ]);
        step(mars);
        assertEqual(warrior.tasks.length, 0, 'process killed by div/0');
    });

    test('DIV.F by zero in one field kills process', () => {
        const { mars, warrior } = setup([
            I(O.DIV, M.F, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 3, A['#'], 0),  // B=0 → one field divides by zero
            I(O.DAT, M.F, A['#'], 21, A['#'], 49),
        ]);
        step(mars);
        // ICWS-94: if either field divides by zero, process dies
        // but the non-zero division still executes
        assertEqual(warrior.tasks.length, 0, 'process killed');
        assertEqual(cell(mars, 2).aVal, 7, 'A still computed: 21/3');
    });
});

// ══════════════════════════════════════════════════════════════════
// MOD — Modulo (kills process on mod-by-zero)
// ══════════════════════════════════════════════════════════════════
describe('MOD — Modulo', () => {
    test('MOD.A: dest.A %= src.A', () => {
        const { mars } = setup([
            I(O.MOD, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 3, A['#'], 0),
            I(O.DAT, M.F, A['#'], 10, A['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 1, 'A: 10%3 = 1');
    });

    test('MOD.B: dest.B %= src.B', () => {
        const { mars } = setup([
            I(O.MOD, M.B, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 0, A['#'], 7),
            I(O.DAT, M.F, A['#'], 0, A['#'], 25),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).bVal, 4, 'B: 25%7 = 4');
    });

    test('MOD.AB: dest.B %= src.A', () => {
        const { mars } = setup([
            I(O.MOD, M.AB, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 6, A['#'], 0),
            I(O.DAT, M.F, A['#'], 0, A['#'], 20),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).bVal, 2, 'B: 20%6 = 2');
    });

    test('MOD by zero kills process', () => {
        const { mars, warrior } = setup([
            I(O.MOD, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
            I(O.DAT, M.F, A['#'], 10, A['#'], 0),
        ]);
        step(mars);
        assertEqual(warrior.tasks.length, 0, 'process killed by mod/0');
    });

    test('MOD.F: both fields', () => {
        const { mars } = setup([
            I(O.MOD, M.F, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 3, A['#'], 4),
            I(O.DAT, M.F, A['#'], 17, A['#'], 29),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 2, 'A: 17%3');
        assertEqual(cell(mars, 2).bVal, 1, 'B: 29%4');
    });

    test('MOD.X: cross-mod', () => {
        const { mars } = setup([
            I(O.MOD, M.X, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 3, A['#'], 5),
            I(O.DAT, M.F, A['#'], 17, A['#'], 29),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 2, 'A: 17%5');
        assertEqual(cell(mars, 2).bVal, 2, 'B: 29%3');
    });
});

// ══════════════════════════════════════════════════════════════════
// JMP — Unconditional jump
// ══════════════════════════════════════════════════════════════════
describe('JMP — Unconditional jump', () => {
    test('JMP jumps to target address', () => {
        const { mars, warrior } = setup([
            I(O.JMP, M.B, A['$'], 3, A['$'], 0), // [0] JMP $3
            I(O.DAT, M.F, A['#'], 0, A['#'], 0), // [1] should be skipped
            I(O.DAT, M.F, A['#'], 0, A['#'], 0), // [2] should be skipped
            I(O.NOP, M.F, A['$'], 0, A['$'], 0), // [3] target
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 3, 'PC should be at target');
    });

    test('JMP backwards', () => {
        const { mars, warrior } = setup([
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),      // [0] target
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),      // [1]
            I(O.JMP, M.B, A['$'], CS - 2, A['$'], 0), // [2] JMP -2 (wrapped)
        ], 2);
        step(mars);
        assertEqual(pc(warrior), BASE + 0, 'PC should jump backwards to [0]');
    });
});

// ══════════════════════════════════════════════════════════════════
// JMZ — Jump if zero
// ══════════════════════════════════════════════════════════════════
describe('JMZ — Jump if zero', () => {
    test('JMZ.B jumps when B-field is zero', () => {
        const { mars, warrior } = setup([
            I(O.JMZ, M.B, A['$'], 3, A['$'], 1),     // [0] JMZ $3, $1
            I(O.DAT, M.F, A['#'], 99, A['#'], 0),     // [1] B=0 → zero
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),      // [2]
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),      // [3] target
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 3, 'should jump (B=0)');
    });

    test('JMZ.B does not jump when B-field is non-zero', () => {
        const { mars, warrior } = setup([
            I(O.JMZ, M.B, A['$'], 3, A['$'], 1),
            I(O.DAT, M.F, A['#'], 0, A['#'], 5),  // B=5 → not zero
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'should not jump (B=5)');
    });

    test('JMZ.A jumps when A-field is zero', () => {
        const { mars, warrior } = setup([
            I(O.JMZ, M.A, A['$'], 3, A['$'], 1),
            I(O.DAT, M.F, A['#'], 0, A['#'], 99),  // A=0 → zero
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 3, 'should jump (A=0)');
    });

    test('JMZ.F jumps only when both A and B are zero', () => {
        const { mars, warrior } = setup([
            I(O.JMZ, M.F, A['$'], 3, A['$'], 1),
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),  // both zero
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 3, 'should jump (both zero)');
    });

    test('JMZ.F does not jump when only one field is zero', () => {
        const { mars, warrior } = setup([
            I(O.JMZ, M.F, A['$'], 3, A['$'], 1),
            I(O.DAT, M.F, A['#'], 0, A['#'], 1),  // A=0 but B=1
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'should not jump (B≠0)');
    });
});

// ══════════════════════════════════════════════════════════════════
// JMN — Jump if not zero
// ══════════════════════════════════════════════════════════════════
describe('JMN — Jump if not zero', () => {
    test('JMN.B jumps when B-field is non-zero', () => {
        const { mars, warrior } = setup([
            I(O.JMN, M.B, A['$'], 3, A['$'], 1),
            I(O.DAT, M.F, A['#'], 0, A['#'], 42), // B=42 → non-zero
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 3, 'should jump (B=42)');
    });

    test('JMN.B does not jump when B-field is zero', () => {
        const { mars, warrior } = setup([
            I(O.JMN, M.B, A['$'], 3, A['$'], 1),
            I(O.DAT, M.F, A['#'], 99, A['#'], 0), // B=0 → zero
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'should not jump (B=0)');
    });

    test('JMN.A jumps when A-field is non-zero', () => {
        const { mars, warrior } = setup([
            I(O.JMN, M.A, A['$'], 3, A['$'], 1),
            I(O.DAT, M.F, A['#'], 7, A['#'], 0), // A=7
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 3, 'should jump (A=7)');
    });

    test('JMN.F does not jump when both fields are zero', () => {
        const { mars, warrior } = setup([
            I(O.JMN, M.F, A['$'], 3, A['$'], 1),
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'should not jump (both zero)');
    });

    test('JMN.F jumps when at least one field is non-zero', () => {
        const { mars, warrior } = setup([
            I(O.JMN, M.F, A['$'], 3, A['$'], 1),
            I(O.DAT, M.F, A['#'], 1, A['#'], 0), // A=1, B=0 — not both zero
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),
        ]);
        step(mars);
        // JMN.F: !checkZero which checks A===0 && B===0. Since A=1, not both zero → jump
        assertEqual(pc(warrior), BASE + 3, 'should jump (A=1)');
    });
});

// ══════════════════════════════════════════════════════════════════
// DJN — Decrement and jump if not zero
// ══════════════════════════════════════════════════════════════════
describe('DJN — Decrement and jump if not zero', () => {
    test('DJN.B decrements B-field and jumps when result is non-zero', () => {
        const { mars, warrior } = setup([
            I(O.DJN, M.B, A['$'], 0, A['$'], 1),  // DJN $0, $1
            I(O.DAT, M.F, A['#'], 0, A['#'], 5),  // B=5 → decrements to 4
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 4, 'B decremented from 5 to 4');
        assertEqual(pc(warrior), BASE + 0, 'should jump (4≠0)');
    });

    test('DJN.B decrements to zero and does not jump', () => {
        const { mars, warrior } = setup([
            I(O.DJN, M.B, A['$'], 0, A['$'], 1),  // DJN $0, $1
            I(O.DAT, M.F, A['#'], 0, A['#'], 1),  // B=1 → decrements to 0
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 0, 'B decremented to 0');
        assertEqual(pc(warrior), BASE + 1, 'should not jump (0)');
    });

    test('DJN.A decrements A-field', () => {
        const { mars, warrior } = setup([
            I(O.DJN, M.A, A['$'], 0, A['$'], 1),
            I(O.DAT, M.F, A['#'], 3, A['#'], 99),
        ]);
        step(mars);
        assertEqual(cell(mars, 1).aVal, 2, 'A decremented from 3 to 2');
        assertEqual(cell(mars, 1).bVal, 99, 'B unchanged');
        assertEqual(pc(warrior), BASE + 0, 'should jump (2≠0)');
    });

    test('DJN.F decrements both fields', () => {
        const { mars, warrior } = setup([
            I(O.DJN, M.F, A['$'], 0, A['$'], 1),
            I(O.DAT, M.F, A['#'], 3, A['#'], 5),
        ]);
        step(mars);
        assertEqual(cell(mars, 1).aVal, 2, 'A decremented');
        assertEqual(cell(mars, 1).bVal, 4, 'B decremented');
        assertEqual(pc(warrior), BASE + 0, 'should jump (both non-zero)');
    });

    test('DJN.B wraps on decrement from zero', () => {
        const { mars } = setup([
            I(O.DJN, M.B, A['$'], 0, A['$'], 1),
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),  // B=0 → wraps to 7999
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, CS - 1, 'B wraps to 7999');
    });
});

// ══════════════════════════════════════════════════════════════════
// SPL — Split (fork process)
// ══════════════════════════════════════════════════════════════════
describe('SPL — Fork process', () => {
    test('SPL creates two processes', () => {
        const { mars, warrior } = setup([
            I(O.SPL, M.B, A['$'], 2, A['$'], 0),  // [0] SPL $2
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),  // [1] continuation
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),  // [2] fork target
        ]);
        step(mars);
        assertEqual(warrior.tasks.length, 2, 'should have 2 processes');
    });

    test('SPL queues PC+1 first, then target (ICWS-94 order)', () => {
        const { mars, warrior } = setup([
            I(O.SPL, M.B, A['$'], 2, A['$'], 0),  // [0] SPL $2
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),  // [1] PC+1
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),  // [2] target
        ]);
        step(mars);
        assertEqual(warrior.tasks[0], BASE + 1, 'first process = PC+1 (continuation)');
        assertEqual(warrior.tasks[1], BASE + 2, 'second process = target');
    });

    test('SPL 0 forks to same address', () => {
        const { mars, warrior } = setup([
            I(O.SPL, M.B, A['$'], 0, A['$'], 0),  // [0] SPL $0
        ]);
        step(mars);
        assertEqual(warrior.tasks[0], BASE + 1, 'continuation at PC+1');
        assertEqual(warrior.tasks[1], BASE + 0, 'fork target at same address');
    });

    test('SPL respects max processes limit', () => {
        const { mars, warrior } = setup([
            I(O.SPL, M.B, A['$'], 0, A['$'], 0),
        ]);
        // Fill up to max processes - 1 (leaving room for PC+1 but not target)
        while (warrior.tasks.length < mars.maxProcesses) {
            warrior.tasks.push(BASE);
        }
        const beforeCount = warrior.tasks.length;
        step(mars);
        // PC+1 replaces the executed process, target cannot be added (at max)
        assert(warrior.tasks.length <= mars.maxProcesses, 'should not exceed max processes');
    });
});

// ══════════════════════════════════════════════════════════════════
// CMP/SEQ — Skip if equal
// ══════════════════════════════════════════════════════════════════
describe('CMP/SEQ — Skip if equal', () => {
    test('CMP.B skips when B-fields are equal', () => {
        const { mars, warrior } = setup([
            I(O.CMP, M.B, A['$'], 1, A['$'], 2),  // CMP $1, $2
            I(O.DAT, M.F, A['#'], 10, A['#'], 42), // B=42
            I(O.DAT, M.F, A['#'], 99, A['#'], 42), // B=42 (equal)
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),   // skipped
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),   // lands here
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'should skip to PC+2 (B-fields equal)');
    });

    test('CMP.B does not skip when B-fields differ', () => {
        const { mars, warrior } = setup([
            I(O.CMP, M.B, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 0, A['#'], 42),
            I(O.DAT, M.F, A['#'], 0, A['#'], 99),  // B=99 ≠ 42
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'should not skip (B-fields differ)');
    });

    test('CMP.A skips when A-fields are equal', () => {
        const { mars, warrior } = setup([
            I(O.CMP, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 42, A['#'], 10),
            I(O.DAT, M.F, A['#'], 42, A['#'], 99),  // A=42 (equal)
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'should skip (A-fields equal)');
    });

    test('CMP.AB skips when A of first equals B of second', () => {
        const { mars, warrior } = setup([
            I(O.CMP, M.AB, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 42, A['#'], 0),  // A=42
            I(O.DAT, M.F, A['#'], 0, A['#'], 42),  // B=42 (equal)
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'should skip (A=B cross-compare)');
    });

    test('CMP.F skips when both A and B fields match', () => {
        const { mars, warrior } = setup([
            I(O.CMP, M.F, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 10, A['#'], 20),
            I(O.DAT, M.F, A['#'], 10, A['#'], 20), // same A and B
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'should skip (both fields match)');
    });

    test('CMP.F does not skip when only one field matches', () => {
        const { mars, warrior } = setup([
            I(O.CMP, M.F, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 10, A['#'], 20),
            I(O.DAT, M.F, A['#'], 10, A['#'], 99), // A matches but B differs
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'should not skip (B differs)');
    });

    test('CMP.I skips when entire instructions match', () => {
        const { mars, warrior } = setup([
            I(O.CMP, M.I, A['$'], 1, A['$'], 2),
            I(O.ADD, M.AB, A['#'], 10, A['@'], 20),
            I(O.ADD, M.AB, A['#'], 10, A['@'], 20), // identical
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'should skip (whole instruction matches)');
    });

    test('CMP.I does not skip when modes differ', () => {
        const { mars, warrior } = setup([
            I(O.CMP, M.I, A['$'], 1, A['$'], 2),
            I(O.ADD, M.AB, A['#'], 10, A['@'], 20),
            I(O.ADD, M.AB, A['$'], 10, A['@'], 20), // A-mode differs
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'should not skip (A-mode differs)');
    });
});

// ══════════════════════════════════════════════════════════════════
// SNE — Skip if not equal
// ══════════════════════════════════════════════════════════════════
describe('SNE — Skip if not equal', () => {
    test('SNE.B skips when B-fields differ', () => {
        const { mars, warrior } = setup([
            I(O.SNE, M.B, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 0, A['#'], 10),
            I(O.DAT, M.F, A['#'], 0, A['#'], 20),  // B differs
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'should skip (B-fields differ)');
    });

    test('SNE.B does not skip when B-fields are equal', () => {
        const { mars, warrior } = setup([
            I(O.SNE, M.B, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 0, A['#'], 42),
            I(O.DAT, M.F, A['#'], 0, A['#'], 42),  // B equal
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'should not skip (B equal)');
    });

    test('SNE.I skips when instructions differ', () => {
        const { mars, warrior } = setup([
            I(O.SNE, M.I, A['$'], 1, A['$'], 2),
            I(O.MOV, M.I, A['$'], 0, A['$'], 1),
            I(O.ADD, M.I, A['$'], 0, A['$'], 1),  // different opcode
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'should skip (opcodes differ)');
    });

    test('SNE.I does not skip when instructions are identical', () => {
        const { mars, warrior } = setup([
            I(O.SNE, M.I, A['$'], 1, A['$'], 2),
            I(O.MOV, M.I, A['$'], 5, A['$'], 10),
            I(O.MOV, M.I, A['$'], 5, A['$'], 10),  // identical
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'should not skip (identical)');
    });
});

// ══════════════════════════════════════════════════════════════════
// SLT — Skip if less than
// ══════════════════════════════════════════════════════════════════
describe('SLT — Skip if less than', () => {
    test('SLT.A skips when A-field of first < A-field of second', () => {
        const { mars, warrior } = setup([
            I(O.SLT, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 5, A['#'], 0),
            I(O.DAT, M.F, A['#'], 10, A['#'], 0),  // 5 < 10
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'should skip (5 < 10)');
    });

    test('SLT.A does not skip when A >= A', () => {
        const { mars, warrior } = setup([
            I(O.SLT, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 10, A['#'], 0),
            I(O.DAT, M.F, A['#'], 5, A['#'], 0),  // 10 >= 5
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'should not skip (10 >= 5)');
    });

    test('SLT.B skips when B < B', () => {
        const { mars, warrior } = setup([
            I(O.SLT, M.B, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 0, A['#'], 3),
            I(O.DAT, M.F, A['#'], 0, A['#'], 100), // 3 < 100
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'should skip (3 < 100)');
    });

    test('SLT.AB skips when A of first < B of second', () => {
        const { mars, warrior } = setup([
            I(O.SLT, M.AB, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 5, A['#'], 0),   // A=5
            I(O.DAT, M.F, A['#'], 0, A['#'], 100),  // B=100, 5 < 100
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'should skip (5 < 100)');
    });

    test('SLT.A does not skip on equal values', () => {
        const { mars, warrior } = setup([
            I(O.SLT, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 42, A['#'], 0),
            I(O.DAT, M.F, A['#'], 42, A['#'], 0),  // equal
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'should not skip (equal)');
    });

    test('SLT.F skips only when both fields are less', () => {
        const { mars, warrior } = setup([
            I(O.SLT, M.F, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 1, A['#'], 2),
            I(O.DAT, M.F, A['#'], 10, A['#'], 20),  // 1<10 and 2<20
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'should skip (both less)');
    });

    test('SLT.F does not skip when only one field is less', () => {
        const { mars, warrior } = setup([
            I(O.SLT, M.F, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 1, A['#'], 20),
            I(O.DAT, M.F, A['#'], 10, A['#'], 5),   // 1<10 but 20>=5
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'should not skip (B not less)');
    });
});

// ══════════════════════════════════════════════════════════════════
// NOP — No operation
// ══════════════════════════════════════════════════════════════════
describe('NOP — No operation', () => {
    test('NOP advances PC by 1 and does nothing else', () => {
        const { mars, warrior } = setup([
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),  // [0]
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),  // [1]
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'PC should advance by 1');
        assertEqual(warrior.tasks.length, 1, 'should still have 1 process');
    });
});

// ══════════════════════════════════════════════════════════════════
// STP — Store to P-Space
// ══════════════════════════════════════════════════════════════════
describe('STP — Store to P-Space', () => {
    test('STP.AB stores A-field to p-space at index from B-field', () => {
        const { mars, warrior } = setup([
            I(O.STP, M.AB, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 42, A['#'], 0),  // A=42 (value to store)
            I(O.DAT, M.F, A['#'], 0, A['#'], 5),   // B=5 (p-space index)
        ]);
        step(mars);
        const psIdx = 5 % warrior.pSpace.length;
        assertEqual(warrior.pSpace[psIdx], 42, 'p-space[5] should be 42');
    });

    test('STP.B stores B-field to p-space', () => {
        const { mars, warrior } = setup([
            I(O.STP, M.B, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 0, A['#'], 77),  // B=77 (value)
            I(O.DAT, M.F, A['#'], 0, A['#'], 3),   // B=3 (index)
        ]);
        step(mars);
        const psIdx = 3 % warrior.pSpace.length;
        assertEqual(warrior.pSpace[psIdx], 77, 'p-space[3] should be 77');
    });
});

// ══════════════════════════════════════════════════════════════════
// LDP — Load from P-Space
// ══════════════════════════════════════════════════════════════════
describe('LDP — Load from P-Space', () => {
    test('LDP.AB loads from p-space A-index to dest B-field', () => {
        const { mars, warrior } = setup([
            I(O.LDP, M.AB, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 3, A['#'], 0),   // A=3 (p-space index)
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),   // dest
        ]);
        // Pre-fill p-space
        warrior.pSpace[3 % warrior.pSpace.length] = 99;
        step(mars);
        assertEqual(cell(mars, 2).bVal, 99, 'dest.B should be loaded from p-space');
    });

    test('LDP.B loads from p-space B-index to dest B-field', () => {
        const { mars, warrior } = setup([
            I(O.LDP, M.B, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 0, A['#'], 7),   // B=7 (p-space index)
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),   // dest
        ]);
        warrior.pSpace[7 % warrior.pSpace.length] = 55;
        step(mars);
        assertEqual(cell(mars, 2).bVal, 55, 'dest.B from p-space[7]');
    });

    test('LDP.A loads from p-space A-index to dest A-field', () => {
        const { mars, warrior } = setup([
            I(O.LDP, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 2, A['#'], 0),   // A=2
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),   // dest
        ]);
        warrior.pSpace[2 % warrior.pSpace.length] = 123;
        step(mars);
        assertEqual(cell(mars, 2).aVal, 123, 'dest.A from p-space[2]');
    });
});

// ══════════════════════════════════════════════════════════════════
// ADDRESSING MODES
// ══════════════════════════════════════════════════════════════════
describe('Addressing Mode # (Immediate)', () => {
    test('Immediate source: value is the instruction itself', () => {
        // MOV.AB #5, $1 → copies A-field of MOV instruction (5) to B-field of dest
        const { mars } = setup([
            I(O.MOV, M.AB, A['#'], 5, A['$'], 1),
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 5, 'immediate value used as source');
    });

    test('Immediate B-operand: JMZ with # checks the instruction itself', () => {
        // JMZ.B $2, #0 → B is immediate #0, checkZero checks IR's bVal (0) → zero → jump
        const { mars, warrior } = setup([
            I(O.JMZ, M.B, A['$'], 2, A['#'], 0),  // B-operand is #0
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),   // jump target
        ]);
        step(mars);
        // #0 → ptrB=null → checkZero checks IR fields → bVal=0 → zero → jump
        assertEqual(pc(warrior), BASE + 2, 'immediate #0 is zero → JMZ jumps');
    });
});

describe('Addressing Mode $ (Direct)', () => {
    test('Direct: accesses cell at PC+offset', () => {
        const { mars } = setup([
            I(O.MOV, M.I, A['$'], 1, A['$'], 3),  // copy [1] to [3]
            I(O.ADD, M.AB, A['#'], 42, A['@'], 99),
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),   // dest
        ]);
        step(mars);
        const d = cell(mars, 3);
        assertEqual(d.op, O.ADD, 'opcode copied');
        assertEqual(d.aVal, 42, 'A-val copied');
        assertEqual(d.bVal, 99, 'B-val copied');
    });
});

describe('Addressing Mode @ (B-Indirect)', () => {
    test('B-indirect: follows B-field of intermediate cell', () => {
        // MOV.I @1, $4 → look at B-field of cell[1], follow that offset from cell[1]
        const { mars } = setup([
            I(O.MOV, M.I, A['@'], 1, A['$'], 4),   // [0] MOV.I @1, $4
            I(O.DAT, M.F, A['#'], 0, A['#'], 2),    // [1] B=2, so indirect → [1+2]=[3]
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),    // [2]
            I(O.ADD, M.AB, A['#'], 77, A['#'], 88),  // [3] source (via indirect)
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),    // [4] dest
        ]);
        step(mars);
        assertEqual(cell(mars, 4).op, O.ADD, 'should copy from indirect target');
        assertEqual(cell(mars, 4).aVal, 77, 'A-val from indirect');
    });
});

describe('Addressing Mode < (B-PreDecrement)', () => {
    test('B-predec: decrements B-field before following', () => {
        // MOV.I <1, $4 → decrement B of cell[1] first, then follow
        const { mars } = setup([
            I(O.MOV, M.I, A['<'], 1, A['$'], 4),    // [0] MOV.I <1, $4
            I(O.DAT, M.F, A['#'], 0, A['#'], 3),     // [1] B=3, dec→2, follow [1+2]=[3]
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),     // [2]
            I(O.SUB, M.A, A['#'], 55, A['#'], 66),   // [3] source
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),     // [4] dest
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 2, 'B-field decremented from 3 to 2');
        assertEqual(cell(mars, 4).op, O.SUB, 'source read from indirect after decrement');
        assertEqual(cell(mars, 4).aVal, 55, 'A-val from indirect');
    });
});

describe('Addressing Mode > (B-PostIncrement)', () => {
    test('B-postinc: follows B-field then increments', () => {
        // MOV.I >1, $4 → follow B of cell[1], then increment B
        const { mars } = setup([
            I(O.MOV, M.I, A['>'], 1, A['$'], 4),    // [0] MOV.I >1, $4
            I(O.DAT, M.F, A['#'], 0, A['#'], 2),     // [1] B=2, follow [1+2]=[3], then B→3
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),     // [2]
            I(O.MUL, M.B, A['#'], 33, A['#'], 44),   // [3] source
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),     // [4] dest
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 3, 'B-field incremented from 2 to 3');
        assertEqual(cell(mars, 4).op, O.MUL, 'source read before increment');
        assertEqual(cell(mars, 4).aVal, 33, 'A-val from indirect');
    });
});

describe('Addressing Mode * (A-Indirect)', () => {
    test('A-indirect: follows A-field of intermediate cell', () => {
        const { mars } = setup([
            I(O.MOV, M.I, A['*'], 1, A['$'], 4),    // [0] MOV.I *1, $4
            I(O.DAT, M.F, A['#'], 2, A['#'], 99),    // [1] A=2, follow [1+2]=[3]
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),     // [2]
            I(O.JMP, M.B, A['$'], 11, A['$'], 22),   // [3] source
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),     // [4] dest
        ]);
        step(mars);
        assertEqual(cell(mars, 4).op, O.JMP, 'read via A-indirect');
        assertEqual(cell(mars, 4).aVal, 11, 'A-val from A-indirect');
    });
});

describe('Addressing Mode { (A-PreDecrement)', () => {
    test('A-predec: decrements A-field before following', () => {
        const { mars } = setup([
            I(O.MOV, M.I, A['{'], 1, A['$'], 4),    // [0] MOV.I {1, $4
            I(O.DAT, M.F, A['#'], 3, A['#'], 0),     // [1] A=3, dec→2, follow [1+2]=[3]
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),     // [2]
            I(O.SPL, M.B, A['$'], 7, A['$'], 8),     // [3] source
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),     // [4] dest
        ]);
        step(mars);
        assertEqual(cell(mars, 1).aVal, 2, 'A-field decremented');
        assertEqual(cell(mars, 4).op, O.SPL, 'read via A-predec indirect');
    });
});

describe('Addressing Mode } (A-PostIncrement)', () => {
    test('A-postinc: follows A-field then increments', () => {
        const { mars } = setup([
            I(O.MOV, M.I, A['}'], 1, A['$'], 4),    // [0] MOV.I }1, $4
            I(O.DAT, M.F, A['#'], 2, A['#'], 0),     // [1] A=2, follow [1+2]=[3], then A→3
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),     // [2]
            I(O.NOP, M.I, A['#'], 15, A['#'], 25),   // [3] source
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),     // [4] dest
        ]);
        step(mars);
        assertEqual(cell(mars, 1).aVal, 3, 'A-field incremented');
        assertEqual(cell(mars, 4).op, O.NOP, 'read before increment');
        assertEqual(cell(mars, 4).aVal, 15, 'A-val from A-postinc indirect');
    });
});

// ══════════════════════════════════════════════════════════════════
// EDGE CASES & INTERACTIONS
// ══════════════════════════════════════════════════════════════════
describe('Edge Cases — Core wrapping and boundary conditions', () => {
    test('MOV wraps around core boundary', () => {
        // Place instruction near end of core, write across boundary
        const edge = CS - 1;
        const { mars } = setup([], 0);
        mars.core.set(edge, I(O.MOV, M.I, A['$'], 0, A['$'], 1), 0);
        mars.warriors[0].tasks = [edge];
        step(mars);
        // The MOV copies itself to address (CS-1+1)%CS = 0
        assertEqual(mars.core.get(0).op, O.MOV, 'instruction wraps to address 0');
    });

    test('SUB with result exactly zero', () => {
        const { mars } = setup([
            I(O.SUB, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], 42, A['#'], 0),
            I(O.DAT, M.F, A['#'], 42, A['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 0, '42-42 = 0');
    });

    test('DJN decrement wraps from 0 to CS-1', () => {
        const { mars } = setup([
            I(O.DJN, M.B, A['$'], 0, A['$'], 1),
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, CS - 1, 'wraps from 0 to 7999');
    });

    test('ADD with both operands at core size wraps to 0', () => {
        const { mars } = setup([
            I(O.ADD, M.A, A['$'], 1, A['$'], 2),
            I(O.DAT, M.F, A['#'], CS, A['#'], 0),
            I(O.DAT, M.F, A['#'], CS, A['#'], 0),
        ]);
        step(mars);
        // CS + CS = 2*CS, wrapped: (2*CS) % CS = 0. But CS stored as 0 (wrapped already)
        // Actually, CS (8000) wraps to 0 when stored, so 0+0=0
        assertEqual(cell(mars, 2).aVal, 0, 'CS wraps to 0');
    });

    test('Multiple processes execute in round-robin order', () => {
        // Warrior has 3 processes: [0], [1], [2]. Each writes to the same cell [5].
        // Offsets are relative to PC, so adjust: [0]→$5, [1]→$4, [2]→$3
        const { mars, warrior } = setup([
            I(O.MOV, M.AB, A['#'], 111, A['$'], 5), // [0] writes 111 to [0+5]=[5].B
            I(O.MOV, M.AB, A['#'], 222, A['$'], 4), // [1] writes 222 to [1+4]=[5].B
            I(O.MOV, M.AB, A['#'], 333, A['$'], 3), // [2] writes 333 to [2+3]=[5].B
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),
            I(O.NOP, M.F, A['$'], 0, A['$'], 0),
            I(O.DAT, M.F, A['#'], 0, A['#'], 0),    // [5] shared target
        ]);
        warrior.tasks.push(BASE + 1);
        warrior.tasks.push(BASE + 2);
        // Execute all 3 processes (3 steps for 1 warrior)
        step(mars, 3);
        // Last writer wins → proc2 wrote 333
        assertEqual(cell(mars, 5).bVal, 333, 'last process wrote 333');
    });
});

// ══════════════════════════════════════════════════════════════════
// DEFAULT MODIFIER RESOLUTION
// ══════════════════════════════════════════════════════════════════
describe('Default Modifier Resolution', () => {
    test('MOV with immediate A defaults to .AB', () => {
        // Parser should assign .AB when A-mode is #
        const p = new Parser();
        const parsed = p.parse('MOV #5, $1', CS);
        assertEqual(parsed.instructions[0].mod, M.AB, 'MOV # defaults to .AB');
    });

    test('MOV with immediate B defaults to .B', () => {
        const p = new Parser();
        const parsed = p.parse('MOV $1, #5', CS);
        assertEqual(parsed.instructions[0].mod, M.B, 'MOV with B-immediate defaults to .B');
    });

    test('MOV with no immediates defaults to .I', () => {
        const p = new Parser();
        const parsed = p.parse('MOV $1, $2', CS);
        assertEqual(parsed.instructions[0].mod, M.I, 'MOV $,$ defaults to .I');
    });

    test('ADD with immediate A defaults to .AB', () => {
        const p = new Parser();
        const parsed = p.parse('ADD #5, $1', CS);
        assertEqual(parsed.instructions[0].mod, M.AB, 'ADD # defaults to .AB');
    });

    test('ADD with no immediates defaults to .F', () => {
        const p = new Parser();
        const parsed = p.parse('ADD $1, $2', CS);
        assertEqual(parsed.instructions[0].mod, M.F, 'ADD $,$ defaults to .F');
    });

    test('JMP defaults to .B', () => {
        const p = new Parser();
        const parsed = p.parse('JMP $5', CS);
        assertEqual(parsed.instructions[0].mod, M.B, 'JMP defaults to .B');
    });

    test('DAT defaults to .F', () => {
        const p = new Parser();
        const parsed = p.parse('DAT #0, #0', CS);
        assertEqual(parsed.instructions[0].mod, M.F, 'DAT defaults to .F');
    });

    test('SLT with immediate A defaults to .AB', () => {
        const p = new Parser();
        const parsed = p.parse('SLT #5, $1', CS);
        assertEqual(parsed.instructions[0].mod, M.AB, 'SLT # defaults to .AB');
    });

    test('SLT with no immediate defaults to .B', () => {
        const p = new Parser();
        const parsed = p.parse('SLT $1, $2', CS);
        assertEqual(parsed.instructions[0].mod, M.B, 'SLT $,$ defaults to .B');
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
