/**
 *  Blood Donation - Backend Server
 *  This server handle
 *   - Authentication (JWT)
 *   - Donation management
 *
 *  Database: MongoDB
 *  Middlewares: CORS, JWT Verification, Cookie Parsing
 */

// Load environment variable
require("dotenv").config();

// import required modules
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const express = require("express");
const { MongoClient, ServerApiVersion } = require("mongodb");

// Initial Express app
const app = express();
const port = process.env.PORT || 3000;

// Import utility functions
const { respond } = require("./utils/helpers");

/**
 * =========================
 * Middleware Configuration
 * =========================
 */

// CORS configuration for allowed origins
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);

// Parse JSON bodies and cookies
app.use(express.json());
app.use(cookieParser());

const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Connect to the DB
const db = client.db("blood-donation");

// Collections
const usersCollection = db.collection("users");
const bloodDonorsCollection = db.collection("blood-donors");
const bloodRequestsCollection = db.collection("blood-requests");
const donationsCollection = db.collection("donations");
const blogCollection = db.collection("blogs");

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    // POST: Create a new user
    app.post("/users", async (req, res) => {
      try {
        const userData = {...req.body, createAt: Date.now()};
        const result = await usersCollection.insertOne(userData);
        if (result.insertedId) {
          return respond(res, 200, "User created successfully");
        }
      } catch (error) {
        console.error("Error creating user:", error);
        return respond(res, 500, "Internal server error");
      }
    });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running");
});

app.listen(port, () => {
  console.log(`Server is running on port http://localhost:${port}`);
});
