window.XOpatWorker = class extends OpenSeadragon.EventSource {

    /**
     * Callback handlers, if not provided, an event is emitted instead
     * @param onFinish
     * @param onFailure
     */
    constructor(onFinish, onFailure) {
        super();

        this.onFinish = onFinish ? onFinish : this.raiseEvent.bind(this, 'success');
        this.onFailure = onFailure ? onFailure : this.raiseEvent.bind(this, 'failure');
        this.worker = undefined;
    }

    /**
     * Submit a job into detached window
     * @param options
     * @param {string} options.command global function or member function name to execute
     * @param {string} options.commandContext name of a class/function to be instantiated; if provided,
     *   the command is invoked on the instance of this context, constructor is given options.context
     * @param {any} options.payload payload data
     * @param {any|undefined} options.context context data if necessary, given to the constructor if applicable
     * @param {boolean} options.reset optional, force reset the worker, default false
     * @param files at least one javascript file to execute
     */
    submit(options, ...files) {
        const onFinish = this.onFinish;
        const onFailure = this.onFailure;

        if (options.reset) {
            delete options.reset;
            delete this.worker;
        }

        try {
            if (window.Worker) {
                const rootPath = XOpatWorker.metadata.directory,
                    self = this;

                if (!this.worker) {
                    if (files.length < 1) {
                        onFailure({
                            status: "error",
                            error: "No worker files submitted: exiting!"
                        });
                        return;
                    }

                    this.worker = new Worker(`${rootPath}/worker.js`);

                    this.worker.onmessage = (e) => {
                        const data = e.data;
                        if (data.status === "success") {
                            //once files are loaded, set default handler and fire the job
                            self.worker.onmessage = (e) => {
                                //todo implement ping progress support?
                                const data = e.data;
                                (data.status === "success" ? onFinish : onFailure)(data);
                            };
                            self.worker.postMessage(options);
                        } else {
                            data.error = "Failed to load scripts!";
                            onFailure(data);
                        }
                    };
                    this.worker.postMessage({
                        command: "",
                        workFiles: files,
                    });

                } else {
                    this.worker.postMessage(options);
                }

                //todo timeout?
            } else {
                //todo fallback implementation?
                onFailure(data.payload);
            }
        } catch (e) {
            onFailure(e);
        }
    }
}