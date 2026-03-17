// === WARRIOR LIBRARY ===
const WARRIOR_LIBRARY = [
    { name:"Imp", strategy:"imp", desc:"Simplest — copies itself forward", code:"; Imp\nMOV.I 0, 1" },
    { name:"Dwarf", strategy:"bomber", desc:"Classic bomber — DAT bombs every 4", code:"; Dwarf — Bomber\nORG start\nstart: ADD.AB #4, 3\n       MOV.I  2, @2\n       JMP    start\n       DAT    #0, #0" },
    { name:"Mice", strategy:"scanner", desc:"Scanner — searches then attacks", code:"; Mice — Scanner\nORG start\nptr:   DAT.F  #0, #0\nstart: MOV.AB #12, ptr\nloop:  ADD.AB #4, ptr\n       JMZ.F  loop, @ptr\n       SLT.AB #10, ptr\n       MOV.AB #0, ptr\n       JMP    start\n       DAT    #0, #0" },
    { name:"Gemini", strategy:"replicator", desc:"Self-replicating warrior", code:"; Gemini — Replicator\nORG start\ndest:  DAT    #0, #0\nstart: MOV.I  0, 1\n       MOV.AB #99, dest\nloop:  MOV.I  }start, >dest\n       JMP    loop\n       DAT    #0, #0" },
    { name:"Chang1", strategy:"scanner", desc:"Scan-bomb hybrid", code:"; Chang1 — Scanner/Bomber\nORG start\nstart: ADD.F  #4, scan\nscan:  CMP.I  -100, -104\n       SLT.AB #20, scan\n       JMP    bomb\n       JMP    start\nbomb:  MOV.I  3, >scan\n       JMP    -1\n       DAT    #0, #0" },
    { name:"Paper", strategy:"replicator", desc:"Aggressive replicator — floods core with copies", code:"; Paper — Replicator\nORG start\nstart  SPL  0, 0\n       MOV.I 0, 2667" },
    { name:"Agony", strategy:"scanner", desc:"Championship scan-bomb", code:"; Agony — Champion\nORG start\nstart: ADD.F  #2667, 5\n       JMZ.F  start, @5\n       SLT.AB #20, 3\n       MOV.I  2, @3\n       JMP    start\n       DAT    #0, #0\n       SPL    #0, #0" },
    { name:"Imp Gate", strategy:"defense", desc:"Blocks imps with DAT wall", code:"; Imp Gate — Defense\nORG start\nstep EQU 4\ngate:  DAT    #0, #step\nstart: MOV.I  gate, @gate\n       ADD.AB #step, gate\n       JMP    start" },
    { name:"Vampire", strategy:"vampire", desc:"JMP traps capture enemy procs", code:"; Vampire\nORG start\nstep    EQU 753\nptr:    DAT  #0, #step\ntrap:   JMP  pit-ptr-step, 0\nstart:  MOV.I trap, @ptr\n        ADD.AB #step, ptr\n        SUB.A  #step, trap\n        JMP  start\npit:    JMP  0, 0" },
    { name:"SilkWarrior", strategy:"replicator", desc:"Split-bomber — grows and bombs", code:"; SilkWarrior — Split bomber\nORG start\nstart  SPL  1, 0\n       ADD.AB #2667, 3\n       MOV.I  2, @2\n       JMP    start\n       DAT    #0, #0" },
    { name:"Evolver", strategy:"pspace", desc:"P-Space strategy switcher", code:"; Evolver — P-Space\nLDP.AB #0, #0\nSNE.AB #0, #0\nJMP    strategy2\nMOV.I  0, 1\nSTP.AB #1, #0\nDAT    0, 0\nstrategy2:\nADD    #4, 3\nMOV    2, @2\nJMP    -2\nSTP.AB #1, #0\nDAT    0, 0" },
    { name:"Son of Vain", strategy:"qscan", desc:"Championship qscan/stone/clear/imp — Oversby/Pihlaja", code:";redcode-94nop\n;name Son of Vain\n;author Oversby/Pihlaja\n;strategy qscan -> stone/imp\n;assert 1\nload0 z for 0\n        rof\n\nofs equ (-2)\n\nstep    equ     6457\nhop     equ     3643\ndbofs   equ     9\ntgt     equ     2\ntime    equ     2293\nsdist   equ     (2599+ofs)\n\ndgate   equ     (dclr-9)\ndwipeofs equ    (-947)\nddist   equ     (7328+ofs)\ndmopa   equ     <2667\n\nldist   equ     (7426+ofs)\nldecoy  equ     (5956+ofs)\nidist   equ     (7471+ofs)\n\na1      equ     3922\na2      equ     1999\nb1      equ     609\nb2      equ     6686\nb3      equ     4763\nc2      equ     2149\nd       equ     5014\n\nqrep    equ     13\nqinc1   equ     7\nqhop    equ     60\n\nboot    spl     misc    ,       >b1\nt2      spl     1       ,       >b2\n        spl     1       ,       >b3\n        mov     <dsrc   ,       <ddst\n        mov     <ssrc   ,       {sdst\n        mov     <lsrc   ,       {ldst\nsdst ddst spl   load0+sdist+4,  load0+ddist+4\nldst    jmp     load0+ldist+4,  <chk_flag\n\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n\nlsrc\nspin    spl     #1      ,       4\n        add.a   #2667   ,       1\n        djn.f   spin+idist-ldist-1-2667,<spin-ldist+ldecoy\n        dat     0       ,       0\n\n        dat     0,0\n        dat     0,0\nt3      dat.a   qhop    ,       c2\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n\nimp     mov.i   #10     ,       2667\ndb      dat.a   >hop    ,       >1\ndmop    dat.a   dmopa   ,       dclr+8-dgate\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\ndsrc\ndclr    spl     #0      ,       4\n        spl     #0      ,       {dgate\n        mov     dgate+2 ,       >dgate\n        djn.f   -1      ,       >dgate\n\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n\nqscan   seq     qb + d  ,       qb + d + b2\n        jmp     q1\n\n        sne     qb + d * a1,    qb + d * a1 + b2\n        seq     <t1-1   ,       qb + d * (a1-1) + b2\n        djn.a   q0      ,       {q0\n\n        sne     qb + d * a2,    qb + d * a2 + b2\n        seq     <t1     ,       qb + d * (a2-1) + b2\n        jmp     q0      ,       {q0\n\n        sne     qb + d * b1,    qb + d * b1 + b1\n        seq     <t2-1   ,       qb + d * (b1-1) + (b1-1)\n        jmp     q0      ,       {q2\n\n        sne     qb + d * b3,    qb + d * b3 + b3\n        seq     <t2+1   ,       qb + d * (b3-1) + (b3-1)\n        jmp     q0      ,       }q2\n\n        seq     qb + d * (b1-2),qb + d * (b1-2) + (b1-2)\n        djn     q0      ,       {q2\n\n        sne     qb + d * c2,    qb + d * c2 + b2\n        seq     <t3     ,       qb + d * (c2-1) + b2\n        jmp     q0      ,       }q0\n\n        sne     qb + d * b2,    qb + d * b2 + b2\n        seq     <t2     ,       qb + d * (b2-1) + (b2-1)\n\n        jmp     q0      ,       >a1\nt1      jmp     boot    ,       >a2\n\nspl0\nssrc\nst      spl     0       ,       4\n        mov     -1+dbofs,       @2\n        add     #step   ,       @-1\n        djn.a   @-1     ,       *st+(tgt-hop)-(step*time)\n\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n        dat     0,0\n\nbmbdist equ     (sdist+dbofs)\ngatedist equ    (ddist+dgate-dclr)\nwipedist equ    (sdist+dwipeofs-ddist+dclr-dgate)\n\nmisc    mov     imp     ,       load0+idist\n        mov     db      ,       load0+bmbdist\npmop    mov     dmop    ,       load0+gatedist+2\n        mov     spl0    ,       {sdst\n        mov     dmop    ,       <pmop\n        mov.x   #wipedist,      <pmop\n        spl     @ddst\nchk_flag djn.a  dclr+1  ,       *ldst+4\n        dat     0,0\n\nq0      mul.b   *2      ,       qb\nq1      sne     {t1     ,       @qb\nq2      add.b   t2      ,       qb\n        mov     t3      ,       @qb\nqb      mov     t3      ,       *d\n        sub     #qinc1  ,       qb\n        djn     -3      ,       #qrep\n        jmp     boot\n\n        end     qscan" },
];

const STRATS = {
    imp:{bg:'#1a3a0a',text:'#76ff03',label:'IMP'},
    bomber:{bg:'#3a2000',text:'#ff6d00',label:'BOMBER'},
    scanner:{bg:'#002a3a',text:'#00e5ff',label:'SCANNER'},
    replicator:{bg:'#2a0040',text:'#e040fb',label:'REPLICATOR'},
    vampire:{bg:'#3a0a0a',text:'#ff2d6a',label:'VAMPIRE'},
    defense:{bg:'#0a2a20',text:'#00ffc8',label:'DEFENSE'},
    pspace:{bg:'#1a1a2a',text:'#78909c',label:'P-SPACE'},
    qscan:{bg:'#2a1a00',text:'#ffd740',label:'QSCAN'}
};

// === LIBRARY STATE ===
let libFiltered = [];
let libActiveCategory = null;

function buildLibrary() {
    buildCategoryChips();
    buildFeatured();
    renderLibrary();
    bindLibraryEvents();
}

function getAllWarriors() {
    const catalog = (typeof WARRIOR_CATALOG !== 'undefined') ? WARRIOR_CATALOG : [];
    return catalog.length > 0 ? catalog : WARRIOR_LIBRARY.map(w => ({
        name: w.name, author: '', strategy: w.strategy, category: w.strategy,
        tags: [w.strategy], lines: w.code.split('\n').length, code: w.code, desc: w.desc
    }));
}

function buildCategoryChips() {
    const counts = {};
    getAllWarriors().forEach(w => {
        const cat = w.category || w.strategy || 'other';
        counts[cat] = (counts[cat] || 0) + 1;
    });
    const el = document.getElementById('categoryChips');
    const total = getAllWarriors().length;
    el.innerHTML = `<span class="category-chip active" data-cat="">All <span class="chip-count">${total}</span></span>` +
        Object.keys(counts).sort().map(c =>
            `<span class="category-chip" data-cat="${c}">${(STRATS[c] ? STRATS[c].label : c.toUpperCase())} <span class="chip-count">${counts[c]}</span></span>`
        ).join('');
}

function buildFeatured() {
    const row = document.getElementById('featuredRow');
    row.innerHTML = WARRIOR_LIBRARY.map((w, i) => {
        const s = STRATS[w.strategy] || STRATS.imp;
        return `<div class="featured-card" onclick="loadLibraryWarrior(${i})"><span class="fc-dot" style="background:${s.text}"></span><span class="fc-name">${w.name}</span></div>`;
    }).join('');
}

function renderLibrary() {
    const query = (document.getElementById('librarySearch').value || '').toLowerCase();
    const sortKey = document.getElementById('librarySort').value;
    const all = getAllWarriors();

    libFiltered = all.filter(w => {
        if (libActiveCategory && (w.category || w.strategy) !== libActiveCategory) return false;
        if (query) {
            return w.name.toLowerCase().includes(query) ||
                (w.author || '').toLowerCase().includes(query) ||
                (w.strategy || '').toLowerCase().includes(query) ||
                (w.category || '').toLowerCase().includes(query) ||
                (w.tags || []).some(t => t.toLowerCase().includes(query));
        }
        return true;
    });

    libFiltered.sort((a, b) => {
        if (sortKey === 'name') return a.name.localeCompare(b.name);
        if (sortKey === 'author') return (a.author || '').localeCompare(b.author || '');
        if (sortKey === 'lines') return (a.lines || 0) - (b.lines || 0);
        return 0;
    });

    document.getElementById('libraryCount').textContent = `${libFiltered.length} warriors`;

    const g = document.getElementById('libraryGrid');
    g.innerHTML = libFiltered.map((w, i) => {
        const cat = w.category || w.strategy || 'imp';
        const s = STRATS[cat] || STRATS.imp;
        const desc = w.author ? `by ${w.author}` : (w.desc || w.strategy || '');
        return `<div class="library-item" onclick="loadCatalogWarrior(${i})"><div class="icon" style="background:${s.bg};color:${s.text};"><i class="fas fa-robot"></i></div><div class="info"><div class="name">${w.name}</div><div class="desc">${desc}</div></div><span class="strat-badge" style="background:${s.bg};color:${s.text};">${s.label || cat.toUpperCase()}</span></div>`;
    }).join('');
}

function loadCatalogWarrior(i) {
    const w = libFiltered[i];
    if (!w) return;
    document.getElementById('editor').value = w.code;
    if (typeof RedcodeHighlighter !== 'undefined') RedcodeHighlighter.sync();
    document.querySelectorAll('.tab')[0].click();
    log(`Loaded "${w.name}"`, "info");
    document.querySelectorAll('.library-item').forEach((el, j) => el.classList.toggle('selected', j === i));
}

function loadLibraryWarrior(i) {
    document.getElementById('editor').value = WARRIOR_LIBRARY[i].code;
    if (typeof RedcodeHighlighter !== 'undefined') RedcodeHighlighter.sync();
    document.querySelectorAll('.tab')[0].click();
    log(`Loaded "${WARRIOR_LIBRARY[i].name}"`, "info");
    document.querySelectorAll('.library-item').forEach((el,j) => el.classList.remove('selected'));
}

function bindLibraryEvents() {
    const searchInput = document.getElementById('librarySearch');
    const clearBtn = document.getElementById('libSearchClear');

    searchInput.addEventListener('input', () => {
        clearBtn.style.display = searchInput.value ? '' : 'none';
        renderLibrary();
    });

    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.style.display = 'none';
        searchInput.focus();
        renderLibrary();
    });

    document.getElementById('librarySort').addEventListener('change', renderLibrary);

    document.getElementById('categoryChips').addEventListener('click', e => {
        const chip = e.target.closest('.category-chip');
        if (!chip) return;
        document.querySelectorAll('#categoryChips .category-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        libActiveCategory = chip.dataset.cat || null;
        renderLibrary();
    });

    document.getElementById('featuredToggle').addEventListener('click', () => {
        const row = document.getElementById('featuredRow');
        const chev = document.getElementById('featuredChevron');
        const hidden = row.style.display === 'none';
        row.style.display = hidden ? '' : 'none';
        chev.classList.toggle('collapsed', !hidden);
    });
}

function buildRefPanels() {
    document.getElementById('refGrid').innerHTML = OPCODE_REF.map(r=>`<div class="ref-item"><span class="op">${r.op}</span><span class="rdesc">${r.d}</span></div>`).join('');
    document.getElementById('addrRefGrid').innerHTML = ADDR_REF.map(r=>`<div class="ref-item"><span class="op">${r.s}</span><span class="rdesc">${r.d}</span></div>`).join('');
    document.getElementById('modRefGrid').innerHTML = MOD_REF.map(r=>`<div class="ref-item"><span class="op">${r.s}</span><span class="rdesc">${r.d}</span></div>`).join('');
}
