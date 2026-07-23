/**
 * Questionnaire scripting namespace (`questionnaire`).
 *
 * Mirrors the annotations scripting pattern (modules/annotations/scripting/*.js):
 * a thin adapter over the plugin's public API that the host scripting layer and
 * LLM integrations (the vercel-ai-chat-sdk module) can call. The scripting
 * manager injects this namespace + the inline `.d.ts` below into the model
 * system prompt, so the type declarations are what teach the model the
 * questionnaire schema shape — keep them in sync with ../types.ts.
 *
 * No ES import crosses the plugin/module/core boundary: `ScriptingManager` and
 * `plugin()` are runtime globals (window.ScriptingManager / window.plugin).
 * The API class extends the runtime-global base `ScriptingManager.XOpatScriptingApi`.
 *
 * Registration happens post-bootstrap (plugins load on demand, after
 * ScriptingManager.initialize()); the manager's late-registration path ingests
 * the namespace so contexts created afterwards (e.g. the chat module) see it.
 */

/**
 * Inline TypeScript declarations describing the `questionnaire` namespace and
 * the schema shape. Parsed by ScriptingManager.parseDtsForApi; the interface
 * name must resolve from the namespace ("questionnaire" -> QuestionnaireScriptApi).
 */
const QUESTIONNAIRE_DTS = `
export type QuestionnaireOption = { value: string; label: string };

export type QuestionnaireValidation = {
    required?: boolean;
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    message?: string;
};

/**
 * One field/question. \`kind\` selects the input type. Choice kinds
 * ("select" | "multiselect" | "radio") use \`options\`; "matrix" uses
 * \`rows\`/\`columns\`; "repeat" nests \`elements\`; "content" is a static
 * header/text block (use \`text\`).
 */
export type QuestionnaireElement = {
    id?: string;
    kind:
        | "text" | "textarea" | "number" | "email" | "date" | "tel" | "url"
        | "select" | "multiselect" | "checkbox" | "radio" | "toggle"
        | "content" | "rating" | "file" | "repeat" | "matrix"
        | "measurement" | "roi";
    /** Stable machine field key (snake_case). Defaults from id when omitted. */
    name?: string;
    label?: string;
    description?: string;
    placeholder?: string;
    width?: "full" | "1/2";
    validation?: QuestionnaireValidation;
    /** For select | multiselect | radio. */
    options?: QuestionnaireOption[];
    /** For rating: number of stars. */
    maxRating?: number;
    /** For content: render as heading or paragraph. */
    variant?: "header" | "text";
    /** For content: plain text body. */
    text?: string;
    /** For matrix. */
    rows?: QuestionnaireOption[];
    columns?: QuestionnaireOption[];
    /** For repeat: nested fields and item bounds. */
    elements?: QuestionnaireElement[];
    minItems?: number;
    maxItems?: number;
};

export type QuestionnairePage = {
    id?: string;
    title: string;
    description?: string;
    elements: QuestionnaireElement[];
    /**
     * Stored viewer setup (slides, grid, viewports), captured by
     * capturePageScene. getSchema reports only whether one exists — the payload
     * itself is never handed out, and must never be hand-written.
     */
    scene?: { captured: true; capturedAt?: string; viewerCount?: number };
    /** "prompt" (default) asks the respondent before a full layout switch; "auto" just applies it. */
    sceneApplyMode?: "auto" | "prompt";
    /** Recorder tours bound to this page's viewer slots. Opaque; use the binding methods. */
    recordings?: PageRecordingBinding[];
};

/** A recorder tour attached to one viewer slot of a page. */
export type PageRecordingBinding = {
    id: string;
    /** Viewer slot the tour plays in. */
    slotIndex: number;
    recordingId: string;
    recordingName: string;
    stepCount: number;
    /** Starts by itself when a respondent opens the page. */
    autoplay?: boolean;
    capturedAt?: string;
};

/** A viewer slot of a page — a place a tour can be bound to. */
export type PageViewerSlot = {
    index: number;
    title: string;
    /** The live viewer filling this slot, if any. A slot without one cannot be bound. */
    viewerId?: string;
};

export type QuestionnaireSchema = {
    version: 1;
    title?: string;
    description?: string;
    pages: QuestionnairePage[];
};

export type QuestionnaireResultState = {
    exported: boolean;
    pageCount: number;
    currentPage: number;
    answeredKeys: string[];
};

/** Field key -> answer value. */
export type QuestionnaireAnswers = Record<string, unknown>;

export interface QuestionnaireScriptApi extends ScriptApiObject {
    /** Returns a snapshot of the current questionnaire schema. */
    getSchema(): QuestionnaireSchema;

    /** Returns current answers (field key -> value). Read-only inspection. */
    getAnswers(): QuestionnaireAnswers;

    /** Returns a lightweight runtime/result summary. */
    getResultState(): QuestionnaireResultState;

    /**
     * Replaces the entire questionnaire with the given schema and returns the
     * normalized result. This is the primary way to build a questionnaire:
     * provide \`{ version: 1, title, pages: [{ title, elements: [...] }] }\`.
     * Requires interactive user consent.
     */
    setSchema(schema: QuestionnaireSchema): Promise<QuestionnaireSchema>;

    /** Appends a page and returns the created page. Requires user consent. */
    addPage(page?: Partial<QuestionnairePage>): Promise<QuestionnairePage>;

    /** Removes a page by id or index. Requires user consent. */
    removePage(pageRef: string | number): Promise<boolean>;

    /**
     * Appends a field to a page (by id or index) and returns the created field.
     * Requires user consent.
     */
    addElement(pageRef: string | number, element: QuestionnaireElement): Promise<QuestionnaireElement>;

    /**
     * Shallow-merges a patch into an existing field (the id is preserved) and
     * returns the updated field. Requires user consent.
     */
    updateElement(pageRef: string | number, elementId: string, patch: Partial<QuestionnaireElement>): Promise<QuestionnaireElement>;

    /** Removes a field by id from a page. Requires user consent. */
    removeElement(pageRef: string | number, elementId: string): Promise<boolean>;

    /**
     * Shallow-merges a patch into a page's own fields (title, description,
     * sceneApplyMode, visibleWhen). Fields, the viewer setup and tours have
     * their own methods and are never patched here. Requires user consent.
     */
    updatePage(pageRef: string | number, patch: Partial<QuestionnairePage>): Promise<QuestionnairePage>;

    // ---- presentation: viewer setup + recorder tours ----

    /**
     * Store the CURRENT slide/grid/viewport layout on a page, so opening the
     * page puts the respondent's viewer back into it. Set the viewers up first,
     * then call this. Requires user consent.
     */
    capturePageScene(pageRef: string | number): Promise<object>;

    /** Drop a page's stored viewer setup. Requires user consent. */
    clearPageScene(pageRef: string | number): Promise<boolean>;

    /** The viewer slots of a page — what a tour can be bound to. */
    listPageViewerSlots(pageRef: string | number): PageViewerSlot[];

    /**
     * Attach a recorder tour to one viewer slot of a page. Build the tour first
     * with the \`recorder\` namespace, then bind it by id — only a recording of
     * that slot's own viewer can be bound. Pass \`autoplay: true\` to have it
     * start when the respondent opens the page (default false: they press play).
     * The binding embeds a COPY of the tour, so later recorder edits need a
     * re-bind. Requires user consent.
     */
    bindPageRecording(
        pageRef: string | number,
        slotIndex: number,
        recordingId: string,
        opts?: { autoplay?: boolean },
    ): Promise<PageRecordingBinding>;

    /**
     * Capture the viewer setup AND bind every viewer's active tour to the page
     * in one call — the usual way to make a page present a multi-slide tour.
     * Returns what it bound and, in \`skipped\`, the slots it could not (report
     * those to the user). Requires user consent.
     */
    bindPageTour(pageRef: string | number, opts?: { autoplay?: boolean }): Promise<{
        bound: PageRecordingBinding[];
        skipped: Array<{ slotIndex: number; title: string; reason: string }>;
    }>;

    /** Turn a bound tour's autoplay on or off. Requires user consent. */
    setPageRecordingAutoplay(pageRef: string | number, slotIndex: number, value: boolean): Promise<PageRecordingBinding>;

    /** Detach a page's bound tour. Requires user consent. */
    removePageRecording(pageRef: string | number, slotIndex: number): Promise<boolean>;
}
`;

const PLUGIN_ID = "questionaire";

/**
 * Build and register the questionnaire scripting namespace. Called once from
 * index.ts at bundle-eval time.
 */
export function registerQuestionnaireScriptingApi(): void {
    const ScriptingManager = (globalThis as any).ScriptingManager;
    if (!ScriptingManager?.registerExternalApi || !ScriptingManager?.XOpatScriptingApi) {
        console.warn("[questionaire] ScriptingManager unavailable; scripting namespace not registered.");
        return;
    }

    const ScriptApiBase = ScriptingManager.XOpatScriptingApi as {
        new (namespace: string, name: string, description: string): any;
    };

    class XOpatQuestionnaireScriptApi extends ScriptApiBase {
        MAX_PAGES_PER_CALL = 100;
        MAX_ELEMENTS_PER_PAGE = 300;

        static ScriptApiMetadata = {
            dtypesSource: { kind: "text", value: QUESTIONNAIRE_DTS },
        };

        constructor(namespace: string) {
            super(
                namespace,
                "Questionnaire",
                "Build and edit the xOpat questionnaire and read submitted answers. " +
                "Use setSchema to create a whole questionnaire at once " +
                "({ version: 1, title, pages: [{ title, elements }] }); the schema " +
                "shape is described in the type declarations. Editing operations " +
                "ask the user for permission before applying. " +
                "A page can also carry the VIEWER SETUP and the RECORDER TOURS a respondent gets when they open " +
                "it — this is how a questionnaire walks someone through slides. capturePageScene(pageRef) saves " +
                "the current slides/grid/viewports onto a page and opening the page restores them. " +
                "bindPageRecording(pageRef, slotIndex, recordingId, {autoplay}) attaches one tour built with the " +
                "`recorder` namespace to one viewer slot (listPageViewerSlots shows the slots); " +
                "bindPageTour(pageRef, {autoplay}) does the whole page in one call — saves the setup and attaches " +
                "every viewer's active tour. Pass autoplay: true so it plays on page open, otherwise the " +
                "respondent presses play. Bindings embed a COPY of the tour, so edit the tour first and bind " +
                "last; later recorder edits need a re-bind.",
            );
        }

        /** Live plugin instance; throws when the questionnaire plugin is not loaded. */
        _getPlugin(): any {
            const instance = (globalThis as any).plugin?.(PLUGIN_ID);
            if (!instance) {
                throw new Error("The questionnaire plugin is not available. Enable it first.");
            }
            return instance;
        }

        /** Refuse edits when the `questionaire.edit` capability is denied (UI gating). */
        _assertCanEdit(plugin: any): void {
            if (typeof plugin.can === "function" && plugin.can("questionaire.edit") === false) {
                throw new Error("Editing the questionnaire is not permitted (questionaire.edit denied).");
            }
        }

        /** One consent prompt per edit. Throws when the user declines. */
        async _consent(title: string, details: string[]): Promise<void> {
            await this.requireActionConsent({
                title,
                description: "A script wants to modify the questionnaire.",
                details,
                mode: "warning",
                confirmLabel: "Apply",
                rejectedMessage: "The questionnaire edit was canceled by the user.",
                // One shared grant covers all questionnaire edits (the prompt copy is
                // generic), so a single "Don't ask again" applies to the whole editing class.
                cacheKey: "questionaire:edit",
            });
        }

        // ---- read (no consent) ----

        getSchema(): any {
            const schema = this._getPlugin().getSchema();
            // A page's scene and recording bindings are bulk payloads (canonical
            // scene, tour steps with screenshots, base64 assets). Summarize them:
            // a caller needs to know they exist, never their contents.
            return {
                ...schema,
                pages: (schema?.pages ?? []).map((page: any) => ({
                    ...page,
                    scene: page?.scene ? { captured: true, capturedAt: page.scene.capturedAt, viewerCount: page.scene.viewerCount } : undefined,
                    recordings: page?.recordings?.length
                        ? page.recordings.map((b: any) => this._bindingInfo(b))
                        : undefined,
                })),
            };
        }

        getAnswers(): any {
            return this._getPlugin().getAnswers();
        }

        getResultState(): any {
            return this._getPlugin().getResultState();
        }

        // ---- write (consent + capability gated) ----

        async setSchema(schema: any): Promise<any> {
            const plugin = this._getPlugin();
            this._assertCanEdit(plugin);
            const pages = Array.isArray(schema?.pages) ? schema.pages : [];
            if (pages.length > this.MAX_PAGES_PER_CALL) {
                throw new Error(`Too many pages (${pages.length}); limit is ${this.MAX_PAGES_PER_CALL}.`);
            }
            for (const page of pages) {
                const count = Array.isArray(page?.elements) ? page.elements.length : 0;
                if (count > this.MAX_ELEMENTS_PER_PAGE) {
                    throw new Error(`A page has too many fields (${count}); limit is ${this.MAX_ELEMENTS_PER_PAGE}.`);
                }
            }
            await this._consent("Replace questionnaire", [
                `Title: ${String(schema?.title ?? "(untitled)")}`,
                `Pages: ${pages.length}`,
            ]);
            return plugin.setSchema(schema);
        }

        async addPage(page?: any): Promise<any> {
            const plugin = this._getPlugin();
            this._assertCanEdit(plugin);
            await this._consent("Add questionnaire page", [
                `Title: ${String(page?.title ?? "(new page)")}`,
            ]);
            return plugin.addPage(page);
        }

        async removePage(pageRef: string | number): Promise<boolean> {
            const plugin = this._getPlugin();
            this._assertCanEdit(plugin);
            await this._consent("Remove questionnaire page", [`Page: ${String(pageRef)}`]);
            return plugin.removePage(pageRef);
        }

        async addElement(pageRef: string | number, element: any): Promise<any> {
            const plugin = this._getPlugin();
            this._assertCanEdit(plugin);
            await this._consent("Add questionnaire field", [
                `Page: ${String(pageRef)}`,
                `Kind: ${String(element?.kind ?? "text")}`,
                `Label: ${String(element?.label ?? element?.name ?? "(field)")}`,
            ]);
            return plugin.addElement(pageRef, element);
        }

        async updateElement(pageRef: string | number, elementId: string, patch: any): Promise<any> {
            const plugin = this._getPlugin();
            this._assertCanEdit(plugin);
            await this._consent("Update questionnaire field", [
                `Page: ${String(pageRef)}`,
                `Field: ${String(elementId)}`,
            ]);
            return plugin.updateElement(pageRef, elementId, patch);
        }

        async removeElement(pageRef: string | number, elementId: string): Promise<boolean> {
            const plugin = this._getPlugin();
            this._assertCanEdit(plugin);
            await this._consent("Remove questionnaire field", [
                `Page: ${String(pageRef)}`,
                `Field: ${String(elementId)}`,
            ]);
            return plugin.removeElement(pageRef, elementId);
        }

        async updatePage(pageRef: string | number, patch: any): Promise<any> {
            const plugin = this._getPlugin();
            this._assertCanEdit(plugin);
            await this._consent("Update questionnaire page", [`Page: ${String(pageRef)}`]);
            return plugin.updatePage(pageRef, patch);
        }

        // ---- presentation: viewer setup + recorder tours ----

        /**
         * A binding embeds the whole tour (steps, screenshots, base64 assets).
         * Scripts only ever see this summary — the payload must not reach a
         * model's context.
         */
        _bindingInfo(binding: any): any {
            return {
                id: binding?.id,
                slotIndex: binding?.slotIndex,
                recordingId: binding?.recordingId,
                recordingName: binding?.recordingName,
                stepCount: binding?.stepCount ?? binding?.steps?.length ?? 0,
                autoplay: !!binding?.autoplay,
                capturedAt: binding?.capturedAt,
            };
        }

        _slotInfo(slot: any): any {
            return { index: slot?.index, title: slot?.title, viewerId: slot?.viewerId };
        }

        async capturePageScene(pageRef: string | number): Promise<any> {
            const plugin = this._getPlugin();
            this._assertCanEdit(plugin);
            await this._consent("Store the viewer setup on a questionnaire page", [
                `Page: ${String(pageRef)}`,
                "The current slides, grid layout and viewports are saved onto the page.",
            ]);
            return plugin.capturePageScene(pageRef);
        }

        async clearPageScene(pageRef: string | number): Promise<boolean> {
            const plugin = this._getPlugin();
            this._assertCanEdit(plugin);
            await this._consent("Clear the viewer setup of a questionnaire page", [`Page: ${String(pageRef)}`]);
            return plugin.clearPageScene(pageRef);
        }

        listPageViewerSlots(pageRef: string | number): any[] {
            return this._getPlugin().listPageViewerSlots(pageRef).map((s: any) => this._slotInfo(s));
        }

        async bindPageRecording(pageRef: string | number, slotIndex: number, recordingId: string, opts?: any): Promise<any> {
            const plugin = this._getPlugin();
            this._assertCanEdit(plugin);
            await this._consent("Attach a tour to a questionnaire page", [
                `Page: ${String(pageRef)}`,
                `Viewer slot: ${slotIndex}`,
                opts?.autoplay ? "It starts automatically when the page opens." : "The respondent presses play.",
            ]);
            return this._bindingInfo(plugin.bindPageRecording(pageRef, slotIndex, recordingId, opts));
        }

        async bindPageTour(pageRef: string | number, opts?: any): Promise<any> {
            const plugin = this._getPlugin();
            this._assertCanEdit(plugin);
            await this._consent("Set up a questionnaire page to present the current tour", [
                `Page: ${String(pageRef)}`,
                "The current viewer setup is saved and each viewer's active tour is attached.",
                opts?.autoplay ? "Tours start automatically when the page opens." : "The respondent presses play.",
            ]);
            const result = plugin.bindPageTour(pageRef, opts);
            // The scene is intentionally not returned: it is a large opaque
            // payload and the caller has nothing to do with it.
            return {
                bound: (result?.bound ?? []).map((b: any) => this._bindingInfo(b)),
                skipped: result?.skipped ?? [],
            };
        }

        async setPageRecordingAutoplay(pageRef: string | number, slotIndex: number, value: boolean): Promise<any> {
            const plugin = this._getPlugin();
            this._assertCanEdit(plugin);
            await this._consent("Change a questionnaire page's tour autoplay", [
                `Page: ${String(pageRef)}`,
                `Viewer slot: ${slotIndex}`,
                value ? "The tour will start automatically." : "The respondent will press play.",
            ]);
            return this._bindingInfo(plugin.setPageRecordingAutoplay(pageRef, slotIndex, !!value));
        }

        async removePageRecording(pageRef: string | number, slotIndex: number): Promise<boolean> {
            const plugin = this._getPlugin();
            this._assertCanEdit(plugin);
            await this._consent("Detach a tour from a questionnaire page", [
                `Page: ${String(pageRef)}`,
                `Viewer slot: ${slotIndex}`,
            ]);
            return plugin.removePageRecording(pageRef, slotIndex);
        }
    }

    ScriptingManager.registerExternalApi(
        async (manager: any) => manager.ingestApi(new XOpatQuestionnaireScriptApi("questionnaire")),
        { label: "questionnaire" },
    );
}
