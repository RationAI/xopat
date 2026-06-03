import van from "../../vanjs.mjs";
import { BaseComponent } from "../baseComponent.mjs";
import { IllustratedModal } from "./illustratedModal.mjs";

const { div, button, input, a, form, i: iTag } = van.tags;

/**
 * Login / Sign-up screen built on {@link IllustratedModal}.
 *
 * Left pane carries the tab strip and credential form, right pane shows the
 * themed illustration. The component is auth-method agnostic: it just emits
 * `onSubmit({ mode, email, password })` and `onForgotPassword()`. Wire it to
 * whatever auth client the embedding deployment uses (xOpatUser, OIDC, …).
 */
export class LoginModal extends BaseComponent {
    static MODE = { LOGIN: "login", SIGNUP: "signup" };

    constructor(options = {}) {
        super(options);
        this.options = options;
        this.onSubmit = typeof options.onSubmit === "function" ? options.onSubmit : () => {};
        this.onForgotPassword = typeof options.onForgotPassword === "function" ? options.onForgotPassword : null;
        this.onClose = typeof options.onClose === "function" ? options.onClose : null;

        const t = (key, fallback) => (typeof $ !== "undefined" && typeof $.t === "function" ? $.t(key) : fallback);
        this.labels = {
            login: options.labels?.login || t("auth.login", "Login"),
            signup: options.labels?.signup || t("auth.signup", "Sign up"),
            email: options.labels?.email || t("auth.email", "Email or phone number"),
            password: options.labels?.password || t("auth.password", "Password"),
            submit: options.labels?.submit || t("auth.submit", "Login"),
            forgot: options.labels?.forgot || t("auth.forgot", "Forgot your password?"),
            ...options.labels,
        };

        this._modeState = van.state(options.mode === LoginModal.MODE.SIGNUP ? LoginModal.MODE.SIGNUP : LoginModal.MODE.LOGIN);
        this._submitLabelState = van.state(this.labels.submit);
        this._errorState = van.state("");
        this._created = false;
    }

    create() {
        if (this._created) return this._illustrated.modal.root;

        const header = this._buildHeader();
        const body = this._buildBody();

        this._illustrated = new IllustratedModal({
            id: this.options.id || "login-modal",
            header,
            body,
            accent: this.options.accent || "accent",
            illustrationIcon: this.options.illustrationIcon || "ph-laptop",
            width: this.options.width || "min(960px, 94vw)",
            isBlocking: this.options.isBlocking ?? true,
            allowClose: this.options.allowClose ?? true,
            onClose: () => this.onClose?.(),
        });

        this._illustrated.create();
        this._created = true;
        return this._illustrated.modal.root;
    }

    mount(parent = document.body) {
        this.create();
        this._illustrated.mount(parent);
        return this;
    }

    open() {
        this.create();
        this._illustrated.open();
        return this;
    }

    close() {
        this._illustrated?.close();
        return this;
    }

    get isOpen() {
        return !!this._illustrated?.isOpen;
    }

    get mode() {
        return this._modeState.val;
    }

    setMode(mode) {
        const next = mode === LoginModal.MODE.SIGNUP ? LoginModal.MODE.SIGNUP : LoginModal.MODE.LOGIN;
        this._modeState.val = next;
        this._submitLabelState.val = next === LoginModal.MODE.SIGNUP ? this.labels.signup : this.labels.submit;
    }

    setError(message) {
        this._errorState.val = message || "";
    }

    _buildHeader() {
        const tabClass = (mode) => van.derive(
            () => `tab tab-bordered text-xl font-light ${this._modeState.val === mode ? "tab-active text-primary" : "opacity-50"}`,
        );
        return div(
            { class: "tabs tabs-bordered" },
            a({ class: tabClass(LoginModal.MODE.LOGIN), onclick: () => this.setMode(LoginModal.MODE.LOGIN) }, this.labels.login),
            a({ class: tabClass(LoginModal.MODE.SIGNUP), onclick: () => this.setMode(LoginModal.MODE.SIGNUP) }, this.labels.signup),
        );
    }

    _buildBody() {
        this._emailInput = input({
            type: "text",
            name: "email",
            class: "grow",
            placeholder: this.labels.email,
            autocomplete: "username",
        });
        this._passwordInput = input({
            type: "password",
            name: "password",
            class: "grow",
            placeholder: this.labels.password,
            autocomplete: "current-password",
        });

        const errorBanner = div({
            class: van.derive(() => `alert alert-error py-2 text-sm ${this._errorState.val ? "" : "hidden"}`),
        }, this._errorState);

        return form(
            {
                class: "flex flex-col gap-4",
                onsubmit: (e) => {
                    e.preventDefault();
                    this._emit();
                },
            },
            errorBanner,
            div(
                { class: "input input-bordered flex items-center gap-3 rounded-full bg-base-200/60" },
                iTag({ class: "ph-light ph-user-circle text-xl opacity-70" }),
                this._emailInput,
            ),
            div(
                { class: "input input-bordered flex items-center gap-3 rounded-full bg-base-200/60" },
                iTag({ class: "ph-light ph-lock-key text-xl opacity-70" }),
                this._passwordInput,
            ),
            div(
                { class: "flex items-center justify-between mt-2" },
                this.onForgotPassword
                    ? a(
                        {
                            class: "text-sm text-primary cursor-pointer hover:underline",
                            onclick: (e) => { e.preventDefault(); this.onForgotPassword?.(); },
                        },
                        this.labels.forgot,
                    )
                    : div(),
                button(
                    {
                        type: "submit",
                        class: "btn btn-primary rounded-full px-8",
                    },
                    this._submitLabelState,
                ),
            ),
        );
    }

    _emit() {
        const email = this._emailInput?.value?.trim() || "";
        const password = this._passwordInput?.value || "";
        this.onSubmit({ mode: this._modeState.val, email, password });
    }
}
