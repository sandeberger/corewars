// === GLOBALS ===
let mars, visualizer, effectSystem, animationFrame, tournamentManager, parser;
let stats = { writes: 0, splits: 0 };

// === INIT ===
function init() {
    const cs=parseInt(document.getElementById('coreSizeInp').value)||8000;
    const mc=parseInt(document.getElementById('maxCyclesInp').value)||80000;
    const mp=parseInt(document.getElementById('maxProcsInp').value)||8000;
    mars=new MARS(cs,mc,mp); window.mars=mars;
    effectSystem=new EffectSystem('effectCanvas');
    visualizer=new Visualizer('coreCanvas');
    visualizer.resize(cs);
    parser=new Parser();
    tournamentManager=new TournamentManager();
    window.addEventListener('resize', () => { visualizer.resize(mars.coreSize); visualizer.draw(); });
    buildLibrary(); buildRefPanels(); updateSpeedDisplay();
    visualizer.draw(); loadLibraryWarrior(1);
    document.getElementById('coreSizeDisplay').textContent=cs;
    debuggerUI=new DebuggerUI();
    analyticsDashboard=new AnalyticsDashboard();
    analyticsDashboard.init();
    RedcodeHighlighter.init();
    log("CoreWar Arena ready \u2014 ICWS-94","info");
}

function extractWarriorName(code, fallback) {
    const nm = code.match(/;\s*name\s+(.+)/i);
    if (nm) return nm[1].trim().substring(0, 20);
    // Fallback: first comment that isn't a metadata directive
    const lines = code.split('\n');
    for (const line of lines) {
        const cm = line.match(/^\s*;\s*(.+)/);
        if (!cm) continue;
        const text = cm[1].trim();
        if (/^(redcode|author|name|assert|strategy|url|version|date)\b/i.test(text)) continue;
        return text.substring(0, 20);
    }
    return fallback;
}

// === PARSE / LOAD / RUN ===
function parseOnly() {
    const code=document.getElementById('editor').value;
    const r=parser.parse(code, mars.coreSize, mars.maxProcesses, mars.maxCycles);
    if(r.errors.length>0) { r.errors.forEach(e=>log(`Line ${e.line}: ${e.msg}`,"error")); document.getElementById('editorInfo').textContent=`${r.errors.length} error(s)`; }
    else { log(`\u2713 ${r.instructions.length} instructions valid`,"info"); document.getElementById('editorInfo').textContent=`${r.instructions.length} instr, offset ${r.startOffset}`; }
}

function loadFromEditor() {
    resetSim(); tournamentManager.active=false;
    const code=document.getElementById('editor').value;
    const parsed=parser.parse(code, mars.coreSize, mars.maxProcesses, mars.maxCycles);
    if(parsed.errors.length>0) parsed.errors.forEach(e=>log(`Line ${e.line}: ${e.msg}`,"error"));
    if(parsed.instructions.length===0) return log("No valid code","error");
    if(!parser.assertResult) return log("Assert failed — warrior incompatible with current settings","error");
    const name=extractWarriorName(code, "Player");
    mars.addWarrior(parsed, name);
    log(`Loaded "${name}" \u2014 ${parsed.instructions.length} instr`,"info");
    document.getElementById('editorInfo').textContent=`${parsed.instructions.length} instr`;
    visualizer.draw();
}

function runSim() {
    if(mars.isRunning) { mars.isRunning=false; document.getElementById('playIcon').className='fas fa-play'; document.getElementById('runBtn').classList.remove('running'); return; }
    mars.isRunning=true;
    document.getElementById('playIcon').className='fas fa-pause';
    document.getElementById('runBtn').classList.add('running');
    if(isMobile()) switchMobilePanel('panelCore');
    // Start analytics collector
    if(!mars.collector) mars.collector=new BattleCollector(mars.coreSize, mars.warriors.length);
    // Start debugger recording if active
    if(debuggerUI && debuggerUI.active && !debuggerUI.recorder) debuggerUI.startRecording();
    const loop = () => {
        if(!mars.isRunning) return;
        const speed=101-parseInt(document.getElementById('speedRange').value);
        const steps=Math.max(1, Math.ceil(2000/speed));
        for(let i=0;i<steps;i++) { mars.step(); if(!mars.isRunning) break; }
        visualizer.draw(); soundEngine.processFrame();
        if(mars.cycle%5===0) {
            document.getElementById('cycleCount').textContent=mars.cycle;
            document.getElementById('statCycles').textContent=mars.cycle;
            document.getElementById('statWrites').textContent=stats.writes;
            document.getElementById('statSplits').textContent=stats.splits;
            mars.updateLiveStatus();
        }
        animationFrame=requestAnimationFrame(loop);
    };
    loop();
}

function resetSim() {
    mars.isRunning=false;
    document.getElementById('playIcon').className='fas fa-play';
    document.getElementById('runBtn').classList.remove('running');
    cancelAnimationFrame(animationFrame);
    document.getElementById('floatingNextRound').style.display='none';
    if(debuggerUI) { debuggerUI.stopRecording(); debuggerUI.reset(); }
    mars.collector=null;
    mars.reset(); soundEngine.resetVoices(); visualizer.draw();
    ['cycleCount','statCycles','statWrites','statSplits'].forEach(id=>document.getElementById(id).textContent='0');
}

function restartSingleGame() { closeOverlay(); mars.restartGame(); runSim(); }

function toggleMode() {
    const tUI=document.getElementById('tournamentUI');
    const sC=document.getElementById('simControls');
    const isSimMode=tUI.style.display==='none';
    resetSim();
    if(isSimMode) {
        tUI.style.display='block'; sC.style.display='none';
        document.getElementById('addToTournamentBtn').style.display='inline-flex';
        document.getElementById('loadToSimBtn').style.display='none';
        document.getElementById('modeBtn').innerHTML='<i class="fas fa-code"></i> Simulator';
        document.getElementById('modeIndicator').textContent='TOURNAMENT';
        document.getElementById('modeIndicator').style.color='var(--accent-solar)';
    } else {
        tUI.style.display='none'; sC.style.display='block';
        document.getElementById('addToTournamentBtn').style.display='none';
        document.getElementById('loadToSimBtn').style.display='inline-flex';
        document.getElementById('modeBtn').innerHTML='<i class="fas fa-trophy"></i> Tournament';
        document.getElementById('modeIndicator').textContent='SIMULATOR';
        document.getElementById('modeIndicator').style.color='var(--text-muted)';
        tournamentManager.active=false;
    }
}

function updateSpeedDisplay() {
    const speed=101-parseInt(document.getElementById('speedRange').value);
    document.getElementById('speedDisplay').textContent=`~${Math.max(1, Math.ceil(2000/speed))} cycles/frame`;
}

// === EVENT BINDINGS ===
document.getElementById('loadToSimBtn').onclick = () => { loadFromEditor(); runSim(); };
document.getElementById('addToTournamentBtn').onclick = () => {
    const code=document.getElementById('editor').value;
    const parsed=parser.parse(code, mars.coreSize, mars.maxProcesses, mars.maxCycles);
    if(parsed.instructions.length===0) return log("No valid code","error");
    if(!parser.assertResult) return log("Assert failed — warrior incompatible with current settings","error");
    const name=extractWarriorName(code, `W${tournamentManager.queue.length+1}`);
    tournamentManager.add(name, parsed);
    log(`Added "${name}" to tournament`,"info");
};
document.getElementById('startTournamentBtn').onclick = () => tournamentManager.toggle();
document.getElementById('runBtn').onclick = () => { if(mars.warriors.length===0) loadFromEditor(); runSim(); };
document.getElementById('stepBtn').onclick = () => {
    if(mars.warriors.length===0) loadFromEditor();
    mars.step(); visualizer.draw(); soundEngine.processFrame();
    document.getElementById('cycleCount').textContent=mars.cycle; mars.updateLiveStatus();
};
document.getElementById('resetBtn').onclick = resetSim;
document.getElementById('speedRange').oninput = updateSpeedDisplay;

// === KEYBOARD SHORTCUTS ===
document.addEventListener('keydown', e => {
    const isInput = e.target.matches('input, textarea, select');
    if(isInput&&!e.ctrlKey&&!e.metaKey) return;
    if(e.key===' '&&!isInput) { e.preventDefault(); if(mars.warriors.length===0) loadFromEditor(); runSim(); }
    if(e.key==='s'&&!isInput) { e.preventDefault(); document.getElementById('stepBtn').click(); }
    if(e.key==='r'&&!isInput) { e.preventDefault(); resetSim(); }
    if(e.key==='v'&&!isInput) { e.preventDefault(); toggleVizMode(); }
    if(e.key==='m'&&!isInput) { e.preventDefault(); toggleSound(); }
    if((e.ctrlKey||e.metaKey)&&e.key==='Enter') { e.preventDefault(); loadFromEditor(); runSim(); }
    if(e.key==='d'&&!isInput) { e.preventDefault(); if(debuggerUI) debuggerUI.toggle(); }
    if(e.key==='ArrowLeft'&&!isInput&&debuggerUI&&debuggerUI.active) { e.preventDefault(); if(e.ctrlKey||e.metaKey) debuggerUI.jumpBack(); else debuggerUI.stepBack(); }
    if(e.key==='ArrowRight'&&!isInput&&debuggerUI&&debuggerUI.active) { e.preventDefault(); if(e.ctrlKey||e.metaKey) debuggerUI.jumpFwd(); else debuggerUI.stepFwd(); }
    if(e.key==='Home'&&!isInput&&debuggerUI&&debuggerUI.active) { e.preventDefault(); debuggerUI.goToStart(); }
    if(e.key==='End'&&!isInput&&debuggerUI&&debuggerUI.active) { e.preventDefault(); debuggerUI.goToEnd(); }
    if(e.key==='?'&&!isInput) showHelp();
    if(e.key==='Escape') { hideHelp(); closeOverlay(); if(debuggerUI&&debuggerUI.active) debuggerUI.deactivate(); }
});

document.getElementById('helpModal').addEventListener('click', e => {
    if(e.target===document.getElementById('helpModal')) hideHelp();
});

// === BOOT ===
init();
if(isMobile()) { switchMobilePanel('panelCore'); if(vizMode==='fancy') toggleVizMode(); }
