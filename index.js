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
const userCollection = db.collection("users");
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

    await userCollection.createIndex({
      bloodGroup: 1,
      division: 1,
      district: 1,
      upazila: 1,
      status: 1,
    });

    await userCollection.createIndex({ email: 1 });
    await bloodRequestsCollection.createIndex({ donationStatus: 1 });
    await bloodRequestsCollection.createIndex({ donorId: 1 });
    await bloodDonationCollection.createIndex({ requestId: 1 });
    await bloodDonationCollection.createIndex({ donorId: 1 });
    await bloodDonationCollection.createIndex({ status: 1 });

    // POST: Create a new user
    app.post("/users", async (req, res) => {
      try {
        const userData = req.body;
        // Check user exists
        const existingUser = await userCollection.findOne({
          email: userData.email,
        });
        if (existingUser) {
          return respond(
            res,
            409,
            "User already exists in the database",
            [],
            {}
          );
        } else {
          const result = await userCollection.insertOne(userData);
          if (result.insertedId) {
            return respond(res, 201, "User created successfully", [], {});
          }
        }
      } catch (error) {
        console.error("Error creating user:", error);
        return respond(res, 500, "Server error", [], {});
      }
    });

    // GET: Retrieve single user with flexible filtering
    app.get("/users/find", async (req, res) => {
      try {
        const { email } = req.query;

        // Email must be provided
        if (!email) {
          return respond(res, 400, "Email parameter is required", [], {});
        }

        // Find the user
        const user = await userCollection.findOne({ email: email });
        if (user) {
          return respond(res, 200, "User retrieved successfully", user, {});
        } else {
          return respond(
            res,
            404,
            "User not found with the specified criteria",
            [],
            {}
          );
        }
      } catch (error) {
        console.error("Error fetching user:", error);
        return respond(res, 500, "Server error", [], {});
      }
    });

    // GET: Users result
    app.get("/users", async (req, res) => {
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

        const [total, users] = await Promise.all([
          userCollection.countDocuments(query),
          userCollection.find(query).skip(skip).limit(parsedLimit).toArray(),
        ]);

        if (users?.length) {
          return respond(res, 200, "Users retrieved successfully", users, {
            total,
            page: parsedPage,
            limit: parsedLimit,
            totalPages: Math.ceil(total / parsedLimit),
          });
        } else {
          return respond(res, 404, "Users not found", [], {});
        }
      } catch (error) {
        console.error("Error fetching users:", error);
        return respond(res, 500, "Server error", [], {});
      }
    });

    // PATCH: Update user data
    app.patch("/users/:id", validateId, async (req, res) => {
      const id = req.validatedId;
      const updateData = req.body;

      try {
        const { _id, email, createdAt, ...safeUpdateData } = updateData;
        safeUpdateData.updatedAt = new Date().toISOString();
        const result = await userCollection.updateOne(
          { _id: id },
          { $set: safeUpdateData }
        );

        if (result.matchedCount === 0) {
          return respond(res, 404, "User not found", [], {});
        }

        if (result.modifiedCount === 1) {
          const updatedUser = await userCollection.findOne({ _id: id });
          return respond(
            res,
            200,
            "User updated successfully",
            updatedUser,
            {}
          );
        } else {
          return respond(res, 200, "No changes were made to the user", [], {});
        }
      } catch (error) {
        console.error("Error updating user:", error);
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

        // 1. Prevent self-donation (requester = donor)
        if (
          newBloodRequest.requester.email ===
          newBloodRequest.metadata.donorEmail
        ) {
          return respond(
            res,
            403,
            "You cannot create a blood request for yourself",
            [],
            {}
          );
        }

        // 2. Check if donor is already engaged with this requester
        const existingRequesterDonorPair =
          await bloodRequestsCollection.findOne({
            "requester.email": newBloodRequest.requester.email,
            "metadata.donorEmail": newBloodRequest.metadata.donorEmail,
            "status.current": { $in: ["pending", "inprogress"] },
          });

        if (existingRequesterDonorPair) {
          return respond(
            res,
            409,
            "This donor is already assisting with your active request",
            [],
            {}
          );
        }

        // 3. Check if donor is busy with other requests
        const donorEngagedElsewhere = await bloodRequestsCollection.findOne({
          "metadata.donorEmail": newBloodRequest.metadata.donorEmail,
          "status.current": "inprogress",
        });

        if (donorEngagedElsewhere) {
          return respond(
            res,
            409,
            "This donor is currently helping another patient",
            [],
            {}
          );
        }

        // All checks passed - create request
        const result = await bloodRequestsCollection.insertOne(newBloodRequest);

        if (result.insertedId) {
          return respond(
            res,
            201,
            "Blood request created successfully",
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
        const id = req.validateId;
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
        const { id } = req.validateId;
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
