/**
 * On failure, attach what you actually need to debug an xOpat test.
 *
 * A red test whose only artifact is a stack trace inside the test file is close
 * to useless here — the interesting state lives in the server that the test was
 * talking to. This fixture attaches, **only when the test failed**:
 *
 *  - the effective deployment ENV (the scratch copy, post-`setEnv`)
 *  - the server's stdout/stderr
 *  - the server-side log ring buffer via `POST /__rpc/server/core/getLogs`
 *
 * It reads the module-level registry rather than depending on `xopatServer`,
 * so it costs nothing in projects that never boot a server.
 */
import { activeServers } from "./server.mjs";

export const diagnosticsFixtures = {
    xopatDiagnostics: [
        async ({}, use, testInfo) => {
            await use();
            if (testInfo.status === testInfo.expectedStatus) return;

            for (const server of activeServers) {
                const label = `xopat-server:${server.port}`;
                await testInfo.attach(`${label} env (${server.scratch.sourceFile})`, {
                    body: JSON.stringify(server.scratch.read(), null, 2),
                    contentType: "application/json",
                }).catch(() => {});
                await testInfo.attach(`${label} stdout+stderr`, {
                    body: server.logs || "(no output)",
                    contentType: "text/plain",
                }).catch(() => {});
                const logs = await server.getLogs().catch(e => ({ error: String(e?.message ?? e) }));
                await testInfo.attach(`${label} core logs`, {
                    body: JSON.stringify(logs, null, 2),
                    contentType: "application/json",
                }).catch(() => {});
            }
        },
        { auto: true },
    ],
};
