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
                "ask the user for permission before applying.",
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
            });
        }

        // ---- read (no consent) ----

        getSchema(): any {
            return this._getPlugin().getSchema();
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
    }

    ScriptingManager.registerExternalApi(
        async (manager: any) => manager.ingestApi(new XOpatQuestionnaireScriptApi("questionnaire")),
        { label: "questionnaire" },
    );
}
