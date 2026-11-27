export class History {
  constructor({ limit = 300, maxBytes = 96 * 1024 * 1024 } = {}) {
    this.limit = limit;
    this.maxBytes = maxBytes;
    this.past = [];
    this.future = [];
    this.bytes = 0;
  }

  static size(entry) {
    return (entry.before.length + entry.after.length) * 2;
  }

  push(label, before, after) {
    if (before === after) return false;
    const entry = { label, before, after, time: Date.now() };
    this.past.push(entry);
    this.bytes += History.size(entry);
    for (const dropped of this.future) this.bytes -= History.size(dropped);
    this.future = [];
    while (this.past.length > 1 && (this.past.length > this.limit || this.bytes > this.maxBytes)) {
      this.bytes -= History.size(this.past.shift());
    }
    return true;
  }

  undo() {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push(entry);
    return { snapshot: entry.before, label: entry.label };
  }

  redo() {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push(entry);
    return { snapshot: entry.after, label: entry.label };
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  get undoLabel() {
    return this.past[this.past.length - 1]?.label || '';
  }

  get redoLabel() {
    return this.future[this.future.length - 1]?.label || '';
  }

  clear() {
    this.past = [];
    this.future = [];
    this.bytes = 0;
  }
}
