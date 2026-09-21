/**
 * `XOpatUser.requestSecretUpdate` is core's fan-out to whatever can re-provision a
 * credential. Deduplicating only the IN-FLIGHT attempt is not enough: a provider
 * that cannot re-provision right now still cannot a second later, while every
 * failing request keeps asking. A captured session turned that into repeated
 * identity-provider round trips for the rest of its life, each several seconds
 * long, none of which could have succeeded.
 *
 * The budget must also not become a trap: a credential landing is proof the
 * provider works again and re-arms everything.
 */
import { test, expect, freshXOpatUser } from "@xopat/test-harness";

// This suite is the one that *writes* the budget statics, and they live on a class
// the whole worker shares — see `freshXOpatUser`, which restores them per test so
// the thresholds asserted here cannot decide a neighbour's.
async function freshUser({ cooldownMs = 60_000, maxFailures = 2 } = {}) {
    const { user } = await freshXOpatUser({ cooldownMs, maxFailures });
    return user;
}

test("a burst of failing requests produces ONE refresh attempt", async () => {
    const user = await freshUser();
    let attempts = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    user.addHandler("secret-needs-update", async () => { attempts++; await gate; });

    const all = [
        user.requestSecretUpdate("jwt").catch(() => "rejected"),
        user.requestSecretUpdate("jwt").catch(() => "rejected"),
        user.requestSecretUpdate("jwt").catch(() => "rejected"),
    ];
    // The provider answers without providing anything — the common failure.
    release();
    user.setSecret("token", "jwt");
    await Promise.all(all);

    expect(attempts).toBe(1);
});

test("a fresh attempt inside the cooldown is refused without touching the provider", async () => {
    const user = await freshUser();
    let attempts = 0;
    user.addHandler("secret-needs-update", async () => { attempts++; /* provides nothing */ });

    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});
    expect(attempts).toBe(1);

    const second = await user.requestSecretUpdate("jwt", undefined, 20).catch((e) => e);
    expect(attempts).toBe(1);                       // provider left alone
    expect(String(second)).toContain("cooldown");
});

test("after the failure cap, further requests reject immediately", async () => {
    const user = await freshUser({ cooldownMs: 0, maxFailures: 2 });
    let attempts = 0;
    user.addHandler("secret-needs-update", async () => { attempts++; });

    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});
    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});
    expect(attempts).toBe(2);

    const capped = await user.requestSecretUpdate("jwt", undefined, 20).catch((e) => e);
    expect(attempts).toBe(2);
    expect(String(capped)).toContain("giving up");
});

test("a credential landing re-arms the budget", async () => {
    const user = await freshUser({ cooldownMs: 0, maxFailures: 1 });
    let attempts = 0;
    user.addHandler("secret-needs-update", async () => { attempts++; });

    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});
    expect(attempts).toBe(1);
    // Capped now…
    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});
    expect(attempts).toBe(1);

    // …until a login (interactive or otherwise) deposits one.
    user.setSecret("token", "jwt");

    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});
    expect(attempts).toBe(2);
});

test("the budget is per (type, context) — one dead context does not gag another", async () => {
    const user = await freshUser({ cooldownMs: 0, maxFailures: 1 });
    const seen = [];
    user.addHandler("secret-needs-update", async (e) => { seen.push(`core:${e.type}`); });
    user.addHandler("secret-needs-update:archive", async (e) => { seen.push(`archive:${e.type}`); });

    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});
    await user.requestSecretUpdate("jwt", undefined, 20).catch(() => {});   // capped
    await user.requestSecretUpdate("jwt", "archive", 20).catch(() => {});   // unaffected

    expect(seen).toEqual(["core:jwt", "archive:jwt"]);
});
