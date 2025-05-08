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
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// Initial Express app
const app = express();
const port = process.env.PORT || 3000;

// Import utility functions
const { respond, getBloodGroupQuery } = require("./utils/helpers");

/**
 * =========================
 * Middleware Configuration
 * =========================
 */

const validateId = (req, res, next) => {
  // Check both params and query for ID
  const id = req.params.id || req.query.id;

  // Check if ID exists
  if (!id) {
    return respond(
      res,
      400,
      "ID parameter is required (provide in URL path or query)"
    );
  }

  if (!ObjectId.isValid(id)) {
    return respond(res, 400, "Invalid ID format");
  }

  // Store the validated ID in req for consistency
  req.validatedId = new ObjectId(id);
  next();
};

// CORS configuration for allowed origins
app.use(
  cors({
    origin: ["http://localhost:5173", "https://blood-connect-b4710.web.app"],
    credentials: true,
  })
);

// Parse JSON bodies and cookies
app.use(express.json());
app.use(cookieParser());

app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      connectSrc: ["'self'", "*"],
      imgSrc: ["'self'", "data:", "blob:"],
      objectSrc: ["'none'"],
      frameSrc: ["'self'"],
      upgradeInsecureRequests: [],
    },
  })
);

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
const donorCollection = db.collection("donors");
const bloodRequestsCollection = db.collection("blood-requests");
const bloodDonationCollection = db.collection("blood-donations");
const blogCollection = db.collection("blogs");
const messageCollection = db.collection("messages");

async function run() {
  try {
    // Connect the client to the server (optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    await donorCollection.createIndex({
      bloodGroup: 1,
      division: 1,
      district: 1,
      upazila: 1,
      status: 1,
    });

    await bloodRequestsCollection.createIndex({ donationStatus: 1 });
    await bloodRequestsCollection.createIndex({ donorId: 1 });
    await bloodDonationCollection.createIndex({ requestId: 1 });
    await bloodDonationCollection.createIndex({ donorId: 1 });
    await bloodDonationCollection.createIndex({ status: 1 });

    // POST: Create a new user
    app.post("/donors", async (req, res) => {
      try {
        const donorData = req.body;
        // Check donor exists
        const existingDonor = await donorCollection.findOne({
          email: donorData.email,
        });
        if (existingDonor) {
          return respond(
            res,
            409,
            "Donor already exists in the database",
            [],
            {}
          );
        } else {
          const result = await donorCollection.insertOne(donorData);
          if (result.insertedId) {
            return respond(res, 201, "Donor created successfully", [], {});
          }
        }
      } catch (error) {
        console.error("Error creating user:", error);
        return respond(res, 500, "Server error", [], {});
      }
    });

    // GET: Donors result
    app.get("/donors", async (req, res) => {
      try {
        const {
          bloodGroup,
          division,
          district,
          upazila,
          accountStatus = "active",
          page = 1,
          limit = 10,
        } = req.query;
        const bloodGroupQuery = getBloodGroupQuery(bloodGroup);
        const query = {
          accountStatus,
          ...bloodGroupQuery,
          ...(division && { "location.division": new RegExp(division, "i") }),
          ...(district && { "location.district": new RegExp(district, "i") }),
          ...(upazila && { "location.upazila": new RegExp(upazila, "i") }),
        };

        const parsedPage = Math.max(Number(page) || 1, 1);
        const parsedLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
        const skip = (parsedPage - 1) * parsedLimit;

        const [total, donors] = await Promise.all([
          donorCollection.countDocuments(query),
          donorCollection.find(query).skip(skip).limit(parsedLimit).toArray(),
        ]);

        if (donors?.length) {
          return respond(res, 200, "Donors retrieved successfully", donors, {
            total,
            page: parsedPage,
            limit: parsedLimit,
            totalPages: Math.ceil(total / parsedLimit),
          });
        } else {
          return respond(res, 404, "Donors not found", [], {});
        }
      } catch (error) {
        console.error("Error fetching donors:", error);
        return respond(res, 500, "Server error", [], {});
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
          return respond(
            res,
            409,
            "Message already exists in the database",
            [],
            {}
          );
        } else {
          const result = await messageCollection.insertOne(newMessage);
          if (result.insertedId) {
            return respond(res, 201, "Message saved successfully", [], {});
          }
        }
      } catch (error) {
        console.error("Error saved message:", error);
        return respond(res, 500, "Server error", [], {});
      }
    });

    // POST: Blood request for patient
    app.post("/blood-requests", async (req, res) => {
      try {
        const newBloodRequest = req.body;

        // Check for existing request from this user for the same donor
        const existingBloodRequest = await bloodRequestsCollection.findOne({
          "requester.email": newBloodRequest.requester.email,
          "metadata.donorId": newBloodRequest.metadata.donorId,
          "status.current": { $in: ["pending", "inprogress"] }, // Check only active requests
        });

        if (existingBloodRequest) {
          return respond(
            res,
            409,
            "You already have an active request with this donor",
            [],
            {}
          );
        }

        const result = await bloodRequestsCollection.insertOne(newBloodRequest);

        if (result.insertedId) {
          return respond(
            res,
            201,
            "Blood request saved successfully",
            { insertedId: result.insertedId },
            {}
          );
        }
      } catch (error) {
        console.error("Error saving blood request:", error);
        return respond(res, 500, "Server error", [], {});
      }
    });

    // GET: Retrieve all requests
    app.get("/blood-requests", async (req, res) => {
      try {
        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;
        const total = await bloodRequestsCollection.countDocuments();
        const bloodRequests = await bloodRequestsCollection
          .find()
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();
        if (bloodRequests?.length) {
          return respond(
            res,
            200,
            "Blood requests retrieved successfully",
            bloodRequests,
            {
              total,
              page: parseInt(page),
              totalPages: Math.ceil(total / limit),
            }
          );
        } else {
          return respond(res, 404, "No blood requests found", [], {
            total: 0,
            page: parseInt(page),
            totalPages: 0,
          });
        }
      } catch (error) {
        console.error("Error fetching blood requests:", error);
        return respond(res, 500, "Server error", [], {});
      }
    });

    // GET: Retrieve single request by ID
    app.get("/blood-requests/:id", validateId, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const bloodRequest = await bloodRequestsCollection.findOne(query);

        if (bloodRequest) {
          return respond(
            res,
            200,
            "Blood request retrieved successfully",
            bloodRequest,
            {}
          );
        } else {
          return respond(res, 404, "Blood request not found", [], {});
        }
      } catch (error) {
        console.error("Error fetching blood request:", error);
        return respond(res, 500, "Server error", [], {});
      }
    });

    // PATCH: Blood donated by donor
    app.patch("/blood-requests/:id", validateId, async (req, res) => {
      try {
        const { id } = req.params;
        const updateBloodDonation = req.body;

        // Validate required fields
        if (
          !updateBloodDonation.donationStatus ||
          !updateBloodDonation.status?.current
        ) {
          return respond(res, 400, "Missing required status fields", [], {});
        }

        // Get current timestamp
        const currentTime = new Date().toISOString();

        // Prepare update object
        const updateObj = {
          $set: {
            donationStatus: updateBloodDonation.donationStatus,
            updatedAt: currentTime,
            "status.current": updateBloodDonation.status.current,
          },
          $push: {
            "status.history": {
              $each: [
                {
                  status: updateBloodDonation.status.current,
                  changedAt: currentTime,
                  changedBy: {
                    id: updateBloodDonation.donorId || req.user?.id || "system",
                    name:
                      updateBloodDonation.donorName ||
                      req.user?.name ||
                      "system",
                    email:
                      updateBloodDonation.donorEmail ||
                      req.user?.email ||
                      "system",
                    role: "donor",
                  },
                },
              ],
              $slice: -5,
            },
          },
        };

        // Add donor info if it exists
        if (updateBloodDonation.donorId) {
          updateObj.$set.metadata = {
            donorId: updateBloodDonation.donorId,
            donorName: updateBloodDonation.donorName,
            donorEmail: updateBloodDonation.donorEmail,
            updatedAt: currentTime,
          };
        }

        // Update database
        const result = await bloodRequestsCollection.updateOne(
          { _id: new ObjectId(id) },
          updateObj
        );

        if (result.modifiedCount === 1) {
          const updatedRequest = await bloodRequestsCollection.findOne({
            _id: new ObjectId(id),
          });
          return respond(
            res,
            200,
            "Request updated successfully",
            updatedRequest,
            {}
          );
        } else {
          return respond(
            res,
            404,
            "No request found or no changes made",
            [],
            {}
          );
        }
      } catch (error) {
        console.error("PATCH error:", error);
        return respond(res, 500, "Server error", [], {});
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
