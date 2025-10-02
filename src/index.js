// Node.js file server with cluster, streaming upload, Redis session, and S3-style URL response

import cluster from "cluster";
import os from "os";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import redis from "redis";
import session from "express-session";
import RedisStore from "connect-redis";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "../storage");
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const BASE_URL = process.env.BASE_URL || "https://yourdomain.com/files";

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  console.log(`Primary ${process.pid} is running`);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  cluster.on("exit", (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
    cluster.fork();
  });
} else {
  const app = express();

  app.use(
    cors({
      origin: "*", // Allow all origins for development; restrict in production
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
  const redisClient = redis.createClient({ url: REDIS_URL });
  redisClient
    .connect(() => console.log("Connected to Redis"))
    .catch(console.error);

  app.use(
    session({
      store: new RedisStore({ client: redisClient }),
      secret: "your-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false }, // Set to true if behind SSL
    })
  );

  // Streaming upload handler
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, unique + path.extname(file.originalname));
    },
  });
  const upload = multer({ storage });

  // Upload endpoint
  app.post("/upload", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    // Track upload in Redis (for progress, etc.)
    await redisClient.set(
      `upload:${req.file.filename}`,
      JSON.stringify({
        original: req.file.originalname,
        size: req.file.size,
        uploaded: true,
        timestamp: Date.now(),
      }),
      { EX: 3600 }
    );
    // Return S3-style URL
    const fileUrl = `${BASE_URL}/${req.file.filename}`;
    res.json({ url: fileUrl });
  });

  // Upload progress endpoint
  app.get("/upload/progress/:filename", async (req, res) => {
    try {
      const data = await redisClient.get(`upload:${req.params.filename}`);
      if (!data) return res.status(404).json({ error: "No progress found" });
      res.json(JSON.parse(data));
    } catch (err) {
      res.status(500).json({ error: "Error fetching progress" });
    }
  });

  app.get("/", (req, res) => {
    res.send("File server is running");
  });

  // Serve files (Nginx should handle this in production)
  app.use("/files", express.static(UPLOAD_DIR));

  app.listen(process.env.PORT, () => {
    console.log(`Worker ${process.pid} started on port ${process.env.PORT}`);
  });
}
