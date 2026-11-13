import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { SingleUserOAuthProvider } from "../../src/auth/oauth-provider.js";
import { Signer } from "../../src/auth/signed-token.js";

const KEY = "k".repeat(40);
const RESOURCE = new URL("https://mcp.example.com/mcp");
const REDIRECT = "https://chatgpt.com/connector/oauth/abc";

function makeProvider(extra: Record<string, unknown> = {}) {
    return new SingleUserOAuthProvider({
        password: "correct horse",
        signingKey: KEY,
        resourceUrl: RESOURCE,
        loginPath: "/oauth/login",
        ...extra
    });
}

/** Captures the HTML the provider renders from authorize(). */
function fakeResponse() {
    const res = {
        html: "",
        status: vi.fn(() => res),
        set: vi.fn(() => res),
        send: vi.fn((body: string) => {
            res.html = body;
            return res;
        })
    };
    return res;
}

async function register(provider: SingleUserOAuthProvider) {
    return provider.clientsStore.registerClient!({
        redirect_uris: [REDIRECT],
        client_name: "ChatGPT",
        token_endpoint_auth_method: "client_secret_post"
    } as OAuthClientInformationFull);
}

async function startAuthorization(
    provider: SingleUserOAuthProvider,
    client: OAuthClientInformationFull,
    resource?: URL
) {
    const res = fakeResponse();
    await provider.authorize(
        client,
        {
            redirectUri: REDIRECT,
            codeChallenge: "challenge-123",
            state: "xyz",
            scopes: [],
            resource
        },
        res as unknown as Response
    );
    const pending = /name="pending" value="([^"]+)"/.exec(res.html)?.[1];
    return { res, pending: pending! };
}

async function getCode(provider: SingleUserOAuthProvider) {
    const client = await register(provider);
    const { pending } = await startAuthorization(provider, client);
    const result = await provider.completeLogin({
        pending,
        password: "correct horse",
        decision: "approve"
    });
    expect(result.kind).toBe("redirect");
    const location = new URL((result as { location: string }).location);
    return { client, code: location.searchParams.get("code")!, location };
}

describe("Signer", () => {
    it("round-trips claims and rejects tampering, wrong kind and expiry", () => {
        const signer = new Signer(KEY);
        const token = signer.sign("access", { a: 1 }, 60);
        expect(signer.verify("access", token)?.a).toBe(1);
        expect(signer.verify("refresh", token)).toBeUndefined();
        expect(
            signer.verify("access", token.replace(/^./, "x"))
        ).toBeUndefined();
        expect(
            new Signer("z".repeat(40)).verify("access", token)
        ).toBeUndefined();

        vi.useFakeTimers();
        vi.setSystemTime(Date.now() + 61_000);
        expect(signer.verify("access", token)).toBeUndefined();
        vi.useRealTimers();
    });

    it("rejects short signing keys", () => {
        expect(() => new Signer("short")).toThrow();
    });
});

describe("SingleUserOAuthProvider", () => {
    it("registers clients statelessly so they survive a restart", async () => {
        const client = await register(makeProvider());
        expect(client.client_secret).toBeTruthy();

        const restarted = makeProvider();
        const found = await restarted.clientsStore.getClient(client.client_id);
        expect(found?.redirect_uris).toEqual([REDIRECT]);
        expect(found?.client_secret).toBe(client.client_secret);
        expect(
            await restarted.clientsStore.getClient("made-up")
        ).toBeUndefined();
    });

    it("shows the client name and escapes it on the login page", async () => {
        const provider = makeProvider();
        const client = await provider.clientsStore.registerClient!({
            redirect_uris: [REDIRECT],
            client_name: "<script>x</script>"
        } as OAuthClientInformationFull);
        const { res } = await startAuthorization(provider, client);
        expect(res.html).toContain("&lt;script&gt;");
        expect(res.html).not.toContain("<script>x");
        expect(res.html).toContain("chatgpt.com");
    });

    it("re-renders the page on a wrong password", async () => {
        const provider = makeProvider();
        const client = await register(provider);
        const { pending } = await startAuthorization(provider, client);
        const result = await provider.completeLogin({
            pending,
            password: "wrong",
            decision: "approve"
        });
        expect(result.kind).toBe("retry");
    });

    it("redirects with access_denied when the owner denies", async () => {
        const provider = makeProvider();
        const client = await register(provider);
        const { pending } = await startAuthorization(provider, client);
        const result = await provider.completeLogin({
            pending,
            decision: "deny"
        });
        const url = new URL((result as { location: string }).location);
        expect(url.searchParams.get("error")).toBe("access_denied");
        expect(url.searchParams.get("state")).toBe("xyz");
    });

    it("rejects forged pending requests", async () => {
        const result = await makeProvider().completeLogin({
            pending: "forged.value",
            password: "correct horse"
        });
        expect(result.kind).toBe("error");
    });

    it("rejects an authorization request for another resource", async () => {
        const provider = makeProvider();
        const client = await register(provider);
        await expect(
            startAuthorization(
                provider,
                client,
                new URL("https://evil.example/mcp")
            )
        ).rejects.toThrow();
    });

    it.each([
        "https://mcp.example.com",
        "https://mcp.example.com/",
        "https://mcp.example.com/mcp/"
    ])("accepts resource %s on this server's origin", async (resource) => {
        const provider = makeProvider();
        const client = await register(provider);
        const { pending } = await startAuthorization(
            provider,
            client,
            new URL(resource)
        );
        const result = await provider.completeLogin({
            pending,
            password: "correct horse"
        });
        const code = new URL(
            (result as { location: string }).location
        ).searchParams.get("code")!;
        const tokens = await provider.exchangeAuthorizationCode(
            client,
            code,
            undefined,
            undefined,
            new URL(resource)
        );
        const info = await provider.verifyAccessToken(tokens.access_token);
        expect(info.resource?.href).toBe(RESOURCE.href);
    });

    it("issues tokens for a valid code exactly once", async () => {
        const provider = makeProvider();
        const { client, code, location } = await getCode(provider);
        expect(location.searchParams.get("state")).toBe("xyz");
        expect(await provider.challengeForAuthorizationCode(client, code)).toBe(
            "challenge-123"
        );

        const tokens = await provider.exchangeAuthorizationCode(
            client,
            code,
            undefined,
            REDIRECT,
            RESOURCE
        );
        const info = await provider.verifyAccessToken(tokens.access_token);
        expect(info.clientId).toBe(client.client_id);
        expect(info.resource?.href).toBe(RESOURCE.href);
        expect(info.expiresAt).toBeGreaterThan(Date.now() / 1000);

        await expect(
            provider.exchangeAuthorizationCode(client, code)
        ).rejects.toThrow(/already been used/);
    });

    it("rejects codes for another client or redirect URI", async () => {
        const provider = makeProvider();
        const { code, client } = await getCode(provider);
        const other = await register(provider);
        const otherClient = { ...other, client_id: other.client_id + "x" };
        await expect(
            provider.challengeForAuthorizationCode(otherClient, code)
        ).rejects.toThrow();
        await expect(
            provider.exchangeAuthorizationCode(
                client,
                code,
                undefined,
                "https://evil.example/cb"
            )
        ).rejects.toThrow(/redirect_uri/);
    });

    it("refreshes tokens and keeps refresh and access tokens apart", async () => {
        const provider = makeProvider();
        const { client, code } = await getCode(provider);
        const tokens = await provider.exchangeAuthorizationCode(client, code);

        const refreshed = await provider.exchangeRefreshToken(
            client,
            tokens.refresh_token!
        );
        await expect(
            provider.verifyAccessToken(refreshed.access_token)
        ).resolves.toBeTruthy();

        await expect(
            provider.verifyAccessToken(tokens.refresh_token!)
        ).rejects.toThrow();
        await expect(
            provider.exchangeRefreshToken(client, tokens.access_token)
        ).rejects.toThrow();
        await expect(
            provider.exchangeRefreshToken(client, tokens.refresh_token!, [
                "admin"
            ])
        ).rejects.toThrow();
    });

    it("rejects tokens signed with a different key", async () => {
        const { client, code } = await getCode(makeProvider());
        const tokens = await makeProvider().exchangeAuthorizationCode(
            client,
            code
        );
        const rotated = makeProvider({ signingKey: "r".repeat(40) });
        await expect(
            rotated.verifyAccessToken(tokens.access_token)
        ).rejects.toThrow();
    });

    it("accepts the static bearer token alongside OAuth", async () => {
        const provider = makeProvider({ staticBearerToken: "static-123" });
        const info = await provider.verifyAccessToken("static-123");
        expect(info.resource?.href).toBe(RESOURCE.href);
        await expect(provider.verifyAccessToken("static-12")).rejects.toThrow();
    });

    it("supports a pre-configured client", async () => {
        const provider = makeProvider({
            staticClient: {
                clientId: "my-client",
                clientSecret: "my-secret",
                redirectUris: [REDIRECT]
            }
        });
        const client = await provider.clientsStore.getClient("my-client");
        expect(client?.client_secret).toBe("my-secret");
        expect(client?.redirect_uris).toEqual([REDIRECT]);
    });
});
