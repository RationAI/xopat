/**
 * Minimal semver range matching for `include.json` `engines` declarations.
 *
 * Deliberately small: xOpat only needs to answer "may this element run against
 * this build of the app". Supported range syntax, space separated (all must hold):
 *   *                any version
 *   >=X.Y.Z  >X.Y.Z  <=X.Y.Z  <X.Y.Z  =X.Y.Z  X.Y.Z
 *   ^X.Y.Z           same major (or, below 1.0.0, same minor)
 *   ~X.Y.Z           same major and minor
 *   X.x  X.Y.x       wildcard tail (also `X`/`*` spellings) — same as ^X / ~X.Y
 * Missing parts default to 0, so `>=3` and `^3.1` are valid.
 *
 * Prerelease and build tags are ignored on BOTH sides: xOpat ships versions like
 * `3.0.0-beta.1` and `3.0.1-dev`, and strict semver ordering would place those
 * below `3.0.0`, failing `>=3.0.0` on every development and release-candidate
 * build. Ranges therefore compare release triples only.
 */

type Version = [number, number, number];

const VERSION_RE = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/;

/**
 * Parse the release triple of a version string, ignoring any prerelease/build tag.
 * @return the triple, or undefined if the value does not start with a number
 */
export function parseVersion(value: unknown): Version | undefined {
    const match = typeof value === "string" ? VERSION_RE.exec(value) : null;
    if (!match) return undefined;
    return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)];
}

/**
 * Compare two version strings by their release triple.
 * @return negative if a < b, 0 if equal, positive if a > b; NaN if either is unparsable
 */
export function compareVersions(a: string, b: string): number {
    const left = parseVersion(a), right = parseVersion(b);
    if (!left || !right) return NaN;
    return compareTriples(left, right);
}

function compareTriples([aMajor, aMinor, aPatch]: Version, [bMajor, bMinor, bPatch]: Version): number {
    return (aMajor - bMajor) || (aMinor - bMinor) || (aPatch - bPatch);
}

function matchesComparator(version: Version, comparator: string): boolean {
    const operator = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(comparator);
    if (!operator) return false;
    const bound = parseVersion(operator[2]);
    if (!bound) return false;

    const diff = compareTriples(version, bound);
    switch (operator[1]) {
        case ">=": return diff >= 0;
        case ">": return diff > 0;
        case "<=": return diff <= 0;
        case "<": return diff < 0;
        case "^": {
            //caret allows changes that do not modify the left-most non-zero part
            if (diff < 0) return false;
            if (bound[0] > 0) return version[0] === bound[0];
            if (bound[1] > 0) return version[0] === 0 && version[1] === bound[1];
            return version[0] === 0 && version[1] === 0 && version[2] === bound[2];
        }
        case "~": return diff >= 0 && version[0] === bound[0] && version[1] === bound[1];
        default: return diff === 0;
    }
}

/**
 * Test a version against a range.
 * @param version e.g. "3.0.0-beta.1" (the prerelease tag is ignored)
 * @param range e.g. ">=3.0.0 <4.0.0", "^3.1", "*"
 * @return true when the version satisfies every comparator in the range;
 *   false when it does not, or when either side cannot be parsed
 */
export function satisfies(version: string, range: string): boolean {
    if (typeof range !== "string") return false;
    const trimmed = range.trim();
    if (trimmed === "*" || trimmed === "") return true;

    const parsed = parseVersion(version);
    if (!parsed) return false;

    //">= 3.0.0" is written by humans too: glue a lone operator to its version
    const glued = trimmed.replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1");

    // "3.x" / "3.1.x" (and the .X / .* spellings) are what authors reach for.
    // Without this they would still PARSE — the version regex reads the leading
    // digits and ignores the rest — silently degrading to "=3.0.0" and refusing
    // every real build. Rewrite them to the caret/tilde they mean.
    const normalized = glued.replace(
        /(?<![\w.])(\d+)(?:\.(\d+))?\.[xX*](?![\w.])/g,
        (_m, major, minor) => (minor === undefined ? `^${major}` : `~${major}.${minor}`)
    );

    const comparators = normalized.split(/\s+/);
    return comparators.every(comparator => matchesComparator(parsed, comparator));
}
