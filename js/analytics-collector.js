// === BATTLE ANALYTICS: DATA COLLECTOR ===
// Lightweight in-battle data collection with sampling

class BattleCollector {
    constructor(coreSize, warriorCount) {
        this.coreSize = coreSize;
        this.warriorCount = warriorCount;
        this.writeHeatmap = new Uint16Array(coreSize);
        this.territorySamples = [];
        this.writeRateSamples = [];
        this.killEvents = [];
        this.opcodeUsage = Array.from({ length: warriorCount }, () => new Uint32Array(18));
        this.writeDistHist = Array.from({ length: warriorCount }, () => new Uint32Array(100));
        this.lastWritePos = new Array(warriorCount).fill(-1);
        this.writeCountWindow = new Array(warriorCount).fill(0);
        this.sampleInterval = 200;
        this.stepCount = 0;
        this.active = true;
        this.lastSampleCycle = -1;
        // Take initial sample at cycle 0
        this.sampleTerritory();
    }

    recordStep(cycle, wIdx, pc, opcode, alive) {
        if (!this.active) return;
        this.stepCount++;
        if (wIdx >= 0 && wIdx < this.warriorCount) {
            this.opcodeUsage[wIdx][opcode]++;
        }

        // Territory + process sampling (once per sample interval, dedup per cycle)
        if (cycle > 0 && cycle % this.sampleInterval === 0 && cycle !== this.lastSampleCycle) {
            this.lastSampleCycle = cycle;
            this.sampleTerritory();
            this.sampleWriteRate();
        }
    }

    recordWrite(addr, owner, coreSize) {
        if (!this.active || owner < 0) return;
        const a = ((addr % coreSize) + coreSize) % coreSize;
        this.writeHeatmap[a]++;
        this.writeCountWindow[owner]++;

        // Write distance histogram for strategy detection
        if (this.lastWritePos[owner] >= 0) {
            let dist = Math.abs(a - this.lastWritePos[owner]);
            dist = Math.min(dist, coreSize - dist);
            const bucket = Math.min(99, Math.floor(dist / (coreSize / 100)));
            this.writeDistHist[owner][bucket]++;
        }
        this.lastWritePos[owner] = a;
    }

    recordKill(cycle, killerIdx, victimIdx, pc, instr) {
        if (!this.active) return;
        this.killEvents.push({ cycle, killer: killerIdx, victim: victimIdx, pc: pc || -1, instr: instr ? instr.clone() : null });
    }

    sampleTerritory() {
        const counts = new Array(this.warriorCount).fill(0);
        const procs = new Array(this.warriorCount).fill(0);
        let empty = 0;

        // Sample 500 random cells
        const sampleSize = Math.min(500, this.coreSize);
        for (let i = 0; i < sampleSize; i++) {
            const addr = Math.floor(Math.random() * this.coreSize);
            const owner = mars.core.get(addr).owner;
            if (owner >= 0 && owner < this.warriorCount) counts[owner]++;
            else empty++;
        }

        // Process counts
        mars.warriors.forEach((w, i) => {
            if (!w.dead && i < this.warriorCount) procs[i] = w.tasks.length;
        });

        this.territorySamples.push({
            cycle: mars.cycle,
            counts: counts,
            empty: empty,
            procs: procs
        });
    }

    sampleWriteRate() {
        this.writeRateSamples.push({
            cycle: mars.cycle,
            rates: [...this.writeCountWindow]
        });
        this.writeCountWindow.fill(0);
    }

    finalize() {
        this.active = false;
        // Take final territory sample
        this.sampleTerritory();
        return this.getResults();
    }

    getResults() {
        return {
            writeHeatmap: this.writeHeatmap,
            territorySamples: this.territorySamples,
            writeRateSamples: this.writeRateSamples,
            killEvents: this.killEvents,
            opcodeUsage: this.opcodeUsage,
            writeDistHist: this.writeDistHist,
            coreSize: this.coreSize,
            warriorCount: this.warriorCount
        };
    }
}
