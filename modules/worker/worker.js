var window = self;

onmessage = function(e) {
    const data = e.data,
        payload = data.payload,
        workFiles = data.workFiles,
        commandContext = data.commandContext,
        command = data.command,
        context = data.context;

    let status, result;
    try {
        importScripts(...workFiles);
        const parser = commandContext ? new commandContext(context) : window;

        if (parser && parser[command]) {
            result = parser[command](payload, context);
            status = "success";
        } else {
            result = "Unknown command: " + command;
            status = "error";
        }
    } catch (e) {
        result = e;
        status = "error";
    }

    postMessage({
        status: status,
        payload: result
    });
}