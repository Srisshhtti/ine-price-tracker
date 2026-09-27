require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");
const supabase = require("./src/config/supabase");
const { scrapeProduct } = require("./src/scraper/scraper");
const { withRetry } = require("./src/scraper/retry");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const STORE_URL = process.env.STORE_URL || "https://demo.inelabteamdev.com";

app.get("/", (req, res) => {
  res.json({ message: "INE Price Tracker API is running" });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// SEARCH PRODUCTS
app.get("/api/products/search", async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();

  if (!q) return res.json([]);

  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(STORE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForTimeout(1500);

    const products = await page.locator('a[href*="/item/"]').evaluateAll(
      (links) =>
        links.map((a) => ({
          name: a.innerText.trim().replace(/\s+/g, " "),
          url: new URL(a.getAttribute("href"), location.origin).href,
        }))
    );

    const unique = [];
    const seen = new Set();

    for (const p of products) {
      const match = p.url.match(/\/item\/(\d+)/);
      if (!match) continue;

      const id = Number(match[1]);
      if (seen.has(id)) continue;

      if (p.name.toLowerCase().includes(q)) {
        seen.add(id);
        unique.push({
          id,
          name: p.name.replace(/OPEN ITEM.*/i, "").trim(),
          url: p.url,
        });
      }
    }

    res.json(unique.slice(0, 20));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Product search failed" });
  } finally {
    if (browser) await browser.close();
  }
});

// PRODUCT DETAILS / OPTIONS
app.get("/api/products/:id", async (req, res) => {
  const id = Number(req.params.id);
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`${STORE_URL}/item/${id}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForTimeout(800);

    const data = await page.evaluate(() => {
      const body = document.body.innerText;

      const options = [...document.querySelectorAll("button.opt-chip")]
        .map((x) => ({
          id: x.getAttribute("data-option-id") || x.dataset.id || x.innerText.trim(),
          label: x.innerText.trim(),
        }))
        .filter((x) => x.label);

      const title =
        document.querySelector("h1")?.innerText?.trim() ||
        document.title.replace(/\s*\|.*$/, "").trim();

      return { name: title, options, body };
    });

    res.json({
      id,
      name: data.name,
      options: data.options,
      url: `${STORE_URL}/item/${id}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load product" });
  } finally {
    if (browser) await browser.close();
  }
});

// TRACK PRODUCT
app.post("/api/tracked", async (req, res) => {
  try {
    const {
      store_product_id,
      product_name,
      product_url,
      selected_option,
      selected_option_id,
    } = req.body;

    if (
      !store_product_id ||
      !product_name ||
      !product_url ||
      !selected_option ||
      !selected_option_id
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const { data, error } = await supabase
      .from("tracked_products")
      .insert({
        store_product_id,
        product_name,
        product_url,
        selected_option,
        selected_option_id,
        active: true,
      })
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET TRACKED PRODUCTS
app.get("/api/tracked", async (req, res) => {
  const { data, error } = await supabase
    .from("tracked_products")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

// SCRAPE ONE TRACKED PRODUCT
app.post("/api/tracked/:id/scrape", async (req, res) => {
  const trackedId = Number(req.params.id);

  try {
    const { data: product, error } = await supabase
      .from("tracked_products")
      .select("*")
      .eq("id", trackedId)
      .single();

    if (error || !product) {
      return res.status(404).json({ error: "Tracked product not found" });
    }

    const result = await withRetry(
      () =>
        scrapeProduct({
          productId: product.store_product_id,
          productUrl: product.product_url,
          optionId: product.selected_option_id,
          optionLabel: product.selected_option,
          headless: true,
        }),
      { maxAttempts: 3, delayMs: 1500 }
    );

    for (const attempt of result.attempts) {
      await supabase.from("scrape_attempts").insert({
        tracked_product_id: trackedId,
        attempt_number: attempt.attempt,
        timestamp: new Date().toISOString(),
        outcome: attempt.success
          ? "success"
          : attempt.attempt < result.attempts.length
            ? "retried"
            : "failed",
        price: attempt.price ?? null,
        stock: attempt.stock ?? null,
        error_message: attempt.error || null,
        http_status: attempt.httpStatus || null,
        duration_ms: attempt.durationMs || null,
      });
    }

    const final = result.result;

    await supabase
      .from("tracked_products")
      .update({
        last_scraped_at: new Date().toISOString(),
        ...(result.success
          ? {
              current_price: final.price,
              current_stock: final.stock,
              last_success_at: new Date().toISOString(),
            }
          : {}),
      })
      .eq("id", trackedId);

    if (
      result.success &&
      typeof final.price === "number" &&
      typeof final.stock === "number"
    ) {
      await supabase.from("price_history").insert({
        tracked_product_id: trackedId,
        price: final.price,
        stock: final.stock,
        timestamp: new Date().toISOString(),
      });
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// HISTORY
app.get("/api/tracked/:id/history", async (req, res) => {
  const { data, error } = await supabase
    .from("price_history")
    .select("*")
    .eq("tracked_product_id", Number(req.params.id))
    .order("timestamp", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

// LOGS
app.get("/api/tracked/:id/logs", async (req, res) => {
  const { data, error } = await supabase
    .from("scrape_attempts")
    .select("*")
    .eq("tracked_product_id", Number(req.params.id))
    .order("timestamp", { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

// CSV EXPORT
app.get("/api/export.csv", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("scrape_attempts")
      .select(`
        tracked_product_id,
        attempt_number,
        timestamp,
        outcome,
        price,
        stock,
        tracked_products (
          store_product_id,
          product_name,
          selected_option
        )
      `)
      .order("timestamp", { ascending: true });

    if (error) throw error;

    const header =
      "product_id,product_name,selected_option,timestamp_utc,price,stock,outcome\n";

    const rows = data
      .map((r) => {
        const p = r.tracked_products;
        const escape = (v) =>
          `"${String(v ?? "").replace(/"/g, '""')}"`;

        return [
          p?.store_product_id,
          escape(p?.product_name),
          escape(p?.selected_option),
          r.timestamp,
          r.price ?? "",
          r.stock ?? "",
          r.outcome,
        ].join(",");
      })
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="scrape-history.csv"'
    );

    res.send(header + rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CRON
app.post("/api/cron/scrape", async (req, res) => {
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { data: products, error } = await supabase
    .from("tracked_products")
    .select("*")
    .eq("active", true);

  if (error) return res.status(500).json({ error: error.message });

  const results = [];

  for (const product of products || []) {
    try {
      const response = await fetch(
        `${req.protocol}://${req.get("host")}/api/tracked/${product.id}/scrape`,
        {
          method: "POST",
        }
      );

      results.push({
        id: product.id,
        status: response.ok ? "completed" : "failed",
      });
    } catch (err) {
      results.push({ id: product.id, status: "failed" });
    }
  }

  res.json({ results });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
