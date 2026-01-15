import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import os from "os";

dotenv.config();

const app = express();

// ===== Config =====
const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const APP_API_KEY = process.env.APP_API_KEY;
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 200);
const JOB_TTL_MINUTES = Number(process.env.JOB_TTL_MINUTES || 60);
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini-transcribe";

if (!OPENAI_API_KEY || !APP_API_KEY) {
  console.error("Missing environment variables");
  process.exit(1);
}

// ===== Middleware =====
app.use(cors());
app.use(express.json());

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60
  })
);

// Auth simples
function

