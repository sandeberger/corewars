/**
 * Trace script for Blurstone '88
 *
 * Investigates why Blurstone dies around cycle 1374. Runs three scenarios:
 *   1. Blurstone vs IMP (MOV 0, 1)
 *   2. Blurstone vs NOP (passive dummy)
 *   3. Blurstone solo
 *
 * Uses detailed write-tracking to show the full chain of self-destruction.
 */

const fs = require('fs');
const path = require('path');

// ── Minimal DOM mock (from test-harness.js) ─────────────────────
const mockElements = {};
global.document = {
    getElementById(id) {
        if (!mockElements[id]) {
            mockElements[id] = {
                textContent: '', innerText: '', innerHTML: '', className: '',
                style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false } },
                querySelectorAll(){ return [] }, querySelector(){ return null },
            };
        }
        return mockElements[id];
    },
    querySelectorAll(){ return [] }, querySelector(){ return null },
    addEventListener(){},
    createElement(){ return { className:'', textContent:'', prepend(){}, remove(){}, children:{length:0}, lastChild:{remove(){}} } }
};
global.window = { innerWidth:1920, innerHeight:1080, addEventListener(){},
    AudioContext: class { resume(){} suspend(){} },
    webkitAudioContext: class { resume(){} suspend(){} } };
global.requestAnimationFrame = () => {};
global.cancelAnimationFrame = () => {};
global.Date = Date;
global.tournamentManager = { active: false };
global.isMobile = () => false;
global.switchMobilePanel = () => {};
global.log = () => {};
global.stats = { writes: 0, splits: 0 };

// ── Load engine modules ─────────────────────────────────────────
function loadJS(file) {
    const code = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
    new (require('vm').Script)(code, { filename: file }).runInThisContext();
}
loadJS('constants.js');
loadJS('sound.js');
loadJS('engine.js');

// ── Helpers ─────────────────────────────────────────────────────
const CORE_SIZE = 8000;
const MAX_CYCLES = 80000;
const MAX_PROCS = 8000;

const OP_NAMES = Object.fromEntries(Object.entries(OPCODES).map(([k,v]) => [v,k]));
const MOD_NAMES = Object.fromEntries(Object.entries(MODIFIERS).map(([k,v]) => [v,k]));
const MODE_SYMS = Object.fromEntries(Object.entries(ADDR_MODES).map(([k,v]) => [v,k]));

function fmt(instr) {
    const op = OP_NAMES[instr.op] || '???';
    const mod = MOD_NAMES[instr.mod] || '?';
    const aM = MODE_SYMS[instr.aMode] || '?';
    const bM = MODE_SYMS[instr.bMode] || '?';
    const aV = instr.aVal > CORE_SIZE / 2 ? instr.aVal - CORE_SIZE : instr.aVal;
    const bV = instr.bVal > CORE_SIZE / 2 ? instr.bVal - CORE_SIZE : instr.bVal;
    return `${op}.${mod} ${aM}${aV}, ${bM}${bV}`;
}

function loadWarriorFile(f) {
    return fs.readFileSync(path.join(__dirname, 'warriors', f), 'utf8');
}

const LABELS = ['top(MOV)', 'movBspl(MOV)', 'sub(SUB)', 'sptr(MOV)', 'scan(JMZ)',
                'jmz2(JMZ)', 'bspl(SPL)', 'movStep(MOV)', 'tp(DJN)', 'step(DAT)', 'cptr(DAT)'];

// ══════════════════════════════════════════════════════════════════
// SCENARIO RUNNER
// ══════════════════════════════════════════════════════════════════

function runScenario(name, blurCode, dummyCode, dummyName) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`  ${name}`);
    console.log(`${'='.repeat(70)}`);

    const p1 = new Parser();
    const blurParsed = p1.parse(blurCode, CORE_SIZE);

    global.stats = { writes: 0, splits: 0 };
    const mars = new MARS(CORE_SIZE, MAX_CYCLES, MAX_PROCS);
    mars.addWarrior(blurParsed, 'Blurstone');

    if (dummyCode) {
        const p2 = new Parser();
        mars.addWarrior(p2.parse(dummyCode, CORE_SIZE), dummyName);
    }

    const blur = mars.warriors[0];
    const dummy = mars.warriors[1] || null;
    const base = (blur.tasks[0] - blurParsed.startOffset + CORE_SIZE) % CORE_SIZE;

    console.log(`Blurstone base=${base}, startPC=${blur.tasks[0]}`);
    if (dummy) console.log(`${dummyName} startPC=${dummy.tasks[0]}`);

    // Show code layout
    console.log(`\nCode layout in core:`);
    for (let i = 0; i < blurParsed.instructions.length; i++) {
        const addr = (base + i) % CORE_SIZE;
        console.log(`  [${String(addr).padStart(5)}] ${LABELS[i].padEnd(14)} ${fmt(mars.core.get(addr))}`);
    }

    // Key addresses
    const addrs = {
        top: base,
        movBspl: (base + 1) % CORE_SIZE,
        sub: (base + 2) % CORE_SIZE,
        sptr: (base + 3) % CORE_SIZE,
        scan: (base + 4) % CORE_SIZE,
        jmz2: (base + 5) % CORE_SIZE,
        bspl: (base + 6) % CORE_SIZE,
        movStep: (base + 7) % CORE_SIZE,
        tp: (base + 8) % CORE_SIZE,
        step: (base + 9) % CORE_SIZE,
        cptr: (base + 10) % CORE_SIZE,
    };

    // Trace execution - track writes to critical cells with executing PC
    const origSet = mars.core.set.bind(mars.core);
    const origStep = mars.step.bind(mars);
    let execPC = -1, execInstr = '';

    const watchSet = new Set(Object.values(addrs));
    const writeLog = [];

    mars.step = function() {
        const w = mars.warriors[mars.activeWarriorIdx];
        if (w && !w.dead && w.tasks.length > 0) {
            execPC = w.tasks[0];
            execInstr = fmt(mars.core.get(execPC));
        } else {
            execPC = -1; execInstr = '(skip)';
        }
        return origStep();
    };

    mars.core.set = function(addr, instr, ownerId) {
        const a = ((addr % CORE_SIZE) + CORE_SIZE) % CORE_SIZE;
        if (watchSet.has(a)) {
            writeLog.push({
                cycle: mars.cycle, addr: a,
                before: fmt(mars.core.get(a)), after: fmt(instr),
                ownerId, execPC, execInstr
            });
        }
        return origSet(addr, instr, ownerId);
    };

    // Trace buffer for Blurstone's steps
    const trace = [];
    const origStep2 = mars.step.bind(mars); // now patched
    const maxTrace = 50;

    // Execution counting
    const pcCounts = {};
    let maxProcs = 1;

    while (mars.cycle < 5000) {
        const active = mars.warriors[mars.activeWarriorIdx];
        if (active === blur && !blur.dead && blur.tasks.length > 0) {
            const pc = blur.tasks[0];
            const offset = ((pc - base) % CORE_SIZE + CORE_SIZE) % CORE_SIZE;
            pcCounts[offset] = (pcCounts[offset] || 0) + 1;
            if (blur.tasks.length > maxProcs) maxProcs = blur.tasks.length;
            trace.push({ cycle: mars.cycle, pc, instr: fmt(mars.core.get(pc)),
                         owner: mars.core.get(pc).owner, procs: blur.tasks.length });
            if (trace.length > maxTrace) trace.shift();
        }

        mars.step();

        if (blur.dead) break;
        if (dummy && dummy.dead) {
            console.log(`\n${dummyName} killed at cycle ${mars.cycle}. Blurstone survived.`);
            break;
        }
    }

    // ── Results ──────────────────────────────────────────────────
    if (blur.dead) {
        const lf = blur._lastFatal;
        console.log(`\n>>> BLURSTONE DIED at cycle ${mars.cycle}`);
        if (lf) {
            const killerStr = lf.killerOwner === blur.id ? 'SELF (Blurstone)'
                : lf.killerOwner === -1 ? 'EMPTY CORE (uninitialized DAT)'
                : `warrior ${lf.killerOwner}`;
            console.log(`    Fatal PC: ${lf.pc}`);
            console.log(`    Fatal instruction: ${fmt(lf.instr)}`);
            console.log(`    Written by: ${killerStr}`);
        }

        // PC execution histogram
        console.log(`\nInstruction execution counts:`);
        for (const [off, cnt] of Object.entries(pcCounts).sort((a,b) => Number(a) - Number(b))) {
            const label = LABELS[Number(off)] || `offset ${off}`;
            console.log(`  ${label.padEnd(14)}: ${cnt} times`);
        }
        console.log(`  Max concurrent processes: ${maxProcs}`);

        // Show ALL writes to warrior's code cells, chronologically
        console.log(`\nAll writes to warrior code cells (${writeLog.length} total):`);
        const addrToLabel = {};
        for (const [name, addr] of Object.entries(addrs)) addrToLabel[addr] = name;
        for (const w of writeLog) {
            const label = addrToLabel[w.addr] || `?${w.addr}`;
            const pcOff = ((w.execPC - base) % CORE_SIZE + CORE_SIZE) % CORE_SIZE;
            const pcLabel = LABELS[pcOff] || `offset+${pcOff}`;
            console.log(`  cy=${String(w.cycle).padStart(5)} ${label.padEnd(8)} ${w.before.padEnd(28)} -> ${w.after.padEnd(28)} by PC=${w.execPC}(${pcLabel})`);
        }

        // Execution trace before death
        console.log(`\nLast ${Math.min(20, trace.length)} Blurstone steps before death:`);
        const tStart = Math.max(0, trace.length - 20);
        for (let i = tStart; i < trace.length; i++) {
            const e = trace[i];
            const ow = e.owner === blur.id ? 'B' : e.owner === -1 ? '_' : 'X';
            console.log(`  cycle=${String(e.cycle).padStart(5)} pc=${String(e.pc).padStart(5)} [${ow}] ${e.instr.padEnd(28)} procs=${e.procs}`);
        }

        // Core dump around death
        if (lf) {
            console.log(`\nCore around death PC (${lf.pc}):`);
            for (let off = -3; off <= 3; off++) {
                const a = (lf.pc + off + CORE_SIZE) % CORE_SIZE;
                const ins = mars.core.get(a);
                const ow = ins.owner === blur.id ? 'Blur' : ins.owner === -1 ? 'none' : `w${ins.owner}`;
                console.log(`  [${a}] ${fmt(ins).padEnd(28)} owner=${ow}${off === 0 ? ' <<<' : ''}`);
            }
        }
    } else {
        console.log(`\nBlurstone survived to cycle ${mars.cycle} with ${blur.tasks.length} process(es).`);
    }

    return { died: blur.dead, cycle: mars.cycle };
}

// ══════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════

const blurCode = loadWarriorFile('blurstone88.red');

// Parse and display warrior source
console.log('Blurstone \'88 source:');
const parsedForDisplay = new Parser().parse(blurCode, CORE_SIZE);
parsedForDisplay.instructions.forEach((ins, i) => {
    console.log(`  [${i}] ${LABELS[i].padEnd(14)} ${fmt(ins)}`);
});

const r1 = runScenario('RUN 1: Blurstone vs JMP 0 (actual dummy)', blurCode, 'JMP 0', 'Dummy');
const r2 = runScenario('RUN 2: Blurstone vs IMP (MOV 0, 1)', blurCode, 'MOV 0, 1', 'Imp');
const r3 = runScenario('RUN 3: Blurstone solo (no opponent)', blurCode, null, null);

// ── Summary ──────────────────────────────────────────────
console.log(`\n${'='.repeat(70)}`);
console.log('  SUMMARY');
console.log(`${'='.repeat(70)}`);
console.log(`  vs JMP0: ${r1.died ? `DIED at cycle ${r1.cycle}` : 'SURVIVED'}`);
console.log(`  vs IMP:  ${r2.died ? `DIED at cycle ${r2.cycle}` : 'SURVIVED'}`);
console.log(`  Solo:    ${r3.died ? `DIED at cycle ${r3.cycle}` : 'SURVIVED'}`);
