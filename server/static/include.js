//from https://stackoverflow.com/questions/8988855/include-another-html-file-in-a-html-file
void function(script) {
    const { searchParams } = new URL(script.src);
    // todo creates two head tags :/
    fetch(searchParams.get('src')).then(r => r.text()).then(content => {
        document.body.outerHTML = content;
    }).catch(e => {
        // The success path above deliberately swaps in fetched markup - that is
        // what this include helper is for. The FAILURE path must not: it echoes
        // the requested path and the error text, so it is built from nodes with
        // textContent instead of concatenated into outerHTML.
        const msg = document.createElement("span");
        msg.textContent = `Could not find the built static viewer file ${searchParams.get('src')}! `
            + "Did you build the static viewer page with the grunt task?";
        const detail = document.createElement("code");
        detail.textContent = String(e);
        document.body.replaceChildren(msg, document.createElement("br"), detail);
    });
}(document.currentScript);
