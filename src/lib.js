const content = require("./content");
const files = require("./files");
const network = require("./network");

module.exports = {
  ...content,
  ...files,
  ...network
};
