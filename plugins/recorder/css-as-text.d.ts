declare module "*.css" {
    /** Provided by esbuild's `--loader:.css=text` build flag. */
    const css: string;
    export default css;
}
