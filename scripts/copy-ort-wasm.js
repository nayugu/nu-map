// Copies the ONNX Runtime WASM files needed by the translation worker from
// node_modules into public/ort/ so Vite serves them as static assets.
// Runs automatically before `npm run dev` and `npm run build`.
import { cpSync, mkdirSync } from "fs";

const src = "node_modules/onnxruntime-web/dist/";
const dst = "public/ort/";

mkdirSync(dst, { recursive: true });

for (const file of [
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
]) {
  cpSync(`${src}${file}`, `${dst}${file}`);
}
