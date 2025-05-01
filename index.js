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
const messageCollection = db.collection("messages");

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    await usersCollection.createIndex({
      bloodGroup: 1,
      division: 1,
      district: 1,
      upazila: 1,
      status: 1,
    });

    // POST: Create a new user
    app.post("/users", async (req, res) => {
      try {
        const userData = req.body;
        // Check user
        const existingUser = await usersCollection.findOne({
          email: userData.email,
        });
        if (existingUser) {
          return respond(res, 409, "User already exists in the database");
        } else {
          const result = await usersCollection.insertOne(userData);
          if (result.insertedId) {
            return respond(res, 201, "User created successfully");
          }
        }
      } catch (error) {
        console.error("Error creating user:", error);
        return respond(res, 500, "Internal server error");
      }
    });

    // GET: Retrieve users data
    // GET: Retrieve users data with search and pagination
    app.get("/users", async (req, res) => {
      try {
        const {
          bloodGroup,
          division,
          district,
          upazila,
          status = "active",
          page = 1,
          limit = 10,
        } = req.query;
        const query = { status };
        if (bloodGroup) query.bloodGroup = bloodGroup;
        if (division) query.division = division;
        if (district) query.district = district;
        if (upazila) query.upazila = upazila;
        const skip = (page - 1) * limit;
        const total = await usersCollection.countDocuments(query);
        const donors = await usersCollection
          .find(query)
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        if (donors.length > 0) {
          return respond(res, 200, "Donors found successfully", {
            data: donors,
            total,
            page: parseInt(page),
            totalPages: Math.ceil(total / limit),
          });
        } else {
          return respond(res, 200, "No donors found matching your criteria", {
            data: [],
            total: 0,
            page: parseInt(page),
            totalPages: 0,
          });
        }
      } catch (error) {
        console.error("Error fetching donors:", error);
        return respond(res, 500, "Internal server error");
      }
    });

    // POST: Save a message
    app.post("/messages", async (req, res) => {
      try {
        const newMessage = req.body;
        // Check message
        const existingMessage = await messageCollection.findOne({
          email: newMessage.email,
        });
        if (existingMessage) {
          return respond(res, 409, "Message already exists in the database");
        } else {
          const result = await messageCollection.insertOne(newMessage);
          if (result.insertedId) {
            return respond(res, 201, "Message saved successfully");
          }
        }
      } catch (error) {
        console.error("Error saved message:", error);
        return respond(res, 500, "Internal server error");
      }
    });

    // POST: Create a request for blood
    app.post("/blood-request", async (req, res) => {
      try {
        const newBloodRequest = req.body;
        // Check message
        const existingMessage = await messageCollection.findOne({
          email: newBloodRequest.email,
        });
        if (existingMessage) {
          return respond(res, 409, "Blood data already exists in the database");
        } else {
          const result = await bloodRequestsCollection.insertOne(newBloodRequest);
          if (result.insertedId) {
            return respond(res, 201, "Blood data saved successfully");
          }
        }
      } catch (error) {
        console.error("Error saved message:", error);
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
