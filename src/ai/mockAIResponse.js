export const mockAIResponse = {
  actions: [
    {
      sequence: 1,
      playwrightAction: {
        action: "goto",
        url: "https://mattkenefick.github.io/sample-shadow-dom/",
      },
    },
    {
      sequence: 2,
      prerequisite: [
        { action: "switchToShadowRoot", target: "my-form" },
        { action: "switchToShadowRoot", target: "my-input" },
      ],
      playwrightAction: {
        action: "input",
        target: "My input placeholder",
        value: "testUsername",
      },
    },
  ],
};