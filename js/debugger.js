// === TIME-TRAVEL DEBUGGER ===
// Non-invasive instrumentation of Core.set() and MARS.step()
// Records deltas + periodic snapshots for bidirectional navigation

class DebuggerRecorder {
    constructor(mars, snapshotInterval = 2000, maxSteps = 200000) {
        this.mars = mars;
        this.snapshotInterval = snapshotInterval;
        this.maxSteps = maxSteps;
        this.deltas = [];
        this.snapshots = [];
        this.pendingCoreChanges = [];
        this.pendingTasksBefore = null;
        this.recording = false;
        this.totalSteps = 0;
        this.droppedSteps = 0;
    }

    start() {
        this.clear();
        this.recording = true;
        this.takeSnapshot();
    }

    stop() {
        this.recording = false;
    }

    clear() {
        this.deltas.length = 0;
        this.snapshots.length = 0;
        this.totalSteps = 0;
        this.droppedSteps = 0;
    }

    takeSnapshot() {
        const mars = this.mars;
        const sparseCells = [];
        for (let i = 0; i < mars.coreSize; i++) {
            const c = mars.core.get(i);
            if (c.op !== 0 || c.mod !== 4 || c.aMode !== 1 || c.aVal !== 0 ||
                c.bMode !== 1 || c.bVal !== 0 || c.owner !== -1) {
                sparseCells.push([i, c.clone()]);
            }
        }
        const warriorStates = mars.warriors.map(w => ({
            tasks: [...w.tasks],
            dead: w.dead,
            pSpace: w.pSpace ? [...w.pSpace] : null
        }));
        this.snapshots.push({
            stepIdx: this.totalSteps,
            cycle: mars.cycle,
            activeWarriorIdx: mars.activeWarriorIdx,
            sparseCells,
            warriorStates
        });
    }

    beforeStep() {
        if (!this.recording) return;
        this.pendingCoreChanges = [];
        const w = this.mars.warriors[this.mars.activeWarriorIdx];
        this.pendingTasksBefore = {
            wIdx: this.mars.activeWarriorIdx,
            tasks: w && !w.dead ? [...w.tasks] : [],
            cycle: this.mars.cycle
        };
    }

    recordCoreWrite(addr, oldInstr) {
        if (!this.recording) return;
        this.pendingCoreChanges.push([addr, oldInstr]);
    }

    afterStep() {
        if (!this.recording) return;
        const tb = this.pendingTasksBefore;
        const w = this.mars.warriors[tb.wIdx];

        let events = 0;
        let killInfo = null;
        if (w && w.dead) {
            events |= 1; // death
            if (w._lastFatal) {
                const f = w._lastFatal;
                const killerName = f.killerOwner >= 0 ? (this.mars.warriors[f.killerOwner]?.name || '?') : 'empty cell';
                const opNames = Object.keys(OPCODES);
                const modNames = Object.keys(MODIFIERS);
                const modeChars = {};
                for (const [k,v] of Object.entries(ADDR_MODES)) modeChars[v] = k;
                const op = opNames.find(k => OPCODES[k] === f.instr.op) || '?';
                const mod = modNames.find(k => MODIFIERS[k] === f.instr.mod) || '?';
                const am = modeChars[f.instr.aMode] || '$';
                const bm = modeChars[f.instr.bMode] || '$';
                killInfo = {
                    killerIdx: f.killerOwner,
                    killerName,
                    pc: f.pc,
                    instr: `${op}.${mod} ${am}${f.instr.aVal}, ${bm}${f.instr.bVal}`,
                    cycle: f.cycle
                };
            }
        }
        if (this.pendingCoreChanges.length > 0) events |= 4; // write

        // Capture new values for forward replay
        const coreChangesWithNew = this.pendingCoreChanges.map(([addr, oldInstr]) => {
            const newInstr = this.mars.core.memory[addr].clone();
            return [addr, oldInstr, newInstr];
        });

        // Compact task storage: only store full array if small, else just count
        const tasksBefore = tb.tasks.length <= 16 ? tb.tasks : { len: tb.tasks.length, head: tb.tasks.slice(0, 4) };
        const tasksAfter = w ? (w.tasks.length <= 16 ? [...w.tasks] : { len: w.tasks.length, head: w.tasks.slice(0, 4) }) : [];

        this.deltas.push({
            wIdx: tb.wIdx,
            pc: tb.tasks.length > 0 ? tb.tasks[0] : -1,
            coreChanges: coreChangesWithNew,
            tasksBefore,
            tasksAfter,
            cycleBefore: tb.cycle,
            cycleAfter: this.mars.cycle,
            activeIdxAfter: this.mars.activeWarriorIdx,
            events,
            killInfo
        });

        this.totalSteps++;

        if (this.totalSteps % this.snapshotInterval === 0) {
            this.takeSnapshot();
        }

        // Enforce size limit — drop oldest chunk when exceeded
        if (this.deltas.length > this.maxSteps) {
            const dropCount = this.snapshotInterval;
            this.deltas.splice(0, dropCount);
            this.droppedSteps += dropCount;
            // Remove obsolete snapshots
            while (this.snapshots.length > 1 && this.snapshots[1].stepIdx <= this.droppedSteps) {
                this.snapshots.shift();
            }
        }

        this.pendingCoreChanges = [];
        this.pendingTasksBefore = null;
    }
}

class DebuggerPlayer {
    constructor(mars, recorder) {
        this.mars = mars;
        this.recorder = recorder;
        this.currentStep = 0;
    }

    get totalSteps() { return this.recorder.totalSteps; }
    get minStep() { return this.recorder.droppedSteps; }

    // Expand compact task format back to array
    expandTasks(tasks) {
        if (Array.isArray(tasks)) return [...tasks];
        // Compact format: { len, head }
        return tasks.head ? [...tasks.head] : [];
    }

    restoreSnapshot(snap) {
        const mars = this.mars;
        // Clear core
        for (let i = 0; i < mars.coreSize; i++) {
            mars.core.memory[i] = new Instruction(0, 4, 1, 0, 1, 0);
        }
        // Restore non-empty cells
        for (const [addr, instr] of snap.sparseCells) {
            mars.core.memory[addr] = instr.clone();
        }
        // Restore warrior states
        for (let i = 0; i < mars.warriors.length; i++) {
            const ws = snap.warriorStates[i];
            mars.warriors[i].tasks = [...ws.tasks];
            mars.warriors[i].dead = ws.dead;
            if (ws.pSpace) mars.warriors[i].pSpace = [...ws.pSpace];
        }
        mars.cycle = snap.cycle;
        mars.activeWarriorIdx = snap.activeWarriorIdx;
    }

    seekToStep(targetStep) {
        targetStep = Math.max(this.minStep, Math.min(targetStep, this.totalSteps));

        // Find nearest snapshot <= targetStep
        let bestSnap = this.recorder.snapshots[0];
        for (const snap of this.recorder.snapshots) {
            if (snap.stepIdx <= targetStep) bestSnap = snap;
            else break;
        }

        this.restoreSnapshot(bestSnap);
        this.currentStep = bestSnap.stepIdx;

        // Apply deltas forward
        while (this.currentStep < targetStep) {
            this.applyDeltaForward(this.currentStep);
            this.currentStep++;
        }
    }

    deltaAt(stepIdx) {
        return this.recorder.deltas[stepIdx - this.recorder.droppedSteps];
    }

    applyDeltaForward(stepIdx) {
        const delta = this.deltaAt(stepIdx);
        if (!delta) return;

        for (const change of delta.coreChanges) {
            const addr = change[0];
            const newInstr = change[2];
            if (newInstr) {
                this.mars.core.memory[((addr % this.mars.coreSize) + this.mars.coreSize) % this.mars.coreSize] = newInstr.clone();
            }
        }

        const w = this.mars.warriors[delta.wIdx];
        if (w) {
            w.tasks = this.expandTasks(delta.tasksAfter);
            w.dead = !!(delta.events & 1);
        }
        this.mars.cycle = delta.cycleAfter;
        this.mars.activeWarriorIdx = delta.activeIdxAfter;
    }

    stepBackward() {
        if (this.currentStep <= this.minStep) return false;
        this.currentStep--;
        const delta = this.deltaAt(this.currentStep);
        if (!delta) return false;

        for (const change of delta.coreChanges) {
            const addr = change[0];
            const oldInstr = change[1];
            this.mars.core.memory[((addr % this.mars.coreSize) + this.mars.coreSize) % this.mars.coreSize] = oldInstr.clone();
        }

        const w = this.mars.warriors[delta.wIdx];
        if (w) {
            w.tasks = this.expandTasks(delta.tasksBefore);
            if (delta.events & 1) w.dead = false;
        }

        this.mars.cycle = delta.cycleBefore;
        this.mars.activeWarriorIdx = delta.wIdx;
        return true;
    }

    stepForward() {
        if (this.currentStep >= this.totalSteps) return false;
        this.applyDeltaForward(this.currentStep);
        this.currentStep++;
        return true;
    }

    getCurrentDelta() {
        if (this.currentStep > this.minStep) {
            return this.deltaAt(this.currentStep - 1);
        }
        return null;
    }
}

// Instrument Core.set to capture writes without modifying engine.js
function instrumentCore(core, recorder) {
    const origSet = core.set.bind(core);
    core.set = function(addr, instr, ownerId) {
        const a = ((addr % core.size) + core.size) % core.size;
        const old = core.memory[a].clone();
        recorder.recordCoreWrite(a, old);
        origSet(addr, instr, ownerId);
    };
    core._origSet = origSet;
}

function uninstrumentCore(core) {
    if (core._origSet) {
        core.set = core._origSet;
        delete core._origSet;
    }
}

// Instrument MARS.step to bracket with before/after
function instrumentMARS(mars, recorder) {
    const origStep = mars.step.bind(mars);
    mars.step = function() {
        recorder.beforeStep();
        origStep();
        recorder.afterStep();
    };
    mars._origStep = origStep;
}

function uninstrumentMARS(mars) {
    if (mars._origStep) {
        mars.step = mars._origStep;
        delete mars._origStep;
    }
}

// === DEBUGGER UI ===
class DebuggerUI {
    constructor() {
        this.recorder = null;
        this.player = null;
        this.active = false;
        this.isPlayback = false;
        this.panel = document.getElementById('debuggerPanel');
        this.slider = document.getElementById('dbgSlider');
        this.cycleLabel = document.getElementById('dbgCycleLabel');
        this.instrDisplay = document.getElementById('dbgInstrDisplay');
        this.queuesDisplay = document.getElementById('dbgQueuesDisplay');
        this.cellInspector = document.getElementById('dbgCellInspector');
        this.timelineCanvas = document.getElementById('dbgTimeline');
        this.timelineCtx = this.timelineCanvas ? this.timelineCanvas.getContext('2d') : null;
        this.selectedCell = null;

        this.setupControls();
    }

    setupControls() {
        const btn = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };
        btn('dbgStepBack', () => this.stepBack());
        btn('dbgStepFwd', () => this.stepFwd());
        btn('dbgBigBack', () => this.jumpBack());
        btn('dbgBigFwd', () => this.jumpFwd());
        btn('dbgGoStart', () => this.goToStart());
        btn('dbgGoEnd', () => this.goToEnd());

        if (this.slider) {
            this.slider.addEventListener('input', () => {
                const step = parseInt(this.slider.value);
                this.seekTo(step);
            });
        }
    }

    toggle() {
        if (this.active) this.deactivate();
        else this.activate();
    }

    activate() {
        if (!mars || mars.warriors.length === 0) {
            log('Load warriors first', 'error');
            return;
        }
        this.active = true;
        if (this.panel) this.panel.classList.add('visible');

        // If battle is still running, we need to start recording
        if (!this.recorder) {
            this.startRecording();
        }
        this.updateDisplay();
        log('Debugger activated (D to toggle)', 'info');
    }

    deactivate() {
        this.active = false;
        this.isPlayback = false;
        // Free recording memory when deactivating
        this.stopRecording();
        if (this.recorder) this.recorder.clear();
        this.recorder = null;
        this.player = null;
        if (this.panel) this.panel.classList.remove('visible');
        log('Debugger deactivated', 'info');
    }

    startRecording() {
        this.recorder = new DebuggerRecorder(mars);
        instrumentCore(mars.core, this.recorder);
        instrumentMARS(mars, this.recorder);
        this.recorder.start();
        this.player = new DebuggerPlayer(mars, this.recorder);
    }

    stopRecording() {
        if (this.recorder) {
            this.recorder.stop();
            uninstrumentMARS(mars);
            uninstrumentCore(mars.core);
        }
    }

    enterPlaybackMode() {
        if (!this.recorder || this.recorder.totalSteps === 0) return;
        this.isPlayback = true;
        // Pause the simulation
        if (mars.isRunning) {
            mars.isRunning = false;
            document.getElementById('playIcon').className = 'fas fa-play';
            document.getElementById('runBtn').classList.remove('running');
        }
        this.stopRecording();
        this.player = new DebuggerPlayer(mars, this.recorder);
        this.player.seekToStep(this.recorder.totalSteps);
        this.updateSlider();
        this.updateDisplay();
    }

    seekTo(step) {
        if (!this.isPlayback) this.enterPlaybackMode();
        if (!this.player) return;
        this.player.seekToStep(step);
        this.updateDisplay();
        visualizer.draw();
    }

    stepBack() {
        if (!this.isPlayback) this.enterPlaybackMode();
        if (!this.player) return;
        this.player.stepBackward();
        this.updateSlider();
        this.updateDisplay();
        visualizer.draw();
    }

    stepFwd() {
        if (!this.isPlayback) this.enterPlaybackMode();
        if (!this.player) return;
        this.player.stepForward();
        this.updateSlider();
        this.updateDisplay();
        visualizer.draw();
    }

    jumpBack() {
        if (!this.isPlayback) this.enterPlaybackMode();
        if (!this.player) return;
        // Jump one full cycle back (all warriors)
        const jumpSize = Math.max(1, mars.warriors.filter(w => !w.dead).length);
        this.player.seekToStep(Math.max(0, this.player.currentStep - jumpSize));
        this.updateSlider();
        this.updateDisplay();
        visualizer.draw();
    }

    jumpFwd() {
        if (!this.isPlayback) this.enterPlaybackMode();
        if (!this.player) return;
        const jumpSize = Math.max(1, mars.warriors.filter(w => !w.dead).length);
        this.player.seekToStep(Math.min(this.player.totalSteps, this.player.currentStep + jumpSize));
        this.updateSlider();
        this.updateDisplay();
        visualizer.draw();
    }

    goToStart() {
        if (!this.isPlayback) this.enterPlaybackMode();
        if (!this.player) return;
        this.player.seekToStep(this.player.minStep);
        this.updateSlider();
        this.updateDisplay();
        visualizer.draw();
    }

    goToEnd() {
        if (!this.isPlayback) this.enterPlaybackMode();
        if (!this.player) return;
        this.player.seekToStep(this.player.totalSteps);
        this.updateSlider();
        this.updateDisplay();
        visualizer.draw();
    }

    updateSlider() {
        if (!this.slider || !this.player) return;
        this.slider.max = this.player.totalSteps;
        this.slider.value = this.player.currentStep;
    }

    updateDisplay() {
        if (!this.player) return;

        // Cycle label
        if (this.cycleLabel) {
            const trimmed = this.player.minStep > 0 ? ` (earliest: ${this.player.minStep})` : '';
            this.cycleLabel.textContent = `Step ${this.player.currentStep} / ${this.player.totalSteps}  |  Cycle ${mars.cycle}${trimmed}`;
        }

        // Update slider
        this.updateSlider();

        // Instruction display
        if (this.instrDisplay) {
            const delta = this.player.getCurrentDelta();
            if (delta) {
                const w = mars.warriors[delta.wIdx];
                const wName = w ? w.name : '?';
                const wColor = WCOLORS[delta.wIdx % WCOLORS.length];
                const instr = mars.core.get(delta.pc);
                const op = Object.keys(OPCODES).find(k => OPCODES[k] === instr.op) || '?';
                const mod = Object.keys(MODIFIERS).find(k => MODIFIERS[k] === instr.mod) || '?';
                const am = Object.keys(ADDR_MODES).find(k => ADDR_MODES[k] === instr.aMode) || '$';
                const bm = Object.keys(ADDR_MODES).find(k => ADDR_MODES[k] === instr.bMode) || '$';
                const writes = delta.coreChanges.map(c => c[0]).join(', ');
                const evts = [];
                if (delta.events & 1) evts.push('DEATH');
                if (delta.events & 4) evts.push(`wrote [${writes}]`);

                let killHtml = '';
                if ((delta.events & 1) && delta.killInfo) {
                    const ki = delta.killInfo;
                    const kColor = ki.killerIdx >= 0 ? WCOLORS[ki.killerIdx % WCOLORS.length] : 'var(--text-ghost)';
                    killHtml = `<div class="dbg-kill-banner">Killed by <span style="color:${kColor}">${ki.killerName}</span><br>${ki.instr} @${ki.pc}</div>`;
                }

                this.instrDisplay.innerHTML =
                    `<div class="dbg-warrior" style="color:${wColor}">${wName} @${delta.pc}</div>` +
                    `<div class="dbg-instr">${op}.${mod} ${am}${instr.aVal}, ${bm}${instr.bVal}</div>` +
                    (evts.length ? `<div class="dbg-events">${evts.join(' | ')}</div>` : '') +
                    killHtml;
            } else {
                this.instrDisplay.innerHTML = '<div class="dbg-empty">No step data</div>';
            }
        }

        // Process queues with death info
        if (this.queuesDisplay) {
            let html = '';
            const deathSteps = this.getDeathSteps();
            mars.warriors.forEach((w, i) => {
                const color = WCOLORS[i % WCOLORS.length];
                const status = w.dead ? 'DEAD' : `${w.tasks.length} proc`;
                const tasks = w.dead ? '' : w.tasks.slice(0, 8).join(', ') + (w.tasks.length > 8 ? '...' : '');
                let deathInfo = '';
                if (deathSteps[i] !== undefined) {
                    const ds = deathSteps[i];
                    const ki = ds.killInfo;
                    const killerDetail = ki
                        ? `<div class="dbg-kill-detail">by <span style="color:${ki.killerIdx >= 0 ? WCOLORS[ki.killerIdx % WCOLORS.length] : 'var(--text-ghost)'}">${ki.killerName}</span> — ${ki.instr} @${ki.pc}</div>`
                        : '';
                    if (w.dead) {
                        deathInfo = `<div class="dbg-death-info">Killed cycle ${ds.cycle} <span class="dbg-goto-death" data-step="${ds.step}">[go to]</span>${killerDetail}</div>`;
                    } else {
                        deathInfo = `<div class="dbg-death-info dbg-future">Dies cycle ${ds.cycle} <span class="dbg-goto-death" data-step="${ds.step}">[go to]</span>${killerDetail}</div>`;
                    }
                }
                html += `<div class="dbg-queue"><span class="dbg-wname" style="color:${color}">${w.name}</span>` +
                    `<span class="dbg-status ${w.dead ? 'dead' : ''}">${status}</span>` +
                    (tasks ? `<div class="dbg-tasks">[${tasks}]</div>` : '') +
                    deathInfo + `</div>`;
            });
            this.queuesDisplay.innerHTML = html;
            // Bind go-to-death links
            this.queuesDisplay.querySelectorAll('.dbg-goto-death').forEach(el => {
                el.addEventListener('click', () => {
                    const step = parseInt(el.dataset.step);
                    this.seekTo(step);
                });
            });
        }

        // Timeline
        this.drawTimeline();
    }

    getDeathSteps() {
        if (!this.recorder) return {};
        const deaths = {};
        const offset = this.recorder.droppedSteps;
        for (let i = 0; i < this.recorder.deltas.length; i++) {
            const d = this.recorder.deltas[i];
            if ((d.events & 1) && deaths[d.wIdx] === undefined) {
                deaths[d.wIdx] = {
                    step: offset + i + 1,
                    cycle: d.cycleAfter,
                    killInfo: d.killInfo
                };
            }
        }
        return deaths;
    }

    drawTimeline() {
        if (!this.timelineCanvas || !this.timelineCtx || !this.player) return;
        const ctx = this.timelineCtx;
        const w = this.timelineCanvas.parentElement.clientWidth - 4;
        const h = 24;
        this.timelineCanvas.width = w;
        this.timelineCanvas.height = h;

        ctx.fillStyle = '#0a0c14';
        ctx.fillRect(0, 0, w, h);

        const total = this.player.totalSteps;
        const minS = this.player.minStep;
        const range = total - minS;
        if (range <= 0) return;

        // Draw ownership gradient from available deltas
        const deltas = this.recorder.deltas;
        for (let px = 0; px < w; px++) {
            const idx = Math.min(Math.floor(px * deltas.length / w), deltas.length - 1);
            const delta = deltas[idx];
            if (delta && delta.wIdx < WCOLORS.length) {
                ctx.fillStyle = WCOLORS[delta.wIdx % WCOLORS.length];
                ctx.globalAlpha = 0.4;
                ctx.fillRect(px, 0, 1, h);
            }
        }
        ctx.globalAlpha = 1;

        // Draw death events
        for (let i = 0; i < deltas.length; i++) {
            const d = deltas[i];
            if (d && (d.events & 1)) {
                const px = Math.floor(i * w / deltas.length);
                ctx.fillStyle = '#ff2d6a';
                ctx.fillRect(px - 1, 0, 3, h);
            }
        }

        // Draw current position
        const curPx = Math.floor((this.player.currentStep - minS) * w / range);
        ctx.fillStyle = '#fff';
        ctx.fillRect(curPx - 1, 0, 3, h);
    }

    inspectCell(addr) {
        if (!this.active || !this.cellInspector) return;
        this.selectedCell = addr;
        const instr = mars.core.get(addr);
        const op = Object.keys(OPCODES).find(k => OPCODES[k] === instr.op) || '?';
        const mod = Object.keys(MODIFIERS).find(k => MODIFIERS[k] === instr.mod) || '?';
        const am = Object.keys(ADDR_MODES).find(k => ADDR_MODES[k] === instr.aMode) || '$';
        const bm = Object.keys(ADDR_MODES).find(k => ADDR_MODES[k] === instr.bMode) || '$';
        const owner = instr.owner === -1 ? 'Empty' : (mars.warriors[instr.owner]?.name || '?');

        // Count writes to this cell
        let writeCount = 0;
        const writers = new Set();
        for (const delta of this.recorder.deltas) {
            for (const change of delta.coreChanges) {
                if (change[0] === addr) { writeCount++; writers.add(delta.wIdx); }
            }
        }

        this.cellInspector.innerHTML =
            `<div class="dbg-cell-addr">Cell ${addr}</div>` +
            `<div class="dbg-cell-instr">${op}.${mod} ${am}${instr.aVal}, ${bm}${instr.bVal}</div>` +
            `<div class="dbg-cell-owner">Owner: ${owner}</div>` +
            `<div class="dbg-cell-writes">${writeCount} writes by ${writers.size} warrior(s)</div>`;
    }

    reset() {
        if (this.recorder) this.recorder.clear();
        this.recorder = null;
        this.player = null;
        this.isPlayback = false;
        if (this.instrDisplay) this.instrDisplay.innerHTML = '';
        if (this.queuesDisplay) this.queuesDisplay.innerHTML = '';
        if (this.cellInspector) this.cellInspector.innerHTML = '';
        if (this.cycleLabel) this.cycleLabel.textContent = '';
        if (this.slider) { this.slider.value = 0; this.slider.max = 0; }
        if (this.timelineCtx) this.timelineCtx.clearRect(0, 0, this.timelineCanvas.width, this.timelineCanvas.height);
    }
}

// Global debugger instance
let debuggerUI;
