const fs = require('fs');
const path = require('path');

function canon(p, { cwd = process.cwd(), realpath = false } = {}) {
    if (!p) return '';
    // Resolve against cwd, collapse '..' and '.' and normalize slashes
    let r = path.resolve(cwd, p);
    if (realpath) {
        try { r = fs.realpathSync.native(r); } catch { /* ignore missing */ }
    }
    // On Windows, compare case-insensitively
    if (process.platform === 'win32') r = r.toLowerCase();
    // Use a single slash style for comparison across platforms
    return r.replace(/\\/g, '/');
}

function pathsEqual(a, b, opts) {
    return canon(a, opts) === canon(b, opts);
}

module.exports = { pathsEqual, canon };