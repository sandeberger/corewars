// === SOUND ENGINE ===
let soundEnabled = false;

function toggleSound() {
    soundEnabled = !soundEnabled;
    const btn = document.getElementById('soundBtn');
    btn.querySelector('i').className = soundEnabled ? 'fas fa-volume-up' : 'fas fa-volume-mute';
    if(soundEnabled) { btn.classList.add('sound-on'); soundEngine.init(); log('\uD83D\uDD0A Sound ON','info'); }
    else { btn.classList.remove('sound-on'); soundEngine.stop(); log('\uD83D\uDD07 Sound OFF','info'); }
}

class SoundEngine {
    constructor() {
        this.ctx=null; this.proc=null; this.active=false;
        this.voices={};
        this.deathPhase=0; this.deathFreq=0; this.deathAmp=0; this.deathNoiseAmp=0;
        this.frameCounts={};
    }

    init() {
        if(this.ctx) { this.ctx.resume(); this.active=true; return; }
        this.ctx = new (window.AudioContext||window.webkitAudioContext)();
        const sr = this.ctx.sampleRate;
        this.proc = this.ctx.createScriptProcessor(2048, 0, 1);
        const self = this;
        this.proc.onaudioprocess = function(e) {
            const out = e.outputBuffer.getChannelData(0);
            const len = out.length;
            const fc = self.frameCounts; self.frameCounts = {};
            for(const [idStr, c] of Object.entries(fc)) {
                const id = parseInt(idStr);
                let v = self.voices[id];
                if(!v) {
                    const f = self.noteFreq(id);
                    v = {phase:0, freq:f, baseFreq:f,
                         amp:0, targetAmp:0,
                         filt:0, filtCut:0.02, targetFiltCut:0.02,
                         phase2:0, amp2:0, targetAmp2:0};
                    self.voices[id] = v;
                }
                const writeAct = Math.min(c.w || 0, 500);
                const splitAct = Math.min(c.s || 0, 200);
                const mathAct = Math.min(c.m || 0, 500);
                const totalAct = writeAct*2 + splitAct*4 + mathAct;
                v.targetAmp = Math.min(0.18, totalAct > 0 ? 0.02 + Math.log2(1+totalAct)*0.018 : 0);
                v.targetFiltCut = 0.01 + Math.min(0.45, writeAct * 0.001 + totalAct * 0.0003);
                v.targetAmp2 = splitAct > 0 ? Math.min(0.08, 0.01 + Math.log2(1+splitAct)*0.015) : 0;
            }
            for(let i=0; i<len; i++) {
                let sample = 0;
                for(const v of Object.values(self.voices)) {
                    v.amp += (v.targetAmp - v.amp) * 0.003;
                    v.filtCut += (v.targetFiltCut - v.filtCut) * 0.002;
                    v.amp2 += (v.targetAmp2 - v.amp2) * 0.003;
                    if(v.amp < 0.0005 && v.amp2 < 0.0005) continue;
                    v.phase += v.freq / sr;
                    if(v.phase >= 1) v.phase -= 1;
                    let saw = v.phase * 2 - 1;
                    v.filt += v.filtCut * (saw - v.filt);
                    sample += v.filt * v.amp;
                    if(v.amp2 > 0.0005) {
                        v.phase2 += (v.freq * 2.02) / sr;
                        if(v.phase2 >= 1) v.phase2 -= 1;
                        const sin2 = Math.sin(v.phase2 * 6.2832);
                        sample += sin2 * v.amp2;
                    }
                }
                if(self.deathAmp > 0.001) {
                    self.deathPhase += self.deathFreq / sr;
                    if(self.deathPhase >= 1) self.deathPhase -= 1;
                    sample += (self.deathPhase < 0.5 ? 0.2 : -0.2) * self.deathAmp;
                    self.deathFreq *= 0.9997;
                    self.deathAmp *= 0.9992;
                }
                if(self.deathNoiseAmp > 0.001) {
                    sample += (Math.random()*2-1) * self.deathNoiseAmp * 0.15;
                    self.deathNoiseAmp *= 0.9994;
                }
                if(sample > 0.5) sample = 0.5 + (sample-0.5)/(1+(sample-0.5)*4);
                else if(sample < -0.5) sample = -0.5 + (sample+0.5)/(1+(-sample-0.5)*4);
                out[i] = sample;
            }
            for(const [id, v] of Object.entries(self.voices)) {
                if(!fc[id]) {
                    v.targetAmp *= 0.85;
                    v.targetAmp2 *= 0.85;
                    v.targetFiltCut = 0.01;
                }
            }
        };
        this.proc.connect(this.ctx.destination);
        this.active=true;
    }

    stop() {
        if(!this.ctx) return;
        if(this.proc) { this.proc.disconnect(); this.proc=null; }
        this.voices={}; this.ctx.suspend(); this.active=false;
    }

    resetVoices() { this.voices={}; this.frameCounts={}; this.deathAmp=0; this.deathNoiseAmp=0; }

    noteFreq(id) { return [130.8, 164.8, 196.0, 220.0, 261.6, 329.6, 392.0, 440.0][id % 8]; }

    emit(type, warriorId) {
        if(!this.active) return;
        let c = this.frameCounts[warriorId];
        if(!c) { c={w:0,s:0,j:0,m:0,d:0}; this.frameCounts[warriorId]=c; }
        if(type==='w') c.w++;
        else if(type==='s') c.s++;
        else if(type==='j') c.j++;
        else if(type==='m') c.m++;
        else if(type==='d') {
            this.deathFreq = this.noteFreq(warriorId) * 2;
            this.deathAmp = 0.8;
            this.deathNoiseAmp = 0.8;
            this.deathPhase = 0;
            const v = this.voices[warriorId];
            if(v) { v.targetAmp=0; v.targetAmp2=0; v.targetFiltCut=0.01; }
        }
    }

    processFrame() {}
}

const soundEngine = new SoundEngine();
