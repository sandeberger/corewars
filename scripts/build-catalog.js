#!/usr/bin/env node
// Reads all .red warrior files and generates js/warrior-catalog.js
const fs = require('fs');
const path = require('path');

const WARRIORS_DIR = path.join(__dirname, '..', 'test', 'warriors');
const OUTPUT = path.join(__dirname, '..', 'js', 'warrior-catalog.js');

const files = fs.readdirSync(WARRIORS_DIR).filter(f => f.endsWith('.red')).sort();

function classify(text, code) {
    const s = text.toLowerCase();
    const tags = [];
    if (/\bq[-]?scan|quickscan/.test(s)) tags.push('qscan');
    if (/\bvamp|fang|slaver|capture/.test(s)) tags.push('vampire');
    if (/\breplicat|paper(?!weight)|silk|\bflood/.test(s)) tags.push('replicator');
    if (/\bscann?e?r?\b|cmp.?scan|b-scan/.test(s)) tags.push('scanner');
    if (/\bstone\b|oneshot/.test(s)) tags.push('stone');
    if (/\bbomb(?:er|ing)?\b|\bdwarf\b|\bcarpet/.test(s)) tags.push('bomber');
    if (/\bimp(?:s|ire|ish)?\b/i.test(s) && !/anti.?imp/i.test(s)) tags.push('imp');
    if (/\bgate\b|\bclear\b|\bdefense\b|\banti\b|\bwipe/.test(s)) tags.push('defense');
    if (/\bp.?space|\bldp\b|\bstp\b|\bevol/.test(s)) tags.push('pspace');
    // Fallback: analyze code
    if (tags.length === 0) {
        const cl = code.toLowerCase();
        if (/\bspl\b/.test(cl) && /\bmov\b/.test(cl) && /2667|1334/.test(cl)) tags.push('replicator');
        else if (/\bcmp\b|\bseq\b|\bsne\b/.test(cl) && /\bjmp\b/.test(cl)) tags.push('scanner');
        else if (/\bmov\b.*@/.test(cl) && /\badd\b/.test(cl)) tags.push('bomber');
        else if (/\bspl\b.*0/.test(cl)) tags.push('replicator');
        else if (/\bmov\.i\s+[#$]?0\s*,\s*[#$]?1/i.test(cl)) tags.push('imp');
        else tags.push('other');
    }
    return { category: tags[0], tags };
}

const catalog = [];
const catCounts = {};

for (const file of files) {
    const code = fs.readFileSync(path.join(WARRIORS_DIR, file), 'utf8');
    const lines = code.split(/\r?\n/);

    let name = file.replace('.red', '');
    let author = '';
    const stratLines = [];

    for (const line of lines) {
        const m1 = line.match(/^;\s*name\s+(.+)/i);
        if (m1) name = m1[1].trim();
        const m2 = line.match(/^;\s*author\s+(.+)/i);
        if (m2) author = m2[1].trim();
        const m3 = line.match(/^;\s*strategy\s+(.+)/i);
        if (m3) stratLines.push(m3[1].trim());
    }

    const strategy = stratLines.join(' ');
    const searchText = [name, author, strategy].join(' ');
    const { category, tags } = classify(searchText, code);

    // Count non-comment, non-empty lines for size
    const instrCount = lines.filter(l => {
        const t = l.trim();
        return t && !t.startsWith(';') && !/^(END|ORG)\b/i.test(t);
    }).length;

    catCounts[category] = (catCounts[category] || 0) + 1;

    catalog.push({
        id: file.replace('.red', ''),
        file,
        name,
        author: author || 'Unknown',
        strategy,
        category,
        tags,
        lines: instrCount,
        code
    });
}

// Sort by name (case-insensitive)
catalog.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

// Generate JS
const js = `// Auto-generated warrior catalog — do not edit manually
// Generated: ${new Date().toISOString().split('T')[0]} by scripts/build-catalog.js
// Warriors: ${catalog.length}
const WARRIOR_CATALOG = ${JSON.stringify(catalog)};
`;

fs.writeFileSync(OUTPUT, js, 'utf8');

console.log(`Generated ${OUTPUT}`);
console.log(`Total warriors: ${catalog.length}`);
console.log('Categories:');
Object.entries(catCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}`);
});
