import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createFakeFetch,
  dataUrl,
  GIF_BYTES,
  JPEG_BYTES,
  jsonResponse,
  PNG_BYTES,
} from "@hk01/pi-ai-extra-internal/testing";
import {
  AppImageError,
  createImageClient,
  imageErrorBody,
  imageErrorStatus,
  partsToPrompt,
  type CataloguePolicy,
  type ImageClientConfig,
  type ImagePart,
  type ImageRequest,
} from "../src/server.ts";

const POLICY: CataloguePolicy = { scopes: { test: {} } };
const KEYS = {
  GEMINI_API_KEY: "gemini-key",
  KIE_API_KEY: "kie-key",
  TOAPIS_API_KEY: "toapis-key",
};
const PNG = dataUrl(PNG_BYTES, "image/png");
const JPEG = dataUrl(JPEG_BYTES, "image/jpeg");
/** RIFF....WEBP header; enough for format detection. */
const WEBP = dataUrl(
  new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
    0x38, 0x20,
  ]),
  "image/webp",
);

function client(overrides: Partial<Omit<ImageClientConfig, "policy">> = {}) {
  return createImageClient({
    app: "test-app",
    policy: POLICY,
    env: KEYS,
    ...overrides,
  }).forScope("test");
}

function imagePart(url: string): ImagePart {
  const [header, data] = url.split(",");
  return {
    inlineData: {
      mimeType: header?.slice(5, header.indexOf(";")) ?? "",
      data: data ?? "",
    },
  };
}

function request(
  overrides: { [K in keyof ImageRequest]?: ImageRequest[K] | undefined } = {},
): ImageRequest {
  const merged = {
    appModelId: "google:gemini-3.1-flash-image",
    parts: [{ text: "TEMPLATE:" }, imagePart(PNG), { text: "Make a card." }],
    aspectRatio: "4:5",
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as unknown as ImageRequest;
}

async function rejectsWith(
  promise: Promise<unknown>,
  code: string,
  httpStatus: number,
): Promise<AppImageError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(
      error instanceof AppImageError,
      `expected AppImageError, got ${String(error)}`,
    );
    assert.equal(error.details.code, code);
    assert.equal(error.httpStatus, httpStatus);
    return error;
  }
  assert.fail(`expected ${code}`);
}

describe("createImageClient", () => {
  it("requires a route-owned configured scope", () => {
    const root = createImageClient({ app: "x", policy: POLICY, env: {} });
    assert.throws(
      () => root.forScope("missing"),
      /unknown model scope "missing"/,
    );
  });

  it("rejects a stale policy at startup, before any route asks for its scope", () => {
    const policy: CataloguePolicy = {
      scopes: { test: {}, edit: { exclude: ["kie:removed-model"] } },
    };
    assert.throws(
      () => createImageClient({ app: "x", policy, env: {} }),
      /edit references unknown model family "kie:removed-model"/,
    );
  });

  it("applies default overrides, then scope overrides per field", () => {
    const policy: CataloguePolicy = {
      overrides: {
        "kie:gpt-image-2": {
          label: "GPT Image 2 (KIE)",
          maskEditing: "supported",
        },
      },
      scopes: {
        test: {},
        edit: {
          overrides: {
            "kie:gpt-image-2": {
              maskEditing: "reference-only",
              price: {
                perImageUsd: { "1K": 0.03 },
                inputPerMillionTokensUsd: 0,
              },
            },
          },
        },
      },
    };
    const root = createImageClient({ app: "x", policy, env: KEYS });
    const base = root.forScope("test").findModel("kie:gpt-image-2");
    const edit = root.forScope("edit").findModel("kie:gpt-image-2");
    assert.equal(base?.label, "GPT Image 2 (KIE)");
    assert.equal(base?.maskEditing, "supported");
    assert.equal(base?.price, null);
    assert.equal(edit?.label, "GPT Image 2 (KIE)");
    assert.equal(edit?.maskEditing, "reference-only");
    assert.deepEqual(edit?.price, {
      perImageUsd: { "1K": 0.03 },
      inputPerMillionTokensUsd: 0,
    });
  });
});

describe("listModels", () => {
  it("derives all installed provider families under canonical IDs", () => {
    const models = client().listModels();
    assert.deepEqual(
      models.map((model) => model.id),
      [
        "google:gemini-nano-banana-2.1",
        "google:gemini-3.1-flash-image",
        "google:gemini-3-pro-image",
        "toapis:gemini-3.1-flash-image-preview",
        "toapis:gpt-image-2",
        "toapis:gpt-image-2.5-flare",
        "toapis:gpt-image-2.5-sunburst",
        "toapis:doubao-seedream-5-0-pro",
        "kie:grok-imagine-image-2-0",
        "kie:gpt-image-2",
        "kie:nano-banana-2",
      ],
    );
    const byId = new Map(models.map((model) => [model.id, model]));
    assert.deepEqual(byId.get("google:gemini-3.1-flash-image")?.resolutions, [
      "1K",
      "2K",
      "4K",
    ]);
    assert.deepEqual(byId.get("kie:gpt-image-2")?.referenceLimit, {
      min: 0,
      max: 16,
    });
    assert.equal(
      byId.get("kie:gpt-image-2")?.providerModel,
      "gpt-image-2-image-to-image",
    );
    assert.equal(byId.get("toapis:gpt-image-2")?.providerLabel, "ToAPIs 提供");
    assert.equal(
      byId.get("kie:grok-imagine-image-2-0")?.maskEditing,
      "reference-only",
    );
  });

  it("marks providers without a key as unavailable", () => {
    const models = client({ env: { GEMINI_API_KEY: "g" } }).listModels();
    assert.equal(
      models.find((model) => model.id === "kie:nano-banana-2")?.available,
      false,
    );
    assert.equal(
      models.find((model) => model.id === "kie:nano-banana-2")
        ?.unavailableReason,
      "伺服器未設定 KIE_API_KEY",
    );
    assert.equal(
      models.find((model) => model.id === "google:gemini-3.1-flash-image")
        ?.available,
      true,
    );
  });

  it("reads alternative secret names in order", () => {
    const toapis = client({
      env: { TOAPI_API_KEY: "legacy" },
      secretNames: { toapis: ["TOAPIS_API_KEY", "TOAPI_API_KEY"] },
    }).findModel("toapis:gpt-image-2");
    assert.equal(toapis?.available, true);
  });
});

describe("prepare: validation before any provider call", () => {
  it("rejects unknown model IDs", async () => {
    await rejectsWith(
      client().prepare(request({ appModelId: "openrouter:gpt-image-2" })),
      "unsupported_model",
      400,
    );
  });

  it("rejects a provider without a key with 503", async () => {
    const error = await rejectsWith(
      client({ env: {} }).prepare(request({ appModelId: "kie:nano-banana-2" })),
      "missing_key",
      503,
    );
    assert.match(error.message, /KIE_API_KEY/);
  });

  it("accepts temperature only where the catalogue lists it, within its range", async () => {
    const prepared = await client().prepare(request({ temperature: 0.7 }));
    assert.equal(prepared.temperature, 0.7);
    await rejectsWith(
      client().prepare(
        request({ appModelId: "kie:nano-banana-2", temperature: 0.7 }),
      ),
      "temperature_unsupported",
      400,
    );
    await rejectsWith(
      client().prepare(request({ temperature: "0.7" })),
      "invalid_request",
      400,
    );
    await rejectsWith(
      client().prepare(request({ temperature: 2.5 })),
      "invalid_request",
      400,
    );
  });

  it("never drops reference images", async () => {
    const six = Array.from({ length: 6 }, () => imagePart(PNG));
    const error = await rejectsWith(
      client().prepare(
        request({
          appModelId: "kie:grok-imagine-image-2-0",
          parts: [{ text: "x" }, ...six],
        }),
      ),
      "reference_limit",
      400,
    );
    assert.match(error.message, /1–5 張/);
  });

  it("chooses family operations without exposing text-to-image or image-to-image to consumers", async () => {
    const text = await client().prepare(
      request({
        appModelId: "kie:gpt-image-2",
        parts: [{ text: "a car" }],
        aspectRatio: "4:5",
      }),
    );
    assert.equal(text.info.id, "gpt-image-2-text-to-image");
    const edit = await client().prepare(
      request({ appModelId: "kie:gpt-image-2" }),
    );
    assert.equal(edit.info.id, "gpt-image-2-image-to-image");
  });

  it("rejects a prompt over the selected operation limit before calling the provider", async () => {
    const long = "x".repeat(8_001);
    const error = await rejectsWith(
      client().prepare(
        request({
          appModelId: "kie:grok-imagine-image-2-0",
          parts: [imagePart(PNG), { text: long }],
        }),
      ),
      "prompt_too_long",
      400,
    );
    assert.match(error.message, /8,000 字元/);
  });
});

describe("prepare: resolution, aspect ratio and reference format", () => {
  it("uses a native ratio or the nearest supported ratio", async () => {
    const aspect = async (
      appModelId: string,
      aspectRatio: string,
      resolution?: "1K" | "2K" | "4K",
    ) =>
      (await client().prepare(request({ appModelId, aspectRatio, resolution })))
        .aspectRatio;
    assert.equal(
      await aspect("google:gemini-3.1-flash-image", "300x250"),
      "5:4",
    );
    assert.equal(
      await aspect("toapis:doubao-seedream-5-0-pro", "300x250"),
      "4:3",
    );
    assert.equal(await aspect("kie:gpt-image-2", "4:5", "2K"), "3:4");
  });

  it("keeps the input aspect where the chosen family operation supports it", async () => {
    const keep = async (
      appModelId: string,
      aspectRatio?: string,
      resolution?: "1K" | "2K",
    ) =>
      (
        await client().prepare(
          request({
            appModelId,
            keepInputAspect: true,
            aspectRatio,
            resolution,
          }),
        )
      ).aspectRatio;
    assert.equal(await keep("google:gemini-3.1-flash-image"), undefined);
    assert.equal(await keep("kie:nano-banana-2"), "auto");
    assert.equal(await keep("kie:gpt-image-2", "1200:675", "2K"), "16:9");
  });

  it("converts references only where the selected family operation cannot accept them", async () => {
    const seen: string[] = [];
    const convertReference = async (
      url: string,
      target: { acceptedMimeTypes: readonly string[] },
    ) => {
      seen.push(url);
      assert.deepEqual(target.acceptedMimeTypes, ["image/png", "image/jpeg"]);
      return JPEG;
    };
    const prepared = await client({ convertReference }).prepare(
      request({
        appModelId: "toapis:doubao-seedream-5-0-pro",
        parts: [imagePart(PNG), imagePart(WEBP)],
      }),
    );
    assert.deepEqual(prepared.referenceImages, [PNG, JPEG]);
    assert.deepEqual(seen, [WEBP]);
    await rejectsWith(
      client().prepare(
        request({
          appModelId: "toapis:doubao-seedream-5-0-pro",
          parts: [imagePart(dataUrl(GIF_BYTES, "image/gif"))],
        }),
      ),
      "invalid_reference",
      400,
    );
  });
});

describe("partsToPrompt", () => {
  it("numbers images in order and keeps the text labels", () => {
    const { prompt, referenceImages } = partsToPrompt([
      { text: "A" },
      imagePart(PNG),
      { text: "B" },
      imagePart(JPEG),
    ]);
    assert.equal(
      prompt,
      "A\n\n[Reference image 1]\n\nB\n\n[Reference image 2]",
    );
    assert.deepEqual(referenceImages, [PNG, JPEG]);
  });
});

describe("run", () => {
  const GOOGLE_URL =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent";

  it("returns the generated image and sends app headers to Google", async () => {
    const fake = createFakeFetch([
      {
        method: "POST",
        url: GOOGLE_URL,
        respond: () =>
          jsonResponse({
            responseId: "r1",
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: PNG.split(",")[1],
                      },
                    },
                  ],
                },
              },
            ],
          }),
      },
    ]);
    const kit = client({
      fetch: fake.fetch,
      googleHeaders: { "User-Agent": "aistudio-build" },
    });
    const result = await kit.run(
      await kit.prepare(request({ temperature: 0.4 })),
    );
    assert.equal(result.dataUrl, PNG);
    assert.equal(result.provider, "google");
    const call = fake.calls[0];
    assert.equal(call?.headers["user-agent"], "aistudio-build");
    const body = JSON.parse(String(call?.body)) as {
      generationConfig: {
        temperature: number;
        imageConfig: { aspectRatio: string };
      };
    };
    assert.equal(body.generationConfig.temperature, 0.4);
    assert.equal(body.generationConfig.imageConfig.aspectRatio, "4:5");
  });

  it("turns package errors into messages that name provider, model and canonical family ID", async () => {
    const fake = createFakeFetch([
      {
        method: "POST",
        url: GOOGLE_URL,
        respond: () =>
          jsonResponse({ error: { message: "API key not valid" } }, 401),
      },
    ]);
    const kit = client({ fetch: fake.fetch });
    await assert.rejects(
      kit.run(await kit.prepare(request())),
      (error: unknown) => {
        assert.ok(error instanceof AppImageError);
        assert.match(
          error.message,
          /^google\/gemini-3\.1-flash-image 金鑰無效或未授權/,
        );
        assert.deepEqual(
          { ...error.details },
          {
            appModelId: "google:gemini-3.1-flash-image",
            provider: "google",
            model: "gemini-3.1-flash-image",
            code: "auth",
            status: 401,
          },
        );
        assert.equal(imageErrorStatus(error), 500);
        assert.equal(imageErrorBody(error).details.code, "auth");
        return true;
      },
    );
  });
});
