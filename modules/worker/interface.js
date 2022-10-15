window.PathopusWorker = class extends OpenSeadragon.EventSource {

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
     * @param {string} options.command global function or member function name
     * @param {string} options.commandContext name of a class/function to be instantiated if provided,
     *   the constructor is given context
     * @param {any} options.payload payload data
     * @param {any|undefined} options.context context data if necessary, given to the constructor if applicable
     * @param {boolean} options.reset optional, force reset the worker, default false
     * @param files at least one javascript file to execute
     */
    submit(options, ...files) {
        const onFinish = this.onFinish;
        const onFailure = this.onFailure;

        if (files.length < 1) {
            onFailure("No worker files submitted: exitting!");
            return;
        }

        options.workFiles = files;

        if (options.reset) {
            delete options.reset;
            delete this.worker;
        }

        try {
            if (window.Worker) {
                const rootPath = PathopusWorker.metadata.directory;

                if (!this.worker) {
                    this.worker = new Worker(`${rootPath}/worker.js`);
                    this.worker.onmessage = (e) => {
                        //todo implement ping progress support?
                        const data = e.data;
                        if (data.status === "success") {
                            onFinish(data);
                        } else {
                            onFailure(data);
                        }
                    };
                }
                this.worker.postMessage(options);

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