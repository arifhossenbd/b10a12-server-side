/**
 * Standardized response helper
 * @param {object} res - Express response object
 * @param {number} status - HTTP status code
 * @param {string} message - Response message
 * @param {any} [data=null] - Response data (optional)
 * @param {object} [meta={}] - Metadata/pagination info (optional)
 * @returns {object} - Formatted JSON response
 */
const respond = (res, status, message, data = null, meta = {}) => {
  const response = {
    success: status >= 200 && status < 300,
    message,
  };
  console.log(status, message);

  if (Array.isArray(data) || (data !== null && data !== undefined)) {
    response.data = data;
  }

  if (Object.keys(meta).length > 0) {
    response.meta = meta;
  }

  return res.status(status).json(response);
};

const getBloodGroupQuery = (bloodGroup) => {
  if (!bloodGroup) return {};

  const cleaned = bloodGroup
    .trim()
    .toUpperCase()
    .replace(/[^A-Z+-]/g, "");
  const baseGroup = cleaned.replace(/[+-]/g, "");

  if (!baseGroup) return {};

  return {
    bloodGroup: {
      $regex: new RegExp(`^${baseGroup}[+-]?$`, "i"),
    },
  };
};

/**
 * Enhanced pagination helper
 * @param {object} collection - MongoDB collection
 * @param {object} query - MongoDB query object
 * @param {object} options - Pagination options
 * @param {number} options.page - Current page number
 * @param {number} options.limit - Items per page
 * @param {object} options.sort - Sorting criteria
 * @returns {object} - Paginated result with metadata
 */
async function paginate(collection, query = {}, options = {}) {
  const page = Math.max(parseInt(options.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(options.limit) || 10, 1), 100);
  const skip = (page - 1) * limit;
  const sort = options.sort || { _id: -1 };

  // Execute count and find in parallel
  const [total, items] = await Promise.all([
    collection.countDocuments(query),
    collection.find(query).sort(sort).skip(skip).limit(limit).toArray(),
  ]);

  return {
    items,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}

module.exports = { respond, getBloodGroupQuery, paginate };