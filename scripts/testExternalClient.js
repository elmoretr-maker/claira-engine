/**
 * Claira External Integration Test
 *
 * Simulates a real external platform (e.g. a Wix catalog integration) calling
 * the Claira engine through the public /api/claira/run endpoint.
 *
 * Request shapes are derived from ACTUAL Wix payload fields found in
 * server/index.js (extractWixSummary, extractProductId, extractProductName,
 * extractImageUrlsFromProduct, etc.).
 *
 * Run:  npm run test:external
 * Pre-condition: server must be running — npm run start:server
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Wix instanceId maps to Claira accountId (real field from extractWixSummary).
const WIX_INSTANCE_ID = "wix-instance-abc123def456";

// Shared headers — mirror what a real Wix integration would send.
const SHARED_HEADERS = {
  "Content-Type": "application/json",
  "x-claira-key": "test-key-123",
  "x-claira-request-id": "wix-test-run-001",
};

// ---------------------------------------------------------------------------
// Wix-shaped metadata — fields extracted from real server-side Wix logic.
// These match the shapes parsed by extractWixSummary / extractProductId /
// extractImageUrlsFromProduct in server/index.js.
// ---------------------------------------------------------------------------

/** Realistic Wix catalog event context (mirrors body fields the server reads). */
const WIX_CATALOG_METADATA = {
  // Platform identification
  source: "wix-catalog",
  platform: "wix",

  // Real Wix fields parsed by extractWixSummary
  eventType: "catalog/product-created",
  instanceId: WIX_INSTANCE_ID,
  siteId: "wix-site-xyz789",

  // Real product shape parsed by extractProductId + extractProductName
  product: {
    _id: "prod-001-test",          // extractProductId reads _id, id, productId
    name: "Classic Leather Wallet", // extractProductName reads name, title, productName
    media: {
      mainMedia: {                  // extractImageUrlsFromProduct reads media.mainMedia
        url: "https://static.wixstatic.com/media/example-product.jpg",
      },
    },
    mediaItems: [                   // also read by extractImageUrlsFromProduct
      { url: "https://static.wixstatic.com/media/example-product-2.jpg" },
    ],
  },

  testRun: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * POST to /api/claira/run and return parsed JSON + status.
 * @param {Record<string, any>} body
 * @param {string} [requestId]
 */
async function callClairaRun(body, requestId) {
  const headers = {
    ...SHARED_HEADERS,
    ...(requestId ? { "x-claira-request-id": requestId } : {}),
  };

  const response = await fetch(`${BASE_URL}/api/claira/run`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

/**
 * GET /api/claira/health.
 */
async function callHealth() {
  const response = await fetch(`${BASE_URL}/api/claira/health`);
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

/**
 * Log a test result in a readable format.
 * @param {string} label
 * @param {string} requestId
 * @param {{ status: number, json: any }} result
 */
function logResult(label, requestId, result) {
  const { status, json } = result;
  const ok = status >= 200 && status < 300 && json.success !== false;
  const badge = ok ? "✅ PASS" : "❌ FAIL";

  console.log(`\n${badge}  ${label}`);
  console.log(`       rid: ${requestId}`);
  console.log(`    status: HTTP ${status}`);
  console.log(`  response: ${JSON.stringify(json, null, 2).split("\n").join("\n            ")}`);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

async function runTests() {
  console.log("=".repeat(60));
  console.log("  Claira External Integration Test");
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Account (Wix instanceId): ${WIX_INSTANCE_ID}`);
  console.log("=".repeat(60));

  let passed = 0;
  let failed = 0;

  // ── Test 0: Health check ──────────────────────────────────────────────────
  {
    const result = await callHealth();
    const ok = result.status === 200 && result.json.status === "ok";
    console.log(`\n${ok ? "✅ PASS" : "❌ FAIL"}  Health check`);
    console.log(`  response: ${JSON.stringify(result.json)}`);
    ok ? passed++ : failed++;
  }

  // ── Test 1: getRiskInsights — Wix catalog context ─────────────────────────
  // Uses the same accountId / metadata fields the Wix integration would send.
  // getRiskInsights needs no operation-specific fields; returns current risk state.
  {
    const rid = "wix-test-risk-001";
    const result = await callClairaRun(
      {
        kind: "getRiskInsights",
        accountId: WIX_INSTANCE_ID,       // Wix instanceId as accountId
        environment: "development",
        metadata: WIX_CATALOG_METADATA,
      },
      rid,
    );
    logResult("getRiskInsights (Wix catalog context)", rid, result);
    result.json.success !== false ? passed++ : failed++;
  }

  // ── Test 2: getSuggestions — Wix catalog context ──────────────────────────
  // getSuggestions returns current engine suggestions with no required fields.
  {
    const rid = "wix-test-suggest-002";
    const result = await callClairaRun(
      {
        kind: "getSuggestions",
        accountId: WIX_INSTANCE_ID,
        environment: "development",
        metadata: {
          ...WIX_CATALOG_METADATA,
          eventType: "catalog/product-updated",  // different real Wix event type
          product: {
            _id: "prod-002-test",
            name: "Premium Denim Jacket",
            media: {
              mainMedia: {
                url: "https://static.wixstatic.com/media/example-jacket.jpg",
              },
            },
          },
        },
      },
      rid,
    );
    logResult("getSuggestions (Wix product-updated context)", rid, result);
    result.json.success !== false ? passed++ : failed++;
  }

  // ── Test 3: listIndustryPacks — no operation-specific fields required ─────
  {
    const rid = "wix-test-packs-003";
    const result = await callClairaRun(
      {
        kind: "listIndustryPacks",
        accountId: WIX_INSTANCE_ID,
        environment: "development",
        metadata: { source: "wix-catalog", platform: "wix", testRun: true },
      },
      rid,
    );
    logResult("listIndustryPacks (Wix context)", rid, result);
    result.json.success !== false ? passed++ : failed++;
  }

  // ── Test 4: Invalid kind — must return 400 with success: false ────────────
  {
    const rid = "wix-test-bad-kind-004";
    const result = await callClairaRun(
      {
        kind: "nonExistentOperation",
        accountId: WIX_INSTANCE_ID,
        metadata: { testRun: true },
      },
      rid,
    );
    const ok = result.status === 400 && result.json.success === false;
    console.log(`\n${ok ? "✅ PASS" : "❌ FAIL"}  Invalid kind → 400 with success:false`);
    console.log(`       rid: ${rid}`);
    console.log(`    status: HTTP ${result.status}`);
    console.log(`  response: ${JSON.stringify(result.json)}`);
    ok ? passed++ : failed++;
  }

  // ── Test 5: Missing kind — must return 400 ────────────────────────────────
  {
    const rid = "wix-test-no-kind-005";
    const result = await callClairaRun(
      {
        accountId: WIX_INSTANCE_ID,
        metadata: { testRun: true },
        // kind intentionally omitted
      },
      rid,
    );
    const ok = result.status === 400 && result.json.success === false;
    console.log(`\n${ok ? "✅ PASS" : "❌ FAIL"}  Missing kind → 400 with success:false`);
    console.log(`       rid: ${rid}`);
    console.log(`    status: HTTP ${result.status}`);
    console.log(`  response: ${JSON.stringify(result.json)}`);
    ok ? passed++ : failed++;
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60) + "\n");

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("\n❌ Test runner failed (is the server running?)");
  console.error(`   ${err.message}`);
  console.error(`   Start the server with: npm run start:server`);
  process.exit(1);
});
