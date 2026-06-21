function createPresentationPrimitives({ h, Box, Text, theme }) {
  function tint(color) {
    return theme.noColor ? undefined : theme.colors[color];
  }

  function SeverityText({ severity, children }) {
    const color =
      severity === "error"
        ? "red"
        : severity === "warn"
          ? "amber"
          : severity === "success"
            ? "green"
            : "azure";
    return h(Text, { color: tint(color) }, children);
  }

  function Panel({ title, subtitle, children }) {
    return h(
      Box,
      {
        borderStyle: "round",
        borderColor: tint("panel"),
        paddingX: 1,
        paddingY: 0,
        flexDirection: "column",
        marginBottom: 1
      },
      h(
        Box,
        { flexDirection: "column", marginBottom: subtitle ? 1 : 0 },
        h(Text, { color: tint("azure"), bold: true }, title),
        subtitle ? h(Text, { color: tint("slate") }, subtitle) : null
      ),
      children
    );
  }

  return {
    Panel,
    SeverityText,
    tint
  };
}

module.exports = { createPresentationPrimitives };
