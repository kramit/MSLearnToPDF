function readOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseCommandArgs(argv, definition, defaults = {}) {
  const args = { ...defaults };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    const option = definition[value];
    if (!option) throw new Error(`Unknown argument: ${value}`);
    if (option.kind === "boolean") {
      args[option.name] = true;
      continue;
    }
    const optionValue = readOptionValue(argv, index, value);
    index += 1;
    if (option.kind === "array") {
      args[option.name].push(optionValue);
    } else {
      args[option.name] = optionValue;
    }
  }
  return args;
}

module.exports = {
  parseCommandArgs,
  readOptionValue
};
