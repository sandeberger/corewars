// === UI HELPERS ===

function log(msg, type="neutral") {
    const c = document.getElementById('logContainer'), d = document.createElement('div');
    d.className = `log-entry ${type}`;
    d.textContent = `[${new Date().toLocaleTimeString('sv-SE',{hour12:false})}] ${msg}`;
    c.prepend(d);
    while (c.children.length > 200) c.lastChild.remove();
}

function clearLog() { document.getElementById('logContainer').innerHTML = ''; }
function showHelp() { document.getElementById('helpModal').classList.add('visible'); }
function hideHelp() { document.getElementById('helpModal').classList.remove('visible'); }

function closeOverlay() {
    document.getElementById('gameOverOverlay').classList.remove('visible');
    if(tournamentManager.active) document.getElementById('floatingNextRound').style.display='block';
}

// === TABS ===
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const paneId = tab.dataset.tab;
        if (!paneId) return;
        tab.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        tab.closest('.panel').querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        document.getElementById(paneId).classList.add('active');
    });
});

// === MOBILE NAV ===
function isMobile() { return window.innerWidth<=900; }

function switchMobilePanel(id) {
    document.querySelectorAll('.main > .panel').forEach(p => p.classList.remove('mobile-active'));
    document.getElementById(id)?.classList.add('mobile-active');
    document.querySelectorAll('.mnav-btn').forEach(b => b.classList.toggle('active', b.dataset.panel===id));
    if(id==='panelCore'&&visualizer&&mars) {
        setTimeout(() => { visualizer.resize(mars.coreSize); visualizer.draw(); }, 50);
    }
}

document.querySelectorAll('.mnav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchMobilePanel(btn.dataset.panel));
});

function handleResponsive() {
    if(isMobile()) {
        if(!document.querySelector('.main > .panel.mobile-active')) switchMobilePanel('panelCore');
        if(vizMode==='fancy') toggleVizMode();
    }
}

window.addEventListener('resize', handleResponsive);
