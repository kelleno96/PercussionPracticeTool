import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

const certPath = path.resolve(__dirname, "192.168.86.243+2.pem");
const keyPath = path.resolve(__dirname, "192.168.86.243+2-key.pem");

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    https:
      fs.existsSync(certPath) && fs.existsSync(keyPath)
        ? {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath)
          }
        : undefined
  }
});
