var window = self;

onmessage = function(e) {
    const data = e.data,
        payload = data.payload,
        workFiles = data.workFiles,
        commandContext = data.commandContext,
        command = data.command,
        context = data.context;

    let status = "error", result;
    try {
        if (command === "") {
            importScripts(...workFiles);
            status = "success";
        } else {
            const target = self[commandContext] ? new self[commandContext](context) : window;

            if (target && target[command]) {
                result = target[command](payload, context);
                status = "success";
            } else {
                result = "Unknown command: " + command;
            }
        }
    } catch (e) {
        result = e;
    }

    postMessage({
        status: status,
        payload: result
    });
}