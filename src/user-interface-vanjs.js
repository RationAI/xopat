function initXopatUIVanJS(){
    console.log('initXopatUI')
    document.body.innerHTML = `
        <div id="xopat-ui">
            <h1>Xopat UI</h1>
            <button id="xopat-button">Click me</button>
        </div>
    `
    document.getElementById('xopat-button').addEventListener('click', () => {
        console.log('Button clicked')
    })
}