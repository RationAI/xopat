// Core-declared capabilities — the gates for actions the core itself performs.
//
// Plugins and modules get their capabilities for free: `registerOwnerRights`
// (src/loader.ts) derives them from `include.json`. Core has no include.json, so
// the handful of core actions that a deployment may legitimately want to close
// are declared here, once, with an explicit choke point each.
//
// Everything in this file is INERT unless an operator writes a role definition
// that names one of these ids: every capability defaults to `allow`, and
// `XOpatUser.can()` answers `true` for ids nobody declared. A vanilla deployment
// behaves exactly as it did before this file existed.
//
// See src/USER_ROLES.md ("Core capabilities" and "Two routes").

/**
 * The local-file escape hatch: the `file-download` last-resort fallback, the
 * `file-upload` sink, and `IO_PIPELINE.importBundle` with a user-picked payload.
 *
 * Deliberately NOT the same question as an owner's `bundle-export`. An operator
 * saying "do not upload annotations to the registry" is not saying "the
 * pathologist may not keep a copy of their own work", and conflating the two
 * made the first sentence unsayable. Deny this one as well to mean "nothing
 * leaves the browser".
 */
export const CAP_IO_LOCAL_FILE = "core.io.local-file";

/** `UTILITIES.export()` — the self-contained `export.html` session document. */
export const CAP_EXPORT_FILE = "core.export.file";

/**
 * `UTILITIES.copyUrlToClipboard()` / `syncSessionToUrl()` — the session in the
 * address bar. Separate from the file: a URL is trivially forwardable and some
 * deployments care about exactly that, while still allowing a local save.
 */
export const CAP_EXPORT_URL = "core.export.url";

/** `APPLICATION_CONTEXT.Scripting` execution of user-authored scripts. */
export const CAP_SCRIPTING_RUN = "core.scripting.run";

interface CoreCapabilityDescriptor {
    id: string;
    label: string;
    description: string;
}

const CORE_CAPABILITIES: CoreCapabilityDescriptor[] = [
    {
        id: CAP_IO_LOCAL_FILE,
        label: "Read and write local files",
        description: "Download data to a file, or load it back from one, when the IO pipeline "
            + "cannot reach a configured destination.",
    },
    {
        id: CAP_EXPORT_FILE,
        label: "Export the session to a file",
        description: "Produce the self-contained export.html session document.",
    },
    {
        id: CAP_EXPORT_URL,
        label: "Share the session as a link",
        description: "Put the current session into the address bar or the clipboard.",
    },
    {
        id: CAP_SCRIPTING_RUN,
        label: "Run scripts",
        description: "Execute user-authored or assistant-authored scripts against the viewer.",
    },
];

/**
 * Declare the core capabilities and mount the local-route guard.
 *
 * Called once from `initXOpatLoader`, right after `XOpatUser.configureRoles`, so
 * the ids exist before the first element mounts and before any IO can run.
 *
 * @param pipeline the bootstrapped `IO_PIPELINE`
 * @returns a disposer that removes the guard and the declarations
 */
export function registerCoreCapabilities(pipeline: any): () => void {
    const User = (window as any).XOpatUser;
    if (!User?.declareCapability) return () => undefined;

    for (const cap of CORE_CAPABILITIES) {
        User.declareCapability({ ...cap, default: "allow", declaredBy: "core" });
    }

    const disposers: Array<() => void> = [];

    // The local-file route, as a normal pipeline guard rather than a special
    // case buried in the export path: it shows up in `listGuards()`, honours
    // `ENV.client.io.disabled`, and refuses through the same `surfaceRefusal`
    // path as everything else.
    //
    // Registered under `resource: "*"` because bundle traffic carries no
    // resource name. Unlike an owner's rights gate it does NOT filter by owner —
    // it is the same answer for everyone, which is the whole point of it being
    // one knob instead of one per plugin.
    if (pipeline?.registerGuard) {
        for (const direction of ["pre-export", "pre-import"]) {
            const dispose = pipeline.registerGuard({
                ownerId: "rights:core",
                resource: "*",
                direction,
                priority: 10_000,
                label: `rights-gate:${CAP_IO_LOCAL_FILE}`,
                handler: (ctx: any) => {
                    if (ctx?.route !== "local") return { ok: true };
                    const user = User.instance?.();
                    if (!user || user.can(CAP_IO_LOCAL_FILE)) return { ok: true };
                    return {
                        ok: false,
                        refused: true,
                        reason: `rights: capability "${CAP_IO_LOCAL_FILE}" denied for current roles `
                            + `[${user.currentRoles().join(", ") || "—"}]`,
                        userMessage: $.t("user.roles.refused", {
                            capability: User.capabilityLabel(CAP_IO_LOCAL_FILE),
                        }),
                        code: "W_PERM_DENIED",
                    };
                },
            });
            if (typeof dispose === "function") disposers.push(dispose);
        }
    }

    return () => {
        for (const d of disposers) {
            try { d(); } catch (e) { console.error(e); }
        }
        User.undeclareCapabilities?.("core");
    };
}

/**
 * Check a core capability at a choke point, telling the user when it is closed.
 *
 * Core actions are invoked from menus and shortcuts rather than through the IO
 * pipeline, so there is no guard phase to carry the refusal — this is the
 * equivalent: one place that answers, and one message that matches what a
 * pipeline refusal would have said.
 *
 * @param capabilityId one of the `CAP_*` ids in this file
 * @param options.silent skip the toast (for enabling/disabling UI rather than
 *   reacting to a click)
 * @returns true when the action may proceed
 */
export function allowCoreAction(capabilityId: string, options: { silent?: boolean } = {}): boolean {
    const User = (window as any).XOpatUser;
    const user = User?.instance?.();
    if (!user || user.can(capabilityId)) return true;
    if (!options.silent) {
        const Dialogs = (window as any).Dialogs;
        Dialogs?.show?.(
            $.t("user.roles.refused", { capability: User.capabilityLabel(capabilityId) }),
            5000,
            Dialogs.MSG_WARN,
        );
    }
    return false;
}
