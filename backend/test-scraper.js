require("dotenv").config();

const { scrapeProduct } = require("./src/scraper/scraper");
const { withRetry } = require("./src/scraper/retry");

async function main() {
  const result = await withRetry(
    () =>
      scrapeProduct({
        productId: 2655,
        productUrl: "https://demo.inelabteamdev.com/item/2655",
        optionId: "o1",
        optionLabel: "64 GB",
        headless: false,
      }),
    {
      maxAttempts: 3,
      delayMs: 2000,
    }
  );

  console.dir(result, { depth: null });
}

main();
