import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import aiRouter from "./server/ai/routes";
import adminRouter from "./server/ai/admin";
import billingRouter from "./server/billing/routes";
import authRouter from "./server/auth";

const resolvedFilename = typeof __filename !== "undefined"
  ? __filename
  : fileURLToPath(import.meta.url);
const resolvedDirname = typeof __dirname !== "undefined"
  ? __dirname
  : path.dirname(resolvedFilename);

// Local secrets: read .env from the working directory before any setting is
// used. Variables already present in the real environment win over the file,
// and a missing file is normal in production, where the host supplies secrets.
// Values are never logged, returned or bundled: only server code reads them.
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch {
    // No .env present, which is expected when the host injects variables.
  }
}

// Detect production mode based on env or execution context (e.g., if compiled inside dist)
const isProduction = process.env.NODE_ENV === "production" ||
                     resolvedFilename.endsWith("server.cjs") ||
                     resolvedDirname.endsWith("dist");

/**
 * The app serves a same-origin API and built files. The headers below lock the
 * browser surface down so the page cannot be framed, cannot load code from
 * anywhere but its own origin, and cannot leak the referring URL. Vite's dev
 * server needs inline styles and a websocket for hot reload, so the development
 * policy is looser by exactly those allowances.
 */
const contentSecurityPolicy = isProduction
  ? [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      // RevenueCat Web Billing delegates card entry to Stripe. Keep the
      // allow-list narrow to those two services; no other third-party code runs.
      "script-src 'self' https://js.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.stripe.com https://sdk.revenuecat-static.com",
      "media-src 'self' blob:",
      "font-src 'self' https://sdk.revenuecat-static.com",
      "connect-src 'self' https://api.revenuecat.com https://e.revenue.cat https://*.stripe.com",
      "frame-src 'self' https://*.stripe.com",
      "worker-src 'self' blob:",
    ].join("; ")
  : [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      // Vite needs inline/eval in development; Stripe still needs its SDK and frames.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.stripe.com https://sdk.revenuecat-static.com",
      "media-src 'self' blob:",
      "font-src 'self' data: https://sdk.revenuecat-static.com",
      "connect-src 'self' ws: wss: https://api.revenuecat.com https://e.revenue.cat https://*.stripe.com",
      "frame-src 'self' https://*.stripe.com",
      "worker-src 'self' blob:",
    ].join("; ");

const securityHeaders: Record<string, string> = {
  "Content-Security-Policy": contentSecurityPolicy,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  // The app records with the microphone for dictation, nothing else.
  // RevenueCat Web Billing can use the browser Payment Request / wallet flow.
  "Permissions-Policy": "camera=(), geolocation=(), payment=(self), usb=(), microphone=(self)",
  "X-DNS-Prefetch-Control": "off",
};

/** Simple fixed-window limiter, enough for a single-user app behind one port. */
const createRateLimiter = (limit: number, windowMs: number) => {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now();
    const id = req.ip || req.socket.remoteAddress || "unknown";
    const entry = hits.get(id);

    if (!entry || entry.resetAt <= now) {
      hits.set(id, { count: 1, resetAt: now + windowMs });
      if (hits.size > 5000) hits.clear();
      return next();
    }

    entry.count += 1;
    if (entry.count > limit) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000).toString());
      res.setHeader("Cache-Control", "no-store");
      return res.status(429).type("text/plain").send("Too many requests, slow down.");
    }
    return next();
  };
};

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    Object.entries(securityHeaders).forEach(([name, value]) => res.setHeader(name, value));
    // In dev, Vite rewrites module URLs whenever it re-optimises dependencies.
    // A revalidated 304 would hand the browser an old module graph, so nothing
    // from the dev server is cached at all.
    if (!isProduction) res.setHeader("Cache-Control", "no-store");
    next();
  });

  // Same-origin only: a page on another site cannot drive this server, and no
  // CORS headers are ever sent, so browsers refuse cross-origin reads by default.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const allowed = new Set([
        `http://${req.headers.host}`,
        `https://${req.headers.host}`,
      ]);
      if (!allowed.has(origin)) {
        return res.status(403).type("text/plain").send("Cross-origin requests are not allowed.");
      }
    }
    next();
  });

  app.use(createRateLimiter(600, 60_000));

  // Account registration and login. These routes set an HttpOnly session
  // cookie; every AI and billing route derives its user id from that session.
  app.use("/api/auth", express.json({ limit: "32kb" }), authRouter);

  // Operator routes are mounted first so the AI router's catch-all cannot
  // swallow them. They have their own token check and never expose a key.
  app.use("/api/ai/admin", express.json({ limit: "32kb" }), adminRouter);

  // RevenueCat calls the webhook; its own shared secret is checked inside the
  // router. The same router carries wallet-authenticated sync/link routes.
  app.use("/api/billing", express.json({ limit: "128kb" }), billingRouter);

  // The assistant and billing are the only writable surfaces. Its body is capped, every field
  // is validated in the router, and the origin check above still applies. The
  // larger cap leaves room for a few compressed photo previews.
  app.use("/api/ai", express.json({ limit: "3mb" }), aiRouter);

  // Body-parser failures happen before the router's own handler, so they are
  // caught here: a malformed request gets JSON, never Express's HTML stack trace.
  app.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    const status = error?.status === 413 ? 413 : 400;
    return res.status(status).json({
      error: status === 413 ? "That message is too long." : "The request could not be read.",
      code: status === 413 ? "payload_too_large" : "bad_json",
    });
  });

  // Everything else stays read-only.
  app.use((req, res, next) => {
    const isAiWrite = req.method === "POST" && req.path.startsWith("/api/ai/");
    const isBillingWrite = req.method === "POST" && req.path.startsWith("/api/billing/");
    const isAuthWrite =
      (req.method === "POST" || req.method === "PATCH") && req.path.startsWith("/api/auth/");
    if (req.method !== "GET" && req.method !== "HEAD" && !isAiWrite && !isBillingWrite && !isAuthWrite) {
      res.setHeader("Allow", "GET, HEAD");
      return res.status(405).type("text/plain").send("Method not allowed.");
    }
    next();
  });

  // Never hand out source maps, dotfiles or server bundles. Vite keeps its dev
  // cache in node_modules/.vite, so that directory is the one dot segment that
  // has to stay reachable while developing.
  app.use((req, res, next) => {
    const segments = req.path.split("/").filter(Boolean);
    const hasDotFile = segments.some((part) => part.startsWith(".") && part !== ".vite");
    const looksPrivate = /\.(map|env|pem|key|crt)$/i.test(req.path) || hasDotFile;
    if (looksPrivate || req.path === "/server.cjs") {
      return res.status(404).type("text/plain").send("Not found.");
    }
    next();
  });

  // Vite middleware for development vs static asset serving for production
  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = resolvedDirname.endsWith("dist")
      ? resolvedDirname
      : path.join(resolvedDirname, "dist");

    app.use(express.static(distPath, {
      index: false,
      dotfiles: "deny",
      etag: true,
      maxAge: "1h",
      setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
    }));
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
