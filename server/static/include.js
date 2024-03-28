//from https://stackoverflow.com/questions/8988855/include-another-html-file-in-a-html-file
void function(script) {
    const { searchParams } = new URL(script.src);
    // todo creates two head tags :/
    fetch(searchParams.get('src')).then(r => r.text()).then(content => {
        document.body.outerHTML = content;
    }).catch(e =>
        document.body.outerHTML = `<span>Could not find the built static viewer file ${searchParams.get('src')}! Did you build the static viewer page with the grunt task?</span><br><code>${e}</code>`
    );
}(document.currentScript);
