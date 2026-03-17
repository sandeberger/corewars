// === REDCODE SYNTAX HIGHLIGHTING ===
// Overlay-based highlighter: textarea handles input, <pre> shows colored output

const RedcodeHighlighter = (() => {
    const OPCODES = /\b(DAT|MOV|ADD|SUB|MUL|DIV|MOD|JMP|JMZ|JMN|DJN|SPL|SLT|CMP|SEQ|SNE|LDP|STP|NOP)\b/i;
    const DIRECTIVES = /\b(ORG|END|EQU|FOR|ROF|PIN)\b/i;
    const MODIFIER = /\.(A|B|AB|BA|F|X|I)\b/i;

    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function highlightLine(line) {
        // Check for comment
        const semi = line.indexOf(';');
        let code = semi >= 0 ? line.substring(0, semi) : line;
        let comment = semi >= 0 ? line.substring(semi) : '';

        // Highlight comment
        let commentHtml = '';
        if (comment) {
            // Check for metadata directives in comment
            if (/^;\s*(name|author|assert|strategy|redcode|url|version|date)\b/i.test(comment)) {
                commentHtml = `<span class="hl-meta">${escapeHtml(comment)}</span>`;
            } else {
                commentHtml = `<span class="hl-comment">${escapeHtml(comment)}</span>`;
            }
        }

        if (!code.trim()) return escapeHtml(code) + commentHtml;

        // Tokenize code part
        let result = '';
        let i = 0;
        const len = code.length;

        while (i < len) {
            // Skip whitespace
            if (code[i] === ' ' || code[i] === '\t') {
                let ws = '';
                while (i < len && (code[i] === ' ' || code[i] === '\t')) { ws += code[i]; i++; }
                result += ws;
                continue;
            }

            // Colon (label separator)
            if (code[i] === ':') {
                result += ':';
                i++;
                continue;
            }

            // Addressing mode characters
            if ('#$@*'.includes(code[i]) || (code[i] === '<' || code[i] === '>' || code[i] === '{' || code[i] === '}')) {
                result += `<span class="hl-mode">${escapeHtml(code[i])}</span>`;
                i++;
                continue;
            }

            // Comma
            if (code[i] === ',') {
                result += ',';
                i++;
                continue;
            }

            // Modifier (.A, .B, .AB, etc.)
            if (code[i] === '.') {
                const rest = code.substring(i);
                const m = rest.match(/^(\.[A-Za-z]{1,2})\b/);
                if (m && MODIFIER.test(m[1])) {
                    result += `<span class="hl-modifier">${escapeHtml(m[1])}</span>`;
                    i += m[1].length;
                    continue;
                }
                result += '.';
                i++;
                continue;
            }

            // Numbers (including negative)
            if (code[i] === '-' || code[i] === '+' || (code[i] >= '0' && code[i] <= '9')) {
                let num = '';
                if (code[i] === '-' || code[i] === '+') { num += code[i]; i++; }
                while (i < len && code[i] >= '0' && code[i] <= '9') { num += code[i]; i++; }
                if (num.length > 0 && num !== '-' && num !== '+') {
                    result += `<span class="hl-number">${num}</span>`;
                } else {
                    result += escapeHtml(num);
                }
                continue;
            }

            // Words (opcodes, directives, labels)
            if ((code[i] >= 'A' && code[i] <= 'Z') || (code[i] >= 'a' && code[i] <= 'z') || code[i] === '_') {
                let word = '';
                while (i < len && /[A-Za-z0-9_]/.test(code[i])) { word += code[i]; i++; }

                if (OPCODES.test(word)) {
                    const cls = word.toUpperCase() === 'DAT' ? 'hl-dat' : 'hl-opcode';
                    result += `<span class="${cls}">${escapeHtml(word)}</span>`;
                } else if (DIRECTIVES.test(word)) {
                    result += `<span class="hl-directive">${escapeHtml(word)}</span>`;
                } else {
                    result += `<span class="hl-label">${escapeHtml(word)}</span>`;
                }
                continue;
            }

            // Anything else
            result += escapeHtml(code[i]);
            i++;
        }

        return result + commentHtml;
    }

    function highlight(text) {
        const lines = text.split('\n');
        return lines.map(highlightLine).join('\n');
    }

    let editor, pre, pending = false;

    function sync() {
        if (!editor || !pre) return;
        const code = pre.querySelector('code') || pre;
        code.innerHTML = highlight(editor.value) + '\n';
    }

    function scheduleSync() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; sync(); });
    }

    function syncScroll() {
        if (!editor || !pre) return;
        pre.scrollTop = editor.scrollTop;
        pre.scrollLeft = editor.scrollLeft;
    }

    function init() {
        editor = document.getElementById('editor');
        pre = document.getElementById('editorHighlight');
        if (!editor || !pre) return;

        editor.addEventListener('input', scheduleSync);
        editor.addEventListener('scroll', syncScroll);
        editor.addEventListener('keydown', e => {
            // Tab key inserts spaces instead of changing focus
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = editor.selectionStart;
                const end = editor.selectionEnd;
                editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
                editor.selectionStart = editor.selectionEnd = start + 4;
                scheduleSync();
            }
        });

        // Initial sync
        sync();
    }

    return { init, sync, highlight };
})();
