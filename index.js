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
const donationCollection = db.collection("donations");
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

    await donationCollection.createIndexes([
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
        const { email, name } = req.query;

        if (!email && !name) {
          return respond(res, 400, "Name and email parameter is required");
        }

        const user = await userCollection.findOne({ email });
        if (user) {
          return respond(res, 200, `${name} connected successfully`, user);
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
        if (newBloodRequest.requester?.email === newBloodRequest.donor?.email) {
          return respond(
            res,
            403,
            "You cannot create a blood request for yourself"
          );
        }

        // Check if donor is already engaged with this requester
        const existingPair = await bloodRequestsCollection.findOne({
          "requester?.email": newBloodRequest.requester?.email,
          "donor?.email": newBloodRequest.donor?.email,
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
          "donor?.email": newBloodRequest.donor?.email,
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

    // GET: Retrieve all blood requests with proper role-based access control
    app.get("/blood-requests", async (req, res) => {
      try {
        const { email, role, page = 1, limit = 10 } = req.query;

        // Build the query based on user role
        let query = {};

        if (email) {
          // Users can see requests where they're either requester OR donor
          query = {
            $or: [{ "requester.email": email }, { "donor.email": email }],
          };
        } else if (role === "admin" || role === "volunteer") {
          // Admins and volunteers can see all requests
          query = {};
        } else {
          return respond(
            res,
            400,
            "Email or valid role is required to fetch donation requests"
          );
        }

        const { items: requests, meta } = await paginate(
          bloodRequestsCollection,
          query,
          {
            page: parseInt(page),
            limit: parseInt(limit),
            sort: { createdAt: -1 },
          }
        );

        return respond(
          res,
          200,
          "Donation requests retrieved successfully",
          requests,
          meta
        );
      } catch (error) {
        console.error("Error fetching donation requests:", error);
        return respond(res, 500, "Server error while processing your request");
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

    // DELETE: Delete a blood request (only if status is pending or cancelled) by requester or admin
    app.delete("/blood-requests/:id", validateId, async (req, res) => {
      try {
        const id = req.validatedId;
        const { email, role } = req.query;

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

        // Authorization check
        if (role !== "admin" && request.requester?.email !== email) {
          return respond(
            res,
            403,
            "You are not authorized to delete this request"
          );
        }

        // Only allow deletion if status is pending OR cancelled
        if (
          request.status.current !== "pending" &&
          request.status.current !== "cancelled"
        ) {
          return respond(
            res,
            403,
            "Can only delete requests with 'pending' or 'cancelled' status"
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

    // GET: Get recent blood donation requests
    app.get("/recent/blood/request", async (req, res) => {
      try {
        const { requesterEmail } = req.query;

        if (!requesterEmail) {
          return respond(res, 400, "Requester email is required");
        }

        const query = { "requester?.email": requesterEmail };
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

    // Unified blood request update endpoint with role-based access control
    app.patch("/blood-requests/:id", validateId, async (req, res) => {
      try {
        const id = req.validatedId;
        const { role, email, name, action, status, ...updateData } = req.body;
        const currentTime = new Date().toISOString();

        // Validate required fields
        if (!role || !email) {
          return respond(res, 400, "Role and email are required");
        }

        // Validate action
        if (!["update", "complete", "cancel"].includes(action)) {
          return respond(res, 400, "Invalid action specified");
        }

        const existingRequest = await bloodRequestsCollection.findOne({
          _id: id,
        });
        if (!existingRequest) {
          return respond(res, 404, "Blood request not found");
        }

        // Check permissions based on action
        const isRequester = existingRequest.requester?.email === email;
        const isDonor = existingRequest.donor?.email === email;
        const currentStatus = existingRequest.status?.current;

        switch (action) {
          case "update":
            // For update action, allow full document update with permission checks
            if (!isRequester && role !== "admin" && role !== "volunteer") {
              return respond(res, 403, "Not authorized to update this request");
            }

            // Prepare update object
            const finalUpdate = {
              ...updateData,
              updatedAt: currentTime,
              // If status is being updated, maintain history
              ...(status?.current && {
                status: {
                  current: status.current,
                  history: [
                    ...(existingRequest.status.history || []),
                    {
                      status: status.current,
                      changedAt: currentTime,
                      changedBy: { email, name, role },
                    },
                  ],
                },
              }),
            };

            const updateResult = await bloodRequestsCollection.updateOne(
              { _id: id },
              { $set: finalUpdate }
            );

            if (updateResult.matchedCount === 0) {
              return respond(res, 404, "Blood request not found");
            }

            const updatedRequest = await bloodRequestsCollection.findOne({
              _id: id,
            });
            return respond(
              res,
              200,
              "Request updated successfully",
              updatedRequest
            );

          case "complete":
            if (
              !isRequester &&
              !isDonor &&
              role !== "admin" &&
              role !== "volunteer"
            ) {
              return respond(
                res,
                403,
                "Not authorized to complete this request"
              );
            }

            if (currentStatus !== "inprogress") {
              return respond(
                res,
                400,
                "Can only complete in-progress requests"
              );
            }

            const completeUpdate = {
              "status.current": "completed",
              "status.history": [
                ...(existingRequest.status.history || []),
                {
                  status: "completed",
                  changedAt: currentTime,
                  changedBy: { email, name, role },
                },
              ],
              updatedAt: currentTime,
            };

            const completeResult = await bloodRequestsCollection.updateOne(
              { _id: id },
              { $set: completeUpdate }
            );

            if (completeResult.matchedCount === 0) {
              return respond(res, 404, "Blood request not found");
            }

            const completedRequest = await bloodRequestsCollection.findOne({
              _id: id,
            });
            return respond(
              res,
              200,
              "Request completed successfully",
              completedRequest
            );

          case "cancel":
            if (!isRequester && role !== "admin") {
              return respond(
                res,
                403,
                "Only requester or admin can cancel request"
              );
            }

            if (!["pending", "inprogress"].includes(currentStatus)) {
              return respond(
                res,
                400,
                "Can only cancel pending or in-progress requests"
              );
            }

            const cancelUpdate = {
              "status.current": "cancelled",
              "status.history": [
                ...(existingRequest.status.history || []),
                {
                  status: "cancelled",
                  changedAt: currentTime,
                  changedBy: { email, name, role },
                },
              ],
              updatedAt: currentTime,
            };

            const cancelResult = await bloodRequestsCollection.updateOne(
              { _id: id },
              { $set: cancelUpdate }
            );

            if (cancelResult.matchedCount === 0) {
              return respond(res, 404, "Blood request not found");
            }

            const cancelledRequest = await bloodRequestsCollection.findOne({
              _id: id,
            });
            return respond(
              res,
              200,
              "Request cancelled successfully",
              cancelledRequest
            );

          default:
            return respond(res, 400, "Invalid action specified");
        }
      } catch (error) {
        console.error("Error updating blood request:", error);
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
