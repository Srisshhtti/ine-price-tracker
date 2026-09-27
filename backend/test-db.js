require("dotenv").config();

const supabase = require("./src/config/supabase");

async function test() {
  const { data, error } = await supabase
    .from("tracked_products")
    .select("*")
    .limit(5);

  if (error) {
    console.error("❌ Database connection failed:");
    console.error(error);
    return;
  }

  console.log("✅ Supabase connected successfully!");
  console.log("Rows:", data);
}

test();
