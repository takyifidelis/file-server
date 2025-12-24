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
const REDIS_URL =  process.env.FILESERVER_REDIS_URL || "redis://localhost:6379/0";
const BASE_URL = process.env.FILESERVER_BASE_URL || "https://yourdomain.com/files";

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
  // const redisClient = redis.createClient({ url: REDIS_URL });
  const redisClient = redis.createClient({ url: REDIS_URL });
  // await redisClient.connect();
  redisClient
  .connect(() => console.log("Connected to Redis"))
  .catch(console.error);
  await redisClient.select(0);

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
    console.log('file uploaded ', req.file)
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
    console.log('file info saved to redis')
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

  app.get("/health", (req, res) => {
    res.send("File server is running");
  });

  app.delete("/:filename", async (req, res) => {
    const filePath = path.join(UPLOAD_DIR, req.params.filename);
    console.log('request recieved ', req.params.filename)
    try {
      // Delete file from filesystem
      await fs.promises.unlink(filePath);
      
      // Remove file metadata from Redis
      await redisClient.del(`upload:${req.params.filename}`);
      
      res.json({ message: "File deleted successfully" });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: "File not found" });
      }
      console.error("Error deleting file:", err);
      res.status(500).json({ error: "Failed to delete file" });
    }
  });

  // Serve files (Nginx should handle this in production)
  app.use("/", express.static(UPLOAD_DIR));

  app.listen(process.env.FILESERVER_PORT, () => {
    console.log(`Worker ${process.pid} started on port ${process.env.FILESERVER_PORT}`);
    console.log(`url is ${BASE_URL}`);
  });
}
