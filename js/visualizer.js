// === EFFECT SYSTEM ===
class EffectSystem {
    constructor(id) {
        this.canvas=document.getElementById(id);
        this.ctx=this.canvas.getContext('2d');
        this.particles=[];
    }

    resize(w, h) { this.canvas.width=w; this.canvas.height=h; }

    addWrite(x, y, color) {
        if(this.particles.length>200) return;
        this.particles.push({x, y, vx:(Math.random()-0.5)*3, vy:(Math.random()-0.5)*3, life:1, decay:0.05+Math.random()*0.03, color, size:2+Math.random()*2});
    }

    addDeath(x, y) {
        for(let i=0;i<8;i++) {
            const a=(i/8)*Math.PI*2, s=2+Math.random()*4;
            this.particles.push({x, y, vx:Math.cos(a)*s, vy:Math.sin(a)*s, life:1, decay:0.025+Math.random()*0.02, color:'#ff2d6a', size:2+Math.random()*3});
        }
    }

    update() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.particles=this.particles.filter(p => {
            p.x+=p.vx; p.y+=p.vy; p.vx*=0.94; p.vy*=0.94; p.life-=p.decay;
            if(p.life<=0) return false;
            this.ctx.globalAlpha=p.life*0.7;
            this.ctx.fillStyle=p.color;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size*p.life, 0, Math.PI*2);
            this.ctx.fill();
            return true;
        });
        this.ctx.globalAlpha=1;
    }
}

// === VISUALIZER ===
let vizMode = 'fancy';

function toggleVizMode() {
    vizMode = vizMode==='fancy' ? 'fast' : 'fancy';
    const btn=document.getElementById('vizModeBtn');
    const lbl=document.getElementById('vizModeLabel');
    const ec=document.getElementById('effectCanvas');
    if(vizMode==='fast') { btn.classList.add('fast-mode'); btn.title='Switch to Fancy Mode (V)'; ec.style.display='none'; lbl.classList.add('show'); }
    else { btn.classList.remove('fast-mode'); btn.title='Switch to Fast Mode (V)'; ec.style.display=''; lbl.classList.remove('show'); }
    if(visualizer) visualizer.draw();
    log(vizMode==='fast' ? '\u26A1 Fast mode \u2014 no effects' : '\u2728 Fancy mode \u2014 full effects', 'info');
}

class Visualizer {
    constructor(id) {
        this.canvas=document.getElementById(id);
        this.ctx=this.canvas.getContext('2d');
        this.zoomLevel=1; this.offsetX=0; this.offsetY=0;
        this.pulse=0; this.cellSize=4; this.cols=100;
        this.isDragging=false; this.lastMouse={x:0, y:0};

        this.canvas.addEventListener('mousemove', e=>this.handleHover(e));
        this.canvas.addEventListener('mouseout', ()=>document.getElementById('tooltip').style.display='none');
        this.canvas.addEventListener('click', e=>this.handleClick(e));
        this.canvas.addEventListener('mousedown', e => { this.isDragging=true; this.lastMouse={x:e.clientX, y:e.clientY}; });
        this.canvas.addEventListener('mousemove', e => {
            if(!this.isDragging) return;
            this.offsetX+=e.clientX-this.lastMouse.x;
            this.offsetY+=e.clientY-this.lastMouse.y;
            this.lastMouse={x:e.clientX, y:e.clientY};
        });
        window.addEventListener('mouseup', ()=>this.isDragging=false);
        this.canvas.addEventListener('wheel', e => {
            e.preventDefault();
            this.zoomLevel=Math.max(0.3, Math.min(5, this.zoomLevel*(e.deltaY<0?1.1:0.9)));
        }, {passive:false});

        // Touch support
        this.touchStart=null; this.pinchDist=0;
        this.canvas.addEventListener('touchstart', e => {
            if(e.touches.length===1) { this.isDragging=true; this.touchStart={x:e.touches[0].clientX, y:e.touches[0].clientY}; this.lastMouse={x:e.touches[0].clientX, y:e.touches[0].clientY}; }
            else if(e.touches.length===2) { this.isDragging=false; const dx=e.touches[0].clientX-e.touches[1].clientX, dy=e.touches[0].clientY-e.touches[1].clientY; this.pinchDist=Math.hypot(dx,dy); }
            e.preventDefault();
        }, {passive:false});
        this.canvas.addEventListener('touchmove', e => {
            if(e.touches.length===1&&this.isDragging) { this.offsetX+=e.touches[0].clientX-this.lastMouse.x; this.offsetY+=e.touches[0].clientY-this.lastMouse.y; this.lastMouse={x:e.touches[0].clientX, y:e.touches[0].clientY}; }
            else if(e.touches.length===2) { const dx=e.touches[0].clientX-e.touches[1].clientX, dy=e.touches[0].clientY-e.touches[1].clientY; const dist=Math.hypot(dx,dy); if(this.pinchDist>0) { const scale=dist/this.pinchDist; this.zoomLevel=Math.max(0.3, Math.min(5, this.zoomLevel*scale)); } this.pinchDist=dist; }
            e.preventDefault();
        }, {passive:false});
        this.canvas.addEventListener('touchend', e => { if(e.touches.length===0) { this.isDragging=false; this.pinchDist=0; } });
    }

    resize(cs) {
        const p=this.canvas.parentElement;
        this.canvas.width=p.clientWidth; this.canvas.height=p.clientHeight;
        effectSystem.resize(this.canvas.width, this.canvas.height);
        this.cellSize=Math.max(2, Math.floor(Math.sqrt((this.canvas.width*this.canvas.height)/cs)));
        this.cols=Math.floor(this.canvas.width/this.cellSize);
    }

    zoom(f) { this.zoomLevel=Math.max(0.3, Math.min(5, this.zoomLevel*f)); }
    resetView() { this.zoomLevel=1; this.offsetX=0; this.offsetY=0; }

    draw() {
        if(!mars) return;
        const core=mars.core, warriors=mars.warriors, ctx=this.ctx;
        const size=this.cellSize*this.zoomLevel, gap=size>6?1:0.5;
        ctx.fillStyle='#050608'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        if(vizMode==='fast') this.drawFast(core, warriors, ctx, size, gap);
        else this.drawFancy(core, warriors, ctx, size, gap);
    }

    drawFast(core, warriors, ctx, size, gap) {
        for(let i=0;i<core.size;i++) {
            const instr=core.get(i);
            const x=(i%this.cols)*size+this.offsetX, y=Math.floor(i/this.cols)*size+this.offsetY;
            if(x<-size||y<-size||x>this.canvas.width||y>this.canvas.height) continue;
            if(instr.owner!==-1) { ctx.fillStyle=WCOLORS[instr.owner%WCOLORS.length]; ctx.fillRect(x,y,size-gap,size-gap); }
            else if(size>3) { ctx.fillStyle='#111820'; ctx.fillRect(x,y,size-gap,size-gap); }
        }
        warriors.forEach(w => {
            if(w.dead) return;
            ctx.fillStyle='#fff';
            const maxD=Math.min(w.tasks.length, 200);
            for(let i=0;i<maxD;i++) {
                const pc=w.tasks[i];
                const x=(pc%this.cols)*size+this.offsetX, y=Math.floor(pc/this.cols)*size+this.offsetY;
                if(x<-size||y<-size||x>this.canvas.width+size||y>this.canvas.height+size) continue;
                const m=size>5?2:1;
                ctx.fillRect(x+m, y+m, size-gap-m*2, size-gap-m*2);
            }
        });
    }

    drawFancy(core, warriors, ctx, size, gap) {
        for(let i=0;i<core.size;i++) {
            const instr=core.get(i);
            const x=(i%this.cols)*size+this.offsetX, y=Math.floor(i/this.cols)*size+this.offsetY;
            if(x<-size||y<-size||x>this.canvas.width||y>this.canvas.height) continue;
            if(instr.owner!==-1) {
                ctx.globalAlpha=Math.max(0.3, 1-instr.age*0.0003);
                ctx.fillStyle=WCOLORS[instr.owner%WCOLORS.length];
                ctx.fillRect(x,y,size-gap,size-gap); instr.age++;
            } else {
                ctx.globalAlpha=0.12; ctx.fillStyle='#1a2030';
                ctx.fillRect(x,y,size-gap,size-gap);
            }
        }
        ctx.globalAlpha=1; this.pulse=(this.pulse+0.15)%(Math.PI*2);
        const pv=Math.sin(this.pulse)*1.5;
        warriors.forEach(w => {
            if(w.dead) return;
            const color=WCOLORS[w.id%WCOLORS.length];
            ctx.fillStyle=color; ctx.strokeStyle='#fff'; ctx.lineWidth=1.5;
            ctx.shadowBlur=8; ctx.shadowColor=color;
            const maxD=Math.min(w.tasks.length, 200);
            for(let i=0;i<maxD;i++) {
                const pc=w.tasks[i];
                const x=(pc%this.cols)*size+this.offsetX+size/2, y=Math.floor(pc/this.cols)*size+this.offsetY+size/2;
                if(x<-size||y<-size||x>this.canvas.width+size||y>this.canvas.height+size) continue;
                const r=Math.max(2, size/2.2)+(i===0?pv:0);
                ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
                if(i===0) ctx.stroke();
            }
        });
        ctx.shadowBlur=0;
        const now=Date.now();
        mars.recentWrites=mars.recentWrites.filter(w=>now-w.time<200);
        for(let wi=0;wi<mars.recentWrites.length;wi+=3) {
            const w=mars.recentWrites[wi];
            const x=(w.pos%this.cols)*size+this.offsetX+size/2, y=Math.floor(w.pos/this.cols)*size+this.offsetY+size/2;
            effectSystem.addWrite(x,y, WCOLORS[w.id%WCOLORS.length]);
        }
        mars.recentDeaths=mars.recentDeaths.filter(d=>now-d.time<100);
        mars.recentDeaths.forEach(d => {
            const x=(d.pos%this.cols)*size+this.offsetX+size/2, y=Math.floor(d.pos/this.cols)*size+this.offsetY+size/2;
            effectSystem.addDeath(x,y);
        });
        effectSystem.update();
    }

    handleClick(e) {
        if(!mars||!mars.core||!debuggerUI||!debuggerUI.active) return;
        const r=this.canvas.getBoundingClientRect();
        const size=this.cellSize*this.zoomLevel;
        const col=Math.floor((e.clientX-r.left-this.offsetX)/size);
        const row=Math.floor((e.clientY-r.top-this.offsetY)/size);
        const idx=row*this.cols+col;
        if(idx>=0&&idx<mars.coreSize) debuggerUI.inspectCell(idx);
    }

    handleHover(e) {
        if(!mars||!mars.core||this.isDragging) return;
        const r=this.canvas.getBoundingClientRect();
        const size=this.cellSize*this.zoomLevel;
        const col=Math.floor((e.clientX-r.left-this.offsetX)/size);
        const row=Math.floor((e.clientY-r.top-this.offsetY)/size);
        const idx=row*this.cols+col;
        const tip=document.getElementById('tooltip');
        if(idx>=0&&idx<mars.coreSize) {
            const i=mars.core.get(idx);
            const op=Object.keys(OPCODES).find(k=>OPCODES[k]===i.op)||'?';
            const mod=Object.keys(MODIFIERS).find(k=>MODIFIERS[k]===i.mod)||'?';
            const am=Object.keys(ADDR_MODES).find(k=>ADDR_MODES[k]===i.aMode)||'$';
            const bm=Object.keys(ADDR_MODES).find(k=>ADDR_MODES[k]===i.bMode)||'$';
            const owner=i.owner===-1?'Empty':(mars.warriors[i.owner]?.name||'?');
            const oc=i.owner===-1?'var(--text-ghost)':WCOLORS[i.owner%WCOLORS.length];
            let procs=[];
            mars.warriors.forEach(w => { if(!w.dead&&w.tasks.includes(idx)) procs.push(w.name); });
            tip.innerHTML=`<div class="tip-addr">ADDR ${idx}</div><div class="tip-instr">${op}.${mod} ${am}${i.aVal}, ${bm}${i.bVal}</div><div class="tip-owner">Owner: <span style="color:${oc}">${owner}</span></div>${procs.length?`<div class="tip-proc">\u25B6 ${procs.join(', ')}</div>`:''}`;
            tip.style.display='block';
            let left=e.clientX+15, top=e.clientY+15;
            if(left+tip.offsetWidth>window.innerWidth) left=e.clientX-tip.offsetWidth-15;
            if(top+tip.offsetHeight>window.innerHeight) top=e.clientY-tip.offsetHeight-15;
            tip.style.left=left+'px'; tip.style.top=top+'px';
        } else tip.style.display='none';
    }
}
