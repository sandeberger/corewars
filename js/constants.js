// === OPCODES, MODIFIERS, ADDRESSING MODES ===
const OPCODES = {DAT:0,MOV:1,ADD:2,SUB:3,MUL:4,DIV:5,MOD:6,JMP:7,JMZ:8,JMN:9,DJN:10,SPL:11,SLT:12,CMP:13,SEQ:13,SNE:14,LDP:15,STP:16,NOP:17};
const MODIFIERS = {A:0,B:1,AB:2,BA:3,F:4,X:5,I:6};
const ADDR_MODES = {'#':0,'$':1,'@':2,'<':3,'>':4,'*':5,'{':6,'}':7};
const WCOLORS = ['#00ffc8','#ff2d6a','#ffb300','#7c4dff','#00e5ff','#ff6d00','#76ff03','#e040fb'];

// === REFERENCE DATA ===
const OPCODE_REF = [{op:'DAT',d:'Kill process'},{op:'MOV',d:'Copy A\u2192B'},{op:'ADD',d:'B+=A'},{op:'SUB',d:'B-=A'},{op:'MUL',d:'B*=A'},{op:'DIV',d:'B/=A'},{op:'MOD',d:'B%=A'},{op:'JMP',d:'Jump A'},{op:'JMZ',d:'Jump if B=0'},{op:'JMN',d:'Jump if B\u22600'},{op:'DJN',d:'B--, jmp\u22600'},{op:'SPL',d:'Fork at A'},{op:'SEQ',d:'Skip A=B'},{op:'SNE',d:'Skip A\u2260B'},{op:'SLT',d:'Skip A<B'},{op:'LDP',d:'Load PSpace'},{op:'STP',d:'Store PSpace'},{op:'NOP',d:'No-op'}];
const ADDR_REF = [{s:'#',d:'Immediate'},{s:'$',d:'Direct'},{s:'@',d:'B-Indirect'},{s:'<',d:'B-PreDec'},{s:'>',d:'B-PostInc'},{s:'*',d:'A-Indirect'},{s:'{',d:'A-PreDec'},{s:'}',d:'A-PostInc'}];
const MOD_REF = [{s:'.A',d:'A\u2192A'},{s:'.B',d:'B\u2192B'},{s:'.AB',d:'A\u2192B'},{s:'.BA',d:'B\u2192A'},{s:'.F',d:'Both'},{s:'.X',d:'Cross'},{s:'.I',d:'Whole'}];
