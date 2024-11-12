export default {
  routes: [
    // Define any custom routes if needed
    { pattern: "/api/*", handler: "worker" },
  ],
  build: {
    command: "bun run build",
    directory: "dist",
  },
};
