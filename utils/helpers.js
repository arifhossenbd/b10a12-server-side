exports.respond = (res, status, message = null, data = null) => {
  console.log(message)
  const capitalizeFirstLetter = (text) => {
    return text
      ? text?.charAt(0).toUpperCase() + text?.slice(1).toLowerCase()
      : text;
  };
  const success = status >= 200 && status < 300;
  const response = {
    success,
    message: capitalizeFirstLetter(message || (success ? "Success" : "Error")),
  }
  if(data) response.data = data;
  return res.status(status).json(response);
};