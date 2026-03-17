// === BATTLE ANALYTICS: STRATEGY CLASSIFIER + ELO + TOURNAMENT STATS ===

class StrategyClassifier {
    classify(opcodeUsage, writeDistHist, procCounts, coreSize) {
        const totalOps = opcodeUsage.reduce((s, v) => s + v, 0) || 1;
        const movPct = opcodeUsage[1] / totalOps; // MOV
        const splPct = opcodeUsage[11] / totalOps; // SPL
        const cmpPct = (opcodeUsage[13] + opcodeUsage[14]) / totalOps; // CMP+SNE
        const jmpPct = (opcodeUsage[7] + opcodeUsage[8] + opcodeUsage[9] + opcodeUsage[10]) / totalOps;
        const addSubPct = (opcodeUsage[2] + opcodeUsage[3]) / totalOps;
        const datPct = opcodeUsage[0] / totalOps; // DAT executions (deaths)

        // Analyze write distance pattern
        let peakBucket = 0, peakVal = 0;
        const totalDist = writeDistHist.reduce((s, v) => s + v, 0) || 1;
        for (let i = 0; i < writeDistHist.length; i++) {
            if (writeDistHist[i] > peakVal) { peakVal = writeDistHist[i]; peakBucket = i; }
        }
        const distConcentration = peakVal / totalDist;

        // Analyze process growth
        const maxProcs = procCounts.length > 0 ? Math.max(...procCounts) : 1;
        const avgProcs = procCounts.length > 0 ? procCounts.reduce((s, v) => s + v, 0) / procCounts.length : 1;

        // Score each strategy
        const scores = {};

        // Imp: high MOV.I, zero SPL, write-distance = 1
        scores.imp = movPct * 3 + (splPct < 0.01 ? 1 : 0) + (peakBucket <= 1 ? 2 : 0) + (distConcentration > 0.5 ? 1 : 0);

        // Bomber: regular write-distance, few processes, DAT bombs
        scores.bomber = (distConcentration > 0.3 ? 2 : 0) + (peakBucket > 2 ? 1 : 0) + (maxProcs < 4 ? 1 : 0) + movPct * 2 + addSubPct * 2;

        // Scanner: high CMP/SEQ/SNE, conditional jumps
        scores.scanner = cmpPct * 6 + jmpPct * 2 + (maxProcs < 4 ? 1 : 0);

        // Replicator: high SPL, growing process count
        scores.replicator = splPct * 5 + (maxProcs > 20 ? 2 : 0) + (avgProcs > 5 ? 1 : 0) + movPct * 1;

        // Vampire: writes JMP instructions
        scores.vampire = jmpPct * 3 + cmpPct * 2 + movPct * 1 + (maxProcs < 10 ? 1 : 0);

        // Find best match
        let best = 'unknown', bestScore = 0;
        for (const [strat, score] of Object.entries(scores)) {
            if (score > bestScore) { bestScore = score; best = strat; }
        }

        return {
            type: best,
            confidence: Math.min(1, bestScore / 8),
            scores,
            profile: {
                offense: Math.min(1, movPct * 2 + addSubPct),
                defense: Math.min(1, splPct * 2 + cmpPct + jmpPct * 0.5),
                speed: Math.min(1, (maxProcs < 3 ? 0.8 : 0.3) + (1 - datPct) * 0.2),
                territory: Math.min(1, movPct + splPct * 0.5 + (maxProcs > 10 ? 0.3 : 0)),
                resilience: Math.min(1, splPct * 2 + (maxProcs > 5 ? 0.4 : 0) + (avgProcs > 3 ? 0.3 : 0))
            }
        };
    }
}

class EloRating {
    constructor(k = 32, initial = 1500) {
        this.k = k;
        this.initial = initial;
        this.ratings = {};
    }

    getRating(name) {
        if (!this.ratings[name]) this.ratings[name] = this.initial;
        return this.ratings[name];
    }

    update(winnerName, loserName, isDraw = false) {
        const ra = this.getRating(winnerName);
        const rb = this.getRating(loserName);
        const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
        const eb = 1 / (1 + Math.pow(10, (ra - rb) / 400));

        if (isDraw) {
            this.ratings[winnerName] = ra + this.k * (0.5 - ea);
            this.ratings[loserName] = rb + this.k * (0.5 - eb);
        } else {
            this.ratings[winnerName] = ra + this.k * (1 - ea);
            this.ratings[loserName] = rb + this.k * (0 - eb);
        }
    }

    getRankings() {
        return Object.entries(this.ratings)
            .sort((a, b) => b[1] - a[1])
            .map(([name, rating]) => ({ name, rating: Math.round(rating) }));
    }

    load() {
        try {
            const stored = localStorage.getItem('corewars_elo');
            if (stored) this.ratings = JSON.parse(stored);
        } catch (e) { /* ignore */ }
    }

    save() {
        try {
            localStorage.setItem('corewars_elo', JSON.stringify(this.ratings));
        } catch (e) { /* ignore */ }
    }
}

class TournamentStats {
    constructor() {
        this.matchups = {};
        this.headToHead = {};
        this.elo = new EloRating();
        this.totalMatches = 0;
        this.load();
    }

    recordMatch(warriors, winner) {
        this.totalMatches++;
        const names = warriors.map(w => w.name).sort();
        const key = names.join(' vs ');

        if (!this.headToHead[key]) {
            this.headToHead[key] = { total: 0, draws: 0 };
            names.forEach(n => this.headToHead[key][n] = 0);
        }
        this.headToHead[key].total++;

        if (winner) {
            this.headToHead[key][winner.name]++;
            // Update Elo
            warriors.forEach(w => {
                if (w.name !== winner.name) {
                    this.elo.update(winner.name, w.name, false);
                }
            });
        } else {
            this.headToHead[key].draws++;
            // Draw Elo
            if (warriors.length === 2) {
                this.elo.update(warriors[0].name, warriors[1].name, true);
            }
        }

        // Strategy matchups
        if (warriors.length === 2 && winner) {
            for (const w of warriors) {
                if (w._strategyType) {
                    const other = warriors.find(x => x !== w);
                    if (other && other._strategyType) {
                        const mKey = [w._strategyType, other._strategyType].sort().join('_vs_');
                        if (!this.matchups[mKey]) this.matchups[mKey] = {};
                        if (!this.matchups[mKey][w._strategyType]) this.matchups[mKey][w._strategyType] = 0;
                        if (w.name === winner.name) this.matchups[mKey][w._strategyType]++;
                    }
                }
            }
        }

        this.save();
    }

    getMatchupMatrix() {
        const types = ['imp', 'bomber', 'scanner', 'replicator', 'vampire'];
        const matrix = {};
        for (const t1 of types) {
            matrix[t1] = {};
            for (const t2 of types) {
                const key = [t1, t2].sort().join('_vs_');
                if (this.matchups[key]) {
                    matrix[t1][t2] = this.matchups[key][t1] || 0;
                } else {
                    matrix[t1][t2] = 0;
                }
            }
        }
        return matrix;
    }

    load() {
        try {
            const stored = localStorage.getItem('corewars_tournament_stats');
            if (stored) {
                const data = JSON.parse(stored);
                this.matchups = data.matchups || {};
                this.headToHead = data.headToHead || {};
                this.totalMatches = data.totalMatches || 0;
            }
            this.elo.load();
        } catch (e) { /* ignore */ }
    }

    save() {
        try {
            localStorage.setItem('corewars_tournament_stats', JSON.stringify({
                matchups: this.matchups,
                headToHead: this.headToHead,
                totalMatches: this.totalMatches
            }));
            this.elo.save();
        } catch (e) { /* ignore */ }
    }

    reset() {
        this.matchups = {};
        this.headToHead = {};
        this.totalMatches = 0;
        this.elo = new EloRating();
        try {
            localStorage.removeItem('corewars_tournament_stats');
            localStorage.removeItem('corewars_elo');
        } catch (e) { /* ignore */ }
    }
}

// Globals
let strategyClassifier, tournamentStatsManager;
