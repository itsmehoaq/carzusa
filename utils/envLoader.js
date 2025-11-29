const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const basePath = path.join(__dirname, "../.env");
  dotenv.config({ path: basePath });

  const isDev = process.env.DEV_MODE === "true" || process.env.DEV_MODE === "1";

  if (isDev) {
    const devPath = path.join(__dirname, "../.env.development");

    if (fs.existsSync(devPath)) {
      console.log("DEV_MODE detected. Loading overrides from .env.development");

      const devConfig = dotenv.parse(fs.readFileSync(devPath));
      for (const k in devConfig) {
        process.env[k] = devConfig[k];
      }
    } else {
      console.warn("DEV_MODE is on, but .env.development file is missing!");
    }
  } else {
    console.log("Production Mode Active. Using .env configuration.");
  }
}

module.exports = loadEnv;
