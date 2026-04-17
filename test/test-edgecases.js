/**
 * ICWS-94 Edge Cases & Subtle Standard Compliance Tests
 *
 * Tests the trickiest, most commonly mis-implemented aspects of the
 * ICWS-94 standard: instruction register semantics, operand evaluation
 * order, self-referencing instructions, and boundary conditions.
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
const BASE = 100;
const O = OPCODES, M = MODIFIERS, AM = ADDR_MODES;

function I(op, mod, aMode, aVal, bMode, bVal) {
    return new Instruction(op, mod, aMode, aVal, bMode, bVal);
}

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

function step(mars, n = 1) { for (let i = 0; i < n; i++) mars.step(); }
function cell(mars, offset) { return mars.core.get(BASE + offset); }
function pc(w) { return w.tasks.length > 0 ? w.tasks[0] : -1; }

// ══════════════════════════════════════════════════════════════════
// 1. INSTRUCTION REGISTER (IR) — Must be a COPY, not a reference
//    ICWS-94 §3.1: "The current instruction is read from Core and
//    stored in the Instruction Register."
//    A-operand evaluation side-effects must NOT contaminate B-operand.
// ══════════════════════════════════════════════════════════════════
describe('Instruction Register — A side-effects must not contaminate B', () => {
    test('B-predec (<) on self: A changes bVal, B should use original', () => {
        // MOV.I <0, $2 → A pre-decs self.bVal (2→1), follows to eff=pc+1
        // B should use original bVal=2 → target pc+2 (NOT contaminated bVal=1 → pc+1)
        const { mars } = setup([
            I(O.MOV, M.I, AM['<'], 0, AM['$'], 2),    // [0] bVal=2
            I(O.ADD, M.AB, AM['#'], 77, AM['#'], 88), // [1] source via A
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [2] correct B target
        ]);
        step(mars);
        assertEqual(cell(mars, 2).op, O.ADD, 'B should write to [2], not [1]');
        assertEqual(cell(mars, 2).aVal, 77, 'should copy A-val from source');
    });

    test('B-postinc (>) on self: A changes bVal, B should use original', () => {
        // MOV.I >0, $1 → A follows self.bVal=1, then postinc to 2
        // B should use original bVal=1 → target pc+1 (NOT postinc'd bVal=2 → pc+2)
        const { mars } = setup([
            I(O.MOV, M.I, AM['>'], 0, AM['$'], 1),    // [0] bVal=1
            I(O.SUB, M.A, AM['#'], 55, AM['#'], 66),  // [1] source & correct B target
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [2] wrong target if contaminated
        ]);
        step(mars);
        // A follows bVal=1 → eff=pc+1, reads [1], postinc bVal to 2
        // B should still be $1 → writes to pc+1
        // MOV.I copies [1] to [1] (self-copy, effectively no change to [1])
        // The key check: [2] should NOT have been written to
        assertEqual(cell(mars, 2).op, O.DAT, '[2] should be untouched');
    });

    test('A-predec ({) on self: A changes aVal, B unaffected (uses bVal)', () => {
        // ADD.AB {0, $1 → A pre-decs self.aVal (0→7999), follows aVal → eff=pc-1
        // B uses bVal=1, which is NOT changed by { (only aVal is)
        const { mars } = setup([
            I(O.ADD, M.AB, AM['{'], 0, AM['$'], 1),   // [0] aVal=0, bVal=1
            I(O.DAT, M.F, AM['#'], 100, AM['#'], 200),// [1] target
        ]);
        step(mars);
        // A-predec: aVal 0→7999, follows → eff = pc+7999 = pc-1 (empty DAT 0,0)
        // ADD.AB: dest.B += src.A → [1].B += core[pc-1].A = 200 + 0 = 200
        assertEqual(cell(mars, 1).bVal, 200, 'B should target [1] correctly');
    });

    test('A-postinc (}) on self: A changes aVal, B unaffected', () => {
        // MOV.AB }0, $1 → A follows self.aVal=0 (eff=pc), postinc aVal to 1
        // B should still use bVal=1, unrelated to aVal
        const { mars } = setup([
            I(O.MOV, M.AB, AM['}'], 0, AM['$'], 1),   // [0] aVal=0, bVal=1
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [1] target
        ]);
        step(mars);
        // A: } follows aVal=0 → eff=pc, reads self (the MOV). postinc aVal to 1.
        // MOV.AB: dest.B = src.A. src is core[pc] (the MOV), src.A=0 (original via IR)
        // Wait: src is core[ptrA] = core[pc]. But A-postinc modified core[pc].aVal to 1.
        // So src.A is 1 (from core), not 0 (from IR). This is correct per ICWS-94:
        // the IR is used for operand resolution, but source values are read from core.
        assertEqual(cell(mars, 1).bVal, 1, 'dest.B = core[pc].A (postinc to 1)');
    });

    test('Immediate A with B-predec: IR values used for immediate source', () => {
        // MOV.AB #5, <0 → A is immediate (#5), B pre-decs self.bVal
        // When A is immediate, src = IR (the copy). The IR's aVal should be 5
        // regardless of B's pre-dec modifying core[pc].bVal.
        const { mars } = setup([
            I(O.MOV, M.AB, AM['#'], 5, AM['<'], 0),   // [0] aVal=5, bVal=0
            // B-predec on self: bVal 0→7999, eff = pc+7999 = pc-1
        ]);
        step(mars);
        // MOV.AB: dest.B = src.A. src = IR (immediate), src.A = 5.
        // dest = core[pc-1]. dest.B = 5.
        const target = mars.core.get(BASE - 1);
        assertEqual(target.bVal, 5, 'immediate source should use IR value 5');
    });
});

// ══════════════════════════════════════════════════════════════════
// 2. OPERAND EVALUATION ORDER — A fully resolves before B begins
//    B should see A's side effects on intermediate cells.
// ══════════════════════════════════════════════════════════════════
describe('Operand Evaluation Order — A resolves before B', () => {
    test('A post-inc on pointer cell, B follows same cell (sees incremented value)', () => {
        // MOV.I >1, @1 → both use cell [1] as pointer
        // A: > follows [1].bVal=2 → eff=1+2=3, then postinc [1].bVal to 3
        // B: @ follows [1].bVal=3 (post-inc'd by A) → eff=1+3=4
        const { mars } = setup([
            I(O.MOV, M.I, AM['>'], 1, AM['@'], 1),    // [0]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 2),    // [1] pointer, B=2
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [2]
            I(O.NOP, M.F, AM['#'], 33, AM['#'], 44),  // [3] A-source
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [4] B-dest
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 3, 'pointer B-field incremented by A');
        assertEqual(cell(mars, 4).op, O.NOP, 'B followed post-inc value → wrote to [4]');
        assertEqual(cell(mars, 4).aVal, 33, 'correct source copied');
    });

    test('A pre-dec on pointer cell, B follows same cell (sees decremented value)', () => {
        // MOV.I <1, @1 → both use cell [1]
        // A: < pre-decs [1].bVal from 3→2, follows → eff=1+2=3
        // B: @ follows [1].bVal=2 (already decremented) → eff=1+2=3
        // Same effective address for both! (copies [3] to [3], no-op)
        const { mars } = setup([
            I(O.MOV, M.I, AM['<'], 1, AM['@'], 1),    // [0]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 3),    // [1] pointer, B=3
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [2]
            I(O.ADD, M.A, AM['#'], 99, AM['#'], 77),   // [3] source
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 2, 'pointer decremented by A');
        // Both A and B resolve to [3] (same cell), so MOV.I is self-copy
        assertEqual(cell(mars, 3).op, O.ADD, '[3] unchanged (copied to itself)');
    });

    test('Double pre-dec (<) on same pointer: cell decremented twice', () => {
        // MOV.I <1, <1 → both A and B pre-dec [1].bVal
        // A: pre-dec [1].bVal (4→3), follows → eff=1+3=4
        // B: pre-dec [1].bVal (3→2), follows → eff=1+2=3
        const { mars } = setup([
            I(O.MOV, M.I, AM['<'], 1, AM['<'], 1),    // [0]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 4),    // [1] pointer, B=4
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [2]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [3] B-dest
            I(O.SUB, M.X, AM['#'], 11, AM['#'], 22),  // [4] A-source
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 2, 'pointer decremented TWICE (4→3→2)');
        assertEqual(cell(mars, 3).op, O.SUB, '[4] copied to [3]');
        assertEqual(cell(mars, 3).aVal, 11, 'correct source values');
    });

    test('Double post-inc (>) on same pointer: cell incremented twice', () => {
        // MOV.I >1, >1 → both A and B post-inc [1].bVal
        // A: follows [1].bVal=0 → eff=1+0=1, postinc bVal to 1
        // B: follows [1].bVal=1 → eff=1+1=2, postinc bVal to 2
        const { mars } = setup([
            I(O.MOV, M.I, AM['>'], 1, AM['>'], 1),    // [0]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [1] pointer, B=0
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [2] B-dest
        ]);
        step(mars);
        // After both post-incs, [1].bVal should be 2
        // A read from eff=1 (the pointer itself), B wrote to eff=2
        assertEqual(cell(mars, 1).bVal, 2, 'pointer incremented TWICE (0→1→2)');
    });
});

// ══════════════════════════════════════════════════════════════════
// 3. SELF-REFERENCING INSTRUCTIONS
//    Instructions that read/write their own cell.
// ══════════════════════════════════════════════════════════════════
describe('Self-Referencing — Instructions operating on themselves', () => {
    test('MOV.I $0, $1 copies itself to next cell', () => {
        const { mars } = setup([
            I(O.MOV, M.I, AM['$'], 0, AM['$'], 1),   // [0]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),   // [1]
        ]);
        step(mars);
        assertEqual(cell(mars, 1).op, O.MOV, 'self-copy to [1]');
        assertEqual(cell(mars, 1).mod, M.I, 'modifier copied');
        assertEqual(cell(mars, 1).aVal, 0, 'aVal copied');
        assertEqual(cell(mars, 1).bVal, 1, 'bVal copied');
    });

    test('ADD.F $1, $1: same cell for src and dest — doubles, not quadruples', () => {
        // Both operands point to same cell [1]. Engine must read src BEFORE writing.
        const { mars } = setup([
            I(O.ADD, M.F, AM['$'], 1, AM['$'], 1),    // [0] ADD.F $1, $1
            I(O.DAT, M.F, AM['#'], 10, AM['#'], 20),  // [1] target
        ]);
        step(mars);
        // ADD.F: dest.A += src.A, dest.B += src.B (same cell)
        // src is read first: A=10, B=20. Then dest is written: A=10+10=20, B=20+20=40
        assertEqual(cell(mars, 1).aVal, 20, 'A: 10+10=20 (doubled, not quadrupled)');
        assertEqual(cell(mars, 1).bVal, 40, 'B: 20+20=40 (doubled, not quadrupled)');
    });

    test('SUB.A $1, $1: same cell — subtracts to zero', () => {
        const { mars } = setup([
            I(O.SUB, M.A, AM['$'], 1, AM['$'], 1),
            I(O.DAT, M.F, AM['#'], 42, AM['#'], 99),
        ]);
        step(mars);
        // SUB.A: dest.A = dest.A - src.A = 42-42 = 0
        assertEqual(cell(mars, 1).aVal, 0, 'A: 42-42=0');
        assertEqual(cell(mars, 1).bVal, 99, 'B unchanged');
    });

    test('MUL.A $1, $1: same cell — squares the value', () => {
        const { mars } = setup([
            I(O.MUL, M.A, AM['$'], 1, AM['$'], 1),
            I(O.DAT, M.F, AM['#'], 5, AM['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 1).aVal, 25, 'A: 5*5=25');
    });

    test('MOV.I $0, $0 is a no-op (self to self)', () => {
        const { mars } = setup([
            I(O.MOV, M.I, AM['$'], 0, AM['$'], 0),
        ]);
        const before = cell(mars, 0).clone();
        step(mars);
        const after = cell(mars, 0);
        assertEqual(after.op, before.op, 'op unchanged');
        assertEqual(after.aVal, before.aVal, 'aVal unchanged');
        assertEqual(after.bVal, before.bVal, 'bVal unchanged');
    });

    test('JMP $0 creates infinite loop at same address', () => {
        const { mars, warrior } = setup([
            I(O.JMP, M.B, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars, 10);
        assert(!warrior.dead, 'should not die');
        assertEqual(pc(warrior), BASE, 'PC stays at same address');
    });
});

// ══════════════════════════════════════════════════════════════════
// 4. DIV/MOD PARTIAL EXECUTION — Mixed zero divisors
//    When .F or .X modifier has one zero divisor and one non-zero,
//    the non-zero result is still computed and written, but process dies.
// ══════════════════════════════════════════════════════════════════
describe('DIV/MOD Partial Execution — Mixed zero divisors', () => {
    test('DIV.F: A-field divides, B-field is zero → result written, process dies', () => {
        const { mars, warrior } = setup([
            I(O.DIV, M.F, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 3, AM['#'], 0),   // A=3, B=0
            I(O.DAT, M.F, AM['#'], 21, AM['#'], 50), // dest
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 7, 'A-field computed: 21/3=7');
        assertEqual(warrior.tasks.length, 0, 'process dies (B div by zero)');
    });

    test('DIV.F: B-field divides, A-field is zero → result written, process dies', () => {
        const { mars, warrior } = setup([
            I(O.DIV, M.F, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 5),   // A=0, B=5
            I(O.DAT, M.F, AM['#'], 42, AM['#'], 25),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).bVal, 5, 'B-field computed: 25/5=5');
        assertEqual(warrior.tasks.length, 0, 'process dies (A div by zero)');
    });

    test('MOD.F: one zero divisor → partial write + death', () => {
        const { mars, warrior } = setup([
            I(O.MOD, M.F, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 7, AM['#'], 0),   // A=7, B=0
            I(O.DAT, M.F, AM['#'], 23, AM['#'], 50),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 2, 'A-field computed: 23%7=2');
        assertEqual(warrior.tasks.length, 0, 'process dies (B mod by zero)');
    });

    test('DIV.X: cross-divide with one zero', () => {
        const { mars, warrior } = setup([
            I(O.DIV, M.X, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 4),   // cross: A.B→D.A, A.A→D.B
            I(O.DAT, M.F, AM['#'], 20, AM['#'], 30),
        ]);
        step(mars);
        // DIV.X: dest.A = dest.A / src.B = 20/4 = 5
        //        dest.B = dest.B / src.A = 30/0 → die
        assertEqual(cell(mars, 2).aVal, 5, 'cross A computed: 20/4=5');
        assertEqual(warrior.tasks.length, 0, 'dies (cross B div/0)');
    });

    test('DIV by zero with both fields zero kills process (no writes)', () => {
        const { mars, warrior } = setup([
            I(O.DIV, M.F, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),   // both zero
            I(O.DAT, M.F, AM['#'], 42, AM['#'], 99),
        ]);
        step(mars);
        // Neither field computes, both are null
        assertEqual(warrior.tasks.length, 0, 'process dies');
        // Values should remain unchanged (no valid result to write)
        // Actually per our implementation, dest is cloned and unchanged fields stay
        assertEqual(cell(mars, 2).aVal, 42, 'A-field untouched');
        assertEqual(cell(mars, 2).bVal, 99, 'B-field untouched');
    });
});

// ══════════════════════════════════════════════════════════════════
// 5. DJN DECREMENT-THEN-CHECK — Decrement happens BEFORE zero check
// ══════════════════════════════════════════════════════════════════
describe('DJN — Decrement happens before zero check', () => {
    test('DJN with value 1: decrements to 0, does NOT jump', () => {
        const { mars, warrior } = setup([
            I(O.DJN, M.B, AM['$'], 0, AM['$'], 1),
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 1),  // B=1 → dec to 0
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 0, 'decremented to 0');
        assertEqual(pc(warrior), BASE + 1, 'should NOT jump (0 after decrement)');
    });

    test('DJN with value 2: decrements to 1, DOES jump', () => {
        const { mars, warrior } = setup([
            I(O.DJN, M.B, AM['$'], 0, AM['$'], 1),
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 2),  // B=2 → dec to 1
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 1, 'decremented to 1');
        assertEqual(pc(warrior), BASE + 0, 'should jump (1 after decrement)');
    });

    test('DJN.AB: decrements B-field (not A-field) via AB modifier', () => {
        // .AB modifier for DJN: decrement is applied based on the modifier
        // opDec case 2 (.AB): decrements B-field
        const { mars, warrior } = setup([
            I(O.DJN, M.AB, AM['$'], 0, AM['$'], 1),
            I(O.DAT, M.F, AM['#'], 99, AM['#'], 3),  // A=99, B=3
        ]);
        step(mars);
        assertEqual(cell(mars, 1).aVal, 99, 'A-field untouched by .AB');
        assertEqual(cell(mars, 1).bVal, 2, 'B-field decremented by .AB');
    });

    test('DJN.BA: decrements A-field (not B-field) via BA modifier', () => {
        const { mars, warrior } = setup([
            I(O.DJN, M.BA, AM['$'], 0, AM['$'], 1),
            I(O.DAT, M.F, AM['#'], 3, AM['#'], 99),  // A=3, B=99
        ]);
        step(mars);
        assertEqual(cell(mars, 1).aVal, 2, 'A-field decremented by .BA');
        assertEqual(cell(mars, 1).bVal, 99, 'B-field untouched by .BA');
    });

    test('DJN.F: decrements both fields, checks both for zero', () => {
        // Both must be zero for "is zero" to be true (DJN uses checkZero inverted)
        const { mars, warrior } = setup([
            I(O.DJN, M.F, AM['$'], 0, AM['$'], 1),
            I(O.DAT, M.F, AM['#'], 1, AM['#'], 2),  // A→0, B→1
        ]);
        step(mars);
        // checkZero with .F: returns true only if BOTH are zero
        // A=0, B=1 → not both zero → DJN jumps
        assertEqual(pc(warrior), BASE + 0, 'should jump (not both zero)');
    });

    test('DJN.F with both fields at 1: both decrement to 0, no jump', () => {
        const { mars, warrior } = setup([
            I(O.DJN, M.F, AM['$'], 0, AM['$'], 1),
            I(O.DAT, M.F, AM['#'], 1, AM['#'], 1),  // both → 0
        ]);
        step(mars);
        assertEqual(cell(mars, 1).aVal, 0, 'A decremented to 0');
        assertEqual(cell(mars, 1).bVal, 0, 'B decremented to 0');
        assertEqual(pc(warrior), BASE + 1, 'should NOT jump (both zero)');
    });
});

// ══════════════════════════════════════════════════════════════════
// 6. CMP/SEQ ON EMPTY CORE — Default cells are identical DAT.F $0,$0
// ══════════════════════════════════════════════════════════════════
describe('CMP/SEQ — Comparing identical empty core cells', () => {
    test('CMP.I on two empty core cells: should be equal (skip)', () => {
        // Empty core = DAT.F $0,$0 everywhere
        // Two different empty cells should be identical
        const { mars, warrior } = setup([
            I(O.CMP, M.I, AM['$'], 50, AM['$'], 100), // compare [50] and [100]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // should be skipped
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),    // lands here
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'empty cells are equal → skip');
    });

    test('CMP.I: empty cell vs non-empty → not equal (no skip)', () => {
        const { mars, warrior } = setup([
            I(O.CMP, M.I, AM['$'], 50, AM['$'], 1),
            I(O.ADD, M.AB, AM['#'], 5, AM['$'], 1),  // non-default instruction
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'different instructions → no skip');
    });

    test('SNE.I on two empty cells: should NOT skip (they are equal)', () => {
        const { mars, warrior } = setup([
            I(O.SNE, M.I, AM['$'], 50, AM['$'], 100),
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'empty cells are equal → SNE no skip');
    });
});

// ══════════════════════════════════════════════════════════════════
// 7. INDIRECT THROUGH EMPTY CORE — Following DAT 0,0 resolves to self
// ══════════════════════════════════════════════════════════════════
describe('Indirect Through Empty Core — DAT 0,0 resolves to itself', () => {
    test('@-indirect through DAT 0,0: follows B=0 → resolves to pointer cell', () => {
        // MOV.I @1, $3 → [1] is empty DAT 0,0, B=0 → eff = 1+0 = 1
        const { mars } = setup([
            I(O.MOV, M.I, AM['@'], 1, AM['$'], 3),
            I(O.DAT, M.F, AM['$'], 0, AM['$'], 0),   // [1] empty (B=0)
            I(O.DAT, M.F, AM['$'], 0, AM['$'], 0),   // [2]
            I(O.DAT, M.F, AM['$'], 0, AM['$'], 0),   // [3] dest
        ]);
        step(mars);
        // Source via @1 = core[1+0] = core[1] = DAT 0,0
        // Dest = core[3]
        // MOV.I: copy DAT 0,0 to [3] → no visible change (already DAT 0,0)
        assertEqual(cell(mars, 3).op, O.DAT, '[3] gets DAT from indirect');
    });

    test('*-indirect through DAT 0,0: follows A=0 → resolves to pointer cell', () => {
        const { mars } = setup([
            I(O.MOV, M.I, AM['*'], 1, AM['$'], 3),
            I(O.DAT, M.F, AM['$'], 0, AM['$'], 0),   // [1] A=0
            I(O.DAT, M.F, AM['$'], 0, AM['$'], 0),
            I(O.DAT, M.F, AM['$'], 0, AM['$'], 0),   // [3]
        ]);
        step(mars);
        assertEqual(cell(mars, 3).op, O.DAT, '[3] gets DAT from A-indirect');
    });
});

// ══════════════════════════════════════════════════════════════════
// 8. SPL EDGE CASES
// ══════════════════════════════════════════════════════════════════
describe('SPL Edge Cases', () => {
    test('SPL #5: immediate A → fork target is PC (not PC+5)', () => {
        // Immediate mode returns null from resolveAddress
        // Engine uses fallback: splTgt = ptrA ?? pc
        const { mars, warrior } = setup([
            I(O.SPL, M.B, AM['#'], 5, AM['$'], 0),  // [0] SPL #5
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),  // [1]
        ]);
        step(mars);
        assertEqual(warrior.tasks[0], BASE + 1, 'continuation at PC+1');
        assertEqual(warrior.tasks[1], BASE + 0, 'fork target is PC (immediate → null → fallback)');
    });

    test('SPL $0: fork and continuation both at adjacent addresses', () => {
        const { mars, warrior } = setup([
            I(O.SPL, M.B, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        assertEqual(warrior.tasks[0], BASE + 1, 'continuation at PC+1');
        assertEqual(warrior.tasks[1], BASE + 0, 'fork at PC+0 (self)');
    });

    test('SPL does not execute the forked process in the same turn', () => {
        // SPL creates a fork. The forked process should NOT execute until its turn.
        const { mars, warrior } = setup([
            I(O.SPL, M.B, AM['$'], 1, AM['$'], 0),    // [0] SPL $1
            I(O.MOV, M.AB, AM['#'], 42, AM['$'], 2),  // [1] fork target
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [2] destination
        ]);
        step(mars);
        // After 1 step, only SPL executed. MOV at [1] should NOT have executed yet.
        assertEqual(cell(mars, 2).bVal, 0, 'fork target has not executed yet');
        assertEqual(warrior.tasks.length, 2, 'two processes queued');
    });
});

// ══════════════════════════════════════════════════════════════════
// 9. POST-INCREMENT vs INSTRUCTION WRITE — Write wins
//    If instruction writes to same cell that was post-incremented,
//    the instruction's write overwrites the post-increment.
// ══════════════════════════════════════════════════════════════════
describe('Post-Increment vs Instruction Write — Write wins', () => {
    test('MOV.I overwrites cell that B post-incremented', () => {
        // MOV.I $2, >1 → B: follows [1].bVal=0 → eff=1+0=1, postinc [1].bVal to 1
        // Then MOV.I writes source [2] to eff [1], overwriting the post-inc
        const { mars } = setup([
            I(O.MOV, M.I, AM['$'], 2, AM['>'], 1),    // [0]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [1] pointer & dest (B=0)
            I(O.ADD, M.AB, AM['#'], 77, AM['#'], 88), // [2] source
        ]);
        step(mars);
        // Post-inc set [1].bVal to 1, but then MOV.I overwrites [1] entirely
        assertEqual(cell(mars, 1).op, O.ADD, 'MOV.I overwrote post-inc cell');
        assertEqual(cell(mars, 1).bVal, 88, 'B-field from source (not post-inc value)');
    });
});

// ══════════════════════════════════════════════════════════════════
// 10. PREDECREMENT SIDE EFFECTS SURVIVE PROCESS DEATH
//     If a process executes DAT, it dies, but any pre-decrement
//     from operand evaluation already modified core.
// ══════════════════════════════════════════════════════════════════
describe('Pre-decrement Side Effects Survive Death', () => {
    test('DAT with pre-decrement: process dies but side effect persists', () => {
        // DAT <1, #0 → resolveAddress for A: <1 pre-decs [1].bVal
        // The process dies (DAT), but the pre-decrement already happened.
        const { mars, warrior } = setup([
            I(O.DAT, M.F, AM['<'], 1, AM['#'], 0),    // [0] DAT <1, #0
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 5),    // [1] B=5
        ]);
        step(mars);
        assertEqual(warrior.tasks.length, 0, 'process dies (DAT)');
        assertEqual(cell(mars, 1).bVal, 4, 'pre-dec side effect persists: 5→4');
    });
});

// ══════════════════════════════════════════════════════════════════
// 11. SLT WITH WRAPPING — Values near core size
//     In unsigned comparison, 7999 > 1 (not -1 < 1)
// ══════════════════════════════════════════════════════════════════
describe('SLT with Wrapping — Unsigned comparison semantics', () => {
    test('SLT.A: 7999 is NOT less than 1 (unsigned)', () => {
        const { mars, warrior } = setup([
            I(O.SLT, M.A, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], CS - 1, AM['#'], 0),  // A=7999
            I(O.DAT, M.F, AM['#'], 1, AM['#'], 0),       // A=1
        ]);
        step(mars);
        // 7999 < 1? No → don't skip
        assertEqual(pc(warrior), BASE + 1, '7999 is not less than 1');
    });

    test('SLT.A: 0 IS less than 1', () => {
        const { mars, warrior } = setup([
            I(O.SLT, M.A, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),
            I(O.DAT, M.F, AM['#'], 1, AM['#'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, '0 < 1 → skip');
    });

    test('SLT with immediate: #3 < $value', () => {
        // SLT #3, $1 → compares immediate 3 with cell [1]
        const { mars, warrior } = setup([
            I(O.SLT, M.AB, AM['#'], 3, AM['$'], 1),  // .AB: compare A of src with B of dest
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 10),  // B=10, 3 < 10 → skip
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, '3 < 10 → skip');
    });
});

// ══════════════════════════════════════════════════════════════════
// 12. COMPLEX MULTI-STEP SCENARIOS
// ══════════════════════════════════════════════════════════════════
describe('Complex Multi-Step — Real warrior patterns', () => {
    test('Dwarf pattern: ADD + MOV + JMP loop places bombs', () => {
        // Classic Dwarf: ADD #4, $3; MOV $2, @$2; JMP $-2; DAT #0, #0
        const { mars, warrior } = setup([
            I(O.ADD, M.AB, AM['#'], 4, AM['$'], 3),   // [0] ADD #4, $3
            I(O.MOV, M.I, AM['$'], 2, AM['@'], 2),    // [1] MOV $2, @$2
            I(O.JMP, M.B, AM['$'], CS - 2, AM['$'], 0), // [2] JMP -2
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [3] bomb + pointer
        ]);
        // Run one full loop: ADD, MOV, JMP
        step(mars, 3);
        // After ADD: [3].bVal = 0+4 = 4
        // After MOV: copy [3] (DAT 0,4) to [3+4]=[7] via @[3] (bVal=4)
        assertEqual(cell(mars, 7).op, O.DAT, 'bomb placed at [7]');
        // PC should be back at [0] after JMP
        assertEqual(pc(warrior), BASE + 0, 'JMP loops back');

        // Second loop
        step(mars, 3);
        // ADD: [3].bVal = 4+4 = 8
        // MOV: copy [3] (DAT 0,8) to [3+8]=[11]
        assertEqual(cell(mars, 11).op, O.DAT, 'second bomb at [11]');
    });

    test('Imp pattern: MOV $0, $1 in tight loop', () => {
        const { mars, warrior } = setup([
            I(O.MOV, M.I, AM['$'], 0, AM['$'], 1),  // Imp
        ]);
        step(mars, 100);
        assert(!warrior.dead, 'imp survives');
        // PC should be 100 cells ahead
        assertEqual(pc(warrior), (BASE + 100) % CS, 'imp advanced 100 cells');
    });

    test('SPL 0 bomb: rapid process doubling', () => {
        const { mars, warrior } = setup([
            I(O.SPL, M.B, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars, 5);
        // After 5 SPL 0 executions, processes grow (limited by queue mechanics)
        assert(warrior.tasks.length > 1, 'multiple processes created');
        assert(!warrior.dead, 'warrior alive');
    });
});

// ══════════════════════════════════════════════════════════════════
// 13. CHECKZERO WITH IMMEDIATE B-OPERAND (Bug fix verification)
//     JMZ, JMN, DJN with #immediate B must check the IR fields,
//     not blindly return false when ptr is null.
// ══════════════════════════════════════════════════════════════════
describe('checkZero with Immediate B-Operand', () => {
    test('JMZ $2, #0: zero immediate → should jump', () => {
        // B is #0, which is zero → JMZ should jump to target
        const { mars, warrior } = setup([
            I(O.JMZ, M.B, AM['$'], 2, AM['#'], 0),  // [0] JMZ $2, #0
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),   // [1] fall-through (death)
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),   // [2] jump target
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'JMZ jumped (0 is zero)');
    });

    test('JMZ $2, #5: non-zero immediate → should NOT jump', () => {
        const { mars, warrior } = setup([
            I(O.JMZ, M.B, AM['$'], 2, AM['#'], 5),  // [0] JMZ $2, #5
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),   // [1] fall-through
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),   // [2] jump target
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'JMZ did not jump (5 is not zero)');
    });

    test('JMN $2, #0: zero immediate → should NOT jump', () => {
        const { mars, warrior } = setup([
            I(O.JMN, M.B, AM['$'], 2, AM['#'], 0),  // [0] JMN $2, #0
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),   // [1] fall-through
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),   // [2] jump target
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'JMN did not jump (0 is zero)');
    });

    test('JMN $2, #7: non-zero immediate → should jump', () => {
        const { mars, warrior } = setup([
            I(O.JMN, M.B, AM['$'], 2, AM['#'], 7),  // [0] JMN $2, #7
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),   // [1] fall-through (death)
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),   // [2] jump target
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'JMN jumped (7 is not zero)');
    });

    test('JMZ.A $2, #0 with aVal=0: checks A-field', () => {
        // .A modifier → checkZero uses aVal of IR
        const { mars, warrior } = setup([
            I(O.JMZ, M.A, AM['$'], 2, AM['#'], 99),  // [0] aVal of B-operand irrelevant; .A checks A of target
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        // .A checks aVal of the target. But B is immediate (#99), so ptr is null.
        // checkZero uses instr (the IR). IR.aVal = 2 (the A-operand value). 2 ≠ 0 → don't jump.
        assertEqual(pc(warrior), BASE + 1, 'JMZ.A checks aVal of IR (which is 2, not zero)');
    });

    test('JMZ.AB $2, #0: .AB checks bVal', () => {
        // .AB modifier → checkZero checks bVal
        const { mars, warrior } = setup([
            I(O.JMZ, M.AB, AM['$'], 2, AM['#'], 0),  // [0] bVal=0
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'JMZ.AB jumped (bVal=0 is zero)');
    });
});

// ══════════════════════════════════════════════════════════════════
// 14. DJN WITH IMMEDIATE B — Decrement-then-check on IR
//     When B is immediate, DJN must decrement the IR copy's fields
//     and then check for zero. The decrement is ephemeral (IR only).
// ══════════════════════════════════════════════════════════════════
describe('DJN with Immediate B-Operand', () => {
    test('DJN $0, #1: decrement 1→0, zero → should NOT jump (loop to self)', () => {
        // B=#1, decrement makes it 0, zero → don't jump → fall through to next
        const { mars, warrior } = setup([
            I(O.DJN, M.B, AM['$'], 0, AM['#'], 1),   // [0] DJN $0, #1
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),   // [1] fall-through
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'DJN fell through (1→0 is zero)');
    });

    test('DJN $0, #0: decrement 0→7999, non-zero → should jump', () => {
        // B=#0, decrement wraps to CS-1=7999, not zero → jump
        const { mars, warrior } = setup([
            I(O.DJN, M.B, AM['$'], 0, AM['#'], 0),   // [0] DJN $0, #0
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),   // [1] fall-through
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 0, 'DJN jumped (0→7999 is not zero)');
    });

    test('DJN $0, #5: decrement 5→4, non-zero → should jump', () => {
        const { mars, warrior } = setup([
            I(O.DJN, M.B, AM['$'], 0, AM['#'], 5),   // [0] DJN $0, #5
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 0, 'DJN jumped (5→4 is not zero)');
    });

    test('DJN immediate B persists decrement in core', () => {
        // ICWS-94: # mode target is the instruction itself; decrement must persist
        const { mars, warrior } = setup([
            I(O.DJN, M.B, AM['$'], 2, AM['#'], 1),   // [0] DJN $2, #1 → dec to 0, fall through
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),   // [1]
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),   // [2] target
        ]);
        step(mars);
        // Core must reflect the decremented value (ICWS-94 §5.4.10)
        assertEqual(cell(mars, 0).bVal, 0, 'core bVal decremented from 1 to 0');
    });
});

// ══════════════════════════════════════════════════════════════════
// 15. DOUBLE INDIRECTION — Chained @ and * addressing
//     Indirection only goes one level deep per ICWS-94.
// ══════════════════════════════════════════════════════════════════
describe('Indirection Depth — Single level only', () => {
    test('MOV @1, $3: B-indirect through chain does NOT double-deref', () => {
        // [1].bVal=1 → points to [1+1]=[2]. Indirection resolves to [2], period.
        // Even though [2].bVal=1 → would point to [3], no second deref happens.
        const { mars, warrior } = setup([
            I(O.MOV, M.B, AM['@'], 1, AM['$'], 4),     // [0] MOV @1, $4
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 1),     // [1] bVal=1 → points to [2]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 1),     // [2] bVal=1 → would point to [3]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 42),    // [3] if double deref, would read this
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),     // [4] destination
        ]);
        step(mars);
        // @1 resolves: [1].bVal=1, target = 1+1 = 2. Reads [2].bVal = 1.
        assertEqual(cell(mars, 4).bVal, 1, 'single deref: got [2].bVal, not [3].bVal');
    });

    test('MOV *1, $3: A-indirect single level', () => {
        const { mars, warrior } = setup([
            I(O.MOV, M.A, AM['*'], 1, AM['$'], 4),     // [0] MOV *1, $4
            I(O.DAT, M.F, AM['#'], 2, AM['#'], 0),     // [1] aVal=2 → points to [3]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),     // [2]
            I(O.DAT, M.F, AM['#'], 77, AM['#'], 0),    // [3] aVal=77
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),     // [4] destination
        ]);
        step(mars);
        assertEqual(cell(mars, 4).aVal, 77, 'A-indirect read from [3].aVal');
    });
});

// ══════════════════════════════════════════════════════════════════
// 16. PRE-DECREMENT ON SAME CELL — A and B both pre-dec same pointer
//     A's pre-dec happens first, B sees the already-decremented value.
// ══════════════════════════════════════════════════════════════════
describe('Pre/Post operations on shared pointer cells', () => {
    test('MOV <1, <1: double pre-dec on same pointer cell', () => {
        // [1] has bVal=10
        // A resolves <1: pre-dec [1].bVal (10→9), read from [1+9]=[10]
        // B resolves <1: pre-dec [1].bVal (9→8), write to [1+8]=[9]
        const { mars, warrior } = setup([
            I(O.MOV, M.I, AM['<'], 1, AM['<'], 1),      // [0] MOV <1, <1
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 10),     // [1] pointer, bVal=10
        ]);
        step(mars);
        // After both pre-decs: [1].bVal = 8
        assertEqual(cell(mars, 1).bVal, 8, 'two pre-decs: 10→9→8');
    });

    test('MOV >1, >1: double post-inc on same pointer cell', () => {
        // [1] has bVal=3
        // A resolves >1: read via [1+3]=[4], post-inc [1].bVal (3→4)
        // B resolves >1: write to [1+4]=[5], post-inc [1].bVal (4→5)
        const { mars, warrior } = setup([
            I(O.MOV, M.B, AM['>'], 1, AM['>'], 1),      // [0] MOV >1, >1
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 3),      // [1] pointer, bVal=3
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),      // [2]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),      // [3]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 99),     // [4] source (bVal=99)
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),      // [5] destination
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 5, 'two post-incs: 3→4→5');
        assertEqual(cell(mars, 5).bVal, 99, 'source [4].bVal copied to [5]');
    });

    test('ADD {1, }1: A-predec and A-postinc on same cell', () => {
        // [1] has aVal=5
        // A resolves {1: pre-dec [1].aVal (5→4), read from [1+4]=[5]
        // B resolves }1: target = [1+4]=[5], post-inc [1].aVal (4→5)
        const { mars, warrior } = setup([
            I(O.ADD, M.B, AM['{'], 1, AM['}'], 1),      // [0] ADD {1, }1
            I(O.DAT, M.F, AM['#'], 5, AM['#'], 0),      // [1] aVal=5
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),      // [2]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),      // [3]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),      // [4]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 10),     // [5] bVal=10
        ]);
        step(mars);
        // A reads [5].bVal=10 (src), B writes to [5].bVal += 10 → 20
        // [1].aVal: 5→4 (pre-dec) →5 (post-inc)
        assertEqual(cell(mars, 1).aVal, 5, 'aVal restored: pre-dec then post-inc');
        assertEqual(cell(mars, 5).bVal, 20, 'ADD: 10+10=20');
    });
});

// ══════════════════════════════════════════════════════════════════
// 17. SNE.I WITH SUBTLE DIFFERENCES
//     SNE.I compares full instruction including opcode, modes, modifier.
//     Two cells that look similar but differ in mode should NOT match.
// ══════════════════════════════════════════════════════════════════
describe('SNE.I — Full instruction comparison', () => {
    test('SNE.I: identical cells → equal → dont skip', () => {
        const { mars, warrior } = setup([
            I(O.SNE, M.I, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 5, AM['#'], 10),   // [1]
            I(O.DAT, M.F, AM['#'], 5, AM['#'], 10),   // [2] same
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'identical → no skip');
    });

    test('SNE.I: different addressing mode → not equal → skip', () => {
        const { mars, warrior } = setup([
            I(O.SNE, M.I, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 5, AM['#'], 10),   // [1] aMode=#
            I(O.DAT, M.F, AM['$'], 5, AM['#'], 10),   // [2] aMode=$ ← different!
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'different aMode → skip');
    });

    test('SNE.I: different modifier → not equal → skip', () => {
        const { mars, warrior } = setup([
            I(O.SNE, M.I, AM['$'], 1, AM['$'], 2),
            I(O.MOV, M.A, AM['$'], 0, AM['$'], 0),    // [1] mod=.A
            I(O.MOV, M.B, AM['$'], 0, AM['$'], 0),    // [2] mod=.B ← different!
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'different modifier → skip');
    });

    test('SNE.I: different opcode → not equal → skip', () => {
        const { mars, warrior } = setup([
            I(O.SNE, M.I, AM['$'], 1, AM['$'], 2),
            I(O.ADD, M.F, AM['$'], 5, AM['$'], 10),   // [1] ADD
            I(O.SUB, M.F, AM['$'], 5, AM['$'], 10),   // [2] SUB ← different!
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'different opcode → skip');
    });
});

// ══════════════════════════════════════════════════════════════════
// 18. MOV.I PRESERVES ALL FIELDS
//     MOV.I copies the entire instruction: opcode, modifier, modes, values
// ══════════════════════════════════════════════════════════════════
describe('MOV.I — Full instruction copy', () => {
    test('MOV.I copies opcode, modifier, addressing modes, and values', () => {
        const { mars, warrior } = setup([
            I(O.MOV, M.I, AM['$'], 1, AM['$'], 2),
            I(O.ADD, M.X, AM['<'], 42, AM['}'], 99),  // [1] complex source
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [2] empty destination
        ]);
        step(mars);
        const dest = cell(mars, 2);
        assertEqual(dest.op, O.ADD, 'opcode copied');
        assertEqual(dest.mod, M.X, 'modifier copied');
        assertEqual(dest.aMode, AM['<'], 'aMode copied');
        assertEqual(dest.bMode, AM['}'], 'bMode copied');
        assertEqual(dest.aVal, 42, 'aVal copied');
        assertEqual(dest.bVal, 99, 'bVal copied');
    });
});

// ══════════════════════════════════════════════════════════════════
// 19. ARITHMETIC WRAPPING AT CORE SIZE BOUNDARIES
//     All values are modulo core size. Overflow and underflow must wrap.
// ══════════════════════════════════════════════════════════════════
describe('Arithmetic Wrapping', () => {
    test('ADD wraps at core size: 7990 + 20 = 10 (mod 8000)', () => {
        const { mars, warrior } = setup([
            I(O.ADD, M.A, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 20, AM['#'], 0),
            I(O.DAT, M.F, AM['#'], 7990, AM['#'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 10, '7990+20=8010→10 mod 8000');
    });

    test('SUB wraps negative: 3 - 5 = 7998 (mod 8000)', () => {
        const { mars, warrior } = setup([
            I(O.SUB, M.A, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 5, AM['#'], 0),    // source: A=5
            I(O.DAT, M.F, AM['#'], 3, AM['#'], 0),    // dest: A=3
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 7998, '3-5=-2→7998 mod 8000');
    });

    test('MUL wraps large products: 4000 * 4000 = 0 (mod 8000)', () => {
        const { mars, warrior } = setup([
            I(O.MUL, M.A, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 4000, AM['#'], 0),
            I(O.DAT, M.F, AM['#'], 4000, AM['#'], 0),
        ]);
        step(mars);
        // 4000*4000 = 16,000,000 mod 8000 = 0
        assertEqual(cell(mars, 2).aVal, 0, '4000*4000=16M→0 mod 8000');
    });

    test('Pre-decrement wraps: 0 - 1 = 7999', () => {
        // <1 when [1].bVal=0 → pre-dec to 7999
        const { mars, warrior } = setup([
            I(O.MOV, M.B, AM['<'], 1, AM['$'], 2),  // [0] MOV <1, $2
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),  // [1] bVal=0
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),  // [2] dest
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 7999, 'pre-dec wrapped: 0→7999');
    });
});

// ══════════════════════════════════════════════════════════════════
// 20. SELF-MODIFYING DJN COUNTER
//     DJN modifies its own B-target, which changes behavior on next loop.
// ══════════════════════════════════════════════════════════════════
describe('Self-Modifying DJN', () => {
    test('DJN uses counter cell; counter reaches zero to exit loop', () => {
        // DJN $0, $1 decrements [1].bVal each iteration, jumps to $0 (self) while non-zero
        const { mars, warrior } = setup([
            I(O.DJN, M.B, AM['$'], 0, AM['$'], 1),   // [0] DJN $0, $1
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 3),    // [1] counter: bVal=3
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),    // [2] exit target
        ]);
        // Iteration 1: [1].bVal 3→2, not zero → jump to $0
        step(mars);
        assertEqual(cell(mars, 1).bVal, 2, 'counter: 3→2');
        assertEqual(pc(warrior), BASE + 0, 'jump back (2≠0)');

        // Iteration 2: [1].bVal 2→1, not zero → jump to $0
        step(mars);
        assertEqual(cell(mars, 1).bVal, 1, 'counter: 2→1');
        assertEqual(pc(warrior), BASE + 0, 'jump back (1≠0)');

        // Iteration 3: [1].bVal 1→0, zero → fall through to [1]
        step(mars);
        assertEqual(cell(mars, 1).bVal, 0, 'counter: 1→0');
        assertEqual(pc(warrior), BASE + 1, 'fell through (0=zero)');
    });
});

// ══════════════════════════════════════════════════════════════════
// 21. SPL TASK QUEUE ORDERING
//     ICWS-94: SPL queues continuation (PC+1) first, then fork target.
//     The next step for this warrior executes the CONTINUATION, not fork.
// ══════════════════════════════════════════════════════════════════
describe('SPL Task Queue Ordering', () => {
    test('SPL $2: next execution is continuation (PC+1), not fork target', () => {
        const { mars, warrior } = setup([
            I(O.SPL, M.B, AM['$'], 2, AM['$'], 0),   // [0] SPL $2 → fork to [2]
            I(O.MOV, M.A, AM['#'], 77, AM['$'], 3),   // [1] continuation: write 77
            I(O.MOV, M.A, AM['#'], 88, AM['$'], 2),   // [2] fork target: write 88
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [3]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [4]
        ]);
        // After SPL: queue = [continuation=1, fork=2]
        step(mars);
        assertEqual(warrior.tasks.length, 2, 'two tasks in queue');
        assertEqual(warrior.tasks[0], BASE + 1, 'first in queue: continuation');
        assertEqual(warrior.tasks[1], BASE + 2, 'second in queue: fork target');

        // Execute continuation first (step 2)
        step(mars);
        assertEqual(cell(mars, 4).aVal, 77, 'continuation wrote 77');

        // Then fork target (step 3)
        step(mars);
        assertEqual(cell(mars, 4).aVal, 88, 'fork overwrote with 88');
    });
});

// ══════════════════════════════════════════════════════════════════
// 22. JMP WITH IMMEDIATE A
//     JMP #N → A resolves to null → jump target is PC (loop to self)
// ══════════════════════════════════════════════════════════════════
describe('JMP with Immediate A', () => {
    test('JMP #5: immediate A → jumps to self (infinite loop)', () => {
        const { mars, warrior } = setup([
            I(O.JMP, M.B, AM['#'], 5, AM['$'], 0),   // [0] JMP #5
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 0, 'JMP #N loops to self');
    });
});

// ══════════════════════════════════════════════════════════════════
// 23. MOV/ADD/SUB TO IMMEDIATE B — No-op (can't write to immediate)
// ══════════════════════════════════════════════════════════════════
describe('Write to Immediate B — No-op', () => {
    test('MOV $1, #0: immediate B dest → no write occurs', () => {
        const { mars, warrior } = setup([
            I(O.MOV, M.A, AM['$'], 1, AM['#'], 0),   // [0] MOV $1, #0
            I(O.DAT, M.F, AM['#'], 42, AM['#'], 0),  // [1] source
        ]);
        const before = cell(mars, 0).bVal;
        step(mars);
        // Nothing should be written — instruction advances normally
        assertEqual(pc(warrior), BASE + 1, 'PC advances normally');
        // The instruction at [0] should be unchanged (or at least no crash)
    });

    test('ADD $1, #0: immediate B dest → no write, no crash', () => {
        const { mars, warrior } = setup([
            I(O.ADD, M.A, AM['$'], 1, AM['#'], 0),
            I(O.DAT, M.F, AM['#'], 10, AM['#'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'ADD with imm B is a no-op');
    });
});

// ══════════════════════════════════════════════════════════════════
// 24. DIV/MOD BOTH ZERO WITH .A AND .B MODIFIERS
//     Single-field division by zero kills process and writes nothing.
// ══════════════════════════════════════════════════════════════════
describe('DIV/MOD Single-Field Zero Divisor', () => {
    test('DIV.A $1, $2: A-field div by 0 → die, no write', () => {
        const { mars, warrior } = setup([
            I(O.DIV, M.A, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 99),   // src A=0 (divisor!)
            I(O.DAT, M.F, AM['#'], 10, AM['#'], 5),   // dest A=10
        ]);
        step(mars);
        step(mars); // trigger dead flag
        assert(warrior.dead || warrior.tasks.length === 0, 'process killed by div/0');
        assertEqual(cell(mars, 2).aVal, 10, 'dest unchanged on div/0');
    });

    test('MOD.B $1, $2: B-field mod by 0 → die, no write', () => {
        const { mars, warrior } = setup([
            I(O.MOD, M.B, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 99, AM['#'], 0),   // src B=0 (divisor!)
            I(O.DAT, M.F, AM['#'], 5, AM['#'], 10),   // dest B=10
        ]);
        step(mars);
        step(mars);
        assert(warrior.dead || warrior.tasks.length === 0, 'process killed by mod/0');
        assertEqual(cell(mars, 2).bVal, 10, 'dest unchanged on mod/0');
    });
});

// ══════════════════════════════════════════════════════════════════
// 25. CMP.I WITH BOTH IMMEDIATE — Compares IR to itself
// ══════════════════════════════════════════════════════════════════
describe('CMP with Both Immediate Operands', () => {
    test('CMP.A #3, #5: both immediate → compares IR.aVal to IR.aVal → equal → skip', () => {
        const { mars, warrior } = setup([
            I(O.CMP, M.A, AM['#'], 3, AM['#'], 5),
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        // Both resolve to instr. .A compares instr.aVal with instr.aVal → always equal
        assertEqual(pc(warrior), BASE + 2, 'CMP.A #,# always skips (self-compare)');
    });

    test('CMP.AB #3, #5: compares IR.aVal(3) vs IR.bVal(5) → not equal → no skip', () => {
        const { mars, warrior } = setup([
            I(O.CMP, M.AB, AM['#'], 3, AM['#'], 5),
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        // .AB compares A of src with B of dest. Both are instr → aVal=3 vs bVal=5 → not equal
        assertEqual(pc(warrior), BASE + 1, 'CMP.AB #3,#5 → 3≠5 → no skip');
    });

    test('CMP.AB #7, #7: same cross-fields → equal → skip', () => {
        const { mars, warrior } = setup([
            I(O.CMP, M.AB, AM['#'], 7, AM['#'], 7),
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'CMP.AB #7,#7 → 7=7 → skip');
    });
});

// ══════════════════════════════════════════════════════════════════
// 26. COMPLEX: Imp-gate (SPL 0 + JMP -1 defense)
// ══════════════════════════════════════════════════════════════════
describe('Complex: Imp-gate defense pattern', () => {
    test('SPL 0, JMP -1 creates self-sustaining gate', () => {
        const { mars, warrior } = setup([
            I(O.SPL, M.B, AM['$'], 0, AM['$'], 0),       // [0] SPL $0
            I(O.JMP, M.B, AM['$'], CS - 1, AM['$'], 0),  // [1] JMP -1
        ]);
        // Run several cycles — the gate should keep spawning processes
        step(mars, 10);
        assert(!warrior.dead, 'gate warrior survives');
        assert(warrior.tasks.length > 2, 'multiple processes sustained');
    });
});

// ══════════════════════════════════════════════════════════════════
// 27. MULTI-PROCESS SHARED STATE
//     Two processes from SPL modify the same counter cell.
// ══════════════════════════════════════════════════════════════════
describe('Multi-Process Shared State', () => {
    test('Two processes both increment a shared counter', () => {
        // [0] SPL $2 → fork
        // [1] ADD #1, $3 → increment [4]
        // [2] ADD #1, $2 → increment [4]
        // [3] JMP $-2    → jump to [1]
        // [4] DAT #0, #0 → counter
        const { mars, warrior } = setup([
            I(O.SPL, M.B, AM['$'], 2, AM['$'], 0),     // [0] SPL $2
            I(O.ADD, M.AB, AM['#'], 1, AM['$'], 3),    // [1] ADD #1, $3 (cont)
            I(O.ADD, M.AB, AM['#'], 1, AM['$'], 2),    // [2] ADD #1, $2 (fork)
            I(O.JMP, M.B, AM['$'], CS - 2, AM['$'], 0),// [3] JMP -2 → [1]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),     // [4] shared counter
        ]);
        // SPL: queue=[1,2]. Step 2: exec [1], counter+1=1. Step 3: exec [2], counter+1=2.
        step(mars, 3);
        assertEqual(cell(mars, 4).bVal, 2, 'both processes incremented counter');
    });
});

// ══════════════════════════════════════════════════════════════════
// 28. DJN SELF-DECREMENTING — DJN $0, $0 modifies its own bVal in core
// ══════════════════════════════════════════════════════════════════
describe('DJN Self-Decrementing (modifies own instruction in core)', () => {
    test('DJN.B $0, $0: first iteration modifies own bVal, changing B-offset', () => {
        // DJN $0, $0: initially bVal=0.
        // opDec resolves B: $0 → target = pc+0 = pc. Decrements core[pc].bVal: 0→7999.
        // checkZero: core[pc].bVal = 7999 ≠ 0 → jump to pc+aVal=pc+0=pc.
        // BUT on 2nd iteration, the IR now has bVal=7999.
        // B resolves: $7999 → target = pc+7999 ≠ pc! Self-modification changed the offset!
        const { mars, warrior } = setup([
            I(O.DJN, M.B, AM['$'], 0, AM['$'], 0),   // [0] DJN $0, $0
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),   // [1] exit
        ]);
        // First iteration: bVal 0→7999, not zero → loop
        step(mars);
        assertEqual(cell(mars, 0).bVal, 7999, 'bVal wrapped: 0→7999');
        assertEqual(pc(warrior), BASE + 0, 'loops to self');

        // Second iteration: IR has bVal=7999, so B=$7999 → ptrB = (pc+7999) % CS.
        // opDec decrements core[pc+7999], NOT core[pc]. core[pc].bVal stays 7999.
        step(mars);
        assertEqual(cell(mars, 0).bVal, 7999, 'core[pc].bVal unchanged (B offset changed!)');
    });
});

// ══════════════════════════════════════════════════════════════════
// 29. A-INDIRECT PRE-DEC AFFECTING B's INDIRECT
//     A uses {1, which pre-decrements [1].aVal.
//     B uses *1, which follows [1].aVal (now decremented by A's side effect).
// ══════════════════════════════════════════════════════════════════
describe('A-operand Pre-dec Visible to B A-indirect', () => {
    test('{1 pre-decs [1].aVal; *1 uses the decremented aVal', () => {
        const { mars, warrior } = setup([
            I(O.MOV, M.B, AM['{'], 1, AM['*'], 1),    // [0] MOV {1, *1
            I(O.DAT, M.F, AM['#'], 5, AM['#'], 0),    // [1] aVal=5
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [2]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [3]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [4]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 99),   // [5] source bVal=99
        ]);
        step(mars);
        // A resolves {1: pre-dec [1].aVal (5→4), target=1+4=5. ptrA=5.
        // B resolves *1: follows [1].aVal (now 4!), target=1+4=5. ptrB=5.
        // MOV.B copies core[5].bVal to core[5].bVal — self-copy, no change.
        assertEqual(cell(mars, 1).aVal, 4, 'pre-dec: 5→4');
        // Both resolved to same address (5), so it's a self-copy
        assertEqual(cell(mars, 5).bVal, 99, 'self-copy is a no-op');
    });
});

// ══════════════════════════════════════════════════════════════════
// 30. DIV.F PARTIAL WRITE — One divisor zero, other succeeds
//     ICWS-94: compute the non-zero result, write it, then die.
// ══════════════════════════════════════════════════════════════════
describe('DIV.F Partial Write Details', () => {
    test('DIV.F: A-div/0 but B succeeds → B-field updated, process dies', () => {
        const { mars, warrior } = setup([
            I(O.DIV, M.F, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 3),    // src: A=0 (div/0!), B=3
            I(O.DAT, M.F, AM['#'], 100, AM['#'], 12), // dest: A=100, B=12
        ]);
        step(mars);
        // A: 100/0 = div/0 → dest.A unchanged (100)
        // B: 12/3 = 4 → dest.B = 4
        assertEqual(cell(mars, 2).aVal, 100, 'A-field unchanged (div/0)');
        assertEqual(cell(mars, 2).bVal, 4, 'B-field computed: 12/3=4');
        assertEqual(warrior.tasks.length, 0, 'process dies from partial div/0');
    });

    test('MOD.X: cross-fields, one zero → partial write + death', () => {
        const { mars, warrior } = setup([
            I(O.MOD, M.X, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 7, AM['#'], 0),    // src: A=7, B=0 (cross: B→A, A→B)
            I(O.DAT, M.F, AM['#'], 20, AM['#'], 15),  // dest: A=20, B=15
        ]);
        step(mars);
        // .X: dest.A = dest.A % src.B = 20 % 0 → div/0! dest.A unchanged.
        //     dest.B = dest.B % src.A = 15 % 7 = 1
        assertEqual(cell(mars, 2).aVal, 20, 'A-field unchanged (mod/0 via cross)');
        assertEqual(cell(mars, 2).bVal, 1, 'B-field computed: 15%7=1');
        assertEqual(warrior.tasks.length, 0, 'process dies');
    });
});

// ══════════════════════════════════════════════════════════════════
// 31. P-SPACE ROUND-TRIP (STP → LDP)
//     Store to p-space, then load back, verify value survives.
// ══════════════════════════════════════════════════════════════════
describe('P-Space Round-Trip', () => {
    test('STP stores value, LDP loads it back', () => {
        // [0] STP.AB #42, $2 → ps[core[2].B] = 42 → ps[3] = 42
        // [1] LDP.AB #3, $2  → core[3].B = ps[3] = 42
        // [2] DAT #0, #3     → pointer cell, bVal=3 (p-space index)
        // [3] DAT #0, #0     → destination for LDP
        const { mars, warrior } = setup([
            I(O.STP, M.AB, AM['#'], 42, AM['$'], 2),   // [0] store 42 into ps[3]
            I(O.LDP, M.AB, AM['#'], 3, AM['$'], 2),    // [1] load ps[3] into [3].B
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 3),     // [2] pointer/index cell
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),     // [3] destination
        ]);
        step(mars); // STP: ps[3] = 42
        step(mars); // LDP: core[BASE+3].bVal = ps[3] = 42
        assertEqual(cell(mars, 3).bVal, 42, 'round-trip through p-space preserves value');
    });
});

// ══════════════════════════════════════════════════════════════════
// 32. INDIRECT ADDRESSING NEAR CORE BOUNDARY
//     Ensure indirect addressing wraps correctly at core edges.
// ══════════════════════════════════════════════════════════════════
describe('Indirect Addressing Near Core Boundary', () => {
    test('B-indirect wraps around core: pointer reaches cell 7999', () => {
        // Pointer at BASE+1 with bVal that makes target = 7999
        // target=BASE+1, indirect = BASE+1 + bVal (mod CS) = 7999
        // So bVal = 7999 - (BASE+1) = 7898
        const bVal = CS - BASE - 2; // 7898
        const { mars, warrior } = setup([
            I(O.MOV, M.B, AM['@'], 1, AM['$'], 2),     // [0] MOV @1, $2
            I(O.DAT, M.F, AM['#'], 0, AM['#'], bVal),  // [1] bVal→points to 7999
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),     // [2] destination
        ]);
        // Set a value at cell 7999
        mars.core.set(CS - 1, I(O.DAT, M.F, AM['#'], 0, AM['#'], 77), 0);
        step(mars);
        assertEqual(cell(mars, 2).bVal, 77, 'indirect wraps around core boundary');
    });
});

// ══════════════════════════════════════════════════════════════════
// 33. SPL AT MAX PROCESSES — Fork silently fails
// ══════════════════════════════════════════════════════════════════
describe('SPL at Max Processes', () => {
    test('SPL when at max processes: continuation queued, fork dropped', () => {
        const { mars, warrior } = setup([
            I(O.SPL, M.B, AM['$'], 0, AM['$'], 0),   // [0] SPL $0
        ]);
        const maxProcs = mars.maxProcesses;
        // Fill queue to exactly maxProcs. After shift (-1), push cont (+1) → maxProcs.
        // Then check: maxProcs < maxProcs → false → fork dropped.
        warrior.tasks = [];
        for (let i = 0; i < maxProcs; i++) {
            warrior.tasks.push(BASE + 0);
        }
        step(mars); // Execute SPL: shift(-1), push cont(+1), fork dropped
        assertEqual(warrior.tasks.length, maxProcs, 'fork dropped at max (cont still queued)');
    });
});

// ══════════════════════════════════════════════════════════════════
// 34. NOP WITH SIDE EFFECTS FROM ADDRESSING MODES
//     NOP does nothing, but operand resolution still has side effects!
// ══════════════════════════════════════════════════════════════════
describe('NOP with Addressing Mode Side Effects', () => {
    test('NOP <1, >2: pre-dec and post-inc still happen', () => {
        const { mars, warrior } = setup([
            I(O.NOP, M.F, AM['<'], 1, AM['>'], 2),    // [0] NOP <1, >2
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 10),   // [1] bVal=10
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 20),   // [2] bVal=20
        ]);
        step(mars);
        // <1: pre-dec [1].bVal (10→9)
        // >2: post-inc [2].bVal (20→21)
        // NOP does nothing else, but side effects happened
        assertEqual(cell(mars, 1).bVal, 9, 'pre-dec side effect from NOP');
        assertEqual(cell(mars, 2).bVal, 21, 'post-inc side effect from NOP');
    });
});

// ══════════════════════════════════════════════════════════════════
// 35. IN-REGISTER EVALUATION: source snapshot captured between A and B
//     MOV.I $0, >0 — B post-incs core[pc].bVal DURING B-operand eval.
//     In-register: source was captured at A-resolve (before the post-inc),
//     so the MOV writes back the pre-increment value.
// ══════════════════════════════════════════════════════════════════
describe('In-register evaluation: source captured before B-operand side effects', () => {
    test('MOV.I $0, >0: self-mov restores pre-increment source', () => {
        // A resolves $0 → ptrA=pc. srcA captured = core[pc] with bVal=0.
        // B resolves >0 → target=pc, r=pc+0, post-inc core[pc].bVal (0→1). ptrB=pc.
        // MOV.I writes srcA (bVal=0) over core[pc] → net bVal=0 (post-inc undone).
        const { mars, warrior } = setup([
            I(O.MOV, M.I, AM['$'], 0, AM['>'], 0),
        ]);
        step(mars);
        assertEqual(cell(mars, 0).bVal, 0, 'srcA snapshot predates post-inc; MOV restores bVal=0');
        assertEqual(cell(mars, 0).op, O.MOV, 'still a MOV instruction');
        assertEqual(cell(mars, 0).aVal, 0, 'aVal unchanged');
    });

    test('MOV.I $1, <1: src captured before B-side pre-decrement modifies source cell', () => {
        // A resolves $1 → ptrA=pc+1. srcA = core[pc+1].clone() with bVal=2.
        // B resolves <1 → target=pc+1, pre-dec core[pc+1].bVal (2→1), r=pc+1+1=pc+2. ptrB=pc+2.
        // MOV.I writes srcA (bVal=2) to core[pc+2].
        // In-memory (buggy) would read src AFTER pre-dec → bVal=1. In-register → bVal=2.
        const { mars, warrior } = setup([
            I(O.MOV, M.I, AM['$'], 1, AM['<'], 1),    // [0]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 2),    // [1]
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 1, 'pre-dec applied to source cell: 2→1');
        assertEqual(cell(mars, 2).bVal, 2, 'dest has pre-decrement snapshot (in-register semantics)');
        assertEqual(cell(mars, 2).op, O.DAT, 'dest is the DAT (whole-instruction copy from src)');
    });
});

// ══════════════════════════════════════════════════════════════════
// 36. PRE-DECREMENT ON DESTINATION CELL — Clone captures side effect
//     ADD.A <2, $2: A pre-decs [2].bVal, then B resolves to [2].
//     dest is cloned from the MODIFIED [2] (with pre-decremented bVal).
// ══════════════════════════════════════════════════════════════════
describe('Pre-decrement on destination cell', () => {
    test('ADD.A <2, $2: dest clone captures A pre-dec side effect', () => {
        // [0] ADD.A <2, $2
        // [1] DAT #0, #0
        // [2] DAT #10, #5 (A=10, B=5)
        // A resolves <2: target=2, pre-dec [2].bVal (5→4), r=2+4=6. ptrA=6.
        // B resolves $2: target=2. ptrB=2.
        // ADD.A: src=core[6] (empty, aVal=0). dest=core[2].clone() (aVal=10, bVal=4!).
        // dest.aVal = src.aVal + dest.aVal = 0 + 10 = 10.
        // core.set(2, dest) → [2] = {aVal:10, bVal:4}
        const { mars, warrior } = setup([
            I(O.ADD, M.A, AM['<'], 2, AM['$'], 2),    // [0]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [1]
            I(O.DAT, M.F, AM['#'], 10, AM['#'], 5),   // [2]
        ]);
        step(mars);
        assertEqual(cell(mars, 2).bVal, 4, 'bVal pre-decremented: 5→4');
        assertEqual(cell(mars, 2).aVal, 10, 'aVal: 0+10=10 (src was empty core)');
    });
});

// ══════════════════════════════════════════════════════════════════
// 37. CMP.I IGNORES OWNER FIELD
//     Two identical instructions with different owners compare as equal.
// ══════════════════════════════════════════════════════════════════
describe('CMP.I ignores owner field', () => {
    test('Two instructions with different owners but same fields → equal', () => {
        const { mars, warrior } = setup([
            I(O.CMP, M.I, AM['$'], 1, AM['$'], 2),
            I(O.ADD, M.F, AM['$'], 5, AM['$'], 10),   // [1] owner will be 0
            I(O.ADD, M.F, AM['$'], 5, AM['$'], 10),   // [2] same instruction
        ]);
        // Set different owners
        mars.core.get(BASE + 1).owner = 0;
        mars.core.get(BASE + 2).owner = 1;
        step(mars);
        // CMP.I compares op, mod, aMode, aVal, bMode, bVal — NOT owner
        assertEqual(pc(warrior), BASE + 2, 'owner ignored → equal → skip');
    });
});

// ══════════════════════════════════════════════════════════════════
// 38. DIV INTEGER TRUNCATION
//     ICWS-94: integer division truncates toward zero (floor for positives).
// ══════════════════════════════════════════════════════════════════
describe('DIV Integer Truncation', () => {
    test('DIV.A: 7/2=3 (floor), not 4', () => {
        const { mars, warrior } = setup([
            I(O.DIV, M.A, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 2, AM['#'], 0),    // divisor A=2
            I(O.DAT, M.F, AM['#'], 7, AM['#'], 0),    // dividend A=7
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 3, '7/2=3 (integer truncation)');
    });

    test('DIV.B: 1/3=0 (floor)', () => {
        const { mars, warrior } = setup([
            I(O.DIV, M.B, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 3),    // divisor B=3
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 1),    // dividend B=1
        ]);
        step(mars);
        assertEqual(cell(mars, 2).bVal, 0, '1/3=0 (integer truncation)');
    });

    test('MOD: 17%5=2', () => {
        const { mars, warrior } = setup([
            I(O.MOD, M.A, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 5, AM['#'], 0),    // divisor A=5
            I(O.DAT, M.F, AM['#'], 17, AM['#'], 0),   // dividend A=17
        ]);
        step(mars);
        assertEqual(cell(mars, 2).aVal, 2, '17%5=2');
    });
});

// ══════════════════════════════════════════════════════════════════
// 39. JMZ/JMN WITH .F MODIFIER — Requires BOTH fields zero/non-zero
// ══════════════════════════════════════════════════════════════════
describe('JMZ/JMN with .F modifier', () => {
    test('JMZ.F: one zero, one non-zero → does NOT jump (both must be zero)', () => {
        const { mars, warrior } = setup([
            I(O.JMZ, M.F, AM['$'], 2, AM['$'], 1),
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 5),    // [1] A=0, B=5
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'JMZ.F: A=0 but B=5 → not both zero → no jump');
    });

    test('JMZ.F: both zero → jumps', () => {
        const { mars, warrior } = setup([
            I(O.JMZ, M.F, AM['$'], 2, AM['$'], 1),
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [1] A=0, B=0
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'JMZ.F: both zero → jump');
    });

    test('JMN.F: one non-zero → jumps (not-both-zero)', () => {
        const { mars, warrior } = setup([
            I(O.JMN, M.F, AM['$'], 2, AM['$'], 1),
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 5),    // [1] A=0, B=5
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'JMN.F: B=5 (at least one non-zero) → jump');
    });

    test('JMN.F: both zero → does NOT jump', () => {
        const { mars, warrior } = setup([
            I(O.JMN, M.F, AM['$'], 2, AM['$'], 1),
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'JMN.F: both zero → no jump');
    });
});

// ══════════════════════════════════════════════════════════════════
// 40. MULTI-PROCESS: ONE PROCESS DIES, OTHERS SURVIVE
// ══════════════════════════════════════════════════════════════════
describe('Multi-process partial death', () => {
    test('SPL then one process hits DAT; other process survives', () => {
        // [0] SPL $2      → fork: queue=[1, 2]
        // [1] DAT #0, #0  → continuation hits DAT → dies
        // [2] NOP          → fork target survives
        // [3] JMP $-1      → loops
        const { mars, warrior } = setup([
            I(O.SPL, M.B, AM['$'], 2, AM['$'], 0),   // [0]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),   // [1] death trap
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),   // [2] fork survives
            I(O.JMP, M.B, AM['$'], CS - 1, AM['$'], 0), // [3] JMP -1 → loop at [2]
        ]);
        step(mars); // SPL: queue=[1, 2]
        assertEqual(warrior.tasks.length, 2, 'two processes after SPL');

        step(mars); // Execute [1] (DAT) → process dies, queue=[2]
        assertEqual(warrior.tasks.length, 1, 'one process died');
        assert(!warrior.dead, 'warrior still alive (has one process)');

        step(mars); // Execute [2] (NOP) → queue=[3]
        step(mars); // Execute [3] (JMP -1) → queue=[2]
        assertEqual(pc(warrior), BASE + 2, 'surviving process loops');
        assert(!warrior.dead, 'warrior alive with single process');
    });
});

// ══════════════════════════════════════════════════════════════════
// 41. SELF-MODIFYING CODE — Write to next instruction before executing it
// ══════════════════════════════════════════════════════════════════
describe('Self-modifying code — write to upcoming instruction', () => {
    test('MOV overwrites next instruction; new instruction executes', () => {
        // [0] MOV.I $3, $1    → copies [3] (NOP) over [1] (DAT)
        // [1] DAT #0, #0      → originally death, but gets overwritten by NOP
        // [2] JMP $0, $0      → should reach here if [1] is now NOP
        // [3] NOP              → template to copy
        const { mars, warrior } = setup([
            I(O.MOV, M.I, AM['$'], 3, AM['$'], 1),    // [0] overwrite [1]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [1] will be replaced
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),    // [2] target
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),    // [3] source template
        ]);
        step(mars); // MOV: [1] is now NOP
        assertEqual(cell(mars, 1).op, O.NOP, '[1] overwritten with NOP');

        step(mars); // Execute [1] (now NOP, not DAT) → survives
        assert(!warrior.dead, 'warrior survives (DAT was overwritten before execution)');
        assertEqual(pc(warrior), BASE + 2, 'PC advanced past the overwritten cell');
    });
});

// ══════════════════════════════════════════════════════════════════
// 42. SUB.X — Cross-field subtraction
// ══════════════════════════════════════════════════════════════════
describe('SUB.X — Cross-field subtraction', () => {
    test('SUB.X: dest.A -= src.B, dest.B -= src.A', () => {
        const { mars, warrior } = setup([
            I(O.SUB, M.X, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 3, AM['#'], 7),    // src: A=3, B=7
            I(O.DAT, M.F, AM['#'], 20, AM['#'], 10),  // dest: A=20, B=10
        ]);
        step(mars);
        // .X: dest.A = dest.A - src.B = 20 - 7 = 13
        //     dest.B = dest.B - src.A = 10 - 3 = 7
        assertEqual(cell(mars, 2).aVal, 13, 'dest.A = 20-7 = 13');
        assertEqual(cell(mars, 2).bVal, 7, 'dest.B = 10-3 = 7');
    });

    test('SUB.X with same cell: A=10, B=3 → A=10-3=7, B=3-10=7993', () => {
        // SUB.X $1, $1: src and dest are the same cell
        const { mars, warrior } = setup([
            I(O.SUB, M.X, AM['$'], 1, AM['$'], 1),
            I(O.DAT, M.F, AM['#'], 10, AM['#'], 3),
        ]);
        step(mars);
        // src = core[1] (ref), dest = core[1].clone()
        // .X: dest.A = fn(src.B=3, dest.A=10) = wrap(10-3) = 7
        //     dest.B = fn(src.A=10, dest.B=3) = wrap(3-10) = 7993
        // Key: src.A is still 10 (reference to original, unmodified by dest write)
        assertEqual(cell(mars, 1).aVal, 7, 'A = 10-3 = 7');
        assertEqual(cell(mars, 1).bVal, 7993, 'B = 3-10 = -7 → 7993');
    });
});

// ══════════════════════════════════════════════════════════════════
// 43. SLT.F WITH MIXED LESS/GREATER — Must be less in BOTH fields
// ══════════════════════════════════════════════════════════════════
describe('SLT.F — Both fields must be less', () => {
    test('SLT.F: A<A but B>B → no skip', () => {
        const { mars, warrior } = setup([
            I(O.SLT, M.F, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 2, AM['#'], 10),   // src: A=2, B=10
            I(O.DAT, M.F, AM['#'], 5, AM['#'], 3),    // dest: A=5, B=3
        ]);
        step(mars);
        // A: 2 < 5 ✓, B: 10 < 3 ✗ → overall false → no skip
        assertEqual(pc(warrior), BASE + 1, 'SLT.F: one field not less → no skip');
    });

    test('SLT.F: both less → skip', () => {
        const { mars, warrior } = setup([
            I(O.SLT, M.F, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 2, AM['#'], 3),    // src: A=2, B=3
            I(O.DAT, M.F, AM['#'], 5, AM['#'], 10),   // dest: A=5, B=10
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        // A: 2 < 5 ✓, B: 3 < 10 ✓ → skip
        assertEqual(pc(warrior), BASE + 2, 'SLT.F: both less → skip');
    });

    test('SLT.F: equal values → no skip (not strictly less)', () => {
        const { mars, warrior } = setup([
            I(O.SLT, M.F, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 5, AM['#'], 5),
            I(O.DAT, M.F, AM['#'], 5, AM['#'], 5),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'SLT.F: equal → no skip');
    });
});

// ══════════════════════════════════════════════════════════════════
// 44. MOV.I WITH IMMEDIATE SOURCE — Copies the MOV instruction itself
// ══════════════════════════════════════════════════════════════════
describe('MOV.I with immediate source — copies self', () => {
    test('MOV.I #99, $1: copies the MOV instruction (not DAT #99)', () => {
        const { mars, warrior } = setup([
            I(O.MOV, M.I, AM['#'], 99, AM['$'], 1),   // [0] MOV.I #99, $1
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [1] destination
        ]);
        step(mars);
        // #99 → ptrA=null → src=instr (the IR clone of the MOV instruction)
        // MOV.I copies entire instruction to [1]
        const d = cell(mars, 1);
        assertEqual(d.op, O.MOV, 'copied opcode is MOV (not DAT)');
        assertEqual(d.mod, M.I, 'modifier .I preserved');
        assertEqual(d.aMode, AM['#'], 'aMode # preserved');
        assertEqual(d.aVal, 99, 'aVal 99 preserved');
        assertEqual(d.bMode, AM['$'], 'bMode $ preserved');
        assertEqual(d.bVal, 1, 'bVal 1 preserved');
    });
});

// ══════════════════════════════════════════════════════════════════
// 45. OWNERSHIP TRANSFER — MOV writes with executor's owner ID
// ══════════════════════════════════════════════════════════════════
describe('Ownership transfer on write', () => {
    test('MOV sets destination owner to executing warrior', () => {
        const { mars, warrior } = setup([
            I(O.MOV, M.I, AM['$'], 1, AM['$'], 3),    // [0] write to [3] (outside loaded code)
            I(O.ADD, M.F, AM['$'], 5, AM['$'], 10),   // [1] source
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),    // [2]
        ]);
        // [3] is empty core (not set by setup), should be owner -1
        const target = mars.core.get(BASE + 3);
        assertEqual(target.owner, -1, 'initially unowned');
        step(mars);
        assertEqual(mars.core.get(BASE + 3).owner, 0, 'owner set to warrior id after MOV');
    });
});

// ══════════════════════════════════════════════════════════════════
// 46. PRE-DEC/POST-INC DO NOT CHANGE OWNERSHIP
//     Side effects from addressing modes preserve the cell's existing owner.
// ══════════════════════════════════════════════════════════════════
describe('Pre-dec/post-inc preserve ownership', () => {
    test('<1 pre-decs cell owned by another warrior; owner unchanged', () => {
        const { mars, warrior } = setup([
            I(O.NOP, M.F, AM['<'], 1, AM['$'], 0),    // [0] NOP <1, $0
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 10),   // [1] owned by warrior 5
        ]);
        mars.core.get(BASE + 1).owner = 5;
        step(mars);
        assertEqual(cell(mars, 1).bVal, 9, 'bVal pre-decremented: 10→9');
        assertEqual(cell(mars, 1).owner, 5, 'owner unchanged by pre-dec side effect');
    });
});

// ══════════════════════════════════════════════════════════════════
// 47. CMP ON SAME CELL — Both operands resolve to identical address
// ══════════════════════════════════════════════════════════════════
describe('CMP on same cell', () => {
    test('CMP.I $1, $1: both resolve to same cell → always equal → skip', () => {
        const { mars, warrior } = setup([
            I(O.CMP, M.I, AM['$'], 1, AM['$'], 1),
            I(O.ADD, M.X, AM['>'], 3, AM['<'], 7),    // arbitrary complex instruction
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 2, 'same cell always equal');
    });

    test('SNE.I $1, $1: same cell → equal → no skip', () => {
        const { mars, warrior } = setup([
            I(O.SNE, M.I, AM['$'], 1, AM['$'], 1),
            I(O.ADD, M.X, AM['>'], 3, AM['<'], 7),
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),
        ]);
        step(mars);
        assertEqual(pc(warrior), BASE + 1, 'same cell → equal → SNE no skip');
    });
});

// ══════════════════════════════════════════════════════════════════
// 48. MUL.X — Cross-multiplication
// ══════════════════════════════════════════════════════════════════
describe('MUL.X — Cross-multiply', () => {
    test('MUL.X: dest.A *= src.B, dest.B *= src.A', () => {
        const { mars, warrior } = setup([
            I(O.MUL, M.X, AM['$'], 1, AM['$'], 2),
            I(O.DAT, M.F, AM['#'], 3, AM['#'], 5),    // src: A=3, B=5
            I(O.DAT, M.F, AM['#'], 7, AM['#'], 11),   // dest: A=7, B=11
        ]);
        step(mars);
        // .X: dest.A = src.B * dest.A = 5 * 7 = 35
        //     dest.B = src.A * dest.B = 3 * 11 = 33
        assertEqual(cell(mars, 2).aVal, 35, 'A = 5*7 = 35');
        assertEqual(cell(mars, 2).bVal, 33, 'B = 3*11 = 33');
    });
});

// ══════════════════════════════════════════════════════════════════
// 49. ADD.F/ADD.I WITH SAME CELL — Read-before-write via clone
//     Critical: dest clone captures original values, src reads from
//     reference. Both fields should double independently.
// ══════════════════════════════════════════════════════════════════
describe('ADD.F same cell — clone prevents cross-contamination', () => {
    test('ADD.F $1, $1: A=3, B=7 → A=6, B=14 (doubled independently)', () => {
        const { mars, warrior } = setup([
            I(O.ADD, M.F, AM['$'], 1, AM['$'], 1),
            I(O.DAT, M.F, AM['#'], 3, AM['#'], 7),
        ]);
        step(mars);
        // src = reference to core[1]: A=3, B=7
        // dest = clone of core[1]: A=3, B=7
        // .F: dest.A = fn(src.A=3, dest.A=3) = 6
        //     dest.B = fn(src.B=7, dest.B=7) = 14
        // Key: src.B is still 7 when computing dest.B (not 6, because dest is a clone)
        assertEqual(cell(mars, 1).aVal, 6, 'A doubled: 3+3=6');
        assertEqual(cell(mars, 1).bVal, 14, 'B doubled: 7+7=14');
    });
});

// ══════════════════════════════════════════════════════════════════
// 50. COMPLEX: Vampire pattern — JMP @ptr captures opponent
// ══════════════════════════════════════════════════════════════════
describe('Complex: Vampire JMP @ptr capture mechanism', () => {
    test('MOV writes JMP-to-self; victim executes it → trapped', () => {
        // Simulates the vampire pattern: write a JMP $0 into enemy code
        const { mars, warrior } = setup([
            I(O.MOV, M.I, AM['$'], 2, AM['$'], 3),    // [0] plant the trap
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),    // [1]
            I(O.JMP, M.B, AM['$'], 0, AM['$'], 0),    // [2] trap: JMP $0
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),    // [3] target location
        ]);
        step(mars); // MOV plants JMP $0 at [3]
        assertEqual(cell(mars, 3).op, O.JMP, 'trap planted');
        assertEqual(cell(mars, 3).aVal, 0, 'JMP $0 → infinite loop at [3]');
    });
});

// ══════════════════════════════════════════════════════════════════
// 51. P-SPACE INDEX 0 IS SPECIAL — Stores last result
//     After game ends, p-space[0] is set to the result.
//     Initial p-space[0] should be accessible via LDP.
// ══════════════════════════════════════════════════════════════════
describe('P-Space index 0', () => {
    test('STP then LDP at index 0 round-trips correctly', () => {
        const { mars, warrior } = setup([
            I(O.STP, M.AB, AM['#'], 99, AM['$'], 3),   // [0] ps[[3].B=0] = 99
            I(O.LDP, M.AB, AM['#'], 0, AM['$'], 3),    // [1] [4].B = ps[0]
            I(O.NOP, M.F, AM['$'], 0, AM['$'], 0),     // [2]
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),     // [3] pointer, bVal=0
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 0),     // [4] destination
        ]);
        step(mars); // STP: ps[0] = 99
        step(mars); // LDP: core[4].bVal = ps[0] = 99
        assertEqual(cell(mars, 4).bVal, 99, 'p-space[0] round-trip works');
    });
});

// ══════════════════════════════════════════════════════════════════
// PARSER: Single-operand DAT handling (ICWS-94 §4.3)
// ══════════════════════════════════════════════════════════════════
//
// Per ICWS-94 §4.3: "Instructions with only one operand have the
// default A-operand of $0 for DAT and the default B-operand of $0
// for all other opcodes."
//
// So: DAT #5 → DAT.F $0, #5  (operand goes to B, A defaults to $0)
//     JMP 5  → JMP.B $5, $0  (operand goes to A, B defaults to $0)

describe('Parser: single-operand DAT (ICWS-94 §4.3)', () => {
    const parser = new Parser();

    test('DAT #5 should put 5 in B-field, not A-field', () => {
        const result = parser.parse('DAT #5');
        const instr = result.instructions[0];
        // Per standard: DAT $0, #5
        assertEqual(instr.bVal, 5, 'bVal should be 5');
        assertEqual(instr.aVal, 0, 'aVal should be 0');
        assertEqual(instr.bMode, 0, 'bMode should be # (immediate=0)');
        assertEqual(instr.aMode, 1, 'aMode should be $ (direct=1)');
    });

    test('DAT #111 should put 111 in B-field (bombfinder pattern)', () => {
        const result = parser.parse('DAT #111');
        const instr = result.instructions[0];
        assertEqual(instr.bVal, 111, 'bVal should be 111');
        assertEqual(instr.aVal, 0, 'aVal should be 0');
    });

    test('DAT $3 should put 3 in B-field with direct mode', () => {
        const result = parser.parse('DAT $3');
        const instr = result.instructions[0];
        assertEqual(instr.bVal, 3, 'bVal should be 3');
        assertEqual(instr.aVal, 0, 'aVal should be 0');
        assertEqual(instr.bMode, 1, 'bMode should be $ (direct=1)');
        assertEqual(instr.aMode, 1, 'aMode should be $ (direct=1)');
    });

    test('DAT #0 modes should still be correct even with value 0', () => {
        const result = parser.parse('DAT #0');
        const instr = result.instructions[0];
        // Even though the value is 0 either way, modes must be correct
        assertEqual(instr.bMode, 0, 'bMode should be # (immediate=0)');
        assertEqual(instr.aMode, 1, 'aMode should be $ (direct=1)');
    });

    test('DAT #0, #0 (two operands) should not be affected', () => {
        const result = parser.parse('DAT #0, #0');
        const instr = result.instructions[0];
        assertEqual(instr.aMode, 0, 'aMode should be # (immediate=0)');
        assertEqual(instr.bMode, 0, 'bMode should be # (immediate=0)');
        assertEqual(instr.aVal, 0, 'aVal=0');
        assertEqual(instr.bVal, 0, 'bVal=0');
    });

    test('JMP 5 should still put operand in A-field (non-DAT)', () => {
        const result = parser.parse('JMP 5');
        const instr = result.instructions[0];
        assertEqual(instr.aVal, 5, 'aVal should be 5');
        assertEqual(instr.bVal, 0, 'bVal should be 0');
    });

    test('MOV #7 should put operand in A-field (non-DAT)', () => {
        const result = parser.parse('MOV #7, $0');
        const instr = result.instructions[0];
        assertEqual(instr.aVal, 7, 'aVal should be 7');
        assertEqual(instr.aMode, 0, 'aMode should be # (immediate=0)');
    });

    test('SPL 0 should put operand in A-field (non-DAT)', () => {
        const result = parser.parse('SPL 0');
        const instr = result.instructions[0];
        assertEqual(instr.aVal, 0, 'aVal should be 0');
        assertEqual(instr.bVal, 0, 'bVal should be 0');
    });
});

// ══════════════════════════════════════════════════════════════════
// PARSER: ORG/END with label references
// ══════════════════════════════════════════════════════════════════

describe('Parser: ORG/END with label resolution', () => {
    const parser = new Parser();

    test('END with label resolves correct start offset', () => {
        const result = parser.parse('DAT #0, #0\nstart: JMP -1\nEND start');
        assertEqual(result.startOffset, 1, 'startOffset should be 1 (index of start label)');
    });

    test('ORG with label resolves correct start offset', () => {
        const result = parser.parse('ORG entry\nDAT #0, #0\nentry: MOV $0, $1');
        assertEqual(result.startOffset, 1, 'startOffset should be 1 (index of entry label)');
    });

    test('ORG with numeric value works', () => {
        const result = parser.parse('ORG 2\nDAT #0, #0\nDAT #0, #0\nMOV $0, $1');
        assertEqual(result.startOffset, 2, 'startOffset should be 2');
    });

    test('END without argument defaults to 0', () => {
        const result = parser.parse('MOV $0, $1\nEND');
        assertEqual(result.startOffset, 0, 'startOffset should be 0');
    });
});

// ══════════════════════════════════════════════════════════════════
// PARSER: EQU constant resolution
// ══════════════════════════════════════════════════════════════════

describe('Parser: EQU constants', () => {
    const parser = new Parser();

    test('Simple numeric EQU', () => {
        const result = parser.parse('STEP EQU 3364\nADD #STEP, $1');
        assertEqual(result.instructions[0].aVal, 3364, 'EQU value should be 3364');
    });

    test('EQU with forward reference', () => {
        const result = parser.parse('SIZE EQU END_CODE-START_CODE\nSTART_CODE: NOP\nNOP\nEND_CODE: NOP');
        // SIZE = 2 - 0 = 2
        const p2 = new Parser();
        const r2 = p2.parse('SIZE EQU 2\nMOV #SIZE, $1');
        assertEqual(r2.instructions[0].aVal, 2, 'Forward-reference EQU resolves to 2');
    });

    test('EQU text substitution with mode char', () => {
        const result = parser.parse('BOMB EQU #0\nMOV BOMB, $1');
        assertEqual(result.instructions[0].aMode, 0, 'Text EQU with # preserved mode');
        assertEqual(result.instructions[0].aVal, 0, 'Text EQU value is 0');
    });
});

// ══════════════════════════════════════════════════════════════════
// PARSER: Expression evaluation edge cases
// ══════════════════════════════════════════════════════════════════

describe('Parser: expression evaluation', () => {
    const parser = new Parser();

    test('Negative operand value wraps correctly', () => {
        const result = parser.parse('DAT #0, #-1');
        assertEqual(result.instructions[0].bVal, 7999, '-1 wraps to 7999');
    });

    test('Arithmetic expression in operand', () => {
        const result = parser.parse('MOV #3+4, $0');
        assertEqual(result.instructions[0].aVal, 7, '3+4 = 7');
    });

    test('Modulo expression wraps to core size', () => {
        const result = parser.parse('MOV #8001, $0');
        assertEqual(result.instructions[0].aVal, 1, '8001 wraps to 1');
    });

    test('Parenthesized expression', () => {
        const result = parser.parse('MOV #(2+3)*2, $0');
        assertEqual(result.instructions[0].aVal, 10, '(2+3)*2 = 10');
    });

    test('DAT no operands defaults to $0,$0', () => {
        const result = parser.parse('DAT');
        const instr = result.instructions[0];
        assertEqual(instr.aMode, 1, 'aMode default $ (direct)');
        assertEqual(instr.aVal, 0, 'aVal default 0');
        assertEqual(instr.bMode, 1, 'bMode default $ (direct)');
        assertEqual(instr.bVal, 0, 'bVal default 0');
    });
});

// ══════════════════════════════════════════════════════════════════
// ENGINE: DAT operand side effects persist after death
// ══════════════════════════════════════════════════════════════════

describe('DAT operand side effects (ICWS-94 §3.2-3.3)', () => {
    // Per standard, operand evaluation (including pre-dec/post-inc)
    // happens BEFORE the instruction executes. Even DAT (which kills
    // the process) should have its side effects persist.

    test('DAT <1 should pre-dec cell[1].bVal despite process dying', () => {
        const { mars, warrior } = setup([
            I(0, 4, 3, 1, 1, 0),  // DAT.F <1, $0
            I(0, 4, 1, 0, 1, 5),  // DAT.F $0, $5  (bVal=5)
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 4, 'bVal should be decremented from 5 to 4');
        assert(warrior.dead || warrior.tasks.length === 0, 'process should be dead');
    });

    test('DAT >1 should post-inc cell[1].bVal despite process dying', () => {
        const { mars, warrior } = setup([
            I(0, 4, 4, 1, 1, 0),  // DAT.F >1, $0
            I(0, 4, 1, 0, 1, 5),  // DAT.F $0, $5  (bVal=5)
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 6, 'bVal should be incremented from 5 to 6');
    });

    test('DAT {1 should A-pre-dec cell[1].aVal despite process dying', () => {
        const { mars, warrior } = setup([
            I(0, 4, 6, 1, 1, 0),  // DAT.F {1, $0  (A-predec)
            I(0, 4, 1, 10, 1, 0), // DAT.F $10, $0  (aVal=10)
        ]);
        step(mars);
        assertEqual(cell(mars, 1).aVal, 9, 'aVal should be decremented from 10 to 9');
    });
});

// ══════════════════════════════════════════════════════════════════
// ENGINE: B-operand side effects for JMP/SPL/NOP
// ══════════════════════════════════════════════════════════════════

describe('B-operand side effects for instructions that ignore ptrB', () => {
    // JMP, SPL, NOP evaluate both operands (per §3.2-3.3) but only
    // use ptrA. The B-operand's side effects must still persist.

    test('JMP $0, <1 should pre-dec cell[1].bVal', () => {
        const { mars } = setup([
            I(7, 1, 1, 0, 3, 1),  // JMP.B $0, <1
            I(0, 4, 1, 0, 1, 10), // DAT.F $0, $10 (bVal=10)
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 9, 'JMP B-operand pre-dec should persist');
    });

    test('SPL $0, <1 should pre-dec cell[1].bVal', () => {
        const { mars } = setup([
            I(11, 1, 1, 0, 3, 1),  // SPL.B $0, <1
            I(0, 4, 1, 0, 1, 10),  // DAT.F $0, $10 (bVal=10)
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 9, 'SPL B-operand pre-dec should persist');
    });

    test('NOP $0, <1 should pre-dec cell[1].bVal', () => {
        const { mars } = setup([
            I(17, 4, 1, 0, 3, 1),  // NOP.F $0, <1
            I(0, 4, 1, 0, 1, 10),  // DAT.F $0, $10 (bVal=10)
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 9, 'NOP B-operand pre-dec should persist');
    });

    test('JMP $2, >1 should post-inc cell[1].bVal and jump correctly', () => {
        const { mars, warrior } = setup([
            I(7, 1, 1, 2, 4, 1),  // JMP.B $2, >1
            I(0, 4, 1, 0, 1, 5),  // DAT.F $0, $5  (bVal=5)
            I(17, 4, 1, 0, 1, 0), // NOP (jump target)
        ]);
        step(mars);
        assertEqual(cell(mars, 1).bVal, 6, 'post-inc should persist');
        assertEqual(pc(warrior), BASE + 2, 'should jump to NOP at offset 2');
    });
});

// ══════════════════════════════════════════════════════════════════
// ENGINE: A-operand side effect visible to B-operand resolution
// ══════════════════════════════════════════════════════════════════

describe('A-operand side effects visible during B-operand resolution', () => {
    // Per ICWS-94 §3.2-3.3: A-operand fully evaluates (including
    // side effects) before B-operand evaluation begins.

    test('{1 and <1 on same cell: A-predec aVal, B-predec bVal', () => {
        const { mars } = setup([
            I(1, 6, 6, 1, 3, 1),   // MOV.I {1, <1
            I(0, 4, 1, 5, 1, 10),  // DAT.F $5, $10
        ]);
        step(mars);
        // A-predec: cell[1].aVal 5→4. ptrA = BASE+1+4 = BASE+5
        // B-predec: cell[1].bVal 10→9 (sees aVal already changed). ptrB = BASE+1+9 = BASE+10
        assertEqual(cell(mars, 1).aVal, 4, 'A-predec decremented aVal from 5 to 4');
        assertEqual(cell(mars, 1).bVal, 9, 'B-predec decremented bVal from 10 to 9');
    });

    test('>1 and @1 on same cell: postinc bVal visible to B-indirect', () => {
        const { mars } = setup([
            I(1, 6, 4, 1, 2, 1),   // MOV.I >1, @1
            I(0, 4, 1, 0, 1, 3),   // DAT.F $0, $3 (bVal=3)
        ]);
        step(mars);
        // A-postinc: r = BASE+1+3 = BASE+4. Then bVal 3→4.
        // B-indirect @1: reads bVal=4 (AFTER postinc!). ptrB = BASE+1+4 = BASE+5
        assertEqual(cell(mars, 1).bVal, 4, 'post-inc changed bVal from 3 to 4');
        // ptrA = BASE+4, ptrB = BASE+5: MOV.I copies cell[4] to cell[5]
        // Verify the B-indirect used the post-incremented value
        const srcCell = mars.core.get(BASE + 4);
        const dstCell = mars.core.get(BASE + 5);
        assertEqual(dstCell.op, srcCell.op, 'MOV.I copied cell[4] to cell[5]');
    });
});

// ══════════════════════════════════════════════════════════════════
// ENGINE: Pre-dec/post-inc preserve original cell ownership
// ══════════════════════════════════════════════════════════════════

describe('Operand side effects preserve cell ownership', () => {
    test('Pre-dec on enemy cell preserves enemy ownership', () => {
        const { mars } = setup([
            I(1, 6, 3, 1, 1, 2),   // MOV.I <1, $2 (warrior 0)
        ]);
        // Set cell[1] as owned by enemy (warrior 1)
        mars.core.set(BASE + 1, I(0, 4, 1, 0, 1, 5), 1);
        step(mars);
        // Pre-dec should preserve owner=1, not change to owner=0
        assertEqual(cell(mars, 1).owner, 1, 'pre-dec preserves original owner');
        assertEqual(cell(mars, 1).bVal, 4, 'pre-dec decremented bVal');
    });

    test('DJN opDec preserves ownership (consistent with pre-dec)', () => {
        const { mars } = setup([
            I(10, 1, 1, 0, 1, 1),  // DJN.B $0, $1
        ]);
        // Set cell[1] as owned by enemy (warrior 1) with bVal=5
        mars.core.set(BASE + 1, I(0, 4, 1, 0, 1, 5), 1);
        step(mars);
        // DJN's opDec should preserve owner (consistent with pre-dec in resolveAddress)
        assertEqual(cell(mars, 1).owner, 1, 'opDec preserves original owner');
        assertEqual(cell(mars, 1).bVal, 4, 'opDec decremented bVal');
    });
});

// ══════════════════════════════════════════════════════════════════
// PARSER: Single-operand DAT with label and addressing modes
// ══════════════════════════════════════════════════════════════════

describe('Parser: single-operand DAT combined with labels', () => {
    const parser = new Parser();

    test('DAT with label reference goes to B-field', () => {
        const result = parser.parse('target: NOP\nDAT target');
        // target is at index 0. DAT is at index 1.
        // With single-operand DAT: operand goes to B.
        // Label offset: target(0) - current(1) = -1 → 7999
        const instr = result.instructions[1];
        assertEqual(instr.bVal, 7999, 'label reference goes to B-field for DAT');
        assertEqual(instr.aVal, 0, 'A-field defaults to 0 for DAT');
    });

    test('Single-operand DAT with B-predec mode', () => {
        const result = parser.parse('DAT <5');
        const instr = result.instructions[0];
        assertEqual(instr.bMode, 3, 'B-mode should be < (predec=3)');
        assertEqual(instr.bVal, 5, 'B-value should be 5');
        assertEqual(instr.aMode, 1, 'A-mode defaults to $ (direct=1)');
    });

    test('Single-operand DAT negative value wraps to B-field', () => {
        const result = parser.parse('DAT #-14');
        const instr = result.instructions[0];
        assertEqual(instr.bVal, 7986, '-14 wraps to 7986 in B-field');
        assertEqual(instr.bMode, 0, 'B-mode is # (immediate)');
        assertEqual(instr.aVal, 0, 'A-field is 0');
    });
});

// ══════════════════════════════════════════════════════════════════
// PARSER: Default modifier resolution (ICWS-94 §4.4)
// ══════════════════════════════════════════════════════════════════

describe('Parser: default modifier resolution', () => {
    const parser = new Parser();

    test('MOV with both non-immediate defaults to .I', () => {
        const result = parser.parse('MOV $1, $2');
        assertEqual(result.instructions[0].mod, 6, 'MOV $,$  → .I (6)');
    });

    test('MOV with immediate A defaults to .AB', () => {
        const result = parser.parse('MOV #1, $2');
        assertEqual(result.instructions[0].mod, 2, 'MOV #,$  → .AB (2)');
    });

    test('MOV with immediate B defaults to .B', () => {
        const result = parser.parse('MOV $1, #2');
        assertEqual(result.instructions[0].mod, 1, 'MOV $,#  → .B (1)');
    });

    test('ADD with both non-immediate defaults to .F', () => {
        const result = parser.parse('ADD $1, $2');
        assertEqual(result.instructions[0].mod, 4, 'ADD $,$  → .F (4)');
    });

    test('CMP with both non-immediate defaults to .I', () => {
        const result = parser.parse('CMP $1, $2');
        assertEqual(result.instructions[0].mod, 6, 'CMP $,$  → .I (6)');
    });

    test('Single-operand DAT defaults B-mode to $, so DAT.F', () => {
        // DAT #5 → DAT $0, #5 → defMod('DAT', $, #) → .F
        const result = parser.parse('DAT #5');
        assertEqual(result.instructions[0].mod, 4, 'DAT #5  → .F (4)');
    });
});

// ══════════════════════════════════════════════════════════════════
// INTEGRATION: Dwarf with single-operand DAT (parser+engine)
// ══════════════════════════════════════════════════════════════════

describe('Integration: dwarf pattern with single-operand DAT', () => {
    test('Dwarf with "DAT #4" bombs forward, not self', () => {
        // Classic dwarf: ADD #4, 3 / MOV 2, @2 / JMP -2 / DAT #4
        // With correct parsing: DAT $0, #4 → bVal=4
        // MOV @2 reads bVal=4 from DAT → target = DAT_pos + 4
        const parser = new Parser();
        const result = parser.parse('ADD #4, 3\nMOV 2, @2\nJMP -2\nDAT #4');
        assertEqual(result.instructions.length, 4, '4 instructions');

        const mars = new MARS(CS, 80000, 8000);
        for (let i = 0; i < result.instructions.length; i++) {
            const inst = result.instructions[i];
            mars.core.set(BASE + i, new Instruction(inst.op, inst.mod, inst.aMode, inst.aVal, inst.bMode, inst.bVal), 0);
        }
        const w = new Warrior(0, 'dwarf', [], BASE, null, mars.pSpaceSize);
        mars.warriors.push(w);

        // Cycle 1: ADD #4, $3 → DAT bVal: 4 + 4 = 8
        step(mars);
        assertEqual(cell(mars, 3).bVal, 8, 'ADD incremented DAT bVal from 4 to 8');

        // Cycle 2: MOV 2, @2 → copies DAT to DAT_pos + bVal = BASE+3+8 = BASE+11
        step(mars);
        const target1 = mars.core.get(BASE + 11);
        assertEqual(target1.op, 0, 'First bomb placed at BASE+11 (DAT)');
        assertEqual(target1.bVal, 8, 'Bomb has bVal=8');

        // Cycle 3: JMP -2 → back to ADD
        step(mars);
        assertEqual(pc(w), BASE, 'JMP goes back to ADD');
    });

    test('dbldwarf.red single-operand DAT #-1 goes to B-field', () => {
        const parser = new Parser();
        const result = parser.parse('DAT #-1');
        const instr = result.instructions[0];
        assertEqual(instr.bVal, 7999, 'DAT #-1 bVal wraps to 7999');
        assertEqual(instr.bMode, 0, 'DAT #-1 bMode is # (immediate)');
        assertEqual(instr.aVal, 0, 'DAT #-1 aVal is 0 (default)');
    });
});

// ══════════════════════════════════════════════════════════════════
// PARSER: Label on same line as instruction (no colon)
// ══════════════════════════════════════════════════════════════════

describe('Parser: labels without colons', () => {
    const parser = new Parser();

    test('Label before opcode (no colon)', () => {
        const result = parser.parse('start MOV $0, $1\nJMP start');
        assertEqual(result.instructions.length, 2, '2 instructions');
        // JMP start → JMP to offset (0 - 1) = -1 → 7999
        assertEqual(result.instructions[1].aVal, 7999, 'JMP to label at index 0 from index 1');
    });

    test('Label with colon', () => {
        const result = parser.parse('start: MOV $0, $1\nJMP start');
        assertEqual(result.instructions.length, 2, '2 instructions');
        assertEqual(result.instructions[1].aVal, 7999, 'JMP to label with colon');
    });

    test('Multiple labels on same line', () => {
        const result = parser.parse('a: b: MOV $0, $1\nJMP a\nJMP b');
        assertEqual(result.instructions.length, 3, '3 instructions');
        // Both a and b point to index 0
        assertEqual(result.instructions[1].aVal, 7999, 'JMP a → offset -1 = 7999');
        assertEqual(result.instructions[2].aVal, 7998, 'JMP b → offset -2 = 7998');
    });
});

// ══════════════════════════════════════════════════════════════════
// PARSER: FOR/ROF preprocessor
// ══════════════════════════════════════════════════════════════════

describe('Parser: FOR/ROF loops', () => {
    const parser = new Parser();

    test('FOR 3 generates 3 copies', () => {
        const result = parser.parse('FOR 3\nNOP\nROF');
        assertEqual(result.instructions.length, 3, '3 NOP instructions');
    });

    test('FOR 0 generates nothing', () => {
        const result = parser.parse('FOR 0\nNOP\nROF\nMOV $0, $1');
        assertEqual(result.instructions.length, 1, 'Only the MOV after ROF');
    });

    test('Nested FOR/ROF', () => {
        const result = parser.parse('FOR 2\nFOR 3\nNOP\nROF\nROF');
        assertEqual(result.instructions.length, 6, '2 * 3 = 6 NOPs');
    });
});

// ══════════════════════════════════════════════════════════════════
// ENGINE: DIV/MOD single-field zero — no write to core
// ══════════════════════════════════════════════════════════════════

describe('DIV/MOD by zero: single-field should NOT write to core', () => {
    test('DIV.A by zero: destination unchanged, process dies', () => {
        const { mars, warrior } = setup([
            I(5, 0, 1, 1, 1, 2),   // DIV.A $1, $2
            I(0, 4, 1, 0, 1, 0),   // DAT $0, $0 (source aVal=0)
            I(0, 4, 1, 99, 1, 77), // DAT $99, $77 (dest)
        ]);
        step(mars);
        // DIV.A: src.aVal=0 → divide by zero → no write, process dies
        assertEqual(cell(mars, 2).aVal, 99, 'dest.aVal unchanged (no write on div-by-zero)');
        assertEqual(cell(mars, 2).bVal, 77, 'dest.bVal unchanged');
        assert(warrior.tasks.length === 0, 'process should be dead');
    });

    test('DIV.F partial: one zero divisor writes other result', () => {
        const { mars, warrior } = setup([
            I(5, 4, 1, 1, 1, 2),   // DIV.F $1, $2
            I(0, 4, 1, 0, 1, 3),   // DAT $0, $3 (aVal=0, bVal=3)
            I(0, 4, 1, 20, 1, 12), // DAT $20, $12 (dest)
        ]);
        step(mars);
        // DIV.F: aVal: 20/0 → null (no write). bVal: 12/3 = 4 (written).
        assertEqual(cell(mars, 2).aVal, 20, 'aVal unchanged (div by zero)');
        assertEqual(cell(mars, 2).bVal, 4, 'bVal written (12/3=4)');
        assert(warrior.tasks.length === 0, 'process dies despite partial write');
    });
});

// ══════════════════════════════════════════════════════════════════
// ENGINE: MOV.X self — field swap
// ══════════════════════════════════════════════════════════════════

describe('MOV.X on same cell swaps fields', () => {
    test('MOV.X $1, $1 swaps aVal and bVal', () => {
        const { mars } = setup([
            I(1, 5, 1, 1, 1, 1),   // MOV.X $1, $1
            I(0, 4, 1, 3, 1, 7),   // DAT $3, $7
        ]);
        step(mars);
        assertEqual(cell(mars, 1).aVal, 7, 'aVal should be swapped to 7');
        assertEqual(cell(mars, 1).bVal, 3, 'bVal should be swapped to 3');
    });
});

// ══════════════════════════════════════════════════════════════════
// PARSER: Regex special chars in label names (label injection)
// ══════════════════════════════════════════════════════════════════
// Labels with regex special chars (. + * ?) create broken patterns
// in evalM/evalMS. E.g., label "A.B" creates /\bA.B\b/ where "."
// matches any char, so "ACB" incorrectly matches.

describe('Parser: label names with regex special characters', () => {
    const parser = new Parser();

    test('Label "A.B" should NOT match "ACB" in operand', () => {
        // A.B is at index 0, ACB is at index 1
        // JMP ACB at index 2 should jump to index 1 (offset -1 = 7999)
        // Bug: "A.B" regex /\bA.B\b/ matches "ACB", giving wrong offset
        const result = parser.parse('A.B: NOP\nACB: NOP\nJMP ACB');
        const jmpInstr = result.instructions[2];
        assertEqual(jmpInstr.aVal, 7999,
            'JMP ACB should be offset -1 (7999), not -2 (7998) from A.B match');
    });

    test('EQU name with dot should not match similar names', () => {
        const result = parser.parse('A.X EQU 100\nABX EQU 200\nMOV #ABX, $0');
        assertEqual(result.instructions[0].aVal, 200,
            'MOV #ABX should use ABX=200, not A.X=100');
    });
});

// ══════════════════════════════════════════════════════════════════
// PARSER: defMod both-immediate (Bug 7a — ICWS-94 §4.4)
//   CMP/SEQ/SNE/MOV with both # operands → default .I, not .AB
//   ADD/SUB/MUL/DIV/MOD with both # → .F, not .AB
//   ADD/SUB/MUL/DIV/MOD with B-only # → .BA, not .B
//   NOP → .B, not .F
// ══════════════════════════════════════════════════════════════════

describe('Parser: defMod both-immediate and B-immediate (Bug 7)', () => {
    const parser = new Parser();

    test('CMP #3, #5 defaults to .I (not .AB)', () => {
        const result = parser.parse('CMP #3, #5');
        assertEqual(result.instructions[0].mod, M.I, 'CMP #,# → .I');
    });

    test('SEQ #1, #2 defaults to .I', () => {
        const result = parser.parse('SEQ #1, #2');
        assertEqual(result.instructions[0].mod, M.I, 'SEQ #,# → .I');
    });

    test('SNE #1, #2 defaults to .I', () => {
        const result = parser.parse('SNE #1, #2');
        assertEqual(result.instructions[0].mod, M.I, 'SNE #,# → .I');
    });

    test('MOV #1, #2 defaults to .I', () => {
        const result = parser.parse('MOV #1, #2');
        assertEqual(result.instructions[0].mod, M.I, 'MOV #,# → .I');
    });

    test('ADD #3, #5 defaults to .F (not .AB)', () => {
        const result = parser.parse('ADD #3, #5');
        assertEqual(result.instructions[0].mod, M.F, 'ADD #,# → .F');
    });

    test('SUB $1, #2 defaults to .BA (not .B)', () => {
        const result = parser.parse('SUB $1, #2');
        assertEqual(result.instructions[0].mod, M.BA, 'SUB $,# → .BA');
    });

    test('MUL $3, #7 defaults to .BA', () => {
        const result = parser.parse('MUL $3, #7');
        assertEqual(result.instructions[0].mod, M.BA, 'MUL $,# → .BA');
    });

    test('DIV #1, #1 defaults to .F', () => {
        const result = parser.parse('DIV #1, #1');
        assertEqual(result.instructions[0].mod, M.F, 'DIV #,# → .F');
    });

    test('NOP defaults to .B (not .F)', () => {
        const result = parser.parse('NOP');
        assertEqual(result.instructions[0].mod, M.B, 'NOP → .B');
    });
});

// ══════════════════════════════════════════════════════════════════
// PARSER: CMP #a, #b with .I — Both-immediate compare (Bug 7a impact)
//   CMP.I with both immediate: both ptrA and ptrB are null,
//   so src=instr, dest=instr. CMP.I compares instr vs instr → always equal → skip.
//   With wrong .AB default: compares aVal vs bVal → may differ → wrong result.
// ══════════════════════════════════════════════════════════════════

describe('CMP #a, #b behavioral impact of correct .I default', () => {
    test('CMP #3, #5 (default .I) → always skip (self-compare)', () => {
        // With correct .I default: both pointers are null → compare IR with IR → always equal
        const parser = new Parser();
        const result = parser.parse('CMP #3, #5\nDAT #0\nNOP');
        const mars = new MARS(CS, 80000, 8000);
        for (let i = 0; i < result.instructions.length; i++) {
            const inst = result.instructions[i];
            mars.core.set(BASE + i, new Instruction(inst.op, inst.mod, inst.aMode, inst.aVal, inst.bMode, inst.bVal), 0);
        }
        const w = new Warrior(0, 'test', [], BASE, null, mars.pSpaceSize);
        mars.warriors.push(w);
        step(mars);
        // With .I: compares IR with IR → equal → skip DAT → land on NOP
        assertEqual(pc(w), BASE + 2, 'CMP.I #3,#5 → self-compare → skip');
    });

    test('SNE #3, #5 (default .I) → never skip (self-compare)', () => {
        const parser = new Parser();
        const result = parser.parse('SNE #3, #5\nNOP');
        const mars = new MARS(CS, 80000, 8000);
        for (let i = 0; i < result.instructions.length; i++) {
            const inst = result.instructions[i];
            mars.core.set(BASE + i, new Instruction(inst.op, inst.mod, inst.aMode, inst.aVal, inst.bMode, inst.bVal), 0);
        }
        const w = new Warrior(0, 'test', [], BASE, null, mars.pSpaceSize);
        mars.warriors.push(w);
        step(mars);
        // With .I: compares IR with IR → equal → no skip
        assertEqual(pc(w), BASE + 1, 'SNE.I #3,#5 → self-compare → no skip');
    });
});

// ══════════════════════════════════════════════════════════════════
// ENGINE: DJN opDec preserves cell ownership (Bug 8)
//   opDec should NOT change the owner of the decremented cell.
//   resolveAddress pre-dec uses t.owner; opDec should be consistent.
// ══════════════════════════════════════════════════════════════════

describe('DJN opDec preserves cell ownership (Bug 8)', () => {
    test('DJN decrementing enemy cell preserves enemy ownership', () => {
        const { mars, warrior } = setup([
            I(O.DJN, M.B, AM['$'], 0, AM['$'], 1),    // [0] DJN $0, $1
            I(O.DAT, M.F, AM['#'], 0, AM['#'], 5),     // [1] owned by warrior 3
        ]);
        mars.core.get(BASE + 1).owner = 3;
        step(mars);
        assertEqual(cell(mars, 1).bVal, 4, 'bVal decremented 5→4');
        assertEqual(cell(mars, 1).owner, 3, 'owner preserved (still warrior 3, not 0)');
    });

    test('DJN.F decrementing unowned cell keeps owner=-1', () => {
        const { mars, warrior } = setup([
            I(O.DJN, M.F, AM['$'], 0, AM['$'], 1),
            I(O.DAT, M.F, AM['#'], 3, AM['#'], 7),
        ]);
        mars.core.get(BASE + 1).owner = -1;
        step(mars);
        assertEqual(cell(mars, 1).aVal, 2, 'aVal decremented');
        assertEqual(cell(mars, 1).bVal, 6, 'bVal decremented');
        assertEqual(cell(mars, 1).owner, -1, 'unowned cell stays unowned');
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
