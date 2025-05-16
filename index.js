/**
 * Blood Donation - Backend Server
 * This server handles:
 * - Authentication (JWT)
 * - Donation management
 *
 * Database: MongoDB
 * Middlewares: CORS, JWT Verification, Cookie Parsing
 */

require("dotenv").config();

const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// Import utility functions
const { respond, getBloodGroupQuery, paginate } = require("./utils/helpers");

/**
 * =========================
 * Middleware Configuration
 * =========================
 */

const validateId = (req, res, next) => {
  const id = req.params.id || req.query.id;

  if (!id) {
    return respond(
      res,
      400,
      "ID parameter is required (provide in URL path or query)"
    );
  }

  try {
    req.validatedId = new ObjectId(id);
    next();
  } catch (error) {
    return respond(res, 400, "Invalid ID format");
  }
};

app.use(
  cors({
    origin: ["http://localhost:5173", "https://blood-connect-b4710.web.app"],
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());
app.use(helmet());

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const db = client.db("blood-donation");
const userCollection = db.collection("users");
const bloodRequestsCollection = db.collection("blood-requests");
const bloodDonationCollection = db.collection("blood-donations");
const blogCollection = db.collection("blogs");
const messageCollection = db.collection("messages");

async function run() {
  try {
    await client.db("admin").command({ ping: 1 });
    console.log("Successfully connected to MongoDB!");

    // Create indexes
    await userCollection.createIndexes([
      {
        key: {
          bloodGroup: 1,
          division: 1,
          district: 1,
          upazila: 1,
          status: 1,
        },
      },
      { key: { email: 1 } },
    ]);

    await bloodRequestsCollection.createIndexes([
      { key: { donationStatus: 1 } },
      { key: { donorId: 1 } },
    ]);

    await bloodDonationCollection.createIndexes([
      { key: { requestId: 1 } },
      { key: { donorId: 1 } },
      { key: { status: 1 } },
    ]);

    // POST: Create a new user
    app.post("/users", async (req, res) => {
      try {
        const userData = req.body;
        const existingUser = await userCollection.findOne({
          email: userData.email,
        });

        if (existingUser) {
          return respond(res, 409, "User already exists");
        }

        const result = await userCollection.insertOne(userData);
        if (result.insertedId) {
          return respond(res, 201, "User created successfully");
        }
      } catch (error) {
        console.error("Error creating user:", error);
        return respond(res, 500, "Server error");
      }
    });

    // GET: Retrieve single user by email
    app.get("/users/find", async (req, res) => {
      try {
        const { email } = req.query;

        if (!email) {
          return respond(res, 400, "Email parameter is required");
        }

        const user = await userCollection.findOne({ email });
        if (user) {
          return respond(res, 200, "User retrieved successfully", user);
        }
        return respond(res, 404, "User not found");
      } catch (error) {
        console.error("Error fetching user:", error);
        return respond(res, 500, "Server error");
      }
    });

    // GET: Users with pagination and filtering
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

        const { items: users, meta } = await paginate(userCollection, query, {
          page,
          limit,
        });

        if (users.length) {
          return respond(res, 200, "Users retrieved successfully", users, meta);
        }
        return respond(res, 404, "Users not found", [], meta);
      } catch (error) {
        console.error("Error fetching users:", error);
        return respond(res, 500, "Server error");
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
          return respond(res, 404, "User not found");
        }

        if (result.modifiedCount === 1) {
          const updatedUser = await userCollection.findOne({ _id: id });
          return respond(res, 200, "User updated successfully", updatedUser);
        }
        return respond(res, 200, "No changes were made to the user");
      } catch (error) {
        console.error("Error updating user:", error);
        return respond(res, 500, "Server error");
      }
    });

    // POST: Save a message
    app.post("/messages", async (req, res) => {
      try {
        const newMessage = req.body;
        const existingMessage = await messageCollection.findOne({
          email: newMessage.email,
        });

        if (existingMessage) {
          return respond(res, 409, "Message already exists");
        }

        const result = await messageCollection.insertOne(newMessage);
        if (result.insertedId) {
          return respond(res, 201, "Message saved successfully");
        }
      } catch (error) {
        console.error("Error saving message:", error);
        return respond(res, 500, "Server error");
      }
    });

    // POST: Blood request for patient
    app.post("/blood-requests", async (req, res) => {
      try {
        const newBloodRequest = req.body;

        // Prevent self-donation
        if (
          newBloodRequest.requester.email ===
          newBloodRequest.metadata.donorEmail
        ) {
          return respond(
            res,
            403,
            "You cannot create a blood request for yourself"
          );
        }

        // Check if donor is already engaged with this requester
        const existingPair = await bloodRequestsCollection.findOne({
          "requester.email": newBloodRequest.requester.email,
          "metadata.donorEmail": newBloodRequest.metadata.donorEmail,
          "status.current": { $in: ["pending", "inprogress"] },
        });

        if (existingPair) {
          return respond(
            res,
            409,
            "This donor is already assisting with your active request"
          );
        }

        // Check if donor is busy with other requests
        const donorBusy = await bloodRequestsCollection.findOne({
          "metadata.donorEmail": newBloodRequest.metadata.donorEmail,
          "status.current": "inprogress",
        });

        if (donorBusy) {
          return respond(
            res,
            409,
            "This donor is currently helping another patient"
          );
        }

        const result = await bloodRequestsCollection.insertOne(newBloodRequest);
        if (result.insertedId) {
          return respond(res, 201, "Blood request created successfully", {
            insertedId: result.insertedId,
          });
        }
      } catch (error) {
        console.error("Error saving blood request:", error);
        return respond(res, 500, "Server error");
      }
    });

    // GET: Retrieve all requests with pagination
    app.get("/blood-requests", async (req, res) => {
      try {
        const { page = 1, limit = 10 } = req.query;

        const { items: bloodRequests, meta } = await paginate(
          bloodRequestsCollection,
          {},
          { page, limit }
        );

        if (bloodRequests.length) {
          return respond(
            res,
            200,
            "Blood requests retrieved successfully",
            bloodRequests,
            meta
          );
        }
        return respond(res, 404, "No blood requests found", [], meta);
      } catch (error) {
        console.error("Error fetching blood requests:", error);
        return respond(res, 500, "Server error");
      }
    });

    // GET: Retrieve single request by ID
    app.get("/blood-requests/:id", validateId, async (req, res) => {
      try {
        const id = req.validatedId;
        const bloodRequest = await bloodRequestsCollection.findOne({ _id: id });

        if (bloodRequest) {
          return respond(
            res,
            200,
            "Blood request retrieved successfully",
            bloodRequest
          );
        }
        return respond(res, 404, "Blood request not found");
      } catch (error) {
        console.error("Error fetching blood request:", error);
        return respond(res, 500, "Server error");
      }
    });

    // PATCH: Update blood request status by donor
    app.patch("/blood-requests/:id", validateId, async (req, res) => {
      try {
        const id = req.validatedId;
        const updateData = req.body;

        // Required field validation
        if (!updateData.donationStatus || !updateData.status?.current) {
          return respond(res, 400, "Missing required status fields");
        }

        const currentTime = new Date().toISOString();

        // Construct the update object
        const updateObj = {
          $set: {
            donationStatus: updateData.donationStatus,
            updatedAt: currentTime,
            "status.current": updateData.status.current,
            // Update metadata if provided
            ...(updateData.metadata && {
              metadata: updateData.metadata,
            }),
          },
          $push: {
            "status.history": {
              $each: [
                {
                  status: updateData.status.current,
                  changedAt: currentTime,
                  changedBy: {
                    id: updateData.metadata.donorId || "system",
                    name: updateData.metadata.donorName || "system",
                    email: updateData.metadata.donorEmail || "system",
                    role: "donor",
                  },
                },
              ],
              $slice: -10, // Keep last 10 status changes
            },
          },
        };

        const result = await bloodRequestsCollection.updateOne(
          { _id: id },
          updateObj
        );

        if (result.matchedCount === 0) {
          return respond(res, 404, "Blood request not found");
        }

        if (result.modifiedCount === 1) {
          const updatedRequest = await bloodRequestsCollection.findOne({
            _id: id,
          });
          return respond(
            res,
            200,
            "Request updated successfully",
            updatedRequest
          );
        }

        return respond(res, 200, "No changes were made to the request");
      } catch (error) {
        console.error("PATCH error:", error);
        return respond(res, 500, "Server error");
      }
    });

    // GET: Get recent donation requests
    app.get("/donations/recent", async (req, res) => {
      try {
        const { requesterEmail } = req.query;

        if (!requesterEmail) {
          return respond(res, 400, "Requester email is required");
        }

        const query = { "requester.email": requesterEmail };
        const { items: requests, meta } = await paginate(
          bloodRequestsCollection,
          query,
          { page: 1, limit: 3, sort: { createdAt: -1 } }
        );

        return respond(
          res,
          200,
          "Recent donation requests retrieved",
          requests,
          {
            ...meta,
            hasMore: meta.total > 3,
          }
        );
      } catch (error) {
        console.error("Error fetching recent donations:", error);
        return respond(res, 500, "Server error");
      }
    });

    // GET: Paginated donation requests with filtering
    app.get("/donations/my-requests", async (req, res) => {
      try {
        const { email, page = 1, limit = 10 } = req.query;

        if (!email) {
          return respond(res, 400, "Requester email is required");
        }

        const query = { "requester.email": email };

        const { items: requests, meta } = await paginate(
          bloodRequestsCollection,
          query,
          { page, limit, sort: { createdAt: -1 } }
        );

        return respond(res, 200, "Donation requests retrieved", requests, meta);
      } catch (error) {
        console.error("Error fetching donation requests:", error);
        return respond(res, 500, "Server error");
      }
    });

    // PATCH: Update blood request (requester edit)
    app.patch("/donations/my-requests/:id", validateId, async (req, res) => {
      try {
        const id = req.validatedId;
        const updateData = req.body;
        const requesterData = updateData?.requester || {};

        if (
          !updateData.recipient ||
          !updateData.donationInfo ||
          !updateData.location
        ) {
          return respond(res, 400, "Missing required fields in request body");
        }

        const existingRequest = await bloodRequestsCollection.findOne({
          _id: id,
        });
        if (!existingRequest) {
          return respond(res, 404, "Blood request not found");
        }

        const currentTime = new Date().toISOString();
        const updateObj = {
          $set: {
            recipient: {
              name: updateData.recipient.name,
              hospital: updateData.recipient.hospital,
            },
            donationInfo: {
              bloodGroup: updateData.donationInfo.bloodGroup,
              requiredDate: updateData.donationInfo.requiredDate,
              requiredTime: updateData.donationInfo.requiredTime,
              urgency: updateData.donationInfo.urgency || "normal",
              additionalInfo: updateData.donationInfo.additionalInfo || "",
            },
            location: {
              division: updateData.location.division,
              district: updateData.location.district,
              upazila: updateData.location.upazila,
              fullAddress: updateData.location.fullAddress,
            },
            updatedAt: currentTime,
            "status.current":
              updateData.status?.current || existingRequest.status.current,
          },
          $push: {
            "status.history": {
              $each: [
                {
                  status:
                    updateData.status?.current ||
                    existingRequest.status.current,
                  changedAt: currentTime,
                  changedBy: {
                    id: requesterData.id || "system",
                    name: requesterData.name || "system",
                    email: requesterData.email || "system",
                    role: "requester",
                  },
                },
              ],
              $slice: -10,
            },
          },
        };

        const result = await bloodRequestsCollection.updateOne(
          { _id: id },
          updateObj
        );

        if (result.matchedCount === 0) {
          return respond(res, 404, "Blood request not found");
        }

        if (result.modifiedCount === 1) {
          const updatedRequest = await bloodRequestsCollection.findOne({
            _id: id,
          });
          return respond(
            res,
            200,
            "Blood request updated successfully",
            updatedRequest
          );
        }
        return respond(
          res,
          200,
          "No changes made to the request",
          existingRequest
        );
      } catch (error) {
        console.error("Error updating blood request:", error);
        return respond(res, 500, "Server error");
      }
    });

    // DELETE: Delete a blood request (only if status is pending)
    app.delete("/donations/my-requests/:id", validateId, async (req, res) => {
      try {
        const id = req.validatedId;
        const { email } = req.query; // Requester's email for verification

        if (!email) {
          return respond(
            res,
            400,
            "Requester email is required for verification"
          );
        }

        // Find the request and verify ownership
        const request = await bloodRequestsCollection.findOne({ _id: id });
        if (!request) {
          return respond(res, 404, "Blood request not found");
        }

        // Verify requester owns this request
        if (request.requester.email !== email) {
          return respond(
            res,
            403,
            "You are not authorized to delete this request"
          );
        }

        // Only allow deletion if status is pending
        if (request.status.current !== "pending") {
          return respond(
            res,
            403,
            "Cannot delete request that is already in progress or completed"
          );
        }

        const result = await bloodRequestsCollection.deleteOne({ _id: id });
        if (result.deletedCount === 1) {
          return respond(res, 200, "Blood request deleted successfully");
        }
        return respond(res, 404, "Blood request not found");
      } catch (error) {
        console.error("Error deleting blood request:", error);
        return respond(res, 500, "Server error");
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
