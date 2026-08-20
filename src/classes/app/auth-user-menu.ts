// The PERMANENT sign-in affordance, in the app-bar user menu.
//
// The recovery scrim (`auth-recovery-ui.ts`) only appears once something has
// already failed, and a sub-context toast can be dismissed — so before this file
// existed there was no way to sign in *on purpose*: `APPLICATION_CONTEXT.auth.login`
// had exactly one caller in the whole application, and it was that scrim.
//
// Rendered from `auth.listContexts()`, so nothing here knows about OIDC, SAML or
// any particular deployment: whichever contexts a broker declared get a row.
//
// GESTURE RULE — read before editing a handler. Opening an identity provider needs
// a user gesture, and a gesture survives microtasks but not a task hop. `login()`
// must therefore be the FIRST statement of an onClick: no awaited fetch, no
// `whenContextSettled`, no `setTimeout` before it, or the browser stops attributing
// the window to the click and the sign-in silently fails to open.

const ROW_IDENTITY = "auth.identity";
const ROW_SIGN_IN = "auth.signin";
const ROW_SIGN_OUT = "auth.signout";
const ROW_SIGN_IN_CTX = (contextId: string) => `auth.signin:${contextId}`;

const auth = (): any => (window as any).APPLICATION_CONTEXT?.auth;
const userMenu = (): any => (window as any).USER_INTERFACE?.AppBar?.User;
const xoUser = (): any => (window as any).XOpatUser?.instance?.();

/** Contexts other than the main identity, in declaration order. */
function subContexts(contexts: any[]): any[] {
    return contexts.filter((c) => c && c.contextId !== "core" && c.isMain !== true);
}

function render(): void {
    const a = auth();
    const menu = userMenu();
    if (!a || !menu) return;

    const contexts: any[] = typeof a.listContexts === "function" ? a.listContexts() : [];
    const user = xoUser();
    const name = user?.name;

    // Who am I. Informational only — disabled so it reads as a header, not an action.
    menu.register(ROW_IDENTITY, {
        icon: "ph-user-circle",
        disabled: true,
        label: name ? $.t("auth.signedInAs", { name }) : $.t("auth.notSignedIn"),
    });

    // The main identity: sign in XOR sign out, never both.
    const main = contexts.find((c) => c.isMain === true || c.contextId === "core");
    if (!main) {
        // No auth module claims the main context — offering a sign-in that throws
        // ("no auth broker registered") would be worse than offering nothing.
        menu.unregister(ROW_SIGN_IN);
        menu.unregister(ROW_SIGN_OUT);
    } else if (a.isAuthenticated("core")) {
        menu.unregister(ROW_SIGN_IN);
        menu.register(ROW_SIGN_OUT, {
            icon: "ph-sign-out",
            label: $.t("auth.signOut"),
            onClick: () => { void a.logout("core"); },
        });
    } else {
        menu.unregister(ROW_SIGN_OUT);
        menu.register(ROW_SIGN_IN, {
            icon: "ph-sign-in",
            label: $.t("auth.signIn"),
            // First statement, deliberately: see the GESTURE RULE above.
            onClick: () => { void a.login("core"); },
        });
    }

    // A row per unauthenticated sub-context (a chat provider, a second archive…),
    // so a feature's login does not depend on its own UI being open.
    for (const cfg of subContexts(contexts)) {
        const rowId = ROW_SIGN_IN_CTX(cfg.contextId);
        if (a.isAuthenticated(cfg.contextId)) {
            menu.unregister(rowId);
            continue;
        }
        menu.register(rowId, {
            icon: "ph-lock-key",
            label: $.t("auth.signInTo", { service: cfg.serviceName || cfg.contextId }),
            onClick: () => { void a.login(cfg.contextId); },
        });
    }
}

/**
 * Mount the account rows and keep them in sync. Safe to call once at boot; the
 * app bar and the auth singleton must both exist by then.
 */
export function wireAuthUserMenu(): void {
    const a = auth();
    if (!a || !userMenu()) return;

    // Several of these fire together on one login (login → secret-updated →
    // settled). Coalesce so the menu is rebuilt once per transition.
    let scheduled = false;
    const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => { scheduled = false; render(); });
    };

    a.onChange?.(schedule);    // every credential transition, any context
    a.onSettled?.(schedule);   // a boot attempt finished — including unsuccessfully

    const user = xoUser();
    // The single global channel the recovery UI uses too: contexts appear after
    // boot, so an app-wide listener must not have to enumerate them up front.
    user?.addHandler?.("auth-interaction-changed", schedule);
    user?.addHandler?.("roles-changed", schedule);

    render();
}
