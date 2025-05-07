/**
 * Standardized response helper
 * @param {object} res - Express response object
 * @param {number} status - HTTP status code
 * @param {string} message - Response message
 * @param {any} [data=null] - Response data (optional)
 * @param {object} [meta={}] - Metadata/pagination info (optional)
 * @returns {object} - Formatted JSON response
 */
exports.respond = (res, status, message, data = null, meta = {}) => {
  const response = {
    success: status >= 200 && status < 300,
    message,
  };

  // Always include data field if it's an array (even if empty)
  if (Array.isArray(data)) {
    response.data = data;
  }
  // Include data if it exists (non-null/undefined)
  else if (data !== null && data !== undefined) {
    response.data = data;
  }

  // Include meta if it has properties
  if (Object.keys(meta).length > 0) {
    response.meta = meta;
  }

  return res.status(status).json(response);
};

exports.getBloodGroupQuery = (bloodGroup) => {
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
