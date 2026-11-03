import devServer from "@hono/vite-dev-server"
import fs from "node:fs"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

function gameWebSocket(): Plugin {
  return {
    name: "dnd-board-game-websocket",
    configureServer(viteServer) {
      const httpServer = viteServer.httpServer
      if (!httpServer) return

      const hubPromise = viteServer.ssrLoadModule("/api/realtime/hub").then((module) => {
        const { createGameHub, registerHub } = module as typeof import("./api/realtime/hub")
        const hub = createGameHub()
        registerHub(hub)
        return hub
      })

      httpServer.on("upgrade", (request, socket, head) => {
        let pathname = ""
        try {
          pathname = new URL(request.url ?? "/", "http://localhost").pathname
        } catch {
          return
        }
        // Leave Vite HMR and every other upgrade to their own listeners.
        if (pathname !== "/ws") return
        void hubPromise.then((hub) => hub.handleUpgrade(request, socket, head)).catch(() => {
          socket.destroy()
        })
      })

      httpServer.once("close", () => {
        void hubPromise.then((hub) => hub.close())
      })
    },
  }
}

function sqliteRuntime(): Plugin {
  return {
    name: "dnd-board-sqlite-runtime",
    apply: "build",
    closeBundle() {
      // Dynamic preview deploys dist/ without the project's node_modules.
      // Keep the native driver external to esbuild, but ship its minimal
      // platform-specific runtime beside boot.js. On Windows this copies the
      // Windows binary built on that runner; no cross-build artifacts are used.
      const sourceRoot = path.resolve(__dirname, "node_modules")
      const runtimeRoot = path.resolve(__dirname, "dist/node_modules")
      const sqliteSource = path.join(sourceRoot, "better-sqlite3")
      const sqliteTarget = path.join(runtimeRoot, "better-sqlite3")
      const nativeBinary = path.join(sqliteSource, "build/Release/better_sqlite3.node")
      if (!fs.existsSync(nativeBinary)) {
        throw new Error(`Missing native SQLite binary: ${nativeBinary}`)
      }

      fs.rmSync(sqliteTarget, { recursive: true, force: true })
      fs.mkdirSync(path.dirname(sqliteTarget), { recursive: true })
      fs.cpSync(path.join(sqliteSource, "lib"), path.join(sqliteTarget, "lib"), { recursive: true })
      fs.mkdirSync(path.join(sqliteTarget, "build/Release"), { recursive: true })
      fs.copyFileSync(nativeBinary, path.join(sqliteTarget, "build/Release/better_sqlite3.node"))
      for (const file of ["package.json", "LICENSE"]) {
        fs.copyFileSync(path.join(sqliteSource, file), path.join(sqliteTarget, file))
      }
      for (const dependency of ["bindings", "file-uri-to-path"]) {
        const target = path.join(runtimeRoot, dependency)
        fs.rmSync(target, { recursive: true, force: true })
        fs.cpSync(path.join(sourceRoot, dependency), target, { recursive: true })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    inspectAttr(), react(), gameWebSocket(), sqliteRuntime()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  ssr: {
    external: ["better-sqlite3", "bindings"],
  },
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
