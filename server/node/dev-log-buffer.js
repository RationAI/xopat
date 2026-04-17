"use strict";

const util = require("node:util");

const DEFAULT_MAX_ENTRIES = 1000;
const CAPTURED_LEVELS = ["debug", "info", "log", "warn", "error"];

function safeFormat(args) {
    try {
        return util.formatWithOptions(
            {
                colors: false,
                depth: 5,
                maxArrayLength: 100,
                maxStringLength: 20_000,
                breakLength: 120,
                compact: 3,
            },
            ...args
        );
    } catch {
        return args.map(arg => {
            if (typeof arg === "string") return arg;
            try {
                return JSON.stringify(arg);
            } catch {
                return String(arg);
            }
        }).join(" ");
    }
}

class DevLogBuffer {
    constructor(options = {}) {
        this.maxEntries = Math.max(10, Number(options.maxEntries) || DEFAULT_MAX_ENTRIES);
        this.entries = [];
        this.nextId = 1;
    }

    push(level, args, meta = {}) {
        const entry = {
            id: this.nextId++,
            level: String(level || "log").toLowerCase(),
            timestamp: new Date().toISOString(),
            message: safeFormat(Array.isArray(args) ? args : [args]),
        };

        if (meta.source) entry.source = meta.source;
        if (meta.context) entry.context = meta.context;
        if (meta.requestId) entry.requestId = meta.requestId;

        this.entries.push(entry);
        const overflow = this.entries.length - this.maxEntries;
        if (overflow > 0) {
            this.entries.splice(0, overflow);
        }
        return entry;
    }

    getEntries(query = {}) {
        const afterId = Number.isFinite(Number(query.afterId)) ? Number(query.afterId) : 0;
        const limit = Math.min(
            500,
            Math.max(1, Number.isFinite(Number(query.limit)) ? Number(query.limit) : 200)
        );
        const search = query.search ? String(query.search).toLowerCase() : "";
        const levels = normalizeLevels(query.level ?? query.levels);

        let filtered = this.entries.filter(entry => entry.id > afterId);

        if (levels && levels.size) {
            filtered = filtered.filter(entry => levels.has(entry.level));
        }

        if (search) {
            filtered = filtered.filter(entry => {
                return String(entry.message || "").toLowerCase().includes(search) ||
                    String(entry.context || "").toLowerCase().includes(search) ||
                    String(entry.source || "").toLowerCase().includes(search);
            });
        }

        const hasMore = filtered.length > limit;
        const entries = hasMore ? filtered.slice(filtered.length - limit) : filtered;
        const nextAfterId = this.entries.length ? this.entries[this.entries.length - 1].id : afterId;

        return {
            entries,
            nextAfterId,
            hasMore,
            totalBuffered: this.entries.length,
            maxEntries: this.maxEntries,
        };
    }
}

function normalizeLevels(value) {
    if (value === undefined || value === null || value === "") return null;
    const values = Array.isArray(value) ? value : [value];
    const normalized = values
        .flatMap(item => String(item).split(","))
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
    return normalized.length ? new Set(normalized) : null;
}

function installDevConsoleCapture(targetConsole = console, buffer, options = {}) {
    if (!buffer) return targetConsole;
    if (targetConsole.__xopatDevCaptureInstalled) return targetConsole;

    const originalMethods = Object.create(null);
    for (const level of CAPTURED_LEVELS) {
        originalMethods[level] = typeof targetConsole[level] === "function"
            ? targetConsole[level].bind(targetConsole)
            : (...args) => process.stdout.write(`${args.join(" ")}\n`);
    }

    for (const level of CAPTURED_LEVELS) {
        targetConsole[level] = (...args) => {
            try {
                buffer.push(level, args, { source: options.source || "console" });
            } catch {}
            return originalMethods[level](...args);
        };
    }

    Object.defineProperty(targetConsole, "__xopatDevCaptureInstalled", {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
    });

    return targetConsole;
}

module.exports = {
    DEFAULT_MAX_ENTRIES,
    CAPTURED_LEVELS,
    DevLogBuffer,
    installDevConsoleCapture,
};
