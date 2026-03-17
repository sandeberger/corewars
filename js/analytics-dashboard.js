// === BATTLE ANALYTICS: DASHBOARD UI ===

class AnalyticsDashboard {
    constructor() {
        this.chartRenderer = new ChartRenderer();
        this.classifier = new StrategyClassifier();
        this.tournamentStats = new TournamentStats();
        this.lastResults = null;
        this.lastClassifications = [];
        this.lastWarriorNames = [];
        this.activeSubTab = 'battleTab';
    }

    init() {
        // Sub-tab switching
        document.querySelectorAll('.analytics-subtab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.analytics-subtab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.analytics-subpane').forEach(p => p.classList.remove('active'));
                const pane = document.getElementById(tab.dataset.subtab);
                if (pane) pane.classList.add('active');
                this.activeSubTab = tab.dataset.subtab;
                this.renderActiveTab();
            });
        });
    }

    onBattleEnd(collector, warriors) {
        if (!collector) return;
        this.lastResults = collector.finalize();
        this.lastWarriorNames = warriors.map(w => w.name);
        this.classifyWarriors(warriors);
        this.renderBattleTab();

        // Record match for tournament stats
        const alive = warriors.filter(w => !w.dead);
        const winner = alive.length === 1 ? alive[0] : null;
        this.tournamentStats.recordMatch(warriors, winner);
        this.renderTournamentTab();
    }

    classifyWarriors(warriors) {
        if (!this.lastResults) return;
        this.lastClassifications = [];
        for (let i = 0; i < warriors.length; i++) {
            const procHistory = this.lastResults.territorySamples.map(s => s.procs[i] || 0);
            const classification = this.classifier.classify(
                this.lastResults.opcodeUsage[i],
                this.lastResults.writeDistHist[i],
                procHistory,
                this.lastResults.coreSize
            );
            this.lastClassifications.push(classification);
            warriors[i]._strategyType = classification.type;
        }
    }

    renderActiveTab() {
        if (this.activeSubTab === 'battleTab') this.renderBattleTab();
        else if (this.activeSubTab === 'tournamentTab') this.renderTournamentTab();
        else if (this.activeSubTab === 'strategyTab') this.renderStrategyTab();
    }

    renderBattleTab() {
        if (!this.lastResults) return;
        const r = this.lastResults;

        // Resize canvases
        this.resizeCanvas('heatmapCanvas', 400, 200);
        this.resizeCanvas('territoryCanvas', 400, 150);
        this.resizeCanvas('processCanvas', 400, 120);
        this.resizeCanvas('writeRateCanvas', 400, 120);

        // Heatmap
        const heatmapCanvas = document.getElementById('heatmapCanvas');
        if (heatmapCanvas) {
            this.chartRenderer.drawHeatmap(heatmapCanvas, r.writeHeatmap, r.coreSize, { title: 'Write Heatmap' });
        }

        // Territory timeline
        const territoryCanvas = document.getElementById('territoryCanvas');
        if (territoryCanvas && r.territorySamples.length > 0) {
            const datasets = [];
            for (let w = 0; w < r.warriorCount; w++) {
                datasets.push({
                    data: r.territorySamples.map(s => s.counts[w] || 0),
                    color: WCOLORS[w % WCOLORS.length]
                });
            }
            const xLabels = r.territorySamples.map(s => String(s.cycle));
            this.chartRenderer.drawStackedArea(territoryCanvas, datasets, { title: 'Territory Over Time', xLabels });
        }

        // Process count
        const processCanvas = document.getElementById('processCanvas');
        if (processCanvas && r.territorySamples.length > 0) {
            const datasets = [];
            for (let w = 0; w < r.warriorCount; w++) {
                datasets.push({
                    data: r.territorySamples.map(s => s.procs[w] || 0),
                    color: WCOLORS[w % WCOLORS.length]
                });
            }
            const xLabels = r.territorySamples.map(s => String(s.cycle));
            this.chartRenderer.drawLineChart(processCanvas, datasets, { title: 'Process Count', xLabels });
        }

        // Write frequency
        const writeRateCanvas = document.getElementById('writeRateCanvas');
        if (writeRateCanvas && r.writeRateSamples.length > 0) {
            const datasets = [];
            for (let w = 0; w < r.warriorCount; w++) {
                datasets.push({
                    data: r.writeRateSamples.map(s => s.rates[w] || 0),
                    color: WCOLORS[w % WCOLORS.length]
                });
            }
            const xLabels = r.writeRateSamples.map(s => String(s.cycle));
            this.chartRenderer.drawLineChart(writeRateCanvas, datasets, { title: 'Write Frequency', xLabels });
        }
    }

    renderTournamentTab() {
        const ts = this.tournamentStats;

        // Elo rankings
        const eloList = document.getElementById('eloRankings');
        if (eloList) {
            const rankings = ts.elo.getRankings();
            if (rankings.length === 0) {
                eloList.innerHTML = '<div class="analytics-empty">No Elo data yet — run some battles!</div>';
            } else {
                eloList.innerHTML = rankings.map((r, i) => {
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
                    return `<div class="elo-row"><span class="elo-rank">${medal}</span><span class="elo-name">${r.name}</span><span class="elo-rating">${r.rating}</span></div>`;
                }).join('');
            }
        }

        // Head-to-head
        const h2hList = document.getElementById('h2hResults');
        if (h2hList) {
            const entries = Object.entries(ts.headToHead);
            if (entries.length === 0) {
                h2hList.innerHTML = '<div class="analytics-empty">No head-to-head data yet</div>';
            } else {
                h2hList.innerHTML = entries.slice(-15).map(([key, data]) => {
                    const names = key.split(' vs ');
                    const parts = names.map(n => {
                        const wins = data[n] || 0;
                        return `<span class="h2h-name">${n}: ${wins}</span>`;
                    }).join(' — ');
                    return `<div class="h2h-row">${parts} <span class="h2h-draws">(${data.draws}D / ${data.total})</span></div>`;
                }).join('');
            }
        }

        // Matchup matrix
        const matchupCanvas = document.getElementById('matchupCanvas');
        if (matchupCanvas) {
            this.resizeCanvas('matchupCanvas', 400, 200);
            const matrix = ts.getMatchupMatrix();
            const types = ['imp', 'bomber', 'scanner', 'replicator', 'vampire'];
            const items = [];
            for (const t1 of types) {
                let total = 0;
                for (const t2 of types) total += matrix[t1][t2];
                if (total > 0) {
                    items.push({
                        label: t1,
                        value: total,
                        valueLabel: `${total} wins`,
                        color: this.stratColor(t1)
                    });
                }
            }
            if (items.length) {
                this.chartRenderer.drawBarChart(matchupCanvas, items, { title: 'Strategy Win Counts' });
            }
        }

        // Total matches
        const totalEl = document.getElementById('totalMatches');
        if (totalEl) totalEl.textContent = `${ts.totalMatches} matches recorded`;
    }

    renderStrategyTab() {
        if (!this.lastResults || !this.lastClassifications.length) {
            const container = document.getElementById('strategyContent');
            if (container) container.innerHTML = '<div class="analytics-empty">Run a battle first to see strategy analysis</div>';
            return;
        }

        // Strategy cards with kill info
        const container = document.getElementById('strategyContent');
        if (container) {
            const r = this.lastResults;
            let html = '';
            this.lastWarriorNames.forEach((name, i) => {
                if (i >= this.lastClassifications.length) return;
                const c = this.lastClassifications[i];
                const color = WCOLORS[i % WCOLORS.length];
                // Find kill event for this warrior
                const killEvt = r.killEvents.find(e => e.victim === i);
                const alive = !killEvt;
                let statusHtml;
                if (alive) {
                    statusHtml = '<span class="strat-alive">SURVIVED</span>';
                } else {
                    const killerName = killEvt.killer >= 0 ? (this.lastWarriorNames[killEvt.killer] || '?') : 'self';
                    const kColor = killEvt.killer >= 0 ? WCOLORS[killEvt.killer % WCOLORS.length] : 'var(--text-ghost)';
                    statusHtml = `<span class="strat-dead">KILLED cycle ${killEvt.cycle} by <span style="color:${kColor}">${killerName}</span></span>`;
                }
                html += `<div class="strategy-card ${alive ? '' : 'strat-card-dead'}">
                    <div class="strat-header">
                        <span class="strat-wname" style="color:${color}">${name}</span>
                        <span class="strat-type-badge" style="background:${this.stratColor(c.type)}20;color:${this.stratColor(c.type)};border:1px solid ${this.stratColor(c.type)}40">${c.type.toUpperCase()}</span>
                        ${statusHtml}
                        <span class="strat-confidence">${Math.round(c.confidence * 100)}%</span>
                    </div>
                    <div class="strat-scores">${Object.entries(c.scores).map(([k, v]) =>
                        `<span class="strat-score-item">${k}: ${v.toFixed(1)}</span>`
                    ).join('')}</div>
                </div>`;
            });
            container.innerHTML = html;
        }

        // Radar chart
        const radarCanvas = document.getElementById('radarCanvas');
        if (radarCanvas && this.lastClassifications.length > 0) {
            this.resizeCanvas('radarCanvas', 300, 250);
            const labels = ['Offense', 'Defense', 'Speed', 'Territory', 'Resilience'];
            const datasets = this.lastClassifications.map((c, i) => ({
                data: [c.profile.offense, c.profile.defense, c.profile.speed, c.profile.territory, c.profile.resilience],
                color: WCOLORS[i % WCOLORS.length]
            }));
            this.chartRenderer.drawRadar(radarCanvas, datasets, labels, { title: 'Strength Profile' });
        }
    }

    stratColor(type) {
        const map = {
            imp: '#00e5ff', bomber: '#ff2d6a', scanner: '#ffb300',
            replicator: '#00ffc8', vampire: '#b388ff', unknown: '#6b7a90'
        };
        return map[type] || map.unknown;
    }

    resizeCanvas(id, defaultW, defaultH) {
        const canvas = document.getElementById(id);
        if (!canvas) return;
        const parent = canvas.parentElement;
        canvas.width = parent ? Math.min(parent.clientWidth - 4, defaultW * 2) : defaultW;
        canvas.height = defaultH;
    }

    reset() {
        this.lastResults = null;
        this.lastClassifications = [];
        this.lastWarriorNames = [];
    }
}

// Global
let analyticsDashboard;
