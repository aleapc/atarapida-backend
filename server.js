import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import os from "os";
import path from "path";

dotenv.config();

const app = express();

// ===== Config =====
const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const APP_API_KEY = process.env.APP_API_KEY;
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 200);
const JOB_TTL_MINUTES = Number(process.env.JOB_TTL_MINUTES || 60);
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini-transcribe";

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY");
  process.exit(1);
}
if (!APP_API_KEY) {
  console.error("Missing APP_API_KEY");
  process.exit(1);
}

// ===== Middleware =====
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60
  })
);

// Auth simples
function auth(req, res, next) {
  const key = req.header("X-APP-KEY");
  if (!key || key !== APP_API_KEY) {
    return res.status(401).json({ error: "unauthorized", message: "Invalid X-APP-KEY" });
  }
  next();
}

// Upload config (temp file in /tmp)
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_, file, cb) => {
      const ext = path.extname(file.originalname || ".m4a") || ".m4a";
      cb(null, `atarapida_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);
    }
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 }
});

// Jobs in memory
const jobs = new Map(); // jobId -> { status, createdAt, transcript?, error? }

// Cleanup old jobs
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > JOB_TTL_MINUTES * 60 * 1000) jobs.delete(id);
  }
}, 60 * 1000).unref();

// Health
app.get("/health", (_, res) => res.json({ ok: true }));

// POST /transcribe
app.post("/transcribe", auth, upload.single("audio"), async (req, res) => {
  if (!req.file?.path) {
    return res.status(400).json({ error: "bad_request", message: 'Missing file field "audio"' });
  }

  const jobId = uuidv4();
  jobs.set(jobId, { status: "processing", createdAt: Date.now() });

  // respond immediately
  res.status(202).json({ jobId });

  const filePath = req.file.path;

  try {
    const buffer = await fs.promises.readFile(filePath);

    const form = new FormData();
    form.append("file", new Blob([buffer]), path.basename(filePath));
    form.append("model", OPENAI_MODEL);
    form.append("language", "pt");

    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form
    });

    const raw = await resp.text();
    if (!resp.ok) {
      jobs.set(jobId, { status: "error", createdAt: jobs.get(jobId).createdAt, error: raw });
      return;
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { text: raw };
    }

    const transcript = (data.text || "").trim();
    jobs.set(jobId, { status: "done", createdAt: jobs.get(jobId).createdAt, transcript });
  } catch (e) {
    jobs.set(jobId, { status: "error", createdAt: jobs.get(jobId).createdAt, error: String(e?.message || e) });
  } finally {
    try {
      await fs.promises.unlink(filePath);
    } catch {}
  }
});

// GET /jobs/:id
app.get("/jobs/:id", auth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "not_found", message: "Job not found or expired" });

  if (job.status === "processing") return res.json({ status: "processing" });
  if (job.status === "error") return res.json({ status: "error", error: job.error || "Unknown error" });

  return res.json({ status: "done", transcript: job.transcript || "" });
});

// Start
app.listen(PORT, () => {
  console.log(`AtaRapida API running on port ${PORT}`);
});

