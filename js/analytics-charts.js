// === BATTLE ANALYTICS: CANVAS CHART RENDERER ===
// Pure canvas charts — no external dependencies

class ChartRenderer {
    constructor() {
        this.colors = WCOLORS;
        this.bgColor = '#0a0c14';
        this.gridColor = '#1e2738';
        this.textColor = '#6b7a90';
        this.brightText = '#c8d0dc';
    }

    // === LINE CHART ===
    drawLineChart(canvas, datasets, options = {}) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        const pad = { top: 20, right: 15, bottom: 30, left: 45 };
        const plotW = w - pad.left - pad.right;
        const plotH = h - pad.top - pad.bottom;

        ctx.fillStyle = this.bgColor;
        ctx.fillRect(0, 0, w, h);

        if (!datasets.length || !datasets[0].data.length) return;

        // Find range
        let maxY = 0;
        for (const ds of datasets) {
            for (const v of ds.data) if (v > maxY) maxY = v;
        }
        if (maxY === 0) maxY = 1;
        const maxX = datasets[0].data.length;

        // Grid lines
        ctx.strokeStyle = this.gridColor;
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = pad.top + plotH * (1 - i / 4);
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(pad.left + plotW, y);
            ctx.stroke();

            ctx.fillStyle = this.textColor;
            ctx.font = '9px Consolas, monospace';
            ctx.textAlign = 'right';
            ctx.fillText(Math.round(maxY * i / 4), pad.left - 4, y + 3);
        }

        // Title
        if (options.title) {
            ctx.fillStyle = this.brightText;
            ctx.font = 'bold 11px system-ui';
            ctx.textAlign = 'left';
            ctx.fillText(options.title, pad.left, 14);
        }

        // X-axis labels
        ctx.fillStyle = this.textColor;
        ctx.font = '9px Consolas, monospace';
        ctx.textAlign = 'center';
        if (options.xLabels) {
            const step = Math.max(1, Math.floor(options.xLabels.length / 6));
            for (let i = 0; i < options.xLabels.length; i += step) {
                const x = pad.left + (i / maxX) * plotW;
                ctx.fillText(options.xLabels[i], x, h - 6);
            }
        }

        // Draw lines
        for (const ds of datasets) {
            ctx.strokeStyle = ds.color || '#00ffc8';
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            for (let i = 0; i < ds.data.length; i++) {
                const x = pad.left + (i / maxX) * plotW;
                const y = pad.top + plotH * (1 - ds.data[i] / maxY);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Fill under line
            ctx.globalAlpha = 0.08;
            ctx.lineTo(pad.left + ((ds.data.length - 1) / maxX) * plotW, pad.top + plotH);
            ctx.lineTo(pad.left, pad.top + plotH);
            ctx.closePath();
            ctx.fillStyle = ds.color || '#00ffc8';
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    // === STACKED AREA CHART ===
    drawStackedArea(canvas, datasets, options = {}) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        const pad = { top: 20, right: 15, bottom: 30, left: 45 };
        const plotW = w - pad.left - pad.right;
        const plotH = h - pad.top - pad.bottom;

        ctx.fillStyle = this.bgColor;
        ctx.fillRect(0, 0, w, h);

        if (!datasets.length || !datasets[0].data.length) return;

        const len = datasets[0].data.length;
        // Calculate stacked totals
        const totals = new Array(len).fill(0);
        for (const ds of datasets) {
            for (let i = 0; i < len; i++) totals[i] += ds.data[i];
        }
        let maxY = Math.max(...totals, 1);

        // Title
        if (options.title) {
            ctx.fillStyle = this.brightText;
            ctx.font = 'bold 11px system-ui';
            ctx.textAlign = 'left';
            ctx.fillText(options.title, pad.left, 14);
        }

        // Grid
        ctx.strokeStyle = this.gridColor;
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = pad.top + plotH * (1 - i / 4);
            ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + plotW, y); ctx.stroke();
        }

        // Draw stacked areas (bottom to top)
        const cumulative = new Array(len).fill(0);
        for (let d = datasets.length - 1; d >= 0; d--) {
            const ds = datasets[d];
            ctx.fillStyle = ds.color || this.colors[d % this.colors.length];
            ctx.globalAlpha = 0.6;
            ctx.beginPath();

            // Top edge
            for (let i = 0; i < len; i++) {
                const x = pad.left + (i / len) * plotW;
                const y = pad.top + plotH * (1 - (cumulative[i] + ds.data[i]) / maxY);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            // Bottom edge (reverse)
            for (let i = len - 1; i >= 0; i--) {
                const x = pad.left + (i / len) * plotW;
                const y = pad.top + plotH * (1 - cumulative[i] / maxY);
                ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.fill();

            // Update cumulative
            for (let i = 0; i < len; i++) cumulative[i] += ds.data[i];
        }
        ctx.globalAlpha = 1;

        // X-axis labels
        if (options.xLabels) {
            ctx.fillStyle = this.textColor;
            ctx.font = '9px Consolas, monospace';
            ctx.textAlign = 'center';
            const step = Math.max(1, Math.floor(options.xLabels.length / 6));
            for (let i = 0; i < options.xLabels.length; i += step) {
                const x = pad.left + (i / len) * plotW;
                ctx.fillText(options.xLabels[i], x, h - 6);
            }
        }
    }

    // === HEATMAP ===
    drawHeatmap(canvas, data, coreSize, options = {}) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;

        ctx.fillStyle = this.bgColor;
        ctx.fillRect(0, 0, w, h);

        if (!data || data.length === 0) return;

        const cols = Math.ceil(Math.sqrt(coreSize * w / h));
        const rows = Math.ceil(coreSize / cols);
        const cellW = w / cols;
        const cellH = h / rows;

        let maxVal = 0;
        for (let i = 0; i < coreSize; i++) if (data[i] > maxVal) maxVal = data[i];
        if (maxVal === 0) return;

        for (let i = 0; i < coreSize; i++) {
            if (data[i] === 0) continue;
            const col = i % cols;
            const row = Math.floor(i / cols);
            const intensity = Math.min(1, data[i] / maxVal);

            // Hot colormap: black → blue → cyan → yellow → white
            let r, g, b;
            if (intensity < 0.25) {
                const t = intensity / 0.25;
                r = 0; g = 0; b = Math.floor(128 * t);
            } else if (intensity < 0.5) {
                const t = (intensity - 0.25) / 0.25;
                r = 0; g = Math.floor(255 * t); b = 128 + Math.floor(127 * (1 - t));
            } else if (intensity < 0.75) {
                const t = (intensity - 0.5) / 0.25;
                r = Math.floor(255 * t); g = 255; b = 0;
            } else {
                const t = (intensity - 0.75) / 0.25;
                r = 255; g = 255; b = Math.floor(255 * t);
            }

            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(col * cellW, row * cellH, Math.ceil(cellW), Math.ceil(cellH));
        }

        // Title overlay
        if (options.title) {
            ctx.fillStyle = 'rgba(10,12,20,0.7)';
            ctx.fillRect(0, 0, w, 20);
            ctx.fillStyle = this.brightText;
            ctx.font = 'bold 11px system-ui';
            ctx.textAlign = 'left';
            ctx.fillText(options.title, 6, 14);
        }
    }

    // === RADAR CHART ===
    drawRadar(canvas, datasets, labels, options = {}) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        const cx = w / 2, cy = h / 2 + 5;
        const r = Math.min(cx, cy) - 30;

        ctx.fillStyle = this.bgColor;
        ctx.fillRect(0, 0, w, h);

        const n = labels.length;
        const angleStep = (Math.PI * 2) / n;

        // Grid rings
        for (let ring = 1; ring <= 4; ring++) {
            ctx.strokeStyle = this.gridColor;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            for (let i = 0; i <= n; i++) {
                const a = -Math.PI / 2 + i * angleStep;
                const x = cx + Math.cos(a) * r * ring / 4;
                const y = cy + Math.sin(a) * r * ring / 4;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // Axes + labels
        ctx.fillStyle = this.textColor;
        ctx.font = '10px Consolas, monospace';
        ctx.textAlign = 'center';
        for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + i * angleStep;
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            ctx.strokeStyle = this.gridColor;
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();

            const lx = cx + Math.cos(a) * (r + 16);
            const ly = cy + Math.sin(a) * (r + 16);
            ctx.fillText(labels[i], lx, ly + 3);
        }

        // Data polygons
        for (const ds of datasets) {
            ctx.strokeStyle = ds.color || '#00ffc8';
            ctx.fillStyle = ds.color || '#00ffc8';
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            for (let i = 0; i <= n; i++) {
                const idx = i % n;
                const a = -Math.PI / 2 + idx * angleStep;
                const val = Math.min(1, Math.max(0, ds.data[idx]));
                const x = cx + Math.cos(a) * r * val;
                const y = cy + Math.sin(a) * r * val;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.globalAlpha = 0.15;
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        // Title
        if (options.title) {
            ctx.fillStyle = this.brightText;
            ctx.font = 'bold 11px system-ui';
            ctx.textAlign = 'center';
            ctx.fillText(options.title, cx, 14);
        }
    }

    // === HORIZONTAL BAR CHART ===
    drawBarChart(canvas, items, options = {}) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        const pad = { top: 20, right: 15, bottom: 10, left: 100 };

        ctx.fillStyle = this.bgColor;
        ctx.fillRect(0, 0, w, h);

        if (!items.length) return;

        const maxVal = Math.max(...items.map(i => i.value), 1);
        const barH = Math.min(24, (h - pad.top - pad.bottom) / items.length - 4);
        const plotW = w - pad.left - pad.right;

        // Title
        if (options.title) {
            ctx.fillStyle = this.brightText;
            ctx.font = 'bold 11px system-ui';
            ctx.textAlign = 'left';
            ctx.fillText(options.title, pad.left, 14);
        }

        items.forEach((item, i) => {
            const y = pad.top + i * (barH + 4);
            const barW = (item.value / maxVal) * plotW;

            // Label
            ctx.fillStyle = this.textColor;
            ctx.font = '10px Consolas, monospace';
            ctx.textAlign = 'right';
            ctx.fillText(item.label, pad.left - 6, y + barH / 2 + 3);

            // Bar
            ctx.fillStyle = item.color || '#00ffc8';
            ctx.globalAlpha = 0.8;
            ctx.fillRect(pad.left, y, barW, barH);
            ctx.globalAlpha = 1;

            // Value label
            ctx.fillStyle = this.brightText;
            ctx.font = '9px Consolas, monospace';
            ctx.textAlign = 'left';
            ctx.fillText(item.valueLabel || item.value, pad.left + barW + 4, y + barH / 2 + 3);
        });
    }
}
