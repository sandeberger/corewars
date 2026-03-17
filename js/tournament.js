// === TOURNAMENT MANAGER ===
class TournamentManager {
    constructor() {
        this.queue=[]; this.active=false; this.round=1;
        this.scores={}; this.history=[];
    }

    add(name, code) {
        this.queue.push({name, codeObj:code, pSpace:new Array(mars.pSpaceSize).fill(0)});
        if(!this.scores[name]) this.scores[name]={wins:0, draws:0, losses:0, points:0};
        this.renderList();
    }

    toggle() { if(this.active) this.stop(); else this.start(); }

    start() {
        if(this.queue.length<2) return log("Need \u22652 warriors","error");
        document.getElementById('startTournamentBtn').innerHTML='<i class="fas fa-stop"></i> Stop';
        document.getElementById('startTournamentBtn').className='btn btn-danger';
        this.active=true; this.round=1; this.scores={};
        this.queue.forEach(w => this.scores[w.name]={wins:0, draws:0, losses:0, points:0});
        this.history=[]; this.runRound();
    }

    stop() {
        document.getElementById('startTournamentBtn').innerHTML='<i class="fas fa-play"></i> Start Tournament';
        document.getElementById('startTournamentBtn').className='btn btn-primary';
        this.active=false;
        document.getElementById('floatingNextRound').style.display='none';
        resetSim(); log("Tournament stopped","warn");
    }

    runRound() {
        resetSim();
        log(`\uD83C\uDFC6 Round ${this.round}`,"info");
        this.queue.forEach(w => mars.addWarrior(w.codeObj, w.name, w.pSpace));
        runSim();
    }

    nextRound() {
        document.getElementById('floatingNextRound').style.display='none';
        const alive=mars.warriors.filter(w=>!w.dead);
        if(alive.length===1) {
            const wn=alive[0].name;
            this.scores[wn].wins++; this.scores[wn].points+=3;
            mars.warriors.filter(w=>w.dead).forEach(w => { if(this.scores[w.name]) this.scores[w.name].losses++; });
            this.history.push({round:this.round, result:wn});
        } else {
            this.queue.forEach(w => { if(this.scores[w.name]) { this.scores[w.name].draws++; this.scores[w.name].points+=1; } });
            this.history.push({round:this.round, result:'DRAW'});
        }
        this.renderScoreboard(); this.renderHistory();
        if(typeof analyticsDashboard!=='undefined'&&analyticsDashboard) analyticsDashboard.renderTournamentTab();
        closeOverlay(); this.round++; this.runRound();
    }

    renderList() {
        const l=document.getElementById('warriorList'); l.innerHTML='';
        this.queue.forEach((w,i) => {
            l.innerHTML+=`<div class="tourney-card"><span class="tname">${w.name}</span><span class="remove" onclick="tournamentManager.remove(${i})"><i class="fas fa-trash-alt"></i></span></div>`;
        });
    }

    renderScoreboard() {
        const sb=document.getElementById('scoreboard');
        const sorted=Object.entries(this.scores).sort((a,b)=>b[1].points-a[1].points);
        sb.innerHTML=sorted.map(([n,s])=>`<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;font-family:var(--font-mono);"><span>${n}</span><span style="color:var(--accent-cyber);">${s.points}p (${s.wins}W/${s.draws}D/${s.losses}L)</span></div>`).join('');
    }

    renderHistory() {
        const h=document.getElementById('matchHistory');
        h.innerHTML=this.history.slice(-10).reverse().map(m=>`<div class="match-entry"><span class="round-num">#${m.round}</span><span class="${m.result==='DRAW'?'draw':'winner'}">${m.result==='DRAW'?'Draw':m.result}</span></div>`).join('');
    }

    remove(idx) { this.queue.splice(idx,1); this.renderList(); }
}
