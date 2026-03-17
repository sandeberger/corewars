// === CORE ENGINE: Instruction, Warrior, Core, Parser, MARS ===

class Instruction {
    constructor(op=0, mod=4, aMode=1, aVal=0, bMode=1, bVal=0) {
        this.op=op; this.mod=mod; this.aMode=aMode; this.aVal=aVal; this.bMode=bMode; this.bVal=bVal;
        this.owner=-1; this.age=0;
    }
    clone() {
        const c = new Instruction(this.op, this.mod, this.aMode, this.aVal, this.bMode, this.bVal);
        c.owner=this.owner; c.age=this.age; return c;
    }
}

class Warrior {
    constructor(id, name, code, startPos, pSpace=null, pSpaceSize=500) {
        this.id=id; this.name=name; this.code=code; this.tasks=[startPos];
        this.pSpace=pSpace||new Array(pSpaceSize).fill(0); this.dead=false;
    }
}

class Core {
    constructor(size) {
        this.size=size;
        this.memory=Array.from({length:size}, ()=>new Instruction(0,4,1,0,1,0));
    }
    get(addr) { return this.memory[((addr%this.size)+this.size)%this.size]; }
    set(addr, instr, ownerId) {
        const a=((addr%this.size)+this.size)%this.size;
        this.memory[a]=instr;
        if(ownerId!==-1) { this.memory[a].owner=ownerId; this.memory[a].age=1; }
    }
}

class Parser {
    constructor() { this.equConstants={}; this.equTexts={}; this.errors=[]; }

    preprocess(lines, maxLength=100) {
        let e=[], s=[];
        for(let l of lines) {
            let c=l.trim();
            let cNoComment=c.split(';')[0].replace(/\t/g, ' ').trim();
            let cu=cNoComment.toUpperCase();
            let forIdx=cu.search(/\bFOR\s+/);
            if(forIdx>=0) {
                let prefix=cNoComment.substring(0,forIdx).trim();
                let countStr=cNoComment.substring(forIdx+3).trim();
                // Last word before FOR is the counter variable (pMARS standard)
                const prefixWords=prefix.split(/\s+/).filter(w=>w);
                let counterVar=prefixWords.length>0?prefixWords[prefixWords.length-1].toUpperCase():null;
                // Push full prefix as a line for label definitions (preserve label-only lines)
                if(prefix) {
                    if(s.length>0) s[s.length-1].lines.push(prefix);
                    else e.push(prefix);
                }
                // Resolve CURLINE/MAXLENGTH in count expression
                let curLine=s.length>0?s[s.length-1].lines.length:(e.length);
                countStr=countStr.replace(/\bCURLINE\b/gi, String(curLine));
                countStr=countStr.replace(/\bMAXLENGTH\b/gi, String(maxLength));
                let count=0;
                try { count=Math.floor(Function('"use strict";return ('+countStr+')')())||0; } catch { count=parseInt(countStr)||0; }
                if(count<0) count=0;
                s.push({count, lines:[], counterVar});
            } else if(cu==='ROF'||cu.endsWith(' ROF')) {
                let b=s.pop();
                if(b) for(let i=0;i<b.count;i++) {
                    const expanded=b.lines.map(line => {
                        let out=line;
                        // Replace counter variable with current value (1-based)
                        if(b.counterVar) {
                            out=out.replace(new RegExp('\\b'+b.counterVar.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','gi'), String(i+1));
                        }
                        // Replace CURLINE with current output line count
                        const cl=s.length>0?s[s.length-1].lines.length:e.length;
                        out=out.replace(/\bCURLINE\b/gi, String(cl));
                        return out;
                    });
                    if(s.length>0) s[s.length-1].lines.push(...expanded);
                    else e.push(...expanded);
                }
            } else {
                if(s.length>0) s[s.length-1].lines.push(l);
                else e.push(l);
            }
        }
        return e;
    }

    parse(code, coreSize=8000, maxProcesses=8000, maxCycles=80000, maxLength=100) {
        this.errors=[]; this.equConstants={}; this.equTexts={};
        let rawLines=this.preprocess(code.split('\n'), maxLength);
        const instructions=[], labels={};
        let orgOffset=0, codeLines=[], lineIndex=0;
        const equDefs=[];
        // Collect ;assert directives before stripping comments
        this.assertResult=true;
        for(const rawLine of rawLines) {
            const am=rawLine.match(/;\s*assert\s+(.+)/i);
            if(am) {
                const expr=am[1].trim()
                    .replace(/\bCORESIZE\b/gi, String(coreSize))
                    .replace(/\bMAXPROCESSES\b/gi, String(maxProcesses))
                    .replace(/\bMAXCYCLES\b/gi, String(maxCycles))
                    .replace(/\bMAXLENGTH\b/gi, String(maxLength))
                    .replace(/\bMINDISTANCE\b/gi, String(Math.floor(coreSize/8)))
                    .replace(/\bVERSION\b/gi, '94')
                    .replace(/\bWARRIORS\b/gi, '2')
                    .replace(/\bPSPACESIZE\b/gi, String(Math.max(1,Math.floor(coreSize/16))));
                try {
                    if(!/[^0-9+\-*/%()&|!=<>\s]/.test(expr)) {
                        const result=Function('"use strict";return ('+expr+')')();
                        if(!result) { this.assertResult=false; this.errors.push({line:0, msg:`Assert failed: ${am[1].trim()}`}); }
                    }
                } catch(e) { /* ignore unparseable asserts */ }
            }
        }
        for(let rawLine of rawLines) {
            let line=rawLine.split(';')[0].replace(/\t/g, ' ').trim();
            if(!line) continue;
            let lineUpper=line.toUpperCase();
            while(line.includes(':')) {
                const ci=line.indexOf(':');
                const lbl=line.substring(0,ci).trim();
                if(lbl) labels[lbl]=lineIndex;
                line=line.substring(ci+1).trim();
                lineUpper=line.toUpperCase();
            }
            if(!line) continue;
            if(lineUpper.startsWith('ORG ')) { orgOffset=line.split(/\s+/)[1].trim(); continue; }
            if(lineUpper==='END'||lineUpper.startsWith('END ')) { const p=line.split(/\s+/); if(p.length>1) orgOffset=p[1].trim(); break; }
            if(lineUpper.includes(' EQU ')) {
                const eqIdx=lineUpper.indexOf(' EQU ');
                const beforeEqu=line.substring(0,eqIdx).trim();
                const afterEqu=line.substring(eqIdx+5).trim();
                const n=beforeEqu.split(/\s+/).pop();
                const prefixWords=beforeEqu.split(/\s+/);
                for(let i=0;i<prefixWords.length-1;i++) labels[prefixWords[i]]=lineIndex;
                const val=afterEqu;
                if(/^\s*[<>@#$*{}]|,\s*[<>@#$*{}]/.test(val)) {
                    this.equTexts[n]=val; labels[n]=0; this.equConstants[n]=true;
                } else {
                    equDefs.push({name:n, expr:val}); labels[n]=0; this.equConstants[n]=true;
                }
                continue;
            }
            if(lineUpper.startsWith('PIN ')) continue;
            let words=line.split(/\s+/);
            while(words.length>0) {
                const w0=words[0].split('.')[0].toUpperCase();
                if(OPCODES.hasOwnProperty(w0)||w0==='END'||w0==='ORG') break;
                labels[words[0]]=lineIndex;
                words=words.slice(1);
            }
            line=words.join(' ');
            if(!line) continue;
            lineUpper=line.toUpperCase();
            if(lineUpper==='END'||lineUpper.startsWith('END ')) { const p=line.split(/\s+/); if(p.length>1) orgOffset=p[1].trim(); break; }
            if(lineUpper.startsWith('ORG ')) { orgOffset=line.split(/\s+/)[1].trim(); continue; }
            codeLines.push({text:line, index:lineIndex, raw:rawLine});
            lineIndex++;
        }
        if(isNaN(orgOffset)&&labels[orgOffset]!==undefined) orgOffset=labels[orgOffset];
        else if(isNaN(orgOffset)) orgOffset=0;

        for(let pass=0;pass<10;pass++) {
            let changed=false;
            for(const eq of equDefs) {
                const val=this.evalMS(eq.expr, labels);
                if(labels[eq.name]!==val) { labels[eq.name]=val; changed=true; }
            }
            if(!changed) break;
        }

        // Determine which EQUs are ci-invariant (true constants).
        // EQUs like "span = labelA - labelB" (distance) ARE constants — labels cancel.
        // EQUs like "boot = go - const - 100" (position) are NOT — they shift with ci.
        // Test: evaluate with original labels vs labels with instruction indices shifted by 1.
        const shiftedLabels={...labels};
        for(const [name] of Object.entries(labels)) {
            if(!this.equConstants[name]) shiftedLabels[name]=labels[name]+1;
        }
        for(const eq of equDefs) {
            const valOrig=this.evalMS(eq.expr, labels);
            const valShifted=this.evalMS(eq.expr, shiftedLabels);
            if(valOrig!==valShifted) delete this.equConstants[eq.name];
        }

        if(typeof orgOffset==='string') {
            if(labels[orgOffset]!==undefined) orgOffset=labels[orgOffset];
            else if(isNaN(parseInt(orgOffset))) orgOffset=0;
        }

        for(let item of codeLines) {
            try {
                let text=item.text;
                for(let pass=0;pass<10;pass++) {
                    let changed=false;
                    for(const [n,v] of Object.entries(this.equTexts)) {
                        const re=new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'g');
                        if(re.test(text)) { text=text.replace(re, v); changed=true; }
                    }
                    if(!changed) break;
                }
                const p=text.match(/^([A-Za-z]{2,3})(?:\.([A-Za-z]{1,2}))?(?:\s+(.+?)(?:\s*,\s*(.+))?)?$/);
                if(!p) { if(text.toUpperCase()==='END') break; this.errors.push({line:item.index, msg:`Syntax: "${item.raw.trim()}"`}); continue; }
                const opStr=p[1].toUpperCase(), modStr=p[2]?p[2].toUpperCase():undefined, op=OPCODES[opStr];
                if(op===undefined) { this.errors.push({line:item.index, msg:`Unknown: ${opStr}`}); continue; }
                let aP, bP;
                if(p[3]&&!p[4]&&opStr==='DAT') {
                    // ICWS-94 §4.3: single-operand DAT puts operand in B, A defaults to $0
                    aP={mode:1, val:0};
                    bP=this.parseOp(p[3], labels, item.index, coreSize);
                } else {
                    aP=p[3]?this.parseOp(p[3], labels, item.index, coreSize):{mode:1, val:0};
                    bP=p[4]?this.parseOp(p[4], labels, item.index, coreSize):{mode:1, val:0};
                }
                let mod=modStr!==undefined?MODIFIERS[modStr]:this.defMod(opStr, aP.mode, bP.mode);
                if(mod===undefined) { this.errors.push({line:item.index, msg:`Bad modifier: .${modStr}`}); mod=4; }
                instructions.push(new Instruction(op, mod, aP.mode, aP.val, bP.mode, bP.val));
            } catch(e) { this.errors.push({line:item.index, msg:e.message}); }
        }
        return {instructions, startOffset:parseInt(orgOffset)||0, errors:this.errors};
    }

    evalMS(expr, labels) {
        let s=expr;
        for(let l in labels) s=s.replace(new RegExp(`\\b${l.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'g'), `(${labels[l]})`);
        try { if(/[^0-9+\-*/%()\s]/.test(s)) return 0; return Math.floor(Function('"use strict";return ('+s+')')()); } catch { return 0; }
    }

    evalM(expr, labels, ci, cs) {
        let s=expr;
        for(let l in labels) {
            const re=new RegExp(`\\b${l.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'g');
            if(s.match(re)) s=s.replace(re, this.equConstants[l]?`(${labels[l]})`:`(${labels[l]}-${ci})`);
        }
        try { if(/[^0-9+\-*/%()\s]/.test(s)) return 0; let r=Math.floor(Function('"use strict";return ('+s+')')()); return((r%cs)+cs)%cs; } catch { return 0; }
    }

    parseOp(str, labels, ci, cs) {
        if(!str) return {mode:1, val:0};
        str=str.trim(); let mode=ADDR_MODES[str[0]];
        let expr=(mode!==undefined)?str.substring(1):str;
        if(mode===undefined) mode=1;
        return {mode, val:this.evalM(expr, labels, ci, cs)};
    }

    defMod(op, aM, bM) {
        const aI=aM===0, bI=bM===0;
        switch(op) {
            case'DAT': return 4;
            case'MOV':case'SEQ':case'SNE':case'CMP': return (aI&&bI)?6:aI?2:bI?1:6;
            case'ADD':case'SUB':case'MUL':case'DIV':case'MOD': return (aI&&bI)?4:aI?2:bI?3:4;
            case'SLT': return aI?2:1;
            case'JMP':case'JMZ':case'JMN':case'DJN':case'SPL': return 1;
            case'STP':case'LDP': return aI?2:1;
            case'NOP': return 1;
            default: return 4;
        }
    }
}

class MARS {
    constructor(cs, mc, mp) {
        this.coreSize=cs; this.maxCycles=mc; this.maxProcesses=mp;
        this.pSpaceSize=Math.max(1, Math.floor(cs/16));
        this.core=new Core(cs); this.warriors=[]; this.cycle=0;
        this.activeWarriorIdx=0; this.isRunning=false;
        this.savedWarriorsData=[]; this.recentWrites=[]; this.recentDeaths=[];
    }

    wrap(v) { return ((v%this.coreSize)+this.coreSize)%this.coreSize; }

    addWarrior(codeObj, name, pSpace=null) {
        const id=this.warriors.length;
        this.savedWarriorsData.push({codeObj, name, pSpace});
        let sp;
        if(this.warriors.length===0) { sp=Math.floor(Math.random()*this.coreSize); }
        else {
            const seg=Math.floor(this.coreSize/(this.warriors.length+1));
            sp=seg*this.warriors.length;
            const minSep=Math.floor(this.coreSize/8);
            for(let a=0;a<20;a++) {
                let ok=true;
                for(const w of this.warriors) {
                    const d=Math.min(Math.abs(sp-w.tasks[0]), this.coreSize-Math.abs(sp-w.tasks[0]));
                    if(d<minSep) { sp=(sp+minSep)%this.coreSize; ok=false; break; }
                }
                if(ok) break;
            }
        }
        for(let i=0;i<codeObj.instructions.length;i++) {
            const instr=codeObj.instructions[i];
            this.core.set(sp+i, new Instruction(instr.op, instr.mod, instr.aMode, instr.aVal, instr.bMode, instr.bVal), id);
        }
        this.warriors.push(new Warrior(id, name, codeObj.instructions, (sp+codeObj.startOffset)%this.coreSize, pSpace, this.pSpaceSize));
        this.updateLiveStatus();
    }

    step() {
        if(!this.warriors.length) return;
        if(this.cycle>=this.maxCycles) { this.endGame("Draw — Max cycles"); return; }
        const alive=this.warriors.filter(w=>!w.dead);
        if(this.warriors.length>1&&alive.length<=1) { this.endGame(alive.length?`${alive[0].name} wins!`:"Mutual destruction"); return; }
        if(this.warriors.length===1&&alive.length===0) { this.endGame("Warrior died"); return; }
        const warrior=this.warriors[this.activeWarriorIdx];
        if(warrior.dead||warrior.tasks.length===0) {
            if(!warrior.dead) { warrior.dead=true; log(`\u2620 ${warrior.name} eliminated`,"error"); this.recentDeaths.push({pos:warrior.tasks[0]||0, id:warrior.id, time:Date.now()}); this.updateLiveStatus(); if(this.collector) { const ki=warrior._lastFatal; this.collector.recordKill(this.cycle, ki?ki.killerOwner:-1, warrior.id, ki?ki.pc:-1, ki?ki.instr:null); } }
            this.nextTurn(); return;
        }
        const pc=warrior.tasks.shift(); const instr=this.core.get(pc).clone();
        if(this.collector) this.collector.recordStep(this.cycle, this.activeWarriorIdx, pc, instr.op, alive.length);
        const ptrA=this.resolveAddress(pc, instr.aMode, instr.aVal);
        const ptrB=this.resolveAddress(pc, instr.bMode, instr.bVal);
        let nextPc=this.wrap(pc+1); let taskAlive=true;
        switch(instr.op) {
            case 0: taskAlive=false; soundEngine.emit('d',warrior.id); break;
            case 1: this.opMOV(instr,ptrA,ptrB,warrior.id); soundEngine.emit('w',warrior.id); break;
            case 2: this.opMath(instr,ptrA,ptrB,warrior.id,(a,b)=>this.wrap(a+b)); soundEngine.emit('m',warrior.id); break;
            case 3: this.opMath(instr,ptrA,ptrB,warrior.id,(a,b)=>this.wrap(b-a)); soundEngine.emit('m',warrior.id); break;
            case 4: this.opMath(instr,ptrA,ptrB,warrior.id,(a,b)=>this.wrap(a*b)); soundEngine.emit('m',warrior.id); break;
            case 5: taskAlive=this.opDivMod(instr,ptrA,ptrB,warrior.id,false); if(!taskAlive) soundEngine.emit('d',warrior.id); else soundEngine.emit('m',warrior.id); break;
            case 6: taskAlive=this.opDivMod(instr,ptrA,ptrB,warrior.id,true); if(!taskAlive) soundEngine.emit('d',warrior.id); else soundEngine.emit('m',warrior.id); break;
            case 7: nextPc=ptrA!==null?ptrA:pc; soundEngine.emit('j',warrior.id); break;
            case 8: if(this.checkZero(instr,ptrB)) nextPc=ptrA!==null?ptrA:pc; soundEngine.emit('j',warrior.id); break;
            case 9: if(!this.checkZero(instr,ptrB)) nextPc=ptrA!==null?ptrA:pc; soundEngine.emit('j',warrior.id); break;
            case 10: { const decP=ptrB!==null?ptrB:pc; this.opDec(instr,decP,warrior.id); if(!this.checkZero(instr,decP)) nextPc=ptrA!==null?ptrA:pc; soundEngine.emit('j',warrior.id); break; }
            case 11: {
                // ICWS-94: queue PC+1 (continuation) first, then target (new process)
                const splTgt=ptrA!==null?ptrA:pc;
                warrior.tasks.push(nextPc);
                if(warrior.tasks.length<this.maxProcesses) { warrior.tasks.push(splTgt); stats.splits++; soundEngine.emit('s',warrior.id); }
                taskAlive=false; // already pushed nextPc above
                break;
            }
            case 13: if(this.compare(instr,ptrA,ptrB)) nextPc=this.wrap(nextPc+1); soundEngine.emit('j',warrior.id); break;
            case 14: if(!this.compare(instr,ptrA,ptrB)) nextPc=this.wrap(nextPc+1); soundEngine.emit('j',warrior.id); break;
            case 12: if(this.checkLT(instr,ptrA,ptrB)) nextPc=this.wrap(nextPc+1); soundEngine.emit('j',warrior.id); break;
            case 16: this.opSTP(instr,ptrA,ptrB,warrior); break;
            case 15: this.opLDP(instr,ptrA,ptrB,warrior); break;
            case 17: break;
        }
        if(taskAlive) warrior.tasks.push(nextPc);
        else if(instr.op!==11) {
            // Task died (not SPL) — record what killed it
            const killerOwner=this.core.get(pc).owner;
            warrior._lastFatal={pc, instr, killerOwner, cycle:this.cycle};
        }
        this.nextTurn();
    }

    nextTurn() {
        do {
            this.activeWarriorIdx++;
            if(this.activeWarriorIdx>=this.warriors.length) { this.activeWarriorIdx=0; this.cycle++; }
        } while(this.warriors[this.activeWarriorIdx]?.dead && this.cycle<this.maxCycles);
    }

    resolveAddress(pc, mode, val) {
        const target=this.wrap(pc+val);
        if(mode===0) return null;
        if(mode===1) return target;
        const t=this.core.get(target);
        if(mode===5||mode===6||mode===7) {
            if(mode===6) { t.aVal=this.wrap(t.aVal-1); this.core.set(target,t,t.owner); }
            const r=this.wrap(target+t.aVal);
            if(mode===7) { t.aVal=this.wrap(t.aVal+1); this.core.set(target,t,t.owner); }
            return r;
        }
        if(mode===2||mode===3||mode===4) {
            if(mode===3) { t.bVal=this.wrap(t.bVal-1); this.core.set(target,t,t.owner); }
            const r=this.wrap(target+t.bVal);
            if(mode===4) { t.bVal=this.wrap(t.bVal+1); this.core.set(target,t,t.owner); }
            return r;
        }
        return target;
    }

    opMOV(instr, pA, pB, owner) {
        if(pB===null) return;
        const src=pA===null?instr:this.core.get(pA);
        const dest=this.core.get(pB).clone();
        switch(instr.mod) {
            case 0: dest.aVal=src.aVal; break;
            case 1: dest.bVal=src.bVal; break;
            case 2: dest.bVal=src.aVal; break;
            case 3: dest.aVal=src.bVal; break;
            case 4: dest.aVal=src.aVal; dest.bVal=src.bVal; break;
            case 5: dest.aVal=src.bVal; dest.bVal=src.aVal; break;
            case 6: dest.op=src.op; dest.mod=src.mod; dest.aMode=src.aMode; dest.aVal=src.aVal; dest.bMode=src.bMode; dest.bVal=src.bVal; break;
        }
        this.core.set(pB, dest, owner);
        this.recentWrites.push({pos:pB, id:owner, time:Date.now()});
        stats.writes++;
        if(this.collector) this.collector.recordWrite(pB, owner, this.coreSize);
    }

    opMath(instr, pA, pB, owner, fn) {
        if(pB===null) return;
        const src=pA===null?instr:this.core.get(pA);
        const dest=this.core.get(pB).clone();
        switch(instr.mod) {
            case 0: dest.aVal=fn(src.aVal,dest.aVal); break;
            case 1: dest.bVal=fn(src.bVal,dest.bVal); break;
            case 2: dest.bVal=fn(src.aVal,dest.bVal); break;
            case 3: dest.aVal=fn(src.bVal,dest.aVal); break;
            case 4: case 6: dest.aVal=fn(src.aVal,dest.aVal); dest.bVal=fn(src.bVal,dest.bVal); break;
            case 5: dest.aVal=fn(src.bVal,dest.aVal); dest.bVal=fn(src.aVal,dest.bVal); break;
        }
        this.core.set(pB, dest, owner); stats.writes++;
        if(this.collector) this.collector.recordWrite(pB, owner, this.coreSize);
    }

    opDivMod(instr, pA, pB, owner, isMod) {
        if(pB===null) return true;
        const src=pA===null?instr:this.core.get(pA);
        const dest=this.core.get(pB).clone();
        const fn=isMod?(a,b)=>a===0?null:b%a:(a,b)=>a===0?null:Math.floor(b/a);
        switch(instr.mod) {
            case 0: { const r=fn(src.aVal,dest.aVal); if(r===null) return false; dest.aVal=this.wrap(r); break; }
            case 1: { const r=fn(src.bVal,dest.bVal); if(r===null) return false; dest.bVal=this.wrap(r); break; }
            case 2: { const r=fn(src.aVal,dest.bVal); if(r===null) return false; dest.bVal=this.wrap(r); break; }
            case 3: { const r=fn(src.bVal,dest.aVal); if(r===null) return false; dest.aVal=this.wrap(r); break; }
            case 4: case 6: { const rA=fn(src.aVal,dest.aVal), rB=fn(src.bVal,dest.bVal); let die=false; if(rA!==null) dest.aVal=this.wrap(rA); else die=true; if(rB!==null) dest.bVal=this.wrap(rB); else die=true; this.core.set(pB,dest,owner); if(this.collector) this.collector.recordWrite(pB,owner,this.coreSize); return !die; }
            case 5: { const rA=fn(src.bVal,dest.aVal), rB=fn(src.aVal,dest.bVal); let die=false; if(rA!==null) dest.aVal=this.wrap(rA); else die=true; if(rB!==null) dest.bVal=this.wrap(rB); else die=true; this.core.set(pB,dest,owner); if(this.collector) this.collector.recordWrite(pB,owner,this.coreSize); return !die; }
        }
        this.core.set(pB, dest, owner); if(this.collector) this.collector.recordWrite(pB,owner,this.coreSize); return true;
    }

    opDec(instr, ptr, owner) {
        const d=ptr===null?instr:this.core.get(ptr).clone();
        switch(instr.mod) {
            case 0: d.aVal=this.wrap(d.aVal-1); break;
            case 1: d.bVal=this.wrap(d.bVal-1); break;
            case 2: d.bVal=this.wrap(d.bVal-1); break;
            case 3: d.aVal=this.wrap(d.aVal-1); break;
            case 4: case 5: case 6: d.aVal=this.wrap(d.aVal-1); d.bVal=this.wrap(d.bVal-1); break;
        }
        if(ptr!==null) this.core.set(ptr, d, d.owner);
    }

    checkZero(instr, ptr) {
        const t=ptr===null?instr:this.core.get(ptr);
        switch(instr.mod) {
            case 0: return t.aVal===0;
            case 1: return t.bVal===0;
            case 2: return t.bVal===0;
            case 3: return t.aVal===0;
            case 4: case 5: case 6: return t.aVal===0&&t.bVal===0;
        }
        return false;
    }

    compare(instr, pA, pB) {
        const a=pA===null?instr:this.core.get(pA);
        const b=pB===null?instr:this.core.get(pB);
        switch(instr.mod) {
            case 0: return a.aVal===b.aVal;
            case 1: return a.bVal===b.bVal;
            case 2: return a.aVal===b.bVal;
            case 3: return a.bVal===b.aVal;
            case 4: return a.aVal===b.aVal&&a.bVal===b.bVal;
            case 5: return a.aVal===b.bVal&&a.bVal===b.aVal;
            case 6: return a.op===b.op&&a.mod===b.mod&&a.aMode===b.aMode&&a.aVal===b.aVal&&a.bMode===b.bMode&&a.bVal===b.bVal;
        }
        return false;
    }

    checkLT(instr, pA, pB) {
        const a=pA===null?instr:this.core.get(pA);
        const b=pB===null?instr:this.core.get(pB);
        switch(instr.mod) {
            case 0: return a.aVal<b.aVal;
            case 1: return a.bVal<b.bVal;
            case 2: return a.aVal<b.bVal;
            case 3: return a.bVal<b.aVal;
            case 4: case 6: return a.aVal<b.aVal&&a.bVal<b.bVal;
            case 5: return a.aVal<b.bVal&&a.bVal<b.aVal;
        }
        return false;
    }

    opSTP(instr, pA, pB, w) {
        if(!w.pSpace||pB===null) return;
        const src=pA===null?instr:this.core.get(pA);
        const dest=this.core.get(pB);
        const ps=w.pSpace, psz=ps.length, wr=(v)=>((v%psz)+psz)%psz;
        switch(instr.mod) {
            case 0: ps[wr(dest.aVal)]=src.aVal; break;
            case 1: ps[wr(dest.bVal)]=src.bVal; break;
            case 2: ps[wr(dest.bVal)]=src.aVal; break;
            case 3: ps[wr(dest.aVal)]=src.bVal; break;
            case 4: case 6: ps[wr(dest.aVal)]=src.aVal; ps[wr(dest.bVal)]=src.bVal; break;
            case 5: ps[wr(dest.bVal)]=src.aVal; ps[wr(dest.aVal)]=src.bVal; break;
        }
    }

    opLDP(instr, pA, pB, w) {
        if(!w.pSpace||pB===null) return;
        const src=pA===null?instr:this.core.get(pA);
        const dest=this.core.get(pB).clone();
        const ps=w.pSpace, psz=ps.length, rd=(v)=>ps[((v%psz)+psz)%psz];
        switch(instr.mod) {
            case 0: dest.aVal=rd(src.aVal); break;
            case 1: dest.bVal=rd(src.bVal); break;
            case 2: dest.bVal=rd(src.aVal); break;
            case 3: dest.aVal=rd(src.bVal); break;
            case 4: case 6: dest.aVal=rd(src.aVal); dest.bVal=rd(src.bVal); break;
            case 5: dest.bVal=rd(src.aVal); dest.aVal=rd(src.bVal); break;
        }
        this.core.set(pB, dest, w.id);
    }

    endGame(reason) {
        this.isRunning=false;
        document.getElementById('playIcon').className='fas fa-play';
        document.getElementById('runBtn').classList.remove('running');
        this.updateLiveStatus();
        this.warriors.forEach(w => {
            if(w.pSpace) w.pSpace[0] = w.dead ? 0 : this.warriors.filter(x=>!x.dead).length;
        });
        document.getElementById('winnerName').innerText=reason;
        const isTourney=tournamentManager.active;
        document.getElementById('nextRoundBtn').style.display=isTourney?'inline-flex':'none';
        document.getElementById('restartBtn').style.display=isTourney?'none':'inline-flex';
        document.getElementById('gameOverOverlay').classList.add('visible');
        if(isMobile()) switchMobilePanel('panelCore');
        log(`\u2694 ${reason}`, "info");
        if(typeof analyticsDashboard!=='undefined'&&analyticsDashboard&&this.collector) analyticsDashboard.onBattleEnd(this.collector, this.warriors);
        if(typeof debuggerUI!=='undefined'&&debuggerUI&&debuggerUI.active&&debuggerUI.recorder) debuggerUI.enterPlaybackMode();
    }

    reset() {
        this.core=new Core(this.coreSize); this.warriors=[]; this.cycle=0;
        this.activeWarriorIdx=0; this.isRunning=false; this.savedWarriorsData=[];
        this.recentWrites=[]; this.recentDeaths=[];
        stats={writes:0, splits:0};
        this.updateLiveStatus();
        document.getElementById('gameOverOverlay').classList.remove('visible');
    }

    restartGame() {
        const c=[...this.savedWarriorsData];
        this.reset();
        c.forEach(d => this.addWarrior(d.codeObj, d.name, d.pSpace));
    }

    updateLiveStatus() {
        const list=document.getElementById('liveWarriorList');
        if(!list) return;
        list.innerHTML='';
        this.warriors.forEach(w => {
            const color=WCOLORS[w.id%WCOLORS.length];
            const cls=w.dead?'dead':'alive';
            list.innerHTML+=`<div class="warrior-card ${cls}"><div class="color-dot" style="background:${color};${w.dead?'':'box-shadow:0 0 8px '+color}"></div><div class="wc-info"><div class="wc-name" style="color:${color}">${w.name}</div><div class="wc-stats"><i class="fas ${w.dead?'fa-skull-crossbones':'fa-microchip'}"></i> ${w.dead?'DEAD':w.tasks.length+' proc'}</div></div><div class="wc-procs" style="color:${w.dead?'var(--accent-pulse)':color}">${w.dead?'\u2715':w.tasks.length}</div></div>`;
        });
        this.updateOwnershipBar();
    }

    updateOwnershipBar() {
        const bar=document.getElementById('coreOwnership');
        if(!bar||!this.warriors.length) return;
        const counts=new Array(this.warriors.length).fill(0);
        for(let i=0;i<this.coreSize;i++) {
            const o=this.core.get(i).owner;
            if(o>=0&&o<counts.length) counts[o]++;
        }
        bar.innerHTML='';
        counts.forEach((c,i) => {
            if(c>0) bar.innerHTML+=`<div class="segment" style="width:${c/this.coreSize*100}%;background:${WCOLORS[i%WCOLORS.length]};"></div>`;
        });
    }
}
