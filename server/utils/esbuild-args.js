module.exports = [
    '--bundle',
    '--sourcemap',
    '--format=iife',
    '--platform=browser',
    '--main-fields=browser,module,main',
    '--conditions=browser,import',
    '--external:fs','--external:path','--external:os',
];