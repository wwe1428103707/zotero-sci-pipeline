const isTTY = process.stderr.isTTY;

export class ProgressBar {
  constructor(label, total = 100, width = 30) {
    this.label = label;
    this.total = total;
    this.width = width;
    this.current = 0;
    this.started = false;
    this.startTime = 0;
  }

  start() {
    this.started = true;
    this.startTime = Date.now();
    this.current = 0;
    this._render();
  }

  update(n) {
    this.current = Math.min(n, this.total);
    this._render();
  }

  increment(delta = 1) {
    this.current = Math.min(this.current + delta, this.total);
    this._render();
  }

  setLabel(label) {
    this.label = label;
    this._render();
  }

  complete() {
    this.current = this.total;
    this._render();
    if (isTTY) process.stderr.write("\n");
  }

  _render() {
    const pct = this.total > 0 ? Math.round((this.current / this.total) * 100) : 0;
    const filled = this.total > 0 ? Math.round((this.current / this.total) * this.width) : 0;
    const bar = "█".repeat(filled) + "░".repeat(this.width - filled);
    const elapsed = this.startTime ? ((Date.now() - this.startTime) / 1000).toFixed(1) : "0.0";
    const msg = `  ${this.label} [${bar}] ${pct}% (${this.current}/${this.total}) ${elapsed}s`;

    if (isTTY) {
      process.stderr.write(`\r${msg}`);
    } else {
      if (!this._lastLog || this.current === this.total || this.current % Math.max(1, Math.round(this.total / 5)) === 0) {
        process.stderr.write(`${msg}\n`);
        this._lastLog = this.current;
      }
    }
  }
}

export function stageHeader(name) {
  process.stderr.write(`\n── ${name} ${"─".repeat(Math.max(0, 60 - name.length))}\n`);
}

export function stageDone(name, detail = "") {
  const d = detail ? ` — ${detail}` : "";
  process.stderr.write(`  ✓ ${name}${d}\n`);
}

export function stageWarn(name, detail) {
  process.stderr.write(`  ⚠ ${name} — ${detail}\n`);
}

export function stageFail(name, detail) {
  process.stderr.write(`  ✗ ${name} — ${detail}\n`);
}
